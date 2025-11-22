/**
 * Dashboard API Client
 * Handles all API interactions for the scalper-base dashboard
 */

import { DashboardConfig, debugLog } from './config.js';

export class DashboardAPI {
    constructor() {
        debugLog("🏗️ DashboardAPI constructor called");

        // Detect vab_intercept.js interference
        if (typeof window.vab_intercept !== 'undefined') {
            console.warn("⚠️ vab_intercept.js detected - this may interfere with fetch calls");
        }

        // Check if fetch is native or modified
        debugLog("🔍 Fetch function:", fetch.toString().substring(0, 100) + "...");

        // Use endpoints from config
        this.tickersUrl = DashboardConfig.endpoints.tickers;
        this.tradesUrl = DashboardConfig.endpoints.trades;
        this.storageUrl = DashboardConfig.endpoints.storage;
        this.summaryUrl = DashboardConfig.endpoints.summary;
        this.universeUrl = DashboardConfig.endpoints.universe;
        this.symbolsUrl = DashboardConfig.endpoints.symbols;
        this.microstructureUrl = DashboardConfig.endpoints.microstructure;
        this.featuresHealthUrl = DashboardConfig.endpoints.featuresHealth;

        this.wsConnected = false;
        this.lastUpdate = Date.now();
        this.currentCategory = DashboardConfig.ui.defaultCategory;

        debugLog("📋 URLs configured:", {
            tickers: this.tickersUrl,
            trades: this.tradesUrl,
            storage: this.storageUrl,
            universe: this.universeUrl,
            symbols: this.symbolsUrl
        });
    }

    // Timeout wrapper for fetch calls
    async fetchWithTimeout(url, options = {}, timeout = DashboardConfig.timeouts.fetch) {
        debugLog(`🌐 fetchWithTimeout called: ${url}`);
        debugLog("⚙️ Options:", options);
        debugLog("⏰ Timeout:", timeout + "ms");

        const controller = new AbortController();
        const timeoutId = setTimeout(() => {
            debugLog(`⏰ Request timeout triggered for: ${url}`);
            controller.abort();
        }, timeout);

        try {
            debugLog("🚀 Starting fetch request...");
            const response = await fetch(url, {
                ...options,
                signal: controller.signal,
                cache: "no-store",
                headers: { 'Cache-Control': 'no-cache', ...options.headers }
            });
            debugLog("✅ Fetch completed successfully");
            clearTimeout(timeoutId);
            return response;
        } catch (error) {
            debugLog("❌ Fetch failed:", error);
            clearTimeout(timeoutId);
            if (error.name === 'AbortError') {
                const timeoutError = new Error(`Request timeout after ${timeout}ms`);
                console.error("⏰ Timeout error:", timeoutError);
                throw timeoutError;
            }
            console.error("💥 Network error:", error);
            throw error;
        }
    }

    async updateTickers() {
        debugLog("📈 Starting updateTickers...");
        debugLog("📡 Tickers URL:", this.tickersUrl);

        try {
            debugLog("⏳ Calling fetchWithTimeout for tickers...");
            const response = await this.fetchWithTimeout(this.tickersUrl);
            debugLog("📥 Tickers response received:", response.status, response.statusText);

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            debugLog("🔍 Parsing symbols JSON...");
            const data = await response.json();
            debugLog("📊 Symbols data received:", data);

            if (data.ok && data.tickers && data.tickers.length > 0) {
                debugLog(`✅ Valid tickers data (${data.tickers.length} tickers)`);
                // Filter valid prices from tickers (they already have correct structure)
                const validTickers = data.tickers
                    .filter(ticker => ticker.price !== null && !isNaN(ticker.price) && ticker.price > 0);
                debugLog(`🔢 Valid tickers after filtering: ${validTickers.length}`);
                if (validTickers.length > 0) {
                    debugLog("🎨 Rendering tickers...");
                    this.renderTickers(validTickers);
                    this.updateConnectionStatus(true);
                    this.lastUpdate = Date.now();
                    debugLog("✅ Tickers updated successfully");
                }
            } else {
                console.warn("⚠️ No valid symbol data received:", data);
            }
        } catch (error) {
            console.error("💥 Failed to fetch tickers:", error);
            console.error("🔍 Tickers error details:", {
                name: error.name,
                message: error.message,
                stack: error.stack,
                url: this.tickersUrl
            });
            this.updateConnectionStatus(false);

            // Fallback: Try direct API if proxy fails
            if (error.message.includes('Failed to fetch') || error.message.includes('ERR_CONNECTION_RESET')) {
                console.warn("🔄 Ticker proxy blocked, trying direct API...");
                debugLog("📡 Direct API URL: /monitor/api/symbols");
                try {
                    debugLog("🚀 Attempting direct fetch (without fetchWithTimeout)...");
                    const directResponse = await fetch('/monitor/api/symbols', {
                        cache: "no-store",
                        headers: { 'Cache-Control': 'no-cache' }
                    });
                    debugLog("📥 Direct response:", directResponse.status, directResponse.statusText);
                    debugLog("🔍 Parsing direct response JSON...");
                    const directData = await directResponse.json();
                    debugLog("📊 Direct data received:", directData);
                    if (directData.ok && directData.tickers && directData.tickers.length > 0) {
                        const validTickers = directData.tickers
                            .filter(ticker => ticker.price !== null && !isNaN(ticker.price) && ticker.price > 0);
                        if (validTickers.length > 0) {
                            this.renderTickers(validTickers);
                            this.updateConnectionStatus(true);
                            this.lastUpdate = Date.now();
                            return;
                        }
                    }
                } catch (directError) {
                    console.error("Direct ticker API also failed:", directError);
                }
            }

            // Show connection error if data is stale (older than 10 seconds)
            if (Date.now() - this.lastUpdate > DashboardConfig.timeouts.default) {
                this.renderTickerError("Connection lost - retrying...");
            }
        }
    }

