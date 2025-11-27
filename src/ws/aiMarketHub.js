// src/ws/aiMarketHub.js
// 🔥 FULL AI MARKET HUB (Bybit linear USDT perp)
// - Orderbook 50 (top 20 level analiza)
// - Trade feed → orderFlowNet60s (USD vrednost)
// - Imbalance, spreadPercent
// - pumpScore, wallScore, spoofScore (v1 simple heuristike)

import { WebsocketClient } from 'bybit-api';

// Koliko nivoa orderbooka gledamo za analizu
const MAX_LEVELS = 20;

// Koliko dugo pamtimo tradove (ms)
const TRADE_WINDOW_MS = 60_000;

// Koliko dugo simbol važi kao "aktivan" pre nego što ga čistimo
const SYMBOL_STALE_MS = 120_000;

// Cleanup interval
const CLEANUP_INTERVAL_MS = 60_000;

export class AiMarketHub {
  constructor() {
    this.ws = null;

    /** @type {Map<string, { bids: [number,number][], asks: [number,number][], lastUpdate: number }>} */
    this.orderbooks = new Map();

    /** @type {Map<string, { trades: {side:string,qty:number,price:number,ts:number}[], lastUpdate: number }>} */
    this.trades = new Map();

    /** @type {Set<string>} */
    this.subscribedOrderbook = new Set();
    /** @type {Set<string>} */
    this.subscribedTrades = new Set();

    this._started = false;

    this._cleanupTimer = setInterval(() => this.cleanup(), CLEANUP_INTERVAL_MS);
  }

  // -----------------------------------------
  // PUBLIC: start WS klienta
  // -----------------------------------------
  start() {
    if (this._started) return;
    this._started = true;

    this.ws = new WebsocketClient(
      {
        key: process.env.BYBIT_API_KEY || '',
        secret: process.env.BYBIT_API_SECRET || '',
        market: 'linear',      // linear perp
        testnet: false,
      },
      {
        // debug: true,
      }
    );

    this.ws.on('open', () => {
      console.log('✅ [AI-MARKET-HUB] WS connection opened');
    });

    this.ws.on('close', () => {
      console.log('⚠️ [AI-MARKET-HUB] WS connection closed');
    });

    this.ws.on('error', (err) => {
      console.error('❌ [AI-MARKET-HUB] WS error:', err?.message || err);
    });

    this.ws.on('update', (data) => {
      try {
        this.handleMessage(data);
      } catch (err) {
        console.error('❌ [AI-MARKET-HUB] handleMessage error:', err.message);
      }
    });

    console.log('🚀 [AI-MARKET-HUB] Initialized (no subs yet)');
  }

  // -----------------------------------------
  // SUBSCRIBE HELPERS
  // -----------------------------------------

  ensureSubscriptions(symbol) {
    // Simboli na Bybit linearu su npr "BTCUSDT", "PEPEUSDT" – isto kao kod tebe

    if (!this.subscribedOrderbook.has(symbol)) {
      this.subscribedOrderbook.add(symbol);
      this.ws.subscribe(`orderbook.50.${symbol}`);
      console.log(`📡 [AI-MARKET-HUB] Subscribed orderbook.50 for ${symbol}`);
    }

    if (!this.subscribedTrades.has(symbol)) {
      this.subscribedTrades.add(symbol);
      this.ws.subscribe(`publicTrade.${symbol}`);
      console.log(`📡 [AI-MARKET-HUB] Subscribed publicTrade for ${symbol}`);
    }
  }

  // -----------------------------------------
  // WS MESSAGE HANDLER
  // -----------------------------------------
  handleMessage(message) {
    const topic = message.topic || message.arg?.topic;
    if (!topic) return;

    if (topic.startsWith('orderbook.50.')) {
      const parts = topic.split('.');
      const symbol = parts[2];
      if (!symbol) return; // ✅ Safety check
      this.handleOrderbook(symbol, message);
      return;
    }

    if (topic.startsWith('publicTrade.')) {
      const parts = topic.split('.');
      const symbol = parts[1];
      if (!symbol) return; // ✅ Safety check
      this.handleTrades(symbol, message);
      return;
    }
  }

