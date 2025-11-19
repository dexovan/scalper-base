// src/monitoring/wsMetrics.js

const state = {
  status: "disconnected", // "connecting" | "connected" | "disconnected" | "error"
  lastMessageAt: null,
  reconnects: 0,
  msgTimestamps: [], // unix ms timestamps
};

export function wsMarkConnecting() {
  state.status = "connecting";
}

export function wsMarkConnected() {
  state.status = "connected";
}

export function wsMarkDisconnected() {
  state.status = "disconnected";
}

export function wsMarkError() {
  state.status = "error";
}

export function wsMarkReconnect() {
  state.reconnects++;
}

export function wsMarkMessage() {
  const now = Date.now();
  state.lastMessageAt = now;
  state.msgTimestamps.push(now);

  const cutoff = now - 60_000;
  state.msgTimestamps = state.msgTimestamps.filter((t) => t >= cutoff);
}

export function getWsSummary() {
  const now = Date.now();
  const msgsLast60s = state.msgTimestamps.filter(
    (t) => now - t <= 60_000
  ).length;

  return {
    status: state.status,
    lastMessageAt: state.lastMessageAt,
    reconnects: state.reconnects,
    msgPer60s: msgsLast60s,
  };
}
