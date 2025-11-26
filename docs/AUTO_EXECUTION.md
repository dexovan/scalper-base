# 🚀 AUTO-EXECUTION SYSTEM

## 📖 Pregled

Fast-Track Entry Loop sa automatskim izvršavanjem trade-ova kada cena uđe u entry zonu.

---

## 🏗️ Arhitektura

```
Scanner Fast Track (2s loop)
         ↓
    IN_ZONE detected
         ↓
    attemptExecution()
         ↓
    POST /api/execute-trade
         ↓
    Bybit Order Executor
         ↓
    Market Order + OCO (TP/SL)
         ↓
    Position Tracking
```

---

## 🔧 Komponente

### 1. **Bybit Order Executor** (`src/execution/bybitOrderExecutor.js`)

Modul za izvršavanje trade-ova na Bybit burzi:

```javascript
import {
  executeTrade,
  getActivePositions,
} from "../execution/bybitOrderExecutor.js";

// Execute trade
const result = await executeTrade({
  symbol: "BTCUSDT",
  direction: "LONG",
  entry: 43500.5,
  tp: 43600.0,
  sl: 43400.0,
  confidence: 85,
  entryZone: { min: 43495, ideal: 43500.5, max: 43505 },
});
```

**Features:**

- ✅ Market orders (instant fill)
- ✅ OCO orders (TP/SL simultaneous)
- ✅ Position tracking
- ✅ Dry-run mode (testiranje bez realnih trade-ova)
- ✅ Risk management (max positions, min balance)
- ✅ Error handling + retry logic

**Configuration:**

```javascript
EXECUTION_CONFIG = {
  enabled: false, // 🔒 DRY-RUN by default
  apiKey: process.env.BYBIT_API_KEY,
  apiSecret: process.env.BYBIT_API_SECRET,
  maxPositions: 3, // Max 3 pozicije istovremeno
  minBalance: 100, // Min 100 USDT balance
  defaultLeverage: 5, // 5x leverage
  defaultMargin: 25, // $25 per trade
};
```

---

### 2. **Execution API Endpoint** (`src/http/monitorApi.js`)

REST API za izvršavanje trade-ova:

#### **POST /api/execute-trade**

Execute trade kada je cena u entry zoni.

**Request:**

```json
{
  "symbol": "GMTUSDT",
  "direction": "LONG",
  "entry": 0.01879,
  "tp": 0.01883,
  "sl": 0.01875,
  "confidence": 82,
  "entryZone": {
    "min": 0.01878,
    "ideal": 0.01879,
    "max": 0.018798
  }
}
```

**Response (Success):**

```json
{
  "ok": true,
  "success": true,
  "orderId": "1234567890",
  "symbol": "GMTUSDT",
  "side": "Buy",
  "qty": "665.338",
  "entry": 0.01879,
  "tp": 0.01883,
  "sl": 0.01875,
  "dryRun": false,
  "timestamp": "2025-11-26T10:30:00.000Z"
}
```

**Response (Dry-Run):**

```json
{
  "ok": true,
  "success": true,
  "dryRun": true,
  "message": "Dry-run mode - no real trade executed"
}
```

**Response (Error):**

```json
{
  "ok": false,
  "error": "Already in position",
  "existingPosition": {
    "symbol": "GMTUSDT",
    "side": "Buy",
    "qty": "665.338",
    "entry": 0.01879
  }
}
```

#### **GET /api/positions**

Vrati sve aktivne pozicije.

**Response:**

```json
{
  "ok": true,
  "positions": [
    {
      "symbol": "GMTUSDT",
      "orderId": "1234567890",
      "side": "Buy",
      "qty": "665.338",
      "entry": 0.01879,
      "tp": 0.01883,
      "sl": 0.01875,
      "timestamp": 1732618200000
    }
  ],
  "count": 1,
  "timestamp": "2025-11-26T10:30:00.000Z"
}
```

---

### 3. **Fast Track Execution Integration** (`scripts/scalp-signal-scanner.js`)

Scanner automatski izvršava trade-ove kada detektuje IN_ZONE.

**Configuration:**

```javascript
FAST_TRACK_CONFIG = {
  enabled: true,
  interval: 2000, // 2s monitoring loop
  autoExecute: false, // 🔒 AUTO-EXECUTE disabled
  executionApiUrl: "http://localhost:8090/api/execute-trade",
  duplicateWindow: 300000, // 5 min cooldown
  maxExecutionAttempts: 3, // Max 3 attempts per signal
};
```

**Execution Flow:**

```
Fast Track Loop (2s)
    ↓
isPriceInEntryZone() → TRUE
    ↓
attemptExecution()
    ↓
Check cooldown (5 min)
    ↓
Check max attempts (3)
    ↓
POST /api/execute-trade
    ↓
✅ Order placed
```

**Logs:**

