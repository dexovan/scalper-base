// =======================================
// engineMetrics.js — central engine stats
// =======================================

export const engineMetrics = {
  decisionsTotal: 0,
  decisionRate: 0,
  lastDecisionAt: null,

  tradesExecuted: 0,
  ordersSent: 0,

  _decisionHistory: [],   // last 60 seconds
};

export function trackDecision() {
  engineMetrics.decisionsTotal++;
  engineMetrics.lastDecisionAt = Date.now();

  engineMetrics._decisionHistory.push(Date.now());

  // keep only last 60 seconds
  const cutoff = Date.now() - 60000;
  engineMetrics._decisionHistory = engineMetrics._decisionHistory.filter(ts => ts > cutoff);

  engineMetrics.decisionRate = engineMetrics._decisionHistory.length;
}

export function trackTrade() {
  engineMetrics.tradesExecuted++;
}

export function trackOrder() {
  engineMetrics.ordersSent++;
}
