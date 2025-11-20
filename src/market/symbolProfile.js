// src/market/symbolProfile.js
import fs from "fs";
import path from "path";
import paths from "../config/paths.js";

const PROFILE_DIR = path.join(paths.PROJECT_ROOT, "data", "profiles");

if (!fs.existsSync(PROFILE_DIR)) {
  fs.mkdirSync(PROFILE_DIR, { recursive: true });
}

export async function loadProfile(symbol) {
  const file = path.join(PROFILE_DIR, `${symbol}.json`);

  if (!fs.existsSync(file)) {
    const fresh = {
      symbol,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      tradeCount: 0,
      winCount: 0,
      lossCount: 0,
      avgMFE: 0,
      avgMAE: 0,
      avgSlippage: 0,
      suggestedMaxLeverage: null,
      suggestedRiskPerTrade: null,
      disabled: false
    };

    await fs.promises.writeFile(file, JSON.stringify(fresh, null, 2));
    return fresh;
  }

  const raw = await fs.promises.readFile(file, "utf8");
  return JSON.parse(raw);
}

export async function saveProfile(profile) {
  const file = path.join(PROFILE_DIR, `${profile.symbol}.json`);
  profile.updatedAt = new Date().toISOString();
  await fs.promises.writeFile(file, JSON.stringify(profile, null, 2));
}

export function getProfileSnapshot(symbol) {
  const file = path.join(PROFILE_DIR, `${symbol}.json`);
  if (!fs.existsSync(file)) return null;

  return JSON.parse(fs.readFileSync(file, "utf8"));
}