  // -----------------------------------------
  // ORDERBOOK HANDLING
  // -----------------------------------------
  handleOrderbook(symbol, msg) {
    let data = msg.data || msg;
    // Bybit WS može vratiti {type:'snapshot', ...} ili {type:'delta', ...}
    if (!data) return;

    const type = data.type || msg.type;

    if (type === 'snapshot') {
      const bids = (data.b ?? data.bids ?? []).map(([price, size]) => [
        Number(price),
        Number(size),
      ]);
      const asks = (data.a ?? data.asks ?? []).map(([price, size]) => [
        Number(price),
        Number(size),
      ]);

      this.orderbooks.set(symbol, {
        bids: bids.slice(0, MAX_LEVELS),
        asks: asks.slice(0, MAX_LEVELS),
        lastUpdate: Date.now(),
      });
      return;
    }

    if (type === 'delta') {
      const cur = this.orderbooks.get(symbol) || {
        bids: [],
        asks: [],
        lastUpdate: Date.now(),
      };

      // delta: u (update), d (delete)
      if (data.b) {
        for (const [priceStr, sizeStr] of data.b) {
          const price = Number(priceStr);
          const size = Number(sizeStr);

          const idx = cur.bids.findIndex((lvl) => lvl[0] === price);
          if (size === 0) {
            if (idx >= 0) cur.bids.splice(idx, 1);
          } else {
            if (idx >= 0) cur.bids[idx][1] = size;
            else cur.bids.push([price, size]);
          }
        }
      }

      if (data.a) {
        for (const [priceStr, sizeStr] of data.a) {
          const price = Number(priceStr);
          const size = Number(sizeStr);

          const idx = cur.asks.findIndex((lvl) => lvl[0] === price);
          if (size === 0) {
            if (idx >= 0) cur.asks.splice(idx, 1);
          } else {
            if (idx >= 0) cur.asks[idx][1] = size;
            else cur.asks.push([price, size]);
          }
        }
      }

      // Sortiranje po ceni
      cur.bids.sort((a, b) => b[0] - a[0]); // bid: veća cena gore
      cur.asks.sort((a, b) => a[0] - b[0]); // ask: manja cena gore

      // ✅ FIX: Limit arrayeve POSLE sortiranja (memory optimization)
      cur.bids = cur.bids.slice(0, MAX_LEVELS);
      cur.asks = cur.asks.slice(0, MAX_LEVELS);
      cur.lastUpdate = Date.now();

      this.orderbooks.set(symbol, cur);
      return;
    }
  }

  // -----------------------------------------
  // TRADES HANDLING
  // -----------------------------------------
  handleTrades(symbol, msg) {
    const tradesArr = msg.data || msg;

    if (!tradesArr || !Array.isArray(tradesArr)) return;

    let state = this.trades.get(symbol);
    if (!state) {
      state = { trades: [], lastUpdate: Date.now() };
    }

    const now = Date.now();
    for (const t of tradesArr) {
      const side = t.S || t.side; // 'Buy' / 'Sell'
      const qty = Number(t.v ?? t.qty ?? t.q ?? 0);
      const price = Number(t.p ?? t.price ?? 0);
      const ts = Number(t.T ?? t.ts ?? now);

      if (!side || !qty || !price) continue;

      state.trades.push({ side, qty, price, ts });
    }

    // prozor 60s
    const cutoff = now - TRADE_WINDOW_MS;
    state.trades = state.trades.filter((t) => t.ts >= cutoff);
    state.lastUpdate = now;

    this.trades.set(symbol, state);
  }

  // -----------------------------------------
  // METRIKE
  // -----------------------------------------
  computeOrderbookMetrics(symbol) {
    const ob = this.orderbooks.get(symbol);
    if (!ob || !ob.bids.length || !ob.asks.length) {
      return null;
    }

    const bestBid = ob.bids[0][0];
    const bestAsk = ob.asks[0][0];
    const mid = (bestBid + bestAsk) / 2;
    const spreadAbs = bestAsk - bestBid;
    const spreadPercent = mid > 0 ? spreadAbs / mid : 0;

    const sumBids = ob.bids.reduce((acc, [_, size]) => acc + size, 0);
    const sumAsks = ob.asks.reduce((acc, [_, size]) => acc + size, 0);
    const total = sumBids + sumAsks || 1;

    // ✅ FIX: Ukloni klampovanje, pusti prirodan opseg (0.5–3.0)
    // imbalanceRatio > 1.0 = više bidova (bullish), < 1.0 = više askova (bearish)
    const bidShare = sumBids / total;
    const askShare = sumAsks / total;
    const imbalanceRatio = askShare === 0 ? 3.0 : bidShare / askShare;

    // WALL detekcija – najveći level vs prosek ostalih
    const wallInfo = this.computeWallScore(ob.bids, ob.asks, bestBid, bestAsk);

    return {
      bestBid,
      bestAsk,
      mid,
      spreadPercent,
      imbalance: imbalanceRatio,
      sumBids,
      sumAsks,
      wallScore: wallInfo.wallScore,
      wallDirection: wallInfo.wallDirection,
    };
  }

