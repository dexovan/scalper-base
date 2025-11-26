// =====================================================
// Monitor API Client – real-time Engine & Dashboard sync
// FINAL VERSION v3.1 (with WS logs, timeouts & engine state)
// =====================================================

export class MonitorAPI {
    constructor() {
        // ===========================
        //  HTTP ENDPOINTS (BACKEND)
        // ===========================
        this.url        = "/monitor/api/summary";
        this.logsUrl    = "/monitor/api/logs";
        this.tickersUrl = "/monitor/api/tickers";
        this.tradesUrl  = "/monitor/api/trades";
        this.storageUrl = "/monitor/api/storage";
        this.universeUrl = "/monitor/api/universe";

        // ===========================
        // Internal state
        // ===========================
        this.data = null;
        this.lastOK = false;

        // Callbacks
        this.onUpdate = null;       // summary update
        this.onLogsUpdate = null;   // logs update
        this.onEngineUp = null;     // engine became reachable
        this.onEngineDown = null;   // engine unreachable

        // WebSocket instance
        this.ws = null;
    }

    // ===========================================
    // Fetch with timeout (prevents UI freezing)
    // ===========================================
    async fetchWithTimeout(url, timeout = 2000) {
        return Promise.race([
            fetch(url, { cache: "no-store" }),
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error("timeout")), timeout)
            )
        ]);
    }

    // ===========================================
    // POLL summary
    // ===========================================
    async poll() {
        try {
            const res = await this.fetchWithTimeout(this.url, 2000);
            if (!res.ok) throw new Error("Bad HTTP status");

            this.data = await res.json();

            const engineWasDown = !this.lastOK;
            this.lastOK = true;

            if (engineWasDown && this.onEngineUp) {
                this.onEngineUp();
            }

            if (this.onUpdate) this.onUpdate(this.data);

        } catch (err) {
            console.log("❌ Monitor API offline:", err.message);
            const engineWasUp = this.lastOK;
            this.lastOK = false;

            if (engineWasUp && this.onEngineDown) {
                this.onEngineDown();
            }

            if (this.onUpdate) this.onUpdate(null);
        }
    }

    // ===========================================
    // Fetch logs (fallback if WS not available)
    // ===========================================
    async getLogs(lines = 50) {
        try {
            const res = await this.fetchWithTimeout(`${this.logsUrl}?lines=${lines}`, 2000);
            if (!res.ok) throw new Error("Logs fetch failed");

            const data = await res.json();
            if (this.onLogsUpdate) this.onLogsUpdate(data.lines);
            return data.lines;

        } catch (err) {
            console.log("❌ Logs API offline:", err.message);
            if (this.onLogsUpdate) {
                this.onLogsUpdate(["<logs unavailable>", err.message]);
            }
            return [];
        }
    }

    // ===========================================
    // WebSocket real-time logs stream
    // ===========================================
    initWS() {
        if (!window.io) {
            console.warn("⚠️ Socket.IO not loaded — WS logs disabled");
            return;
        }

        this.ws = io();

        this.ws.on("connect", () => {
            console.log("🔌 WS connected (dashboard)");
        });

        this.ws.on("disconnect", () => {
            console.log("⚠️ WS disconnected");
        });

        // Real-time streaming line-by-line logs
        this.ws.on("engine-log", line => {
            if (this.onLogsUpdate) {
                this.onLogsUpdate([line]);
            }
        });

        // Engine global status (optional)
        this.ws.on("engine-status", status => {
            console.log("WS engine-status:", status);

            if (status === "up" && this.onEngineUp) this.onEngineUp();
            if (status === "down" && this.onEngineDown) this.onEngineDown();
        });
    }

    // ===========================================
    // Start polling + logs + websocket
    // ===========================================
    start(intervalMs = 1000) {
        this.poll(); // run immediately

        setInterval(() => this.poll(), intervalMs);

        // Logs fallback pulling (WS is primary)
        this.getLogs();
        setInterval(() => this.getLogs(), 5000);

        // Init websocket
        this.initWS();
    }
}

// ===========================================
// Single shared instance
// ===========================================
export const monitorAPI = new MonitorAPI();
