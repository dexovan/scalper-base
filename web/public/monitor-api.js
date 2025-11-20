// ===========================================
// Monitor API Client – real-time engine stats
// ===========================================

export class MonitorAPI {
    constructor() {
        this.url = "/monitor/api/summary";
        this.logsUrl = "/monitor/api/logs";
        this.data = null;
        this.lastOK = false;

        this.onUpdate = null; // callback
        this.onLogsUpdate = null; // logs callback
    }

    async poll() {
        try {
            const res = await fetch(this.url, { cache: "no-store" });
            if (!res.ok) throw new Error("Bad status");

            this.data = await res.json();
            this.lastOK = true;

            if (this.onUpdate) this.onUpdate(this.data);

        } catch (err) {
            console.log("❌ Monitor API offline");
            this.lastOK = false;

            if (this.onUpdate) this.onUpdate(null);
        }
    }

    async getLogs(lines = 50) {
        try {
            const res = await fetch(`${this.logsUrl}?lines=${lines}`, { cache: "no-store" });
            if (!res.ok) throw new Error("Logs fetch failed");

            const data = await res.json();
            if (this.onLogsUpdate) this.onLogsUpdate(data.lines);
            return data.lines;
        } catch (err) {
            console.log("❌ Logs API offline");
            if (this.onLogsUpdate) this.onLogsUpdate(["<logs unavailable>", err.message]);
            return [];
        }
    }

    start(intervalMs = 1000) {
        this.poll(); // immediately
        setInterval(() => this.poll(), intervalMs);

        // Also fetch logs immediately, then every 5 seconds
        this.getLogs();
        setInterval(() => this.getLogs(), 5000);
    }
}

// Single instance
export const monitorAPI = new MonitorAPI();
