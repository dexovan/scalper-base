// web/routes/monitor.js
import express from "express";
import fetch from "node-fetch";

const router = express.Router();

/**
 * Proxy helper to call ENGINE API
 */
async function engineGet(path) {
  const url = `http://localhost:8090${path}`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Engine API error: ${res.status}`);
    return await res.json();
  } catch (err) {
    console.error("[MONITOR] Engine API error:", err.message);
    return { error: true, message: err.message };
  }
}

/**
 * SUMMARY — proxy to engine
 */
router.get("/summary", async (req, res) => {
  const summary = await engineGet("/api/monitor/summary");
  res.json(summary);
});

/**
 * LOGS — proxy to engine
 */
router.get("/logs", async (req, res) => {
  const logs = await engineGet("/api/monitor/logs");
  res.json(logs);
});

export default router;