    async updateTrades() {
        try {
            const response = await this.fetchWithTimeout(`${this.tradesUrl}?limit=${DashboardConfig.ui.maxRecentTrades}`);

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();

            if (data.ok && data.trades) {
                this.renderTrades(data.trades);
            }
        } catch (error) {
            console.error("Failed to fetch trades:", error);

            // Fallback: Try direct API if proxy fails
            if (error.message.includes('Failed to fetch') || error.message.includes('ERR_CONNECTION_RESET')) {
                console.warn("Trades proxy blocked, trying direct API...");
                try {
                    const directResponse = await this.fetchWithTimeout(`/monitor/api/trades?limit=${DashboardConfig.ui.maxRecentTrades}`);
                    const directData = await directResponse.json();
                    if (directData.ok && directData.trades) {
                        this.renderTrades(directData.trades);
                    }
                } catch (directError) {
                    console.error("Direct trades API also failed:", directError);
                }
            }
        }
    }

    async updateStorage() {
        try {
            const response = await this.fetchWithTimeout(this.storageUrl);

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();

            if (data.ok && data.storage) {
                this.renderStorage(data.storage);
            } else if (!data.ok) {
                console.error("Storage API error:", data.error);
            }
        } catch (error) {
            console.error("Failed to fetch storage stats:", error);
            console.error("Storage URL:", this.storageUrl);

            // Fallback: Try direct API if proxy fails (browser extension blocking)
            if (error.message.includes('Failed to fetch')) {
                console.warn("Proxy blocked, trying direct API...");
                try {
                    const directResponse = await fetch('/monitor/api/storage', {
                        cache: "no-store",
                        headers: { 'Cache-Control': 'no-cache' }
                    });
                    const directData = await directResponse.json();
                    if (directData.ok && directData.storage) {
                        this.renderStorage(directData.storage);
                    }
                } catch (directError) {
                    console.error("Direct API also failed:", directError);
                    // Show fallback message
                    this.renderStorageError("Storage API unavailable");
                }
            }
        }
    }

    async updateUniverse() {
        debugLog("🔄 Starting updateUniverse...");
        debugLog("📡 Universe URL:", this.universeUrl);

        try {
            debugLog("⏳ Fetching universe data...");
            const response = await this.fetchWithTimeout(this.universeUrl);
            debugLog("📥 Response received:", response.status, response.statusText);

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            debugLog("🔍 Parsing JSON response...");
            const data = await response.json();
            debugLog("📊 Universe data received:", data);

            // Handle both response formats: {ok: true, universe: {...}} or direct {...stats, symbols}
            const universeData = data.ok ? data.universe : data;

            if (universeData && (universeData.stats || universeData.totalSymbols)) {
                debugLog("✅ Valid universe data, rendering stats...");
                this.renderUniverseStats(universeData);
                debugLog("🎯 Updating symbols for category:", this.currentCategory);
                await this.updateSymbols(this.currentCategory);
            } else {
                console.error("❌ Universe API error: Invalid response format", data);
            }
        } catch (error) {
            console.error("💥 Failed to fetch universe:", error);
            console.error("🔍 Error details:", {
                name: error.name,
                message: error.message,
                stack: error.stack
            });

            // Fallback: Try direct API if proxy fails
            if (error.message.includes('Failed to fetch')) {
                console.warn("Universe proxy blocked, trying direct API...");
                try {
                    const directResponse = await fetch('/monitor/api/symbols', {
                        cache: "no-store",
                        headers: { 'Cache-Control': 'no-cache' }
                    });
                    const directData = await directResponse.json();
                    if (directData.ok && directData.universe) {
                        this.renderUniverseStats(directData.universe);
                        await this.updateSymbols(this.currentCategory);
                    }
                } catch (directError) {
                    console.error("Direct Universe API also failed:", directError);
                    this.renderUniverseError("Universe API unavailable");
                }
            }
        }
    }

    async updateSymbols(category = 'Prime') {
        debugLog(`🎯 Starting updateSymbols for category: ${category}`);

        try {
            const apiUrl = this.symbolsUrl;

            debugLog("📡 Symbols API URL:", apiUrl);
            debugLog("⏳ Fetching symbols data...");

            const response = await this.fetchWithTimeout(apiUrl);
            debugLog("📥 Symbols response:", response.status, response.statusText);

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            debugLog("🔍 Parsing symbols JSON...");
            const data = await response.json();
            debugLog("📊 Symbols data received:", data);
            debugLog("📊 Symbols keys:", Object.keys(data));
            debugLog("📊 data.symbols type:", typeof data.symbols);
            debugLog("📊 data.symbols:", data.symbols);

            if (data.symbols) {
                // Convert symbols object to array with full metadata
                const symbolsArray = Object.values(data.symbols);
                debugLog(`📊 Symbols array length: ${symbolsArray.length}`);
                debugLog(`📊 First symbol:`, symbolsArray[0]);

                // Filter symbols by category on frontend
                let filteredSymbols = symbolsArray;
                if (category !== 'All') {
                    filteredSymbols = symbolsArray.filter(symbol =>
                        symbol.category && symbol.category === category
                    );
                }
                debugLog(`✅ Valid symbols data (${filteredSymbols.length} symbols for ${category}), rendering...`);
                this.renderSymbols(filteredSymbols, category);
            } else {
                console.error("❌ Symbols API error: Invalid response format", data);
                this.renderSymbolsError(`No symbols data available`);
            }
        } catch (error) {
            console.error(`💥 Failed to fetch ${category} symbols:`, error);
            console.error("🔍 Symbols error details:", {
                name: error.name,
                message: error.message,
                stack: error.stack
            });
            this.renderSymbolsError(`${category} symbols unavailable`);
        }
    }

