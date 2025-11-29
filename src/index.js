/**
 * src/index.js
 * AI Scalper Engine – Phase 2 (Universe + WS Dynamic Subscription)
 */

console.log("🔥🔥🔥 [INDEX.JS] FILE LOADED - TOP OF FILE 🔥🔥🔥");
console.log("🔥🔥🔥 [INDEX.JS] TIMESTAMP:", new Date().toISOString(), "🔥🔥🔥");

import {
    initUniverse,
    refreshUniversePeriodically,
    getSymbolsByCategory,
    getUniverseSnapshot
} from "./market/universe_v2.js";

import { initEventHub } from "./ws/eventHub.js";

import { publicEmitter } from "./connectors/bybitPublic.js";

import { getStorageStats } from "./utils/dataStorage.js";

import CONFIG from "./config/index.js";

import metrics from "./core/metrics.js";

// WS metrics – shared module
import * as wsMetrics from "./monitoring/wsMetrics.js";

// Parallel metrics WS connector (stable)
import { BybitPublicWS } from "./connectors/bybit/publicWS.js";

// Phase 2 VARIJANTA B - Event handling for parsed ticker/trade data

// Monitor API server (Opcija A)
import { startMonitorApiServer, attachRealtimeListeners, featureEngine } from "./http/monitorApi.js";

// Phase 5: Regime Engine
import RegimeEngine from "./regime/regimeEngine.js";
import * as OrderbookManager from "./microstructure/OrderbookManager.js";
import { logEngineStartup } from "./regime/regimeLogger.js";

// 🔍 SIGNAL SCANNER INTEGRATION - Run scanner inside engine
import { initializeScannerIntegration, startScannerLoops } from "./market/scannerIntegration.js";

