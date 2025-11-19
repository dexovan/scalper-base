// ===========================================================
// Bybit Public WS v2 – Stable Metrics Connector (ESM)
// ===========================================================

import WebSocket from "ws";
import {
  wsMarkConnecting,
  wsMarkConnected,
  wsMarkDisconnected,
  wsMarkError,
  wsMarkReconnect,
  wsMarkMessage,
} from "../../monitoring/wsMetrics.js";

// MUST BE EXACT – Linear cluster
//const WS_URL = "wss://stream.bybit.com/v5/public/linear";
const WS_URL = "wss://stream.bybit.com/v5/public/linear?category=linear";//

export class BybitPublicWS {
  constructor() {
    this.ws = null;
    this.url = WS_URL;

    this.subscriptions = [];
    this.onEvent = null;

    this.reconnectAttempts = 0;
    this.pingTimer = null;
    this.reconnectTimer = null;

    this.connected = false;
  }

  connect({ symbols = [], channels = [], onEvent = null } = {}) {
    this.subscriptions = this._buildTopics(symbols, channels);
    this.onEvent = onEvent || (() => {});
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
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;

    wsMarkConnecting();
    this.connected = false;

    try {
      console.log("📡 [WS-METRICS] Opening WS:", this.url);
      this.ws = new WebSocket(this.url);

      // ------------- OPEN -------------
      this.ws.on("open", () => {
        console.log("🟢 [WS-METRICS] Connected");
        this.reconnectAttempts = 0;
        this.connected = true;
        wsMarkConnected();

        this._sendSubscribe();
        this._startHeartbeat();
      });

      // ----------- MESSAGE ------------
      this.ws.on("message", (raw) => {
        wsMarkMessage();

        let msg = null;
        try {
          msg = JSON.parse(raw.toString());
        } catch (err) {
          console.error("[WS-METRICS] JSON error:", err);
          return;
        }

        // bybit v5 ping
        if (msg.op === "ping" || msg.req_id === "ping") {
          this._sendPong();
          return;
        }

        if (msg.topic) {
          this.onEvent(msg);
        }
      });

      // ------------- CLOSE -------------
      this.ws.on("close", (code) => {
        console.warn("🔴 [WS-METRICS] Closed:", code);
        wsMarkDisconnected();
        this._cleanupWS();
        this._scheduleReconnect();
      });

      // ------------- ERROR -------------
      this.ws.on("error", (err) => {
        console.error("❌ [WS-METRICS] Error:", err.message);
        wsMarkError();
        this._cleanupWS();
        this._scheduleReconnect();
      });

    } catch (err) {
      console.error("❌ [WS-METRICS] Open exception:", err);
      wsMarkError();
      this._scheduleReconnect();
    }
  }

  _sendSubscribe() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    if (!this.subscriptions.length) {
      console.log("⚠️ [WS-METRICS] No topics to subscribe");
      return;
    }

    const payload = { op: "subscribe", args: this.subscriptions };

    try {
      this.ws.send(JSON.stringify(payload));
      console.log("📡 [WS-METRICS] Subscribed:", this.subscriptions);
    } catch (err) {
      console.error("[WS-METRICS] Subscribe error:", err);
    }
  }

  _sendPong() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    try {
      this.ws.send(JSON.stringify({ op: "pong" }));
    } catch {}
  }

  _startHeartbeat() {
    this._stopHeartbeat();
    this.pingTimer = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      try {
        this.ws.send(JSON.stringify({ op: "ping", req_id: "ping" }));
      } catch {}
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
    wsMarkReconnect();

    const delay = Math.min(2000 * this.reconnectAttempts, 30000);
    console.log(`🔁 [WS-METRICS] Reconnecting in ${delay}ms...`);

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
      } catch {}

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
      } catch {}
    }

    wsMarkDisconnected();
    this.connected = false;
  }
}

const bybitPublicWS = new BybitPublicWS();
export default bybitPublicWS;
