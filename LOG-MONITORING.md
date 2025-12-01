# TP/SL Execution Log Monitoring

## Quick Start

### Windows PowerShell

**Option 1: Simple filtering (recommended)**

```powershell
.\watch-tp.ps1
```

**Option 2: Save logs to file + display**

```powershell
npm start 2>&1 | Tee-Object -FilePath "tp-logs.txt" | Select-String -Pattern "TpslEngine|TP1|TP2|PARTIAL|SUCCESSFUL|FAILED" | grep -v "RiskEngine|EventHub|Metric"
```

**Option 3: Direct grep-like filtering**

```powershell
npm start 2>&1 | Select-String "TpslEngine|TP1 HIT|PARTIAL CLOSE|SUCCESSFUL|FAILED|API Error" | Where-Object { $_ -notmatch "RiskEngine|EventHub" }
```

### Linux/Mac

```bash
./watch-tp-logs.sh
```

---

## What You'll See

### ✅ Successful TP Execution Flow

```
[TpslEngine] 📍 onPriceUpdate() called for ENS @ 10.681
[TpslEngine]   positionState: ACTIVE (LONG, qty=5)
[TpslEngine] ✅ Found tpslState
[TpslEngine] 🔍 TP1 Check for ENS: side=LONG, price=10.681, tp1Target=10.681, isTp1Hit=true
[TpslEngine] ✅ TP1 HIT (direct) at 10.681
[TpslEngine] 💰 TP1 HIT for ENS LONG @ 10.681
[TpslEngine] 📊 TP1 Close details:
   Symbol: ENS
   Position side: LONG
   Opening side to send: Buy
   Quantity to close: 2.5
   bybitOrderExecutor available: true
[TpslEngine] 🚀 CALLING partialClosePosition now...

💰 [PARTIAL CLOSE] Starting close for ENS
   Opening side: Buy, Close side: Sell, Qty: 2.5
💰 [PARTIAL CLOSE] Sending order to Bybit: {...}
💰 [PARTIAL CLOSE] Bybit response received: {...}
✅ [PARTIAL CLOSE] SUCCESS! Closed 2.5 ENS with Sell
[TpslEngine] ✅ partialClosePosition returned: true
✅ [TpslEngine] TP1 partial close SUCCESSFUL for ENS
```

### ❌ Failure Cases to Watch For

**Case 1: Position not found in TP/SL engine**

```
[TpslEngine] ❌ No TP/SL state for ENS_LONG - position not in TP/SL engine!
```

→ This means position was opened but TP/SL engine wasn't notified

**Case 2: Bybit API rejection**

```
💰 [PARTIAL CLOSE] Bybit response received: {retCode: 110001, retMsg: "Invalid order"}
❌ [PARTIAL CLOSE] API Error: Invalid order (retCode: 110001)
❌ [TpslEngine] TP1 partial close FAILED for ENS
```

→ Check Bybit error code

**Case 3: Close order not sent**

```
[TpslEngine] ❌ partialClosePosition function NOT AVAILABLE
```

→ bybitOrderExecutor not loaded

---

## Log Color Meanings

- 🟢 **GREEN**: TP HIT, SUCCESSFUL close
- 🔴 **RED**: FAILED, ERROR, Exception
- 🔵 **CYAN**: CALLING functions, Submitting orders
- ⚪ **WHITE/GRAY**: Regular updates, price checks

---

## Troubleshooting

### No logs appearing?

- Check if `npm start` is running
- Make sure you're in correct directory: `c:\...\scalper-base\`
- Check if position is actually open on Bybit

### Logs showing but no TP execution?

- Watch for: "No TP/SL state" message
- This means position wasn't registered in TP/SL engine
- Check position tracker initialization

### TP HIT shows but close fails?

- Look for "API Error" in red
- Check Bybit API response for error code
- Verify order qty is valid for symbol
