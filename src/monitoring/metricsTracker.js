// src/monitoring/metricsTracker.js
// Centralni summary za /monitor i /api/monitor/summary

import os from "os";
import { getWsStatus } from "../connectors/bybitPublic.js";

/**
 * Formatira uptime u "Xh Ym"
 */
function formatUptime(seconds) {
  const s = Math.floor(seconds || 0);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}h ${m}m`;
}

/**
 * Sistem metrike (uptime, load, memorija)
 */
function getSystemMetrics() {
  const uptimeSeconds = process.uptime();
  const mem = process.memoryUsage();
  const load = os.loadavg?.() || [0, 0, 0];

  return {
    uptimeSeconds,
    uptimeHuman: formatUptime(uptimeSeconds),
    load1m: Number(load[0].toFixed(2)),
    memory: {
      rssMB: Number((mem.rss / 1024 / 1024).toFixed(1)),
      heapUsedMB: Number((mem.heapUsed / 1024 / 1024).toFixed(1)),
      heapTotalMB: Number((mem.heapTotal / 1024 / 1024).toFixed(1)),
    },
  };
}

/**
 * Health summary na osnovu sistema + WS + engine stanja
 */
function getHealth(system, ws, engine) {
  const messages = [];
  let status = "ok";

  // WS health
  if (!ws.connected) {
    status = "degraded";
    messages.push("Bybit WS nije povezan (connected = false).");
  }

  // Load / memorija
  if (system.load1m > 3) {
    status = status === "ok" ? "degraded" : status;
    messages.push(`System load 1m je visok (${system.load1m}).`);
  }

  if (system.memory.rssMB > 800) {
    status = "degraded";
    messages.push(`RSS memorija je visoka (${system.memory.rssMB} MB).`);
  }

  // Engine
  if (engine.status !== "running") {
    status = "degraded";
    messages.push(`Engine status je "${engine.status}", očekivano "running".`);
  }

  if (messages.length === 0) {
    messages.push("Sve izgleda zdravo. Sistem radi u normalnom režimu.");
  }

  return {
    status,
    messages,
  };
}

/**
 * Glavni summary koji koristimo u /monitor i /api/monitor/summary
 */
export function getMonitorSummary() {
  const system = getSystemMetrics();

  // WS status iz Bybit public konektora
  let rawWs = {};
  try {
    rawWs = getWsStatus ? getWsStatus() || {} : {};
  } catch (e) {
    rawWs = {};
  }

  const ws = {
    connected: !!rawWs.connected,
    lastConnectedAt: rawWs.lastConnectedAt || null,
    lastMessageAt: rawWs.lastMessageAt || null,
    lastErrorAt: rawWs.lastErrorAt || null,
    lastErrorMessage: rawWs.lastErrorMessage || null,
    reconnectAttempts: rawWs.reconnectAttempts ?? 0,
    // tickRate/msgPerSec su opcioni - kasnije ćemo ih puniti u bybitPublic.js
    tickRate: rawWs.tickRate ?? null,
    messagesPerSec: rawWs.messagesPerSec ?? null,
    streams:
      rawWs.streams ||
      rawWs.subscriptions ||
      rawWs.subscribedTopics ||
      [],
  };

  // Engine status - za sada placeholder, kasnije vežemo na core
  const engine = {
    status: process.env.DTRADE_ENGINE_STATUS || "running",
    mode: process.env.DTRADE_ENGINE_MODE || "scalper-core",
    // decisionRate = koliko odluka u sekundi engine donosi (placeholder)
    decisionRate: rawWs.decisionRate ?? null,
    lastDecisionAt: null,
  };

  // Event metrike - za sada placeholder nule
  const events = {
    wsMessagesTotal: rawWs.totalMessages ?? 0,
    wsErrorsTotal: rawWs.errorCount ?? 0,
    tradesExecuted: 0,
    ordersSent: 0,
  };

  const health = getHealth(system, ws, engine);

  return {
    system,
    ws,
    engine,
    events,
    health,
    timestamp: new Date().toISOString(),
  };
}