    renderTickerError(message) {
        const container = document.getElementById('tickers-container');
        if (!container) return;

        container.innerHTML = `<div class="col-span-full text-center text-amber-400 text-sm py-8">
            <div class="animate-pulse">⚠️ ${message}</div>
        </div>`;
    }

    renderTickers(tickers) {
        const container = document.getElementById('tickers-container');
        if (!container) return;

        if (tickers.length === 0) {
            container.innerHTML = '<div class="text-center text-slate-500 text-sm py-4">No ticker data available</div>';
            return;
        }

        // Check if table already exists
        let tbody = container.querySelector('tbody');
        let scrollDiv = container.querySelector('.overflow-auto');

        // If table doesn't exist, create it
        if (!tbody) {
            container.innerHTML = `
                <div class="overflow-auto max-h-96 border border-slate-700 rounded-lg">
                    <table class="w-full text-left">
                        <thead class="bg-slate-800/60 sticky top-0">
                            <tr>
                                <th class="px-3 py-2 text-xs font-semibold text-slate-300 uppercase tracking-wider">Symbol</th>
                                <th class="px-3 py-2 text-xs font-semibold text-slate-300 uppercase tracking-wider text-right">Price</th>
                                <th class="px-3 py-2 text-xs font-semibold text-slate-300 uppercase tracking-wider text-right">24h %</th>
                                <th class="px-3 py-2 text-xs font-semibold text-slate-300 uppercase tracking-wider text-right">Volume</th>
                            </tr>
                        </thead>
                        <tbody class="bg-slate-900/40 divide-y divide-slate-700/50">
                        </tbody>
                    </table>
                </div>
            `;
            tbody = container.querySelector('tbody');
            scrollDiv = container.querySelector('.overflow-auto');
        }

        // Save current scroll position
        const currentScrollTop = scrollDiv ? scrollDiv.scrollTop : 0;

        // Create ticker lookup map
        const tickerMap = new Map();
        tickers.forEach(ticker => tickerMap.set(ticker.symbol, ticker));

        // Update existing rows or add new ones
        const existingRows = tbody.querySelectorAll('tr[data-symbol]');
        const processedSymbols = new Set();

        // Update existing rows
        existingRows.forEach(row => {
            const symbol = row.getAttribute('data-symbol');
            const ticker = tickerMap.get(symbol);

            if (ticker) {
                this.updateTickerRow(row, ticker);
                processedSymbols.add(symbol);
            } else {
                // Remove row if ticker no longer exists
                row.remove();
            }
        });

        // Add new rows for tickers not yet in table
        tickers.forEach(ticker => {
            if (!processedSymbols.has(ticker.symbol)) {
                const row = this.createTickerRow(ticker);
                tbody.appendChild(row);
            }
        });

        // Restore scroll position
        if (scrollDiv) {
            scrollDiv.scrollTop = currentScrollTop;
        }
    }

    createTickerRow(ticker) {
        const change = ticker.change24h || 0;
        const changeClass = change >= 0 ? 'text-emerald-400' : 'text-red-400';
        const changeIcon = change >= 0 ? '▲' : '▼';
        const price = ticker.price ? `$${ticker.price.toFixed(2)}` : 'N/A';
        const volume = this.formatVolume(ticker.volume24h);

        const row = document.createElement('tr');
        row.className = 'hover:bg-slate-800/30 transition-colors';
        row.setAttribute('data-symbol', ticker.symbol);
        row.innerHTML = `
            <td class="px-3 py-2 text-sm font-medium text-slate-200">${ticker.symbol}</td>
            <td class="px-3 py-2 text-sm font-bold text-slate-100 text-right">${price}</td>
            <td class="px-3 py-2 text-xs ${changeClass} text-right">
                ${changeIcon} ${Math.abs(change).toFixed(2)}%
            </td>
            <td class="px-3 py-2 text-xs text-slate-500 text-right">${volume}</td>
        `;
        return row;
    }

    updateTickerRow(row, ticker) {
        const change = ticker.change24h || 0;
        const changeClass = change >= 0 ? 'text-emerald-400' : 'text-red-400';
        const changeIcon = change >= 0 ? '▲' : '▼';
        const price = ticker.price ? `$${ticker.price.toFixed(2)}` : 'N/A';
        const volume = this.formatVolume(ticker.volume24h);

        const cells = row.querySelectorAll('td');
        if (cells.length >= 4) {
            // Update price
            cells[1].textContent = price;

            // Update change with new class
            cells[2].className = `px-3 py-2 text-xs ${changeClass} text-right`;
            cells[2].textContent = `${changeIcon} ${Math.abs(change).toFixed(2)}%`;

            // Update volume
            cells[3].textContent = volume;
        }
    }

    renderTrades(trades) {
        const container = document.getElementById('recent-trades-body');
        if (!container) return;

        if (trades.length === 0) {
            container.innerHTML = '<tr><td colspan="6" class="text-center text-slate-500 py-4">No recent trades</td></tr>';
            return;
        }

        // Limit to max 10 trades for clean display
        const limitedTrades = trades.slice(0, DashboardConfig.ui.maxRecentTrades);

        container.innerHTML = limitedTrades.map(trade => {
            const time = new Date(trade.timestamp).toLocaleTimeString('en-US', {
                hour12: false,
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
            });
            const sideClass = trade.side === 'Buy' ? 'text-emerald-400' : 'text-red-400';
            const directionIcon = this.getTickDirectionIcon(trade.tickDirection);

            return `
                <tr class="hover:bg-slate-800/30 transition-colors">
                    <td class="py-2 px-3 text-slate-400">${time}</td>
                    <td class="py-2 px-3 text-slate-200 font-medium">${trade.symbol}</td>
                    <td class="py-2 px-3 ${sideClass} font-medium">${trade.side}</td>
                    <td class="py-2 px-3 text-right text-slate-200 font-mono">$${trade.price?.toFixed(2) || 'N/A'}</td>
                    <td class="py-2 px-3 text-right text-slate-300 font-mono">${trade.quantity || 'N/A'}</td>
                    <td class="py-2 px-3 text-center text-slate-400">${directionIcon}</td>
                </tr>
            `;
        }).join('');
    }

