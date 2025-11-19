// src/connectors/bybit/publicWS.js
// Bybit Public WS v2 – stable connector (ESM)

import WebSocket from "ws";
import {
  wsMarkConnecting,
  wsMarkConnected,
  wsMarkDisconnected,
  wsMarkError,
  wsMarkReconnect,
  wsMarkMessage,
} from "../../monitoring/wsMetrics.js";

// Use non-linear cluster for metrics WS
const WS_URL = "wss://stream.bybit.com/v5/public/linear";

export class BybitPublicWS {
  constructor() {
    this.ws = null;
    this.url = WS_URL;

    this.subscriptions = []; // npr. ["tickers.BTCUSDT", "publicTrade.BTCUSDT"]
    this.onEvent = null;

    this.reconnectAttempts = 0;
    this.pingTimer = null;
    this.reconnectTimer = null;

    this.connected = false;
  }

  /**
   * Startuje WS konekciju.
   * options:
   *  - symbols: ["BTCUSDT","ETHUSDT", ...]
   *  - channels: ["tickers","publicTrade","orderbook.1"]
   *  - onEvent: (eventObj) => void
   */
  connect({
    symbols = ["BTCUSDT", "ETHUSDT"],
    channels = ["tickers"],
    onEvent = null,
  } = {}) {
    this.subscriptions = this._buildTopics(symbols, channels);
    this.onEvent = onEvent;
    this._open();
  }

  _buildTopics(symbols, channels) {
    const topics = [];
    for (const sym of symbols) {
      for (const ch of channels) {
        topics.push(`${ch}.${sym}`);
      }
    }
    return topics;
  }

  _open() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;

    wsMarkConnecting();
    this.connected = false;

    try {
      this.ws = new WebSocket(this.url);

      this.ws.on("open", () => {
        this.reconnectAttempts = 0;
        this.connected = true;
        wsMarkConnected();

        this._sendSubscribe();
        this._startHeartbeat();
      });

      this.ws.on("message", (raw) => {
        wsMarkMessage();

        let msg;
        try {
          msg = JSON.parse(raw.toString());
        } catch (e) {
          console.error("[BybitWS] JSON parse error:", e);
          return;
        }

        // Bybit v5 ping/pong
        if (msg.op === "ping" || msg.req_id === "ping") {
          this._sendPong();
          return;
        }

        if (msg.topic && this.onEvent) {
          this.onEvent(msg);
        }
      });

      this.ws.on("close", (code, reason) => {
        console.warn("[BybitWS] closed:", code, reason?.toString());
        this._cleanupWS();
        wsMarkDisconnected();
        this._scheduleReconnect();
      });

      this.ws.on("error", (err) => {
        console.error("[BybitWS] error:", err);
        wsMarkError();
        this._cleanupWS();
        this._scheduleReconnect();
      });
    } catch (err) {
      console.error("[BybitWS] open() exception:", err);
      wsMarkError();
      this._scheduleReconnect();
    }
  }

  _sendSubscribe() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (!this.subscriptions.length) return;

    const payload = {
      op: "subscribe",
      args: this.subscriptions,
    };

    try {
      this.ws.send(JSON.stringify(payload));
      console.log("[BybitWS] Subscribed:", this.subscriptions);
    } catch (err) {
      console.error("[BybitWS] subscribe error:", err);
    }
  }

  _sendPong() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    try {
      this.ws.send(JSON.stringify({ op: "pong" }));
    } catch (err) {
      console.error("[BybitWS] pong error:", err);
    }
  }

  _startHeartbeat() {
    this._stopHeartbeat();
    // Bybit v5 voli ~20–25s ping interval
    this.pingTimer = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      try {
        this.ws.send(JSON.stringify({ op: "ping", req_id: "ping" }));
      } catch (err) {
        console.error("[BybitWS] ping error:", err);
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
    wsMarkReconnect();

    const delay = Math.min(30_000, 2_000 * this.reconnectAttempts);
    console.log(`[BybitWS] Reconnecting in ${delay}ms...`);

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
      } catch (_) {}
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
      } catch (_) {}
    }
    this.connected = false;
    wsMarkDisconnected();
  }
}

const bybitPublicWS = new BybitPublicWS();
export default bybitPublicWS;
