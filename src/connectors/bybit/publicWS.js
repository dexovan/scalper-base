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

    this.connectPromise = null;   // 🔥 Promise da čeka na full connection

    // 🔥 ORDERBOOK STORAGE (added for AI Market Hub compatibility)
    this.orderbooks = new Map();  // symbol -> { bids: [[price,qty]], asks: [[price,qty]], lastUpdate: timestamp }
  }

  /**
   * Start WS konekcije.
   * options:
   *  - symbols: ["BTCUSDT","ETHUSDT", ...]
   *  - channels: ["tickers","publicTrade","orderbook.50"]
   *  - onEvent: (eventObj) => void
   * @returns {Promise<void>} Resolves when WS opens and first subscription sent
   */
  connect({
    symbols = ["BTCUSDT", "ETHUSDT"],
    channels = ["tickers"],
    onEvent = null,
  } = {}) {
    console.log("🔥 [METRICS-WS] connect() START - symbols:", symbols, "channels:", channels);

    this.subscriptions = this._buildTopics(symbols, channels);
    this.onEvent = onEvent || (() => {});

    console.log("📡 [METRICS-WS] connect() → topics built:", this.subscriptions);

    // 🔥 Return promise that resolves when WS fully opens or rejects on error
    // ULTRA-SHORT timeout (3s) - fail fast if Bybit server unreachable
    this.connectPromise = new Promise((resolve, reject) => {
      console.log("🔥 [METRICS-WS] Promise created, about to call _open()...");

      this._openPromise = resolve;     // Store resolve for use in _open()
      this._rejectPromise = reject;    // Store reject for use on error

      // CRITICAL: Only wait 3s for actual connection
      // If Bybit is down/unreachable, fail FAST so engine can continue
      const timeout = setTimeout(() => {
        if (!this.connected) {
          console.warn(`⏳ [METRICS-WS] ⚠️ TIMEOUT: Connect failed in 3s - Bybit unavailable or network issue`);
          console.warn(`⏳ [METRICS-WS] Engine will continue WITHOUT WebSocket for now`);
          console.warn(`⏳ [METRICS-WS] Reconnection attempts will continue in background...`);
          // Resolve anyway to let engine continue
          // WebSocket will keep trying to reconnect automatically
          resolve();
        }
        clearTimeout(timeout);
      }, 3000); // ⚠️ ONLY 3 seconds!

      this._openTimeout = timeout;
      console.log("🔥 [METRICS-WS] NOW CALLING _open()...");
      this._open();
      console.log("🔥 [METRICS-WS] _open() returned");
    });

    return this.connectPromise;
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
    console.log("🔥 [_OPEN] START - checking if ws already open...");

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      console.log("🔥 [_OPEN] WS already open, returning early");
      return;
    }

    console.log("🔥 [_OPEN] Will attempt new connection");
    console.log(`📡 [METRICS-WS] _open() START → Attempting connection to: ${this.url}`);
    console.log(`📡 [METRICS-WS] Current state: ws=${this.ws ? `exists(${this.ws.readyState})` : 'null'}, connected=${this.connected}`);
    wsMetrics.wsMarkConnecting();
    this.connected = false;

    try {
      console.log("📡 [METRICS-WS] Creating new WebSocket...");
      console.log("📡 [METRICS-WS] URL:", this.url);
      this.ws = new WebSocket(this.url);
      console.log("✅ [METRICS-WS] WebSocket object created successfully");
      console.log(`📡 [METRICS-WS] WebSocket readyState after creation: ${this.ws.readyState}`);

      // 🔥 EMERGENCY TIMEOUT: If WS doesn't connect within 3 seconds, assume it's dead
      const connectDeadlineTimer = setTimeout(() => {
        if (this.ws && this.ws.readyState !== WebSocket.OPEN) {
          console.error("🔴 [METRICS-WS] DEADLINE: WebSocket didn't connect within 3s - forcefully closing");
          console.error(`   Current readyState: ${this.ws?.readyState} (CONNECTING=0, OPEN=1, CLOSING=2, CLOSED=3)`);
          try {
            this.ws.close();
          } catch (e) {
            console.error("   Error closing WS:", e.message);
          }
          this.ws = null;
          this._scheduleReconnect();
        }
      }, 3000);

      this._connectDeadlineTimer = connectDeadlineTimer;

      // ------------- OPEN -------------
      this.ws.on("open", () => {
        console.log("🟢 [METRICS-WS] Connected!");

        // Clear deadline timer since WS connected
        if (this._connectDeadlineTimer) {
          clearTimeout(this._connectDeadlineTimer);
          this._connectDeadlineTimer = null;
        }

        this.reconnectAttempts = 0;
        this.connected = true;
        this._messageCount = 0;
        wsMetrics.wsMarkConnected();

        // Clear timeout since WS connected
        if (this._openTimeout) {
          clearTimeout(this._openTimeout);
        }

        this._sendSubscribe();
        this._startHeartbeat();

        // 🔥 RESOLVE CONNECT PROMISE
        if (this._openPromise) {
          console.log("🟢 [METRICS-WS] Resolving connectPromise");
          this._openPromise();
        }
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

          // 🔥 FEED ORDERBOOK DATA (added for AI Market Hub compatibility)
          if (msg.topic && msg.topic.startsWith("orderbook.") && msg.data) {
            const symbol = msg.topic.split(".")[2]; // orderbook.50.BTCUSDT -> BTCUSDT

            // DEBUG: Log orderbook messages - CRITICAL for diagnostics
            if (this._messageCount <= 50 || Math.random() < 0.01) {
              const msgType = msg.type || msg.data?.type || 'unknown';
              console.log(`📊 [ORDERBOOK-MSG] Topic: ${msg.topic}, Symbol: ${symbol}, Type: ${msgType}, HasBids: ${msg.data?.b?.length || 0}, HasAsks: ${msg.data?.a?.length || 0}`);
            }

            if (symbol) {
              this._handleOrderbookMessage(symbol, msg);
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
        if (this._connectDeadlineTimer) {
          clearTimeout(this._connectDeadlineTimer);
          this._connectDeadlineTimer = null;
        }
        console.warn("🔴 [METRICS-WS] Closed:", code, reason?.toString());
        wsMetrics.wsMarkDisconnected();
        this._cleanupWS();
        this._scheduleReconnect();
      });

      // ------------- ERROR -------------
      this.ws.on("error", (err) => {
        if (this._connectDeadlineTimer) {
          clearTimeout(this._connectDeadlineTimer);
          this._connectDeadlineTimer = null;
        }
        console.error("❌ [METRICS-WS] WebSocket Error Event Fired:", err.message);
        console.error("   Error code:", err.code);
        console.error("   Error details:", JSON.stringify(err, null, 2));
        wsMetrics.wsMarkError();

        // 🔥 REJECT CONNECT PROMISE
        if (this._rejectPromise) {
          console.error("❌ [METRICS-WS] Rejecting connectPromise due to error");
          this._rejectPromise(err);
        }

        this._cleanupWS();
        this._scheduleReconnect();
      });
    } catch (err) {
      console.error("❌ [METRICS-WS] Open exception (try/catch):", err.message);
      console.error("   Exception details:", JSON.stringify(err, null, 2));
      wsMetrics.wsMarkError();

      // 🔥 REJECT CONNECT PROMISE ON EXCEPTION
      if (this._rejectPromise) {
        console.error("❌ [METRICS-WS] Rejecting connectPromise due to exception");
        this._rejectPromise(err);
      }

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

    // DEBUG: Log all topics being subscribed (especially orderbook topics)
    const orderbookTopics = this.subscriptions.filter(t => t.includes('orderbook'));
    const tickerTopics = this.subscriptions.filter(t => t.includes('tickers'));
    const tradeTopics = this.subscriptions.filter(t => t.includes('publicTrade'));

    console.log(`🔍 [METRICS-WS DEBUG] Topic breakdown:`);
    console.log(`   - Orderbook topics: ${orderbookTopics.length} (${orderbookTopics.slice(0, 3).join(', ')}${orderbookTopics.length > 3 ? '...' : ''})`);
    console.log(`   - Ticker topics: ${tickerTopics.length} (${tickerTopics.slice(0, 3).join(', ')}${tickerTopics.length > 3 ? '...' : ''})`);
    console.log(`   - Trade topics: ${tradeTopics.length}`);

    batches.forEach((batch, index) => {
      setTimeout(() => {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

        const payload = {
          op: "subscribe",
          args: batch,
        };

        try {
          // DEBUG: Log batch details before sending
          const batchOrderbooks = batch.filter(t => t.includes('orderbook'));
          const batchTickers = batch.filter(t => t.includes('tickers'));

          console.log(`📡 [METRICS-WS] Batch ${index + 1}/${batches.length}: ${batch.length} topics (${batchOrderbooks.length} orderbooks, ${batchTickers.length} tickers)`);
          console.log(`📡 [METRICS-WS] Sending: ${JSON.stringify(payload)}`);

          this.ws.send(JSON.stringify(payload));
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
  async updateTradeSubscriptions({ add = [], remove = [] } = {}) {
    // ⏳ RETRY LOGIC: Wait up to 60s for WS to be ready
    let attempts = 0;
    const MAX_ATTEMPTS = 60;  // 60 seconds for WS to open (can be slow on startup)

    while ((!this.ws || this.ws.readyState !== WebSocket.OPEN) && attempts < MAX_ATTEMPTS) {
      if (attempts === 0) {
        console.warn(`⏳ [METRICS-WS] WS not ready yet, waiting for connection (add: ${add.length}, remove: ${remove.length})...`);
      }
      if (attempts % 10 === 0 && attempts > 0) {
        console.warn(`⏳ [METRICS-WS] Still waiting... (${attempts}/${MAX_ATTEMPTS}s)`);
      }
      await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
      attempts++;
    }

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.error(`❌ [METRICS-WS] Failed to update trade subs after ${MAX_ATTEMPTS}s - WS still not open`);
      console.warn(`⚠️ [METRICS-WS] Check: ws exists=${!!this.ws}, readyState=${this.ws?.readyState} (OPEN=${WebSocket.OPEN})`);
      return;
    }

    if (attempts > 0) {
      console.log(`✅ [METRICS-WS] WS connected after ${attempts}s, proceeding with subscription update (add: ${add.length}, remove: ${remove.length})`);
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

  // ========================================================
  // ORDERBOOK METHODS (AI Market Hub compatibility)
  // ========================================================

  /**
   * Handle orderbook WebSocket message
   * @param {string} symbol - e.g., "BTCUSDT"
   * @param {object} msg - Bybit WS message with { type: "snapshot"|"delta", data: {...} }
   */
  _handleOrderbookMessage(symbol, msg) {
    if (!msg.data) return;

    const { type, data } = msg;
    const now = Date.now();

    if (type === "snapshot") {
      // Full orderbook snapshot
      const bids = (data.b || []).map(([p, q]) => [parseFloat(p), parseFloat(q)]);
      const asks = (data.a || []).map(([p, q]) => [parseFloat(p), parseFloat(q)]);

      this.orderbooks.set(symbol, {
        bids: bids.slice(0, 20),  // Keep top 20 levels
        asks: asks.slice(0, 20),
        lastUpdate: now
      });
    } else if (type === "delta") {
      // Incremental update
      const existing = this.orderbooks.get(symbol);
      if (!existing) return; // Need snapshot first

      // Update bids
      if (data.b && data.b.length > 0) {
        for (const [priceStr, qtyStr] of data.b) {
          const price = parseFloat(priceStr);
          const qty = parseFloat(qtyStr);

          // Remove existing level
          existing.bids = existing.bids.filter(([p]) => p !== price);

          // Add new level if qty > 0
          if (qty > 0) {
            existing.bids.push([price, qty]);
          }
        }

        // Sort bids descending (highest first)
        existing.bids.sort((a, b) => b[0] - a[0]);
        existing.bids = existing.bids.slice(0, 20);
      }

      // Update asks
      if (data.a && data.a.length > 0) {
        for (const [priceStr, qtyStr] of data.a) {
          const price = parseFloat(priceStr);
          const qty = parseFloat(qtyStr);

          // Remove existing level
          existing.asks = existing.asks.filter(([p]) => p !== price);

          // Add new level if qty > 0
          if (qty > 0) {
            existing.asks.push([price, qty]);
          }
        }

        // Sort asks ascending (lowest first)
        existing.asks.sort((a, b) => a[0] - b[0]);
        existing.asks = existing.asks.slice(0, 20);
      }

      existing.lastUpdate = now;
    }
  }

  /**
   * Get market state for a symbol (AI Market Hub compatible API)
   * @param {string} symbol - e.g., "BTCUSDT"
   * @returns {object|null} Market state with price, bid, ask, imbalance, spread, orderFlowNet60s
   */
  getSymbolState(symbol) {
    const orderbook = this.orderbooks.get(symbol);
    if (!orderbook || !orderbook.bids.length || !orderbook.asks.length) {
      return null;
    }

    const bid = orderbook.bids[0][0];  // Best bid price
    const ask = orderbook.asks[0][0];  // Best ask price
    const price = (bid + ask) / 2;     // Mid price

    // Calculate spread
    const spread = ask - bid;
    const spreadPercent = (spread / price) * 100;

    // Calculate imbalance (bid volume / ask volume)
    const bidVolTop20 = orderbook.bids.slice(0, 20).reduce((sum, [p, q]) => sum + (p * q), 0);
    const askVolTop20 = orderbook.asks.slice(0, 20).reduce((sum, [p, q]) => sum + (p * q), 0);

    let imbalance = 1.0;
    if (askVolTop20 > 0) {
      imbalance = bidVolTop20 / askVolTop20;
    } else if (bidVolTop20 > 0) {
      imbalance = 3.0; // Max imbalance if no asks
    }

    // Get order flow from TradeFlowAggregator
    const flowData = tradeFlowAggregator.getFlow(symbol);
    const orderFlowNet60s = flowData?.netFlow || 0;
    const orderFlowBuyVol60s = flowData?.buyVol || 0;
    const orderFlowSellVol60s = flowData?.sellVol || 0;

    return {
      symbol,
      price,
      bid,
      ask,
      spread,
      spreadPercent,
      imbalance,
      orderFlowNet60s,
      orderFlowBuyVol60s,
      orderFlowSellVol60s,
      volumeAbs60s: orderFlowBuyVol60s + orderFlowSellVol60s,
      lastUpdate: orderbook.lastUpdate
    };
  }
}

// Export TradeFlowAggregator instance for API access
export { tradeFlowAggregator };

// default singleton (ako ti nekad zatreba globalno)
const bybitPublicWS = new BybitPublicWS();
export default bybitPublicWS;
