// src/core/metrics.js

export class EngineMetrics {
    constructor() {
        this.startTime = Date.now();

        this.decisionCount = 0;
        this.ordersSent = 0;
        this.tradesExecuted = 0;
        this.errors = 0;

        this.lastHeartbeat = null;
        this.lastDecisionTime = null;
    }

    heartbeat() {
        this.lastHeartbeat = Date.now();
    }

    markDecision() {
        this.decisionCount++;
        this.lastDecisionTime = Date.now();
    }

    markOrderSent() {
        this.ordersSent++;
    }

    markTradeExecuted() {
        this.tradesExecuted++;
    }

    markError() {
        this.errors++;
    }

    getSummary() {
        const now = Date.now();
        const uptime = now - this.startTime;

        const decisionRate =
            this.lastDecisionTime
                ? (this.decisionCount / (uptime / 1000)).toFixed(2)
                : "0";

        return {
            running: true,
            uptime,
            decisionRate,
            decisionCount: this.decisionCount,
            ordersSent: this.ordersSent,
            tradesExecuted: this.tradesExecuted,
            errors: this.errors,
            lastHeartbeat: this.lastHeartbeat,
            lastDecisionTime: this.lastDecisionTime
        };
    }
}

const metrics = new EngineMetrics();
export default metrics;
