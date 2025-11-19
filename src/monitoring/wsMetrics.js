// ============================================================
// SINGLETON WS METRICS MODULE (FINAL FIX)
// ============================================================

const state = {
  status: "unknown",
  lastMessageAt: null,
  reconnectAttempts: 0,
  messageCount: 0,
};

// ---------------------
// MUTATIONS
// ---------------------
function markConnecting() {
  state.status = "connecting";
}

function markConnected() {
  state.status = "connected";
}

function markDisconnected() {
  state.status = "disconnected";
}

function markError() {
  state.status = "error";
}

function markReconnect() {
  state.reconnectAttempts++;
}

function markMessage() {
  state.messageCount++;
  state.lastMessageAt = Date.now();
}

// ---------------------
// ACCESSOR
// ---------------------
function getSummary() {
  return { ...state };
}

// ---------------------
// DEFAULT SINGLETON EXPORT
// ---------------------
export default {
  markConnecting,
  markConnected,
  markDisconnected,
  markError,
  markReconnect,
  markMessage,
  getSummary,
};

// ---------------------
// NAMED EXPORTS
// ---------------------
export {
  markConnecting as wsMarkConnecting,
  markConnected as wsMarkConnected,
  markDisconnected as wsMarkDisconnected,
  markError as wsMarkError,
  markReconnect as wsMarkReconnect,
  markMessage as wsMarkMessage,
  getSummary as getWsSummary,
};
