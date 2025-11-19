export const wsMetrics = {
  messagesLast60s: 0,
  _history: []
};

export function trackWsMessage() {
  const now = Date.now();
  wsMetrics._history.push(now);

  const cutoff = now - 60000;
  wsMetrics._history = wsMetrics._history.filter(ts => ts > cutoff);

  wsMetrics.messagesLast60s = wsMetrics._history.length;
}
