// ===========================================================
// src/connectors/bybit/publicWS.js
// Bybit Public WS v2 – Stable Metrics Connector (ESM)
// ===========================================================

import WebSocket from "ws";
import * as wsMetrics from "../../monitoring/wsMetrics.js";
import { TradeFlowAggregator } from "../../market/TradeFlowAggregator.js";

// PRAVILAN URL za linear USDT perp public feed
const WS_URL = "wss://stream.bybit.com/v5/public/linear";

// 🚀 GLOBAL TRADE FLOW AGGREGATOR
const tradeFlowAggregator = new TradeFlowAggregator({ windowMs: 60_000 });

export class BybitPublicWS {
  constructor() {
    this.ws = null;
    this.url = WS_URL;

    this.subscriptions = [];      // npr. ["tickers.BTCUSDT", "publicTrade.BTCUSDT"]
    this.tradeTopics = new Set(); // samo publicTrade.* topics (managed by flowHotlistManager)
    this.onEvent = null;          // callback za engine/metrics

    this.reconnectAttempts = 0;
    this.pingTimer = null;
    this.reconnectTimer = null;

    this.connected = false;
    this._messageCount = 0;       // lokalni counter za debug
  }

  /**
   * Start WS konekcije.
   * options:
   *  - symbols: ["BTCUSDT","ETHUSDT", ...]
   *  - channels: ["tickers","publicTrade","orderbook.50"]
   *  - onEvent: (eventObj) => void
   */
  connect({
    symbols = ["BTCUSDT", "ETHUSDT"],
    channels = ["tickers"],
    onEvent = null,
  } = {}) {
    this.subscriptions = this._buildTopics(symbols, channels);
    this.onEvent = onEvent || (() => {});

    console.log("📡 [METRICS-WS] connect() → topics:", this.subscriptions);
    this._open();
  }

  _buildTopics(symbols, channels) {
    const topics = [];
    for (const s of symbols) {
      for (const c of channels) {
        topics.push(`${c}.${s}`);
      }
    }
    return topics;
  }

  _open() {
    // ako je već otvoren, ne otvaraj opet
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;

    console.log("📡 [METRICS-WS] _open() → URL:", this.url);
    wsMetrics.wsMarkConnecting();
    this.connected = false;

    try {
      this.ws = new WebSocket(this.url);

      // ------------- OPEN -------------
      this.ws.on("open", () => {
        console.log("🟢 [METRICS-WS] Connected!");
        this.reconnectAttempts = 0;
        this.connected = true;
        this._messageCount = 0;
        wsMetrics.wsMarkConnected();

        this._sendSubscribe();
        this._startHeartbeat();
      });

      // ----------- MESSAGE ------------
      this.ws.on("message", (raw) => {
        wsMetrics.wsMarkMessage();
        this._messageCount++;

        let msg = null;
        try {
          msg = JSON.parse(raw.toString());
        } catch (err) {
          console.error("❌ [METRICS-WS] JSON parse error:", err.message);
          return;
        }

        // Bybit ponekad koristi ping/pong protokol
        if (msg.op === "ping" || msg.req_id === "ping") {
          this._sendPong();
          return;
        }

        if (msg.topic) {
          // DEBUG: Log first 20 messages to see what topics arrive
          if (this._messageCount <= 20) {
            console.log(`📨 [publicWS MSG ${this._messageCount}] Topic: ${msg.topic}`);
          }

          // 🚀 FEED TRADE DATA TO AGGREGATOR (before passing to onEvent)
          if (msg.topic && msg.topic.startsWith("publicTrade.") && msg.data) {
            const symbol = msg.topic.replace("publicTrade.", "");
            const trades = Array.isArray(msg.data) ? msg.data : [msg.data];

            // DEBUG: Sample 1% of trade messages
            if (Math.random() < 0.01) {
              console.log(`🔥 [publicWS] TRADE MESSAGE: ${symbol}, ${trades.length} trades`);
              console.log(`🔥 [publicWS] Sample trade:`, JSON.stringify(trades[0]));
            }

            for (const t of trades) {
              const tradePrice = parseFloat(t.p || t.price || 0);
              const tradeQty = parseFloat(t.v || t.qty || 0);
              const tradeSide = t.S || t.side || "UNKNOWN";
              const tradeTs = parseInt(t.T || t.timestamp || Date.now());

              const volumeUSD = tradePrice * tradeQty;

              // DEBUG: Sample 0.1% to see actual values
              if (Math.random() < 0.001) {
                console.log(`💰 [FLOW] ${symbol}: price=${tradePrice}, qty=${tradeQty}, vol=${volumeUSD}, side=${tradeSide}`);
              }

              if (tradePrice > 0 && tradeQty > 0) {
                tradeFlowAggregator.onTrade({
                  symbol,
                  side: tradeSide,
                  qty: volumeUSD,
                  ts: tradeTs
                });
              }
            }
          }

          // prosledi event napolje (eventHub / metrics)
          try {
            this.onEvent(msg);
          } catch (err) {
            console.error("❌ [METRICS-WS] onEvent handler error:", err);
          }
        }
      });

      // ------------- CLOSE -------------
      this.ws.on("close", (code, reason) => {
        console.warn("🔴 [METRICS-WS] Closed:", code, reason?.toString());
        wsMetrics.wsMarkDisconnected();
        this._cleanupWS();
        this._scheduleReconnect();
      });

      // ------------- ERROR -------------
      this.ws.on("error", (err) => {
        console.error("❌ [METRICS-WS] Error:", err.message);
        wsMetrics.wsMarkError();
        this._cleanupWS();
        this._scheduleReconnect();
      });
    } catch (err) {
      console.error("❌ [METRICS-WS] Open exception:", err);
      wsMetrics.wsMarkError();
      this._scheduleReconnect();
    }
  }