    renderStorage(storage) {
        if (!storage) return;

        // Update file counts and sizes
        const tickerFiles = document.getElementById('ticker-files');
        const tradeFiles = document.getElementById('trade-files');
        const tickerSize = document.getElementById('ticker-size');
        const tradeSize = document.getElementById('trade-size');

        if (tickerFiles) tickerFiles.textContent = storage.todayFiles?.tickers || 0;
        if (tradeFiles) tradeFiles.textContent = storage.todayFiles?.trades || 0;
        if (tickerSize) tickerSize.textContent = this.formatBytes(storage.todaySizes?.tickers || 0);
        if (tradeSize) tradeSize.textContent = this.formatBytes(storage.todaySizes?.trades || 0);
    }

    renderStorageError(message) {
        // Show error message in storage stats
        const tickerFiles = document.getElementById('ticker-files');
        const tradeFiles = document.getElementById('trade-files');

        if (tickerFiles) tickerFiles.textContent = '⚠️';
        if (tradeFiles) tradeFiles.textContent = '⚠️';

        console.warn('Storage stats error:', message);
    }

    updateConnectionStatus(connected) {
        const statusElement = document.getElementById('ws-status');
        if (!statusElement) return;

        this.wsConnected = connected;

        if (connected) {
            statusElement.className = "inline-flex items-center gap-1 px-2 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/40 text-emerald-300 text-xs";
            statusElement.innerHTML = '<span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span> Connected';
        } else {
            statusElement.className = "inline-flex items-center gap-1 px-2 py-1 rounded-full bg-red-500/10 border border-red-500/40 text-red-300 text-xs";
            statusElement.innerHTML = '<span class="w-2 h-2 rounded-full bg-red-400"></span> Disconnected';
        }
    }

    renderUniverseStats(universe) {
        debugLog("🎨 renderUniverseStats called with:", universe);

        if (!universe) {
            console.error("❌ No universe data provided to renderUniverseStats");
            return;
        }

        // Update statistics
        debugLog("🔍 Looking for DOM elements...");
        const totalSymbols = document.getElementById('total-symbols');
        const primeCount = document.getElementById('prime-count');
        const normalCount = document.getElementById('normal-count');
        const wildCount = document.getElementById('wild-count');

        debugLog("📋 DOM elements found:", {
            totalSymbols: !!totalSymbols,
            primeCount: !!primeCount,
            normalCount: !!normalCount,
            wildCount: !!wildCount
        });

        debugLog("📊 Universe stats to render:", {
            totalSymbols: universe.totalSymbols || universe.stats?.totalSymbols || 0,
            primeCount: universe.primeCount || universe.stats?.primeCount || 0,
            normalCount: universe.normalCount || universe.stats?.normalCount || 0,
            wildCount: universe.wildCount || universe.stats?.wildCount || 0
        });

        if (totalSymbols) {
            const value = universe.totalSymbols || universe.stats?.totalSymbols || 0;
            totalSymbols.textContent = value;
            debugLog("✅ Updated total-symbols:", value);
        } else {
            console.error("❌ total-symbols element not found");
        }

        if (primeCount) {
            const value = universe.primeCount || universe.stats?.primeCount || 0;
            primeCount.textContent = value;
            debugLog("✅ Updated prime-count:", value);
        } else {
            console.error("❌ prime-count element not found");
        }

        if (normalCount) {
            const value = universe.normalCount || universe.stats?.normalCount || 0;
            normalCount.textContent = value;
            debugLog("✅ Updated normal-count:", value);
        } else {
            console.error("❌ normal-count element not found");
        }

        if (wildCount) {
            const value = universe.wildCount || universe.stats?.wildCount || 0;
            wildCount.textContent = value;
            debugLog("✅ Updated wild-count:", value);
        } else {
            console.error("❌ wild-count element not found");
        }
    }

