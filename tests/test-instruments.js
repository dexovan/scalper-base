import { fetchInstrumentsUSDTPerp } from "../src/connectors/bybitPublic.js";

console.log("TEST: Fetch instruments (USDT perp)");

const res = await fetchInstrumentsUSDTPerp();

console.log(JSON.stringify(res, null, 2));
