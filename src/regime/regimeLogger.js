/**
 * REGIME LOGGER
 *
 * Specialized logger for regime transitions with strict disk usage control.
 *
 * Strategy:
 * - Log only regime transitions (no debug spam)
 * - JSONL format for easy parsing
 * - Log rotation: max 10MB × 7 files = 70MB total
 * - Target: ~200KB/day in production
 *
 * Critical-only mode:
 * - Only log PANIC and transitions from PUMP/MANIPULATED
 * - Use in high-traffic environments
 */

import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import path from 'path';

// ================================================================
// CONFIGURATION
// ================================================================

const REGIME_LOG_CONFIG = {
  // File rotation
  maxSize: '10m',
  maxFiles: '7d',

  // Directory
  dirname: path.join(process.cwd(), 'logs'),

  // Filename pattern
  filename: 'regime-%DATE%.log',
  datePattern: 'YYYY-MM-DD',

  // Compression
  zippedArchive: true,

  // Critical-only mode (reduces logging by ~80%)
  criticalOnlyMode: process.env.REGIME_LOG_CRITICAL_ONLY === 'true'
};

// ================================================================
// WINSTON LOGGER SETUP
// ================================================================

const regimeLogger = winston.createLogger({
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
    winston.format.json()
  ),
  transports: [
    new DailyRotateFile({
      ...REGIME_LOG_CONFIG,
      level: 'info'
    })
  ]
});

// ================================================================
// LOGGING FUNCTIONS
// ================================================================

/**
 * Log symbol regime transition
 */
function logSymbolTransition(symbol, fromRegime, toRegime, scores) {
  // Critical-only filter
  if (REGIME_LOG_CONFIG.criticalOnlyMode) {
    // Only log transitions FROM dangerous regimes
    const criticalFromRegimes = ['PUMP', 'MANIPULATED', 'STALE'];
    if (!criticalFromRegimes.includes(fromRegime)) {
      return; // Skip non-critical transition
    }
  }

  regimeLogger.info({
    type: 'symbol_transition',
    symbol,
    from: fromRegime,
    to: toRegime,
    scores: {
      pump: scores.pumpScore?.toFixed(3),
      spoof: scores.spoofScore?.toFixed(3),
      vol: scores.volatilityScore?.toFixed(3),
      news: scores.newsSignal
    }
  });
}

/**
 * Log global regime transition
 */
function logGlobalTransition(fromRegime, toRegime, metrics) {
  // Always log global transitions (critical for risk management)
  regimeLogger.warn({
    type: 'global_transition',
    from: fromRegime,
    to: toRegime,
    metrics: {
      btcVol: metrics.btcVolatility?.toFixed(3),
      ethVol: metrics.ethVolatility?.toFixed(3),
      btcPriceChange: metrics.btcPriceChange5s?.toFixed(2),
      blockedSymbolsPct: metrics.blockedPct?.toFixed(3)
    }
  });
}

/**
 * Log PANIC mode entry (always logged, highest priority)
 */
function logPanicMode(metrics, reasons) {
  regimeLogger.error({
    type: 'panic_mode',
    event: 'entered',
    reasons,
    metrics: {
      btcVol: metrics.btcVolatility?.toFixed(3),
      ethVol: metrics.ethVolatility?.toFixed(3),
      btcPriceChange: metrics.btcPriceChange5s?.toFixed(2),
      blockedSymbolsPct: metrics.blockedPct?.toFixed(3),
      totalSymbols: metrics.totalSymbols,
      blockedSymbols: metrics.symbolsBlocked
    }
  });
}

/**
 * Log trading permission denial
 * (Only in non-critical mode)
 */
function logTradeDenied(symbol, side, reason, regimeInfo) {
  if (REGIME_LOG_CONFIG.criticalOnlyMode) {
    return; // Don't log trade denials in critical-only mode
  }

  regimeLogger.info({
    type: 'trade_denied',
    symbol,
    side,
    reason,
    globalRegime: regimeInfo.globalRegime,
    symbolRegime: regimeInfo.symbolRegime
  });
}

/**
 * Log cooldown period start
 * (Only log if transitioning FROM PUMP)
 */
function logCooldownStart(symbol, durationMs, fromRegime) {
  if (fromRegime === 'PUMP') {
    regimeLogger.info({
      type: 'cooldown_start',
      symbol,
      from: fromRegime,
      durationMs
    });
  }
}

/**
 * Log stale symbol detection
 * (Only in non-critical mode)
 */
function logStaleSymbol(symbol, timeSinceLastTick) {
  if (REGIME_LOG_CONFIG.criticalOnlyMode) {
    return;
  }

  regimeLogger.info({
    type: 'symbol_stale',
    symbol,
    timeSinceLastTickMs: timeSinceLastTick
  });
}

/**
 * Log regime engine startup
 */
function logEngineStartup(stats) {
  regimeLogger.info({
    type: 'engine_startup',
    stats: {
      primeSymbols: stats.primeSymbols,
      normalSymbols: stats.normalSymbols,
      wildSymbols: stats.wildSymbols,
      totalSymbols: stats.totalSymbols
    },
    config: {
      criticalOnlyMode: REGIME_LOG_CONFIG.criticalOnlyMode,
      maxSize: REGIME_LOG_CONFIG.maxSize,
      maxFiles: REGIME_LOG_CONFIG.maxFiles
    }
  });
}

/**
 * Log regime statistics (hourly summary)
 */
function logHourlySummary(stats) {
  regimeLogger.info({
    type: 'hourly_summary',
    stats: {
      totalUpdates: stats.updateCount,
      totalTransitions: stats.transitionCount,
      globalRegime: stats.globalRegime,
      symbolsInPump: stats.symbolsInPump,
      symbolsInManipulated: stats.symbolsInManipulated,
      symbolsBlocked: stats.symbolsBlocked,
      symbolsTradeable: stats.symbolsTradeable
    }
  });
}

// ================================================================
// DISK USAGE MONITORING
// ================================================================

/**
 * Get estimated log file size (requires fs module)
 */
async function getLogFileSize() {
  try {
    const fs = await import('fs/promises');
    const files = await fs.readdir(REGIME_LOG_CONFIG.dirname);
    const regimeFiles = files.filter(f => f.startsWith('regime-'));

    let totalSize = 0;
    for (const file of regimeFiles) {
      const stats = await fs.stat(path.join(REGIME_LOG_CONFIG.dirname, file));
      totalSize += stats.size;
    }

    return {
      totalBytes: totalSize,
      totalMB: (totalSize / 1024 / 1024).toFixed(2),
      fileCount: regimeFiles.length
    };
  } catch (err) {
    return {
      totalBytes: 0,
      totalMB: '0.00',
      fileCount: 0,
      error: err.message
    };
  }
}

// ================================================================
// EXPORTS
// ================================================================

export {
  logSymbolTransition,
  logGlobalTransition,
  logPanicMode,
  logTradeDenied,
  logCooldownStart,
  logStaleSymbol,
  logEngineStartup,
  logHourlySummary,
  getLogFileSize,
  REGIME_LOG_CONFIG
};

export default {
  logSymbolTransition,
  logGlobalTransition,
  logPanicMode,
  logTradeDenied,
  logCooldownStart,
  logStaleSymbol,
  logEngineStartup,
  logHourlySummary,
  getLogFileSize,
  config: REGIME_LOG_CONFIG
};
