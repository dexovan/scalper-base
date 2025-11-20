// ===========================================
// Monitor API Client – real-time engine stats
// ===========================================

export class MonitorAPI {
    constructor() {
        this.url = "/monitor/api/summary";
        this.data = null;
        this.lastOK = false;

        this.onUpdate = null; // callback
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

    start(intervalMs = 1000) {
        this.poll(); // immediately
        setInterval(() => this.poll(), intervalMs);
    }
}

// Single instance
export const monitorAPI = new MonitorAPI();
