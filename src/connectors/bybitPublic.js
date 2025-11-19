// src/connectors/bybitPublic.js
import fetch from "node-fetch";
import CONFIG from "../config/index.js";

export async function fetchInstrumentsUSDTPerp() {
  const endpoint = `${CONFIG.bybit.restBase}/v5/market/instruments-info`;
  const url = `${endpoint}?category=linear`;

  const fetchedAt = new Date().toISOString();

  try {
    const res = await fetch(url);
    if (!res.ok) {
      return {
        success: false,
        fetchedAt,
        symbols: [],
        error: `HTTP ${res.status}`,
      };
    }

    const data = await res.json();

    if (data.retCode !== 0) {
      return {
        success: false,
        fetchedAt,
        symbols: [],
        error: `Bybit error: ${data.retMsg}`,
      };
    }

    const items = data.result.list || [];

    const mapped = items
      .filter((i) => i.quoteCoin === "USDT" && i.contractType === "LinearPerpetual")
      .map((i) => {
        return {
          symbol: i.symbol,
          baseAsset: i.baseCoin,
          quoteAsset: i.quoteCoin,
          contractType: i.contractType,
          status: i.status,
          tickSize: Number(i.priceFilter?.tickSize || 0),
          minOrderQty: Number(i.lotSizeFilter?.minOrderQty || 0),
          lotSize: Number(i.lotSizeFilter?.qtyStep || 0),
          maxLeverage: Number(i.leverageFilter?.maxLeverage || 1),
          raw: i,
        };
      });

    return {
      success: true,
      fetchedAt,
      symbols: mapped,
    };
  } catch (err) {
    return {
      success: false,
      fetchedAt,
      symbols: [],
      error: err.message,
    };
  }
}