  computeWallScore(bids, asks, bestBid, bestAsk) {
    const analyzeSide = (levels, isBid) => {
      if (!levels.length) return { score: 0 };

      const sizes = levels.map((l) => l[1]);
      const maxSize = Math.max(...sizes);
      const avgSize =
        sizes.reduce((a, b) => a + b, 0) / (sizes.length || 1);

      if (avgSize === 0) return { score: 0 };

      const ratio = maxSize / avgSize; // koliko puta veći najveći zid

      // score mapujemo u 0–1: npr ratio 1–4
      const norm = Math.max(0, Math.min(1, (ratio - 1) / 3));

      return { score: norm };
    };

    const bidWall = analyzeSide(bids, true);
    const askWall = analyzeSide(asks, false);

    // ako je jači zid na ask strani → otpor za LONG (wallDirection = 'UP')
    if (askWall.score > bidWall.score && askWall.score > 0.2) {
      return { wallScore: askWall.score, wallDirection: 'UP' };
    }

    // zid na bid strani → support za LONG, otpor za SHORT (wallDirection = 'DOWN')
    if (bidWall.score > askWall.score && bidWall.score > 0.2) {
      return { wallScore: bidWall.score, wallDirection: 'DOWN' };
    }

    return { wallScore: 0, wallDirection: null };
  }

  computeTradeMetrics(symbol) {
    const state = this.trades.get(symbol);
    if (!state || !state.trades.length) {
      return {
        orderFlowNet60s: 0,
        orderFlowBuyVol60s: 0,
        orderFlowSellVol60s: 0,
        lastTradePrice: null,
        lastTradeTs: null,
        volumeAbs60s: 0,
      };
    }

    const trades = state.trades;

    // ✅ FIX: Konvertuj u USD vrednost (qty * price)
    let netUSD = 0;
    let buyVolUSD = 0;
    let sellVolUSD = 0;
    let volAbsUSD = 0;

    for (const t of trades) {
      const usdValue = t.qty * t.price; // ✅ USD vrednost trade-a

      if (t.side === 'Buy') {
        buyVolUSD += usdValue;
        netUSD += usdValue; // Pozitivno za kupovinu
      } else {
        sellVolUSD += usdValue;
        netUSD -= usdValue; // Negativno za prodaju
      }

      volAbsUSD += usdValue;
    }

    const last = trades[trades.length - 1];

    return {
      orderFlowNet60s: netUSD,            // ✅ Net flow u USD ($5000 = buy pressure)
      orderFlowBuyVol60s: buyVolUSD,      // ✅ Total buy volume u USD
      orderFlowSellVol60s: sellVolUSD,    // ✅ Total sell volume u USD
      lastTradePrice: last.price,
      lastTradeTs: last.ts,
      volumeAbs60s: volAbsUSD,            // ✅ Total volume u USD
    };
  }