    renderSymbols(symbols, category) {
        debugLog(`🎨 renderSymbols called for category: ${category}, symbols:`, symbols);

        const container = document.getElementById('universe-table-body');
        debugLog("🔍 universe-table-body element found:", !!container);

        if (!container) {
            console.error("❌ universe-table-body element not found in DOM");
            return;
        }

        if (!symbols || symbols.length === 0) {
            debugLog("⚠️ No symbols to render, showing empty message");
            container.innerHTML = `
                <tr>
                    <td colspan="4" class="text-center text-slate-500 text-sm py-8">
                        No symbols found in ${category} category
                    </td>
                </tr>
            `;
            return;
        }

        debugLog(`✅ Rendering ${symbols.length} symbols for ${category} category`);
        container.innerHTML = symbols.map((symbolMeta, index) => {
            // Handle both string format (old API) and object format (new API)
            const symbolName = typeof symbolMeta === 'string' ? symbolMeta : symbolMeta.symbol;
            const symbolCategory = typeof symbolMeta === 'string' ? category : symbolMeta.category;
            const maxLeverage = typeof symbolMeta === 'string' ? '1-125x' : `1-${symbolMeta.maxLeverage || 125}x`;
            const status = typeof symbolMeta === 'string' ? 'Active' : (symbolMeta.status === 'Trading' ? 'Active' : symbolMeta.status);

            // Format current price
            let priceDisplay = '-';
            let changeDisplay = '';
            if (typeof symbolMeta === 'object' && symbolMeta.currentPrice) {
                const price = parseFloat(symbolMeta.currentPrice);
                if (price < 1) {
                    priceDisplay = price.toFixed(6);
                } else if (price < 100) {
                    priceDisplay = price.toFixed(4);
                } else {
                    priceDisplay = price.toFixed(2);
                }

                if (symbolMeta.change24h) {
                    const change = parseFloat(symbolMeta.change24h);
                    const changeColor = change >= 0 ? 'text-green-400' : 'text-red-400';
                    const changeSign = change >= 0 ? '+' : '';
                    changeDisplay = `<div class="text-xs ${changeColor} mt-0.5">${changeSign}${change.toFixed(2)}%</div>`;
                }
            }

            return `
                <tr class="hover:bg-slate-800/30 transition-colors">
                    <td class="p-2 text-slate-100 font-semibold">${symbolName}</td>
                    <td class="p-2">
                        <span class="px-2 py-1 text-xs rounded-full ${this.getCategoryStyle(symbolCategory)}">
                            ${symbolCategory}
                        </span>
                    </td>
                    <td class="p-2 text-right text-slate-400 text-sm">${maxLeverage}</td>
                    <td class="p-2 text-slate-300 text-sm">${status}</td>
                </tr>
            `;
        }).join('');
    }

    getCategoryStyle(category) {
        switch(category) {
            case 'Prime':
                return 'bg-amber-500/20 text-amber-300 border border-amber-500/40';
            case 'Normal':
                return 'bg-blue-500/20 text-blue-300 border border-blue-500/40';
            case 'Wild':
                return 'bg-purple-500/20 text-purple-300 border border-purple-500/40';
            default:
                return 'bg-slate-500/20 text-slate-300 border border-slate-500/40';
        }
    }

    renderUniverseError(message) {
        const container = document.getElementById('universe-table-body');
        if (!container) return;

        container.innerHTML = `
            <tr>
                <td colspan="5" class="text-center text-amber-400 text-sm py-8">
                    <div class="animate-pulse">⚠️ ${message}</div>
                </td>
            </tr>
        `;
    }

    renderSymbolsError(message) {
        const container = document.getElementById('universe-table-body');
        if (!container) return;

        container.innerHTML = `
            <tr>
                <td colspan="5" class="text-center text-amber-400 text-sm py-8">
                    <div class="animate-pulse">⚠️ ${message}</div>
                </td>
            </tr>
        `;
    }

    formatVolume(volume) {
        if (!volume) return 'N/A';
        if (volume >= 1e9) return (volume / 1e9).toFixed(1) + 'B';
        if (volume >= 1e6) return (volume / 1e6).toFixed(1) + 'M';
        if (volume >= 1e3) return (volume / 1e3).toFixed(1) + 'K';
        return volume.toFixed(0);
    }

