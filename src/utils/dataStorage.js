// =======================================================
// DATA STORAGE UTILITIES - Phase 2 File Storage
// =======================================================
// Handles CSV file writing for tickers and trades
// Organized by date and symbol for easy analysis

import fs from 'fs';
import path from 'path';

// Get current date in YYYY-MM-DD format
function getDateString() {
  return new Date().toISOString().split('T')[0];
}

// Get current timestamp in ISO format
function getTimestamp() {
  return new Date().toISOString();
}

// Ensure directory exists, create if not
function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * Save ticker data to CSV file
 * File: data/tickers/YYYY-MM-DD/SYMBOL.csv
 * Format: timestamp,symbol,lastPrice,volume24h,priceChange24h,high24h,low24h
 */
export function saveTicker(symbol, payload) {
  try {
    const dateStr = getDateString();
    const dirPath = path.join(process.cwd(), 'data', 'tickers', dateStr);
    ensureDir(dirPath);

    const filePath = path.join(dirPath, `${symbol}.csv`);
    const timestamp = getTimestamp();

    // CSV header if file doesn't exist
    if (!fs.existsSync(filePath)) {
      const header = 'timestamp,symbol,lastPrice,volume24h,priceChange24h,high24h,low24h\n';
      fs.writeFileSync(filePath, header);
    }

    // Extract key ticker fields from Bybit payload
    const lastPrice = payload.lastPrice || payload.price || '';
    const volume24h = payload.volume24h || payload.turnover24h || '';
    const priceChange24h = payload.price24hPcnt || '';
    const high24h = payload.highPrice24h || '';
    const low24h = payload.lowPrice24h || '';

    // CSV row
    const row = `${timestamp},${symbol},${lastPrice},${volume24h},${priceChange24h},${high24h},${low24h}\n`;

    // Append to file
    fs.appendFileSync(filePath, row);

  } catch (error) {
    console.error(`[STORAGE-ERROR] Ticker ${symbol}:`, error.message);
  }
}

/**
 * Save trade data to CSV file
 * File: data/trades/YYYY-MM-DD/SYMBOL.csv
 * Format: timestamp,symbol,side,price,quantity,tickDirection,tradeId
 */
export function saveTrade(symbol, payload) {
  try {
    const dateStr = getDateString();
    const dirPath = path.join(process.cwd(), 'data', 'trades', dateStr);
    ensureDir(dirPath);

    const filePath = path.join(dirPath, `${symbol}.csv`);
    const timestamp = getTimestamp();

    // CSV header if file doesn't exist
    if (!fs.existsSync(filePath)) {
      const header = 'timestamp,symbol,side,price,quantity,tickDirection,tradeId\n';
      fs.writeFileSync(filePath, header);
    }

    // Extract trade fields from Bybit payload
    const side = payload.S || '';           // "Buy" | "Sell"
    const price = payload.p || '';          // "91750.20"
    const quantity = payload.v || '';       // "0.027"
    const tickDirection = payload.L || '';  // "PlusTick" | "MinusTick" etc
    const tradeId = payload.i || '';        // Trade ID

    // CSV row
    const row = `${timestamp},${symbol},${side},${price},${quantity},${tickDirection},${tradeId}\n`;

    // Append to file
    fs.appendFileSync(filePath, row);

  } catch (error) {
    console.error(`[STORAGE-ERROR] Trade ${symbol}:`, error.message);
  }
}

/**
 * Get storage statistics (async)
 */
export async function getStorageStats() {
  try {
    const dateStr = getDateString();
    const tickersDir = path.join(process.cwd(), 'data', 'tickers', dateStr);
    const tradesDir = path.join(process.cwd(), 'data', 'trades', dateStr);

    let tickerFiles = 0;
    let tradeFiles = 0;
    let tickerTotalSize = 0;
    let tradesTotalSize = 0;

    // Count ticker files and sizes
    if (fs.existsSync(tickersDir)) {
      const files = fs.readdirSync(tickersDir).filter(f => f.endsWith('.csv'));
      tickerFiles = files.length;
      for (const file of files) {
        const filePath = path.join(tickersDir, file);
        const stats = fs.statSync(filePath);
        tickerTotalSize += stats.size;
      }
    }

    // Count trade files and sizes
    if (fs.existsSync(tradesDir)) {
      const files = fs.readdirSync(tradesDir).filter(f => f.endsWith('.csv'));
      tradeFiles = files.length;
      for (const file of files) {
        const filePath = path.join(tradesDir, file);
        const stats = fs.statSync(filePath);
        tradesTotalSize += stats.size;
      }
    }

    return {
      date: dateStr,
      todayFiles: {
        tickers: tickerFiles,
        trades: tradeFiles
      },
      todaySizes: {
        tickers: tickerTotalSize,
        trades: tradesTotalSize
      },
      paths: {
        tickers: tickersDir,
        trades: tradesDir
      }
    };

  } catch (error) {
    console.error('[STORAGE-ERROR] Stats:', error.message);
    return {
      date: getDateString(),
      todayFiles: { tickers: 0, trades: 0 },
      todaySizes: { tickers: 0, trades: 0 },
      error: error.message
    };
  }
}
