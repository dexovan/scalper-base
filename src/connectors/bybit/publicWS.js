// ===========================================================
// src/connectors/bybit/publicWS.js
// Bybit Public WS v2 – Stable Metrics Connector (ESM)
// ===========================================================

import WebSocket from "ws";
import * as wsMetrics from "../../monitoring/wsMetrics.js";

// PRAVILAN URL za linear USDT perp public feed
const WS_URL = "wss://stream.bybit.com/v5/public/linear";

export class BybitPublicWS {
  constructor() {
    this.ws = null;
    this.url = WS_URL;

    this.subscriptions = [];      // npr. ["tickers.BTCUSDT", "publicTrade.BTCUSDT"]
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

    const payload = {
      op: "subscribe",
      args: this.subscriptions,
    };

    try {
      this.ws.send(JSON.stringify(payload));
      console.log("📡 [METRICS-WS] Subscribed:", this.subscriptions);
    } catch (err) {
      console.error("❌ [METRICS-WS] Subscribe error:", err.message);
    }
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
}

// default singleton (ako ti nekad zatreba globalno)
const bybitPublicWS = new BybitPublicWS();
export default bybitPublicWS;