```
🎯 [ENTRY READY] GMTUSDT LONG - Price 0.018790 IN ZONE [0.018780 — 0.018790 — 0.018798]
🚀 [EXECUTING] GMTUSDT LONG @ 0.01879
   TP: 0.01883 | SL: 0.01875
   Entry Zone: [0.018780 — 0.018790 — 0.018798]
✅ [EXECUTED] GMTUSDT - Order ID: DRY-RUN
   🔒 DRY-RUN MODE
```

---

## ⚙️ Setup

### 1. **Bybit API Credentials**

Dodaj u `.env` fajl:

```bash
BYBIT_API_KEY=your_api_key_here
BYBIT_API_SECRET=your_api_secret_here
```

**Kako dobiti API ključeve:**

1. Login na Bybit → Account & Security → API Management
2. Create New Key
3. Permissions: **Trade** (enable Order placement)
4. IP Whitelist: Dodaj VPS IP adresu
5. Copy API Key + Secret

---

### 2. **Enable Live Trading**

**DRY-RUN MODE (Default):**

```javascript
// src/execution/bybitOrderExecutor.js
EXECUTION_CONFIG.enabled = false; // 🔒 DRY-RUN (no real orders)
```

**LIVE MODE (Real Trading):**

```javascript
// src/execution/bybitOrderExecutor.js
EXECUTION_CONFIG.enabled = true; // 🔥 LIVE TRADING
```

**⚠️ WARNING:** Live mode izvršava REALNE trade-ove sa REALNIM novcem!

---

### 3. **Enable Auto-Execution**

**Manual Mode (Default):**

```javascript
// scripts/scalp-signal-scanner.js
FAST_TRACK_CONFIG.autoExecute = false; // 🔒 Manual (only logs)
```

**Auto-Execute Mode:**

```javascript
// scripts/scalp-signal-scanner.js
FAST_TRACK_CONFIG.autoExecute = true; // 🚀 Automatic execution
```

---

## 🧪 Testing

### **Faza 1: Dry-Run Mode (NO REAL ORDERS)**

Testiranje bez realnih trade-ova:

```bash
# 1. Start Engine
pm2 start ecosystem.config.cjs --only engine

# 2. Start Scanner
pm2 start ecosystem.config.cjs --only scanner

# 3. Monitor logs
pm2 logs scanner --lines 100
```

**Expected Output:**

```
🎯 [ENTRY READY] GMTUSDT LONG - Price 0.018790 IN ZONE
🚀 [EXECUTING] GMTUSDT LONG @ 0.01879
✅ [EXECUTED] GMTUSDT - Order ID: DRY-RUN
   🔒 DRY-RUN MODE
```

**Dry-run validacija:**

- ✅ Entry zone detection works
- ✅ Execution trigger fires correctly
- ✅ No duplicate executions
- ✅ Cooldown window enforced
- ✅ API endpoints responding

---

### **Faza 2: Live Mode (REAL ORDERS - TESTNET)**

Test sa Bybit testnetom:

```javascript
// src/execution/bybitOrderExecutor.js
EXECUTION_CONFIG.baseUrl = "https://api-testnet.bybit.com"; // Testnet
EXECUTION_CONFIG.enabled = true;
```

**Testnet API Keys:**

- URL: https://testnet.bybit.com
- Free test funds (fake USDT)
- Same API kao mainnet

---

### **Faza 3: Live Mode (REAL ORDERS - MAINNET)**

⚠️ **OPASNO - REALNI TRADE-OVI!**

```javascript
// src/execution/bybitOrderExecutor.js
EXECUTION_CONFIG.baseUrl = "https://api.bybit.com"; // Mainnet
EXECUTION_CONFIG.enabled = true;
```

**Safety Checks:**

- ✅ Min balance: 100 USDT
- ✅ Max positions: 3
- ✅ Max risk per trade: $25
- ✅ Duplicate prevention: 5 min cooldown
- ✅ Max execution attempts: 3

---

## 📊 Monitoring

### **Active Positions**

```bash
curl http://localhost:8090/api/positions
```

**Response:**

```json
{
  "ok": true,
  "positions": [
    {
      "symbol": "GMTUSDT",
      "orderId": "1234567890",
      "side": "Buy",
      "qty": "665.338",
      "entry": 0.01879,
      "tp": 0.01883,
      "sl": 0.01875
    }
  ],
  "count": 1
}
```

---

### **Scanner Logs**

```bash
pm2 logs scanner --lines 50
```

**Key Events:**

```
🎯 [ENTRY READY]    - Price entered entry zone
🚀 [EXECUTING]      - Execution request sent
✅ [EXECUTED]       - Order placed successfully
❌ [EXECUTE FAILED] - Order rejected
⏸️  [EXECUTE]       - Cooldown active
⚠️  [EXECUTE]       - Max attempts reached
```

---

### **Engine Logs**

```bash
pm2 logs engine --lines 50
```

**Key Events:**

```
🎯 [API/EXECUTE]    - Trade request received
📤 [BYBIT]          - Placing order on Bybit
✅ [BYBIT]          - Order placed successfully
⚠️  [BYBIT]         - TP/SL failed
❌ [EXECUTOR]       - Trade failed
```

---

## 🛡️ Safety Features

### **1. Duplicate Prevention**