async function startEngine() {
    console.log("🔥🔥🔥 [INDEX.JS] startEngine() CALLED 🔥🔥🔥");
    console.log("====================================================");
    console.log("🚀 AI Scalper Engine – Phase 2 Booting...");
    console.log("📁 KORAK 2: File Storage Implementation Active!");
    console.log("====================================================");

    console.log("🔍 DEBUG: About to initialize Universe and WebSocket...");

    metrics.markDecision();
    metrics.heartbeat();

    // --------------------------
    // UNIVERSE INIT
    // --------------------------
    console.log("🌍 [ENGINE] About to call initUniverse()...");
    await initUniverse();
    console.log("🌍 [ENGINE] initUniverse() completed!");

    // Verify universe loaded
    const universeCheck = await getUniverseSnapshot();
    console.log("🌍 [ENGINE] Universe verification:", {
        totalSymbols: universeCheck?.stats?.totalSymbols || 0,
        fetchedAt: universeCheck?.fetchedAt || 'N/A',
        symbolCount: Object.keys(universeCheck?.symbols || {}).length
    });

    console.log("🔍 DEBUG: Initializing EventHub...");
    initEventHub();

    // DISABLED: Universe refresh writes to disk every 15s (500+ symbols × 1KB = 500KB+ per write = 2MB/min = 2.9GB/day!)
    // refreshUniversePeriodically();
    console.log("⚠️ [ENGINE] Universe periodic refresh DISABLED - preventing disk fill");

    // KORAK 2: Display storage stats
    const storageStats = await getStorageStats();
    if (storageStats) {
        console.log("📁 Data Storage Stats:");
        console.log(`   Date: ${storageStats.date}`);
        console.log(`   Ticker files: ${storageStats.todayFiles?.tickers || 0}`);
        console.log(`   Trade files: ${storageStats.todayFiles?.trades || 0}`);
        console.log(`   Ticker size: ${(storageStats.todaySizes?.tickers / 1024).toFixed(1)} KB`);
        console.log(`   Trade size: ${(storageStats.todaySizes?.trades / 1024).toFixed(1)} KB`);
    }

    console.log("=====================================================");
    console.log("🌍 Universe service started.");
    console.log("📡 Public WS active.");
    console.log("🧠 AI Event Hub active.");
    console.log("💾 File Storage active.");
    console.log("⚡ Engine running normally.");

    // =====================================================
    // METRICS-WEBSOCKET INSTANCE
    // =====================================================
    console.log("=============================");
    console.log("📡 METRICS: Creating WS...");
    console.log("=============================");

    const metricsWS = new BybitPublicWS();

    console.log("📡 METRICS: Calling connect() now...");

    // 🚀 HOT LIST ARCHITECTURE:
    // - Subscribe TICKERS + ORDERBOOK for Prime symbols (cheap, always needed)
    // - Normal symbols monitored via regime engine only (no WS subscriptions to avoid 1006 limit)
    // - Scanner will dynamically subscribe publicTrade.* for top 20-30 candidates
    // - This avoids Bybit 1006 error from too many subscriptions (limit ~100 topics)

    const primeMetadata = await getSymbolsByCategory("Prime");
    const primeSymbolsForWS = primeMetadata.map(m => m.symbol);

    console.log(`📡 [WS] Subscribing to TICKERS + ORDERBOOK for ${primeSymbolsForWS.length} Prime symbols...`);
    console.log(`📡 [WS] publicTrade.* will be dynamically managed by flowHotlistManager`);

    // 🔥 AWAIT WebSocket connection before continuing - WITH ERROR HANDLING
    console.log(`\n⏳ [INDEX] ABOUT TO CALL metricsWS.connect()...`);
    try {
      console.log(`⏳ [INDEX] Calling metricsWS.connect() NOW...`);
      const connectPromise = metricsWS.connect({
        symbols: primeSymbolsForWS,
        channels: ["tickers", "orderbook.50"], // ✅ Prime symbols only to stay under 1006 limit

        // MUST HAVE THE RAW MESSAGE
        onEvent: (msg) => {
            try {
                wsMetrics.wsMarkMessage();

                // DEBUG: Log ALL message topics (sample 0.1%)
                if (Math.random() < 0.001) {
                    console.log(`📨 [WS MESSAGE] Topic: ${msg.topic}, Type: ${msg.type}, HasData: ${!!msg.data}`);
                }

                // 🚀 EMIT EVENTS TO publicEmitter FOR monitorApi.js
                if (msg.topic) {
                    const parts = msg.topic.split(".");
                    const channelType = parts[0];
                    const symbol = parts.length === 3 ? parts[2] : parts[1]; // orderbook.50.SYMBOL vs tickers.SYMBOL

                    // Removed debug log - was generating 600+ logs/sec for orderbook events

                    if (channelType === "tickers" && msg.data) {
                        publicEmitter.emit("event", {
                            type: "ticker",
                            symbol,
                            payload: msg.data,
                            timestamp: new Date().toISOString()
                        });
                    } else if (channelType === "publicTrade" && msg.data) {
                        const trades = Array.isArray(msg.data) ? msg.data : [msg.data];

                        // DEBUG: Log first trade event for each symbol (track up to 10 symbols)
                        if (!global._tradeFirstLogs) global._tradeFirstLogs = new Set();
                        if (!global._tradeFirstLogs.has(symbol) && global._tradeFirstLogs.size < 10) {
                            global._tradeFirstLogs.add(symbol);
                            console.log(`🔥 [TRADE FIRST] ${symbol}: ${trades.length} trades received`);
                        }

                        for (const trade of trades) {
                            // 📊 SEND TRADE DATA TO OrderbookManager
                            const tradeEvent = {
                                price: parseFloat(trade.p || trade.price || 0),
                                qty: parseFloat(trade.v || trade.qty || trade.size || 0),
                                side: (trade.S || trade.side || 'Buy').toUpperCase() === 'BUY' ? 'BUY' : 'SELL',
                                tradeId: trade.i || trade.tradeId || trade.id,
                                ts: parseInt(trade.T || trade.timestamp || Date.now())
                            };

                            OrderbookManager.onTradeEvent(symbol, tradeEvent);

                            // Emit to publicEmitter for dashboard
                            publicEmitter.emit("event", {
                                type: "trade",
                                symbol,
                                payload: trade,
                                timestamp: new Date().toISOString()
                            });
                        }
                    } else if (channelType === "orderbook" && msg.data) {
                    // 📊 SEND ORDERBOOK DATA TO OrderbookManager
                    const orderbookData = Array.isArray(msg.data) ? msg.data[0] : msg.data;

                    if (orderbookData && symbol) {
                        const isSnapshot = msg.type === 'snapshot';

                        // Removed: debug log for every orderbook event (600+ logs/sec)

                        const orderbookEvent = {
                            bids: (orderbookData.b || orderbookData.bids || []).map(level => ({
                                price: parseFloat(level[0] || level.price || 0),
                                qty: parseFloat(level[1] || level.qty || 0)
                            })),
                            asks: (orderbookData.a || orderbookData.asks || []).map(level => ({
                                price: parseFloat(level[0] || level.price || 0),
                                qty: parseFloat(level[1] || level.qty || 0)
                            })),
                            lastUpdateId: orderbookData.u || orderbookData.updateId || null,
                            ts: parseInt(orderbookData.ts || orderbookData.timestamp || Date.now()),
                            isSnapshot: isSnapshot
                        };

                        // Removed: debug log for every orderbook event (600+ logs/sec)

                        // Send to OrderbookManager
                        OrderbookManager.onOrderbookEvent(symbol, orderbookEvent);

                        // Removed: ORDERBOOK FIRST debug log - redundant after cleanup
                    }
                }
            }

                // OPTIONAL DEBUG
                // console.log("[METRICS-WS] EVENT:", msg.topic);
            } catch (onEventErr) {
                console.error("❌ [WS-METRICS] Error in onEvent callback:", onEventErr.message);
                // Don't rethrow - callback errors shouldn't kill WebSocket
            }
        }
      });

      console.log(`⏳ [INDEX] metricsWS.connect() returned, now AWAITING promise...`);
      await connectPromise;
      console.log("✅ [WS-METRICS] WebSocket connected and subscribed!");
    } catch (wsErr) {
      console.error("❌ [WS-METRICS] Failed to connect WebSocket:", wsErr.message);
      console.warn("⚠️ [WS-METRICS] Continuing anyway (manual reconnect will attempt)...");
      // Engine continues - WS will try to reconnect automatically
    }
    console.log("📡 [WS-METRICS] Connector launched with topics:", metricsWS.subscriptions);

    // 🚀 Export metricsWS globally for API access (orderbook + trade flow data)
    global.metricsWS = metricsWS;

    console.log("⚡ Engine running normally.");

    console.log("🚀 DEBUG: Ready to start Monitor API…");

    await startMonitorApiServer(8090); // AWAIT to ensure FeatureEngine is ready
    console.log("🚀 DEBUG: Monitor API started AND FeatureEngine ready");

    // =====================================================
    // PHASE 5: REGIME ENGINE INITIALIZATION
    // =====================================================
    console.log("=============================");
    console.log("🛡️  REGIME: Starting Regime Engine...");
    console.log("=============================");

    console.log("🛡️  [REGIME] Creating RegimeEngine instance...");
    const regimeEngine = new RegimeEngine(featureEngine, OrderbookManager);
    console.log("🛡️  [REGIME] RegimeEngine instance created");

    // Store in global for API access
    global.regimeEngine = regimeEngine;
    console.log("🛡️  [REGIME] Stored in global");

    console.log("🛡️  [REGIME] Calling regimeEngine.start()...");
    await regimeEngine.start();
    console.log("🛡️  [REGIME] regimeEngine.start() completed");

    // Log startup stats
    const stats = {
        primeSymbols: regimeEngine.primeTier.size,
        normalSymbols: regimeEngine.normalTier.size,
        wildSymbols: regimeEngine.wildTier.size,
        totalSymbols: regimeEngine.primeTier.size + regimeEngine.normalTier.size + regimeEngine.wildTier.size
    };

    logEngineStartup(stats);

    console.log("🛡️  [REGIME] Engine started successfully:");
    console.log(`   Prime tier: ${stats.primeSymbols} symbols (1s updates)`);
    console.log(`   Normal tier: ${stats.normalSymbols} symbols (2s updates)`);
    console.log(`   Wild tier: ${stats.wildSymbols} symbols (3-5s updates)`);
    console.log("=============================");

    // =====================================================
    // PHASE 6: SCORING ENGINE INITIALIZATION
    // =====================================================
    console.log("=============================");
    console.log("🎯 SCORING: Starting Scoring Engine...");
    console.log("=============================");

    console.log("🎯 [SCORING] Importing Scoring Engine...");
    const { scoringEngine } = await import('./scoring/scoringEngine.js');
    console.log("🎯 [SCORING] Scoring Engine imported");

    console.log("🎯 [SCORING] Calling scoringEngine.start()...");
    await scoringEngine.start();
    console.log("🎯 [SCORING] scoringEngine.start() completed");

    const scoringStats = scoringEngine.getStats();
    console.log("🎯 [SCORING] Engine started successfully:");
    console.log(`   Total symbols: ${scoringStats.totalSymbols}`);
    console.log(`   Update interval: ${scoringEngine.config.updateIntervalMs}ms`);
    console.log(`   Signals: ARM=${scoringStats.signalCounts.ARM_LONG + scoringStats.signalCounts.ARM_SHORT}, WATCH=${scoringStats.signalCounts.WATCH_LONG + scoringStats.signalCounts.WATCH_SHORT}`);
    console.log("=============================");

    // =====================================================
    // PHASE 7: STATE MACHINE INITIALIZATION
    // =====================================================
    console.log("=============================");
    console.log("⚙️  STATE MACHINE: Starting State Machine...");
    console.log("=============================");

    console.log("⚙️  [STATE] Importing State Machine...");
    const stateMachine = await import('./state/stateMachine.js');
    console.log("⚙️  [STATE] State Machine imported");

    // Get universe symbols (Prime + Normal for now)
    const smPrimeSymbols = await getSymbolsByCategory("Prime");
    const smNormalSymbols = await getSymbolsByCategory("Normal");

    // Extract symbol strings from metadata objects
    const allSymbols = [
        ...smPrimeSymbols.map(meta => meta.symbol),
        ...smNormalSymbols.map(meta => meta.symbol)
    ];

    console.log(`⚙️  [STATE] Initializing for ${allSymbols.length} symbols...`);
    console.log(`⚙️  [STATE] About to call initStateMachine()...`);

    // Set a timeout to detect if initStateMachine hangs
    const initTimeout = setTimeout(() => {
      console.error(`❌ [STATE] TIMEOUT: initStateMachine() took too long (>10s), continuing anyway...`);
    }, 10000);

    try {
      const smStats = stateMachine.initStateMachine(allSymbols);
      clearTimeout(initTimeout);
      console.log("⚙️  [STATE] initStateMachine() completed");

      // Store in global for API access
      global.stateMachine = stateMachine;
      console.log("⚙️  [STATE] Stored in global");

      console.log("⚙️  [STATE] State Machine started successfully:");
      console.log(`   Symbols tracked: ${smStats.symbolCount}`);
      console.log(`   Tick interval: ${smStats.tickInterval}ms`);
      console.log(`   Event logging: enabled`);
      console.log("=============================");
    } catch (err) {
      clearTimeout(initTimeout);
      console.error(`❌ [STATE] FATAL ERROR in initStateMachine: ${err.message}`);
      console.error(err.stack);
      console.log("⚠️  [STATE] Continuing without StateMachine...");
      // Don't throw - continue execution
    };

    // =====================================================
    // PHASE 8: RISK ENGINE INITIALIZATION
    // =====================================================
    console.log("=============================");
    console.log("💰 RISK: Starting Risk Engine...");
    console.log("=============================");

    console.log("💰 [RISK] Importing Risk Engine...");
    const riskEngine = await import('./risk/riskEngine.js');
    console.log("💰 [RISK] Risk Engine imported");

    // Initialize with SIM mode (10K starting equity)
    const riskConfig = {
        maxRiskPerTradePct: 1.0,
        maxPortfolioHeatPct: 6.0,
        maxDailyLossPct: 5.0,
        maxOpenPositions: 5
    };

    console.log("💰 [RISK] Calling initRiskEngine()...");
    riskEngine.initRiskEngine(riskConfig, "SIM", 10000);
    console.log("💰 [RISK] initRiskEngine() completed");

    // Store in global for API access
    global.riskEngine = riskEngine;
    console.log("💰 [RISK] Stored in global");

    const riskSnapshot = riskEngine.getRiskSnapshot();
    console.log("💰 [RISK] Risk Engine started successfully:");
    console.log(`   Mode: SIM (Simulated)`);
    console.log(`   Starting equity: $${riskSnapshot.account.equityTotal.toFixed(2)}`);
    console.log(`   Max risk per trade: ${riskConfig.maxRiskPerTradePct}%`);
    console.log(`   Max portfolio heat: ${riskConfig.maxPortfolioHeatPct}%`);
    console.log(`   Max daily loss: ${riskConfig.maxDailyLossPct}%`);
    console.log("=============================");

    // =====================================================
    // PHASE 9: TP/SL ENGINE INITIALIZATION
    // =====================================================
    console.log("=============================");
    console.log("📊 TP/SL: Starting TP/SL Engine...");
    console.log("=============================");

    console.log("📊 [TP/SL] Importing TP/SL Engine...");
    const tpslEngine = await import('./execution/tpslEngine.js');
    console.log("📊 [TP/SL] TP/SL Engine imported");

    // Initialize with default config
    const tpslConfig = {
        planner: {
            tp1DistancePct: 0.50,
            tp2DistancePct: 1.00,
            slDistancePct: 0.25,
            breakEvenBufferPct: 0.05,
            trailingDistancePct: 0.10
        }
    };

    console.log("📊 [TP/SL] Calling initTpslEngine()...");
    tpslEngine.initTpslEngine(tpslConfig);
    console.log("📊 [TP/SL] initTpslEngine() completed");

    // Store in global for API access
    global.tpslEngine = tpslEngine;
    console.log("📊 [TP/SL] Stored in global");

    console.log("📊 [TP/SL] TP/SL Engine started successfully:");
    console.log(`   TP1 distance: ${tpslConfig.planner.tp1DistancePct}%`);
    console.log(`   TP2 distance: ${tpslConfig.planner.tp2DistancePct}%`);
    console.log(`   SL distance: ${tpslConfig.planner.slDistancePct}%`);
    console.log(`   Trailing distance: ${tpslConfig.planner.trailingDistancePct}%`);
    console.log("=============================");

    // =====================================================
    // PHASE 10: EXECUTION ENGINE INITIALIZATION
    // =====================================================
    console.log("=============================");
    console.log("⚡ EXEC: Starting Execution Engine...");
    console.log("=============================");

    console.log("⚡ [EXEC] Importing Execution Engine...");
    const executionEngine = await import('./execution/executionEngine.js');
    console.log("⚡ [EXEC] Execution Engine imported");

    // Initialize
    console.log("⚡ [EXEC] Calling initExecutionEngine()...");
    executionEngine.initExecutionEngine();
    console.log("⚡ [EXEC] initExecutionEngine() completed");

    // Store in global for API access
    global.executionEngine = executionEngine;
    console.log("⚡ [EXEC] Stored in global");

    // Setup TPSL_TP1_HIT listener for partial close execution
    executionEngine.addEventListener('TPSL_TP1_HIT', async (tpslEvent) => {
      console.log(`🎯 [INDEX] TPSL_TP1_HIT received, calling handleTpslTp1Hit...`);
      await executionEngine.handleTpslTp1Hit(tpslEvent.payload);
    });
    console.log("⚡ [EXEC] TPSL_TP1_HIT listener registered");

    const execState = executionEngine.getExecutionState();
    console.log("⚡ [EXEC] Execution Engine started successfully:");
    console.log(`   Mode: ${execState.mode}`);
    console.log(`   Safe Mode: ${execState.safeMode ? 'ACTIVE' : 'INACTIVE'}`);
    console.log(`   Client Order ID Prefix: ${CONFIG.execution.clientOrderIdPrefix}`);
    console.log(`   Max Slippage: ${CONFIG.execution.maxSlippagePct * 100}%`);
    console.log(`   Max Spread: ${CONFIG.execution.maxSpreadPct * 100}%`);
    console.log("=============================");

    metrics.heartbeat();

    // =====================================================
    // 🔍 PHASE 6: SIGNAL SCANNER INTEGRATION
    // =====================================================
    console.log("\n=============================");
    console.log("🔍 SCANNER: Initializing Signal Scanner (inside engine)...");
    console.log("=============================");

    const scannerReady = await initializeScannerIntegration();
    if (scannerReady) {
      const scannerControl = await startScannerLoops();
      if (scannerControl) {
        console.log("✅ [SCANNER] Signal scanner is ACTIVE!");
        // Store for potential cleanup
        global.scannerControl = scannerControl;
      } else {
        console.warn("⚠️ [SCANNER] Failed to start scanner loops, continuing anyway...");
      }
    } else {
      console.warn("⚠️ [SCANNER] Could not load scanner module, continuing anyway...");
    }

    console.log("\n🎉 ====================================================");
    console.log("✅ ENGINE FULLY INITIALIZED AND READY");
    console.log("🎉 ====================================================\n");
}

startEngine().catch((err) => {
    console.error("❌ ENGINE CRASHED:", err);
    metrics.markError();
});
