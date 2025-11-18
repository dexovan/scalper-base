// src/monitoring/health.js
import os from "os";
import fs from "fs";
import CONFIG from "../config/index.js";
import paths from "../config/paths.js";

const HealthStatus = {
  mode: CONFIG.execution.mode,

  services: {
    config: { status: "OK", details: "Configuration loaded", lastMessageAt: new Date().toISOString() },
    marketData: { status: "INIT", details: "Not started", lastMessageAt: null },
    featureEngine: { status: "INIT", details: "Not started", lastMessageAt: null },
    regimeEngine: { status: "INIT", details: "Not started", lastMessageAt: null },
    scoringEngine: { status: "INIT", details: "Not started", lastMessageAt: null },
    stateMachine: { status: "INIT", details: "Not started", lastMessageAt: null },
    riskEngine: { status: "INIT", details: "Not started", lastMessageAt: null },
    executionEngine: { status: "INIT", details: "Not started", lastMessageAt: null }
  },

  env: {
    nodeVersion: process.version,
    platform: os.platform(),
    uptimeSeconds: 0,
  },

  paths: {
    projectRootOk: true,
    dataDirOk: true,
    logDirOk: true,
    profilesDirOk: true,
  },

  timestamps: {
    lastUpdate: new Date().toISOString(),
  },
};

// Validate paths exist
function validatePaths() {
  HealthStatus.paths.projectRootOk = fs.existsSync(paths.PROJECT_ROOT);
  HealthStatus.paths.dataDirOk = fs.existsSync(paths.DATA_DIR);
  HealthStatus.paths.logDirOk = fs.existsSync(paths.LOG_DIR);
  HealthStatus.paths.profilesDirOk = fs.existsSync(paths.PROFILES_DIR);
}


// Update specific service status
export function setServiceStatus(serviceName, status, details = "") {
  if (HealthStatus.services[serviceName]) {
    HealthStatus.services[serviceName].status = status;
    HealthStatus.services[serviceName].details = details;
    HealthStatus.services[serviceName].lastMessageAt = new Date().toISOString();
  }
}

// Get service status
export function getServiceStatus(serviceName) {
  return HealthStatus.services[serviceName] || null;
}

// Get overall health summary
export function getHealthSummary() {
  const services = Object.values(HealthStatus.services);
  const totalServices = services.length;
  const okServices = services.filter(s => s.status === "OK").length;
  const errorServices = services.filter(s => s.status === "ERROR").length;
  const warnServices = services.filter(s => s.status === "WARN").length;

  let overallStatus = "OK";
  if (errorServices > 0) overallStatus = "ERROR";
  else if (warnServices > 0) overallStatus = "WARN";
  else if (okServices < totalServices) overallStatus = "INIT";

  return {
    overallStatus,
    totalServices,
    okServices,
    errorServices,
    warnServices
  };
}

// Called at boot & every healthUpdateIntervalMs
export function updateHealth() {
  HealthStatus.env.uptimeSeconds = Math.floor(process.uptime());
  HealthStatus.timestamps.lastUpdate = new Date().toISOString();
  validatePaths();
  return HealthStatus;
}

// Initialize health monitoring
export function initHealth() {
  console.log("[HEALTH] Initializing health monitoring...");
  setServiceStatus("config", "OK", "Configuration loaded successfully");
  updateHealth();

  // Start periodic health updates
  setInterval(updateHealth, CONFIG.health.updateIntervalMs);

  console.log(`[HEALTH] Health monitoring started (update interval: ${CONFIG.health.updateIntervalMs}ms)`);
}

export default HealthStatus;