  _sendSubscribe() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    if (!this.subscriptions.length) {
      console.log("⚠️ [METRICS-WS] No topics to subscribe");
      return;
    }

    // Bybit v5 limit: max 10 args per subscribe message
    const BATCH_SIZE = 10;
    const batches = [];

    for (let i = 0; i < this.subscriptions.length; i += BATCH_SIZE) {
      batches.push(this.subscriptions.slice(i, i + BATCH_SIZE));
    }

    console.log(`📡 [METRICS-WS] Subscribing to ${this.subscriptions.length} topics in ${batches.length} batches...`);

    batches.forEach((batch, index) => {
      setTimeout(() => {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

        const payload = {
          op: "subscribe",
          args: batch,
        };

        try {
          this.ws.send(JSON.stringify(payload));
          console.log(`📡 [METRICS-WS] Batch ${index + 1}/${batches.length}: ${batch.length} topics`);
        } catch (err) {
          console.error(`❌ [METRICS-WS] Subscribe batch ${index + 1} error:`, err.message);
        }
      }, index * 100); // 100ms delay between batches
    });
  }

  _sendPong() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    try {
      this.ws.send(JSON.stringify({ op: "pong" }));
    } catch (err) {
      console.error("❌ [METRICS-WS] Pong error:", err.message);
    }
  }

  _startHeartbeat() {
    this._stopHeartbeat();
    // 20s ping je sasvim ok za Bybit v5
    this.pingTimer = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      try {
        this.ws.send(JSON.stringify({ op: "ping", req_id: "ping" }));
      } catch (err) {
        console.error("❌ [METRICS-WS] Ping error:", err.message);
      }
    }, 20_000);
  }

  _stopHeartbeat() {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  _scheduleReconnect() {
    if (this.reconnectTimer) return;

    this.reconnectAttempts++;
    wsMetrics.wsMarkReconnect();

    const delay = Math.min(2_000 * this.reconnectAttempts, 30_000);
    console.log(`🔁 [METRICS-WS] Reconnecting in ${delay}ms...`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this._open();
    }, delay);
  }

  _cleanupWS() {
    this._stopHeartbeat();

    if (this.ws) {
      try {
        this.ws.removeAllListeners();
        this.ws.close();
      } catch (_) {
        // ignore
      }
      this.ws = null;
    }

    this.connected = false;
  }

  disconnect() {
    this._stopHeartbeat();

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      try {
        this.ws.close();
      } catch (_) {
        // ignore
      }
    }

    wsMetrics.wsMarkDisconnected();
    this.connected = false;
    console.log("⏹️ [METRICS-WS] Disconnected by request.");
  }

  /**
   * 🚀 DYNAMIC TRADE SUBSCRIPTION
   * Add/remove publicTrade.* topics without reconnecting entire WS
   * Used by flowHotlistManager to subscribe only top 20-30 symbols
   *
   * @param {Object} options
   * @param {string[]} options.add - Symbols to add (e.g., ["BTCUSDT", "ETHUSDT"])
   * @param {string[]} options.remove - Symbols to remove
   */
  updateTradeSubscriptions({ add = [], remove = [] } = {}) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn("⚠️ [METRICS-WS] Cannot update trade subs, WS not open");
      return;
    }

    const BATCH_SIZE = 10;

    // 1) UNSUBSCRIBE removed symbols
    const toUnsub = remove
      .map(s => `publicTrade.${s}`)
      .filter(topic => this.tradeTopics.has(topic));

    if (toUnsub.length) {
      for (let i = 0; i < toUnsub.length; i += BATCH_SIZE) {
        const batch = toUnsub.slice(i, i + BATCH_SIZE);
        try {
          this.ws.send(JSON.stringify({ op: "unsubscribe", args: batch }));
          console.log(`📡 [METRICS-WS] 🔴 Unsub trade batch (${batch.length}):`, batch.join(", "));
        } catch (err) {
          console.error("❌ [METRICS-WS] Unsub error:", err.message);
        }
      }
      toUnsub.forEach(t => this.tradeTopics.delete(t));
    }

    // 2) SUBSCRIBE new symbols
    const toSub = add
      .map(s => `publicTrade.${s}`)
      .filter(topic => !this.tradeTopics.has(topic));

    if (toSub.length) {
      for (let i = 0; i < toSub.length; i += BATCH_SIZE) {
        const batch = toSub.slice(i, i + BATCH_SIZE);
        try {
          this.ws.send(JSON.stringify({ op: "subscribe", args: batch }));
          console.log(`📡 [METRICS-WS] 🟢 Sub trade batch (${batch.length}):`, batch.join(", "));
        } catch (err) {
          console.error("❌ [METRICS-WS] Sub error:", err.message);
        }
      }
      toSub.forEach(t => this.tradeTopics.add(t));
    }

    console.log(`🔥 [METRICS-WS] Trade topics updated: ${this.tradeTopics.size} active`);
  }
}

// Export TradeFlowAggregator instance for API access
export { tradeFlowAggregator };

// default singleton (ako ti nekad zatreba globalno)
const bybitPublicWS = new BybitPublicWS();
export default bybitPublicWS;