    formatBytes(bytes) {
        if (!bytes) return '0 B';
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(1024));
        return (bytes / Math.pow(1024, i)).toFixed(1) + ' ' + sizes[i];
    }

    getTickDirectionIcon(direction) {
        switch(direction) {
            case 'PlusTick': return '↗️';
            case 'MinusTick': return '↘️';
            case 'ZeroPlusTick': return '→+';
            case 'ZeroMinusTick': return '→-';
            default: return '·';
        }
    }

    // FAZA 3: Microstructure Methods
    async updateMicrostructureStats() {
        try {
            debugLog("📊 Updating microstructure stats...");

            // Get health status for preview
            const healthResponse = await fetch('/api/microstructure/health');
            if (healthResponse.ok) {
                const data = await healthResponse.json();
                debugLog("🔍 Microstructure stats data:", data);

                // API returns: { ok: true, health: { status, activeSymbols, healthySymbols }, symbols: [...] }
                const health = data.health || {};
                const symbols = data.symbols || [];

                // Calculate events per second from trade counts
                const totalTrades = symbols.reduce((sum, s) => sum + (s.tradesCount || 0), 0);
                const eventsPerSecond = Math.floor(totalTrades / 60); // Rough estimate

                // Update preview cards (new dashboard)
                const symbolsPreview = document.getElementById('micro-symbols-preview');
                const ratePreview = document.getElementById('micro-rate-preview');
                const healthPreview = document.getElementById('micro-health-preview');

                if (symbolsPreview) {
                    symbolsPreview.textContent = health.activeSymbols || 0;
                }
                if (ratePreview) {
                    ratePreview.textContent = eventsPerSecond;
                }
                if (healthPreview) {
                    const status = (health.status || '').toUpperCase();
                    const isHealthy = status === 'HEALTHY';
                    healthPreview.textContent = isHealthy ? 'OK' : (status === 'DEGRADED' ? 'Warn' : 'Err');
                    healthPreview.className = isHealthy ?
                        'text-lg font-bold text-green-400' :
                        (status === 'DEGRADED' ? 'text-lg font-bold text-amber-400' : 'text-lg font-bold text-red-400');
                }

                // OLD dashboard IDs (keep for compatibility if old dashboard still exists)
                const oldSymbolsCount = document.getElementById('micro-symbols-count');
                const oldSymbolsStatus = document.getElementById('micro-symbols-status');
                const oldDataRate = document.getElementById('micro-data-rate');
                const oldHealth = document.getElementById('micro-health');
                const oldHealthDetails = document.getElementById('micro-health-details');

                if (oldSymbolsCount) oldSymbolsCount.textContent = health.activeSymbols || '-';
                if (oldSymbolsStatus) oldSymbolsStatus.textContent = `${health.healthySymbols || 0} active`;
                if (oldDataRate) oldDataRate.textContent = `${eventsPerSecond} evt/s`;
                if (oldHealth) {
                    const status = (health.status || '').toUpperCase();
                    oldHealth.textContent = status === 'HEALTHY' ? 'Good' : 'Warning';
                }
                if (oldHealthDetails) {
                    const status = (health.status || '').toUpperCase();
                    oldHealthDetails.textContent = status === 'HEALTHY' ? 'All systems operational' : 'Check system logs';
                }
            }

        } catch (error) {
            console.error("💥 Failed to update microstructure stats:", error);
            const healthPreview = document.getElementById('micro-health-preview');
            if (healthPreview) {
                healthPreview.textContent = 'Error';
                healthPreview.className = 'text-lg font-bold text-red-400';
            }
        }
    }

    renderTopSymbols(symbols) {
        const container = document.getElementById('micro-top-symbols');
        if (!container) return;

        if (!symbols || symbols.length === 0) {
            container.innerHTML = '<div class="text-slate-500 text-xs">No active symbols</div>';
            return;
        }

        // Sort by trade count and take top 5
        const topSymbols = symbols
            .filter(s => s.tradesCount > 0)
            .sort((a, b) => b.tradesCount - a.tradesCount)
            .slice(0, 5);

        container.innerHTML = topSymbols.map(symbol => `
            <div class="flex justify-between items-center text-xs py-1 px-2 rounded bg-slate-800/50 hover:bg-slate-700/50 transition-colors">
                <span class="text-slate-300 font-medium">${symbol.symbol}</span>
                <span class="text-slate-400">${symbol.tradesCount} trades</span>
            </div>
        `).join('');
    }

    updateRecentEvents() {
        const container = document.getElementById('micro-recent-events');
        if (!container) return;

        // Simulate recent events
        const events = [
            'Orderbook updated',
            'Trade executed',
            'Candle generated',
            'Data persisted',
            'Health check OK'
        ];

        const recentEvents = events.slice(0, 3).map(event =>
            `<div class="text-slate-400 text-xs">${new Date().toLocaleTimeString().split(':').slice(1).join(':')} - ${event}</div>`
        ).join('');

        container.innerHTML = recentEvents;
    }

    // FAZA 4: Feature Engine Methods
    async updateFeatureEngineStats() {
        try {
            debugLog("🚀 Updating Feature Engine stats...");

            // Get health status
            const healthResponse = await fetch(this.featuresHealthUrl);
            debugLog("🔍 Health response status:", healthResponse.status);

            if (!healthResponse.ok) {
                throw new Error(`HTTP ${healthResponse.status}`);
            }

            const healthData = await healthResponse.json();
            debugLog("🔍 Parsed health data:", healthData);

            if (healthData.status === 'success' && healthData.data) {
                const data = healthData.data;

                // Update NEW dashboard preview cards
                const symbolsPreview = document.getElementById('features-symbols-preview');
                const ratePreview = document.getElementById('features-rate-preview');
                const healthPreview = document.getElementById('features-health-preview');

                if (symbolsPreview) {
                    symbolsPreview.textContent = data.activeSymbols || 0;
                }
                if (ratePreview) {
                    ratePreview.textContent = data.performanceMetrics?.updatesPerSecond || 0;
                }
                if (healthPreview) {
                    const isHealthy = data.status === 'healthy';
                    healthPreview.textContent = isHealthy ? 'OK' : 'Warn';
                    healthPreview.className = isHealthy ? 'text-lg font-bold text-green-400' : 'text-lg font-bold text-amber-400';
                }

                // OLD dashboard IDs (keep for compatibility)
                const oldSymbolsCount = document.getElementById('features-symbols-count');
                const oldSymbolsStatus = document.getElementById('features-symbols-status');
                const oldUpdateRate = document.getElementById('features-update-rate');
                const oldAvgTime = document.getElementById('features-avg-time');
                const oldHealth = document.getElementById('features-health');
                const oldHealthDetails = document.getElementById('features-health-details');

                if (oldSymbolsCount) oldSymbolsCount.textContent = data.activeSymbols || 0;
                if (oldSymbolsStatus) oldSymbolsStatus.textContent = `${data.activeSymbols || 0} symbols analyzed`;
                if (oldUpdateRate) oldUpdateRate.textContent = data.performanceMetrics?.updatesPerSecond || 0;
                if (oldAvgTime) {
                    oldAvgTime.textContent = data.performanceMetrics?.averageUpdateTime ?
                        `${data.performanceMetrics.averageUpdateTime.toFixed(1)} ms` : '0 ms';
                }
                if (oldHealth) {
                    oldHealth.textContent = data.status === 'healthy' ? 'Healthy' : 'Warning';
                }
                if (oldHealthDetails) {
                    oldHealthDetails.textContent = data.status === 'healthy' ?
                        'All engines operational' : 'Some issues detected';
                }

                // Update performance metrics (old dashboard)
                const perfSymbols = document.getElementById('perf-symbols');
                const perfAnalyses = document.getElementById('perf-analyses');
                const perfErrors = document.getElementById('perf-errors');

                if (perfSymbols) perfSymbols.textContent = data.performanceMetrics?.symbolsProcessed || 0;
                if (perfAnalyses) perfAnalyses.textContent = data.totalAnalyses || 0;
                if (perfErrors) perfErrors.textContent = data.performanceMetrics?.errorsCount || 0;

                // Update memory stats (old dashboard)
                if (data.memory) {
                    const memRss = document.getElementById('mem-rss');
                    const memHeap = document.getElementById('mem-heap');
                    const memUptime = document.getElementById('mem-uptime');

                    if (memRss) memRss.textContent = `${(data.memory.rss / 1024 / 1024).toFixed(1)} MB`;
                    if (memHeap) memHeap.textContent = `${(data.memory.heapUsed / 1024 / 1024).toFixed(1)} MB`;
                    if (memUptime) memUptime.textContent = `${Math.floor(data.uptime)} sec`;
                }

                // Update engines status (old dashboard)
                if (data.engines) {
                    this.updateEnginesStatus(data.engines);
                }

                debugLog("✅ Feature Engine stats updated successfully");
            }

        } catch (error) {
            console.error("❌ Error updating Feature Engine stats:", error);
            const healthPreview = document.getElementById('features-health-preview');
            if (healthPreview) {
                healthPreview.textContent = 'Error';
                healthPreview.className = 'text-lg font-bold text-red-400';
            }
        }
    }

    updateEnginesStatus(engines) {
        const container = document.getElementById('features-engines');
        if (!container) return;

        const engineNames = {
            imbalance: 'Order Book Imbalance',
            walls: 'Walls & Spoofing',
            flow: 'Flow Delta',
            volatility: 'Volatility Engine',
            leverage: 'Fee Leverage',
            pumps: 'Pump Signals'
        };

        container.innerHTML = Object.entries(engines).map(([key, active]) => {
            const name = engineNames[key] || key;
            const status = active ? 'Active' : 'Inactive';
            const statusClass = active ? 'text-emerald-400' : 'text-slate-500';
            const iconClass = active ? 'bg-emerald-400' : 'bg-slate-500';

            return `
                <div class="flex items-center justify-between text-xs">
                    <div class="flex items-center gap-2">
                        <div class="w-2 h-2 rounded-full ${iconClass}"></div>
                        <span class="text-slate-400">${name}</span>
                    </div>
                    <span class="${statusClass}">${status}</span>
                </div>
            `;
        }).join('');
    }

    updateFeatureOverview(data) {
        const container = document.getElementById('features-overview');
        if (!container) return;

        if (!data || data.length === 0) {
            container.innerHTML = `
                <div class="flex justify-between items-center text-xs py-2 px-3 rounded bg-slate-800/50">
                    <span class="text-slate-400">No active analysis data</span>
                    <span class="text-slate-500">Waiting for market data...</span>
                </div>
            `;
            return;
        }

        container.innerHTML = data.map(item => {
            const symbol = item.symbol || 'Unknown';
            const score = item.score !== undefined ? item.score.toFixed(3) : '-';
            const lastUpdate = item.lastUpdate ? new Date(item.lastUpdate).toLocaleTimeString() : '-';
            const scoreClass = item.score > 0.5 ? 'text-emerald-400' : 'text-slate-300';

            return `
                <div class="flex justify-between items-center text-xs py-2 px-3 rounded bg-slate-800/50 hover:bg-slate-700/50 transition-colors">
                    <div class="flex items-center gap-2">
                        <span class="text-slate-200 font-mono">${symbol}</span>
                        <span class="text-slate-500">•</span>
                        <span class="text-slate-400">Score: <span class="${scoreClass}">${score}</span></span>
                    </div>
                    <span class="text-slate-500">${lastUpdate}</span>
                </div>
            `;
        }).join('');
    }

    /**
     * NEW: Render Prime Markets (top 6 only) as cards
     */
    async renderPrimeMarkets() {
        try {
            const response = await this.fetchWithTimeout(this.universeUrl);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            const data = await response.json();
            const universeData = data.ok ? data.universe : data;

            if (!universeData.symbols) return;

            // Get Prime symbols only
            const primeSymbols = Object.values(universeData.symbols)
                .filter(s => s.category === 'Prime')
                .slice(0, DashboardConfig.ui.maxPrimeMarkets);

            // Get ticker data for these symbols
            const tickerResponse = await this.fetchWithTimeout(this.tickersUrl);
            if (!tickerResponse.ok) return;

            const tickerData = await tickerResponse.json();
            const tickers = tickerData.ok ? tickerData.tickers : tickerData.tickers || [];

            // Create ticker map
            const tickerMap = new Map();
            tickers.forEach(t => tickerMap.set(t.symbol, t));

            // Render cards
            const container = document.getElementById('prime-markets-grid');
            if (!container) return;

            container.innerHTML = primeSymbols.map(symbol => {
                const ticker = tickerMap.get(symbol.symbol);
                const price = ticker?.price ? `$${ticker.price.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}` : 'N/A';
                const change = ticker?.change24h || 0;
                const changeClass = change >= 0 ? 'text-emerald-400' : 'text-red-400';
                const changeIcon = change >= 0 ? '▲' : '▼';
                const volume = ticker?.volume24h ? this.formatVolume(ticker.volume24h) : '-';

                // Format leverage (handle different formats: "1-100x", 100, "100", etc.)
                const leverage = symbol.leverage || symbol.maxLeverage || 'N/A';
                const leverageText = typeof leverage === 'string' ? leverage : `${leverage}x`;

                return `
                    <div class="p-3 rounded-lg border border-slate-700 bg-slate-800/40 hover:border-slate-600 transition-colors">
                        <div class="flex items-center justify-between mb-2">
                            <span class="text-sm font-bold text-slate-200">${symbol.symbol}</span>
                            <span class="text-xs text-slate-500">${leverageText}</span>
                        </div>
                        <div class="text-xl font-bold text-slate-100">${price}</div>
                        <div class="flex items-center justify-between mt-2 text-xs">
                            <span class="${changeClass} font-medium">${changeIcon} ${Math.abs(change).toFixed(2)}%</span>
                            <span class="text-slate-500">${volume}</span>
                        </div>
                    </div>
                `;
            }).join('');

        } catch (error) {
            console.error('Failed to render prime markets:', error);
        }
    }

    /**
     * NEW: Update Key Metrics (Active Symbols, Data Rate, Uptime)
     */
    async updateKeyMetrics() {
        try {
            // Active Symbols from microstructure
            const microResponse = await this.fetchWithTimeout('/api/microstructure/health');
            if (microResponse.ok) {
                const micro = await microResponse.json();
                debugLog("🔍 Microstructure health data:", micro);

                const activeSymbolsEl = document.getElementById('metric-active-symbols');
                const symbolsDetailEl = document.getElementById('metric-symbols-detail');
                const dataRateEl = document.getElementById('metric-data-rate');

                // API returns: { ok: true, health: { activeSymbols, healthySymbols }, symbols: [...] }
                const healthData = micro.health || {};
                const activeSymbols = healthData.activeSymbols || 0;
                const healthySymbols = healthData.healthySymbols || 0;

                // Get symbols data for metrics
                const symbolsData = micro.symbols || [];
                const totalTrades = symbolsData.reduce((sum, s) => sum + (s.tradesCount || 0), 0);
                const eventsPerSecond = Math.floor(totalTrades / 60); // Rough estimate

                if (activeSymbolsEl) {
                    activeSymbolsEl.textContent = activeSymbols;
                }
                if (symbolsDetailEl) {
                    symbolsDetailEl.textContent = `${healthySymbols} tracking`;
                }
                if (dataRateEl) {
                    dataRateEl.textContent = `${eventsPerSecond} evt/s`;
                }
            }

            // Uptime from feature engine
            const featuresResponse = await this.fetchWithTimeout(this.featuresHealthUrl);
            if (featuresResponse.ok) {
                const features = await featuresResponse.json();
                debugLog("🔍 Features health data:", features);

                const uptimeEl = document.getElementById('metric-uptime');
                const healthEl = document.getElementById('metric-health');

                // Handle different response structures
                const data = features.data || features;
                const uptime = data.uptime || 0;
                const status = data.status || 'unknown';

                if (uptimeEl) {
                    uptimeEl.textContent = this.formatUptime(uptime);
                }
                if (healthEl) {
                    const isHealthy = status === 'healthy';
                    healthEl.textContent = isHealthy ? 'All systems operational' : 'Check system logs';
                    healthEl.className = isHealthy ? 'mt-1 text-xs text-emerald-400' : 'mt-1 text-xs text-amber-400';
                }
            }

        } catch (error) {
            console.error('Failed to update key metrics:', error);
            // Set fallback values
            const activeSymbolsEl = document.getElementById('metric-active-symbols');
            const symbolsDetailEl = document.getElementById('metric-symbols-detail');
            const dataRateEl = document.getElementById('metric-data-rate');
            const uptimeEl = document.getElementById('metric-uptime');
            const healthEl = document.getElementById('metric-health');

            if (activeSymbolsEl) activeSymbolsEl.textContent = '0';
            if (symbolsDetailEl) symbolsDetailEl.textContent = 'Connecting...';
            if (dataRateEl) dataRateEl.textContent = '0 evt/s';
            if (uptimeEl) uptimeEl.textContent = '-';
            if (healthEl) {
                healthEl.textContent = 'Connection error';
                healthEl.className = 'mt-1 text-xs text-red-400';
            }
        }
    }

    /**
     * Helper: Format uptime seconds to human readable
     */
    formatUptime(seconds) {
        if (!seconds || seconds < 60) return `${Math.floor(seconds)}s`;
        const minutes = Math.floor(seconds / 60);
        if (minutes < 60) return `${minutes}m`;
        const hours = Math.floor(minutes / 60);
        const mins = minutes % 60;
        return `${hours}h ${mins}m`;
    }

    start() {
        debugLog("🚀 Starting Dashboard API...");
        debugLog("📊 Initial data load...");

        // Initial load - NEW DASHBOARD
        debugLog("🔑 Updating key metrics...");
        this.updateKeyMetrics();

        debugLog("⭐ Rendering prime markets...");
        this.renderPrimeMarkets();

        debugLog("💱 Updating recent trades...");
        this.updateTrades();

        debugLog("🔬 Updating microstructure preview...");
        this.updateMicrostructureStats();

        debugLog("🚀 Updating Feature Engine preview...");
        this.updateFeatureEngineStats();

        debugLog("⏰ Setting up polling intervals...");
        // Set up polling intervals using config values

        // Key metrics every 5s
        setInterval(() => {
            this.updateKeyMetrics();
        }, 5000);

        // Prime markets every 2s
        setInterval(() => {
            debugLog("🔄 Interval: updating prime markets");
            this.renderPrimeMarkets();
        }, DashboardConfig.intervals.tickers);

        setInterval(() => {
            debugLog("🔄 Interval: updating trades");
            this.updateTrades();
        }, DashboardConfig.intervals.trades);

        setInterval(() => {
            debugLog("🔄 Interval: updating storage");
            this.updateStorage();
        }, DashboardConfig.intervals.storage);

        setInterval(() => {
            debugLog("🔄 Interval: updating universe");
            this.updateUniverse();
        }, DashboardConfig.intervals.universe);

        setInterval(() => {
            debugLog("🔄 Interval: updating microstructure");
            this.updateMicrostructureStats();
            this.updateRecentEvents();
        }, DashboardConfig.intervals.microstructure);

        setInterval(() => {
            debugLog("🔄 Interval: updating Feature Engine");
            this.updateFeatureEngineStats();
        }, DashboardConfig.intervals.features);

        debugLog("✅ Dashboard API started successfully!");
    }
}
