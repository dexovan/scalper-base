// Global WS metrics state
let wsStatus = "unknown";
let lastMessageAt = null;
let reconnectAttempts = 0;
let messageCount = 0;

export function wsMarkConnecting() {
  wsStatus = "connecting";
}

export function wsMarkConnected() {
  wsStatus = "connected";
}

export function wsMarkDisconnected() {
  wsStatus = "disconnected";
}

export function wsMarkError() {
  wsStatus = "error";
}

export function wsMarkReconnect() {
  reconnectAttempts++;
}

export function wsMarkMessage() {
  messageCount++;
  lastMessageAt = Date.now();
}

export function getWsStatus() {
  return {
    status: wsStatus,
    lastMessageAt,
    reconnectAttempts,
    messageCount,
  };
}