- **Cooldown Window:** 5 minutes per symbol
- **Max Attempts:** 3 execution attempts per signal
- **Position Check:** No duplicate positions on same symbol

### **2. Risk Management**

- **Max Positions:** 3 concurrent positions
- **Min Balance:** 100 USDT required
- **Position Size:** $25 per trade (5x leverage = $125 notional)
- **Stop Loss:** Always set automatically

### **3. Execution Tracking**

```javascript
executionHistory.set(symbol, {
  lastExecution: Date.now(),
  attempts: 1,
  orderId: "1234567890",
  dryRun: false,
});
```

### **4. Signal Invalidation**

- **Timeout:** 45s after first detection
- **Distance:** >0.5% from entry zone
- **Max Adjustments:** 2 zone nudges

---

## 🔧 Configuration

### **Bybit Order Executor**

```javascript
// src/execution/bybitOrderExecutor.js

EXECUTION_CONFIG = {
  enabled: false, // 🔒 DRY-RUN by default
  apiKey: process.env.BYBIT_API_KEY,
  apiSecret: process.env.BYBIT_API_SECRET,
  baseUrl: "https://api.bybit.com",

  maxPositions: 3, // Max concurrent positions
  minBalance: 100, // Min USDT balance
  defaultLeverage: 5, // 5x leverage
  defaultMargin: 25, // $25 per trade

  orderType: "Market", // Market orders
  timeInForce: "GTC", // Good Till Cancel
};
```

---

### **Fast Track Auto-Execute**

```javascript
// scripts/scalp-signal-scanner.js

FAST_TRACK_CONFIG = {
  enabled: true,
  interval: 2000, // 2s monitoring
  autoExecute: false, // 🔒 Manual by default
  executionApiUrl: "http://localhost:8090/api/execute-trade",
  duplicateWindow: 300000, // 5 min cooldown
  maxExecutionAttempts: 3, // Max 3 attempts
};
```

---

## 📈 Performance

### **Expected Entry Hit Rate**

- **Without Entry Zone:** 10-20% (fixed point unreachable)
- **With Entry Zone (0.04%):** 60-80% (flexible zones)
- **With Auto-Execute (2s checks):** 80-95% (rapid monitoring)

### **Execution Speed**

- **Detection:** 2s (Fast Track monitoring interval)
- **API Call:** ~50-200ms (Engine → Bybit)
- **Order Fill:** ~100-500ms (Market order)
- **Total:** ~0.5-1s from IN_ZONE detection to filled order

---

## 🚨 Troubleshooting

### **Problem: "Bybit API credentials not configured"**

**Solution:**

```bash
# Add to .env file
BYBIT_API_KEY=your_key_here
BYBIT_API_SECRET=your_secret_here

# Restart Engine
pm2 restart engine
```

---

### **Problem: "Already in position"**

**Solution:**

- Duplicate prevention working correctly
- Wait 5 minutes cooldown OR close existing position

```bash
# Check active positions
curl http://localhost:8090/api/positions
```

---

### **Problem: "Max positions limit"**

**Solution:**

- Currently 3 positions open
- Wait for TP/SL to close OR increase limit:

```javascript
EXECUTION_CONFIG.maxPositions = 5; // Increase to 5
```

---

### **Problem: "Insufficient balance"**

**Solution:**

```bash
# Check balance via Bybit API or web
# Min 100 USDT required
```

---

### **Problem: "Max execution attempts reached"**

**Solution:**

- Signal tried 3 times, all failed
- Usually means price moved too fast
- Entry zone system will invalidate signal after 45s

---

## 📚 Dodatni Resursi

- **Entry Zone Optimizer:** `scripts/utils/entryZoneOptimizer.js`
- **Bybit API Docs:** https://bybit-exchange.github.io/docs/v5/intro
- **PM2 Monitoring:** `pm2 monit`
- **Dashboard:** http://localhost:3000/scalp-scanner

---

## ✅ Checklist Pre-Production

**Dry-Run Testing:**

- [ ] Engine started successfully
- [ ] Scanner generating signals
- [ ] Entry zones calculating correctly
- [ ] Fast Track monitoring active
- [ ] Execution logs show "DRY-RUN MODE"
- [ ] No duplicate executions
- [ ] Cooldown window working
- [ ] API endpoints responding

**Bybit Setup:**

- [ ] API keys created
- [ ] Trade permission enabled
- [ ] IP whitelist configured
- [ ] Testnet tested successfully
- [ ] Minimum balance available (100 USDT)

**Configuration:**

- [ ] `EXECUTION_CONFIG.enabled = true`
- [ ] `FAST_TRACK_CONFIG.autoExecute = true`
- [ ] `EXECUTION_CONFIG.baseUrl` set correctly (testnet/mainnet)
- [ ] Risk parameters configured (maxPositions, defaultMargin)

**Monitoring:**

- [ ] PM2 logs accessible
- [ ] Dashboard accessible
- [ ] Position tracking working
- [ ] Alerts configured (optional)

---

**🔥 READY FOR LIVE TRADING!**