  computePumpScore(symbol, obMetrics, tradeMetrics) {
    // pumpScore zasnovan na:
    // - spreadPercent (veći spread → veća šansa wick/pump)
    // - wallScore (zidovi mogu držati wick)
    // - recent micro-range price movement (koristimo bestBid/bestAsk + lastTradePrice)

    if (!obMetrics) return 0;

    const { bestBid, bestAsk, spreadPercent } = obMetrics;
    const { lastTradePrice, volumeAbs60s } = tradeMetrics;

    const mid = (bestBid + bestAsk) / 2 || lastTradePrice || 0;
    if (!mid) return 0;

    // price deviation vs mid (ako zadnja cena jako izmakla)
    let deviation = 0;
    if (lastTradePrice) {
      deviation = Math.abs(lastTradePrice - mid) / mid;
    }

    // Normalizacija:
    // - 0–1 po deviation (0–1%)
    const devScore = Math.max(0, Math.min(1, deviation / 0.01));
    // - 0–1 po spread (0–0.6%)
    const spreadScore = Math.max(0, Math.min(1, spreadPercent / 0.006));

    // ✅ FIX: Linearna normalizacija volumena ($0–$50k → 0–1)
    const volScore = Math.max(0, Math.min(1, volumeAbs60s / 50000));

    // pumpScore = kombinacija (težine možemo menjati kasnije)
    const pumpScore = 0.5 * devScore + 0.3 * spreadScore + 0.2 * volScore;

    return pumpScore;
  }

  computeSpoofScore(symbol, obMetrics) {
    // Za sada nema full spoof detekcije (cancel rate itd),
    // koristimo grubu heuristiku: ekstreman wallScore + uzak spread
    if (!obMetrics) return 0;

    const { wallScore, spreadPercent } = obMetrics;

    if (wallScore === 0) return 0;

    // Ako postoji jak zid i spread je relativno mali → spoofScore raste
    const spreadFactor = spreadPercent < 0.002 ? 1 : 0.5; // <0.2% je "čvršće"
    const spoofScore = Math.max(0, Math.min(1, wallScore * spreadFactor));

    return spoofScore;
  }

  // -----------------------------------------
  // PUBLIC: getSymbolState – za /api/live-market i executor
  // -----------------------------------------
  getSymbolState(symbol) {
    // osiguraj da je subscribe uradjen
    if (this.ws) {
      this.ensureSubscriptions(symbol);
    }

    const obMetrics = this.computeOrderbookMetrics(symbol);
    const tradeMetrics = this.computeTradeMetrics(symbol);

    if (!obMetrics) {
      return null;
    }

    const { bestBid, bestAsk, mid, spreadPercent, imbalance, wallScore, wallDirection } =
      obMetrics;
    const { orderFlowNet60s, orderFlowBuyVol60s, orderFlowSellVol60s, lastTradePrice, lastTradeTs, volumeAbs60s } =
      tradeMetrics;

    const pumpScore = this.computePumpScore(symbol, obMetrics, tradeMetrics);
    const spoofScore = this.computeSpoofScore(symbol, obMetrics);

    const now = Date.now();

    return {
      symbol,
      price: mid,
      bid: bestBid,
      ask: bestAsk,
      spread: bestAsk - bestBid,           // ✅ Dodaj absolutni spread (executor očekuje)
      spreadPercent,
      imbalance,
      orderFlowNet60s,                     // ✅ USD vrednost
      orderFlowBuyVol60s,                  // ✅ USD vrednost (za scanner check)
      orderFlowSellVol60s,                 // ✅ USD vrednost (za scanner check)
      pumpScore,
      spoofScore,
      wallScore,
      wallDirection,
      volumeAbs60s,
      lastTradePrice,
      lastTradeTs,
      lastUpdate: now,
    };
  }

  // -----------------------------------------
  // CLEANUP
  // -----------------------------------------
  cleanup() {
    const now = Date.now();
    let removed = 0;

    for (const [symbol, ob] of this.orderbooks.entries()) {
      if (now - ob.lastUpdate > SYMBOL_STALE_MS) {
        this.orderbooks.delete(symbol);
        removed++;
      }
    }

    for (const [symbol, t] of this.trades.entries()) {
      if (now - t.lastUpdate > SYMBOL_STALE_MS) {
        this.trades.delete(symbol);
        removed++;
      }
    }

    if (removed > 0) {
      console.log(
        `🧹 [AI-MARKET-HUB] Cleanup: removed ${removed} stale symbol states`
      );
    }
  }

  // -----------------------------------------
  // STOP (ako ikad bude potrebno)
  // -----------------------------------------
  stop() {
    if (this._cleanupTimer) clearInterval(this._cleanupTimer);
    if (this.ws) {
      try {
        this.ws.closeAll();
      } catch (e) {}
    }
    this._started = false;
  }
}

export default AiMarketHub;
