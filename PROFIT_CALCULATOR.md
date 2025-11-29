# 🎯 SCALP TRADING PROFIT CALCULATOR

## 📋 CURRENT CONFIG

```
Leverage:        3x
Margin per trade: $18
TP distance:      +0.35% (LONG) / -0.35% (SHORT)
SL distance:      -0.30% (LONG) / +0.30% (SHORT)
Entry mode:       MAKER_FIRST (maker fee -0.02%, taker fee 0.06%)
Total fees:       0.04% (entry -0.02% + exit 0.06%)
```

---

## 📊 EXAMPLE 1: BTC TP HIT (LONG)

**SETUP:**

```
Symbol:    BTCUSDT
Price:     $100,000
Direction: LONG
Margin:    $18
Leverage:  3x
Position:  $54 notional
```

**ENTRY:**

```
Entry price:    $100,000
Maker fee:      -0.02% of notional
Fee cost:       -0.02% × $54 = -$0.0108
Position after fee: $54 - $0.0108 = $53.9892
```

**TARGET (TP HIT @ +0.35%):**

```
TP price:       $100,000 × 1.0035 = $100,350
Price movement: +$350 notional
Profit (raw):   +$350 / $100,000 × $54 = +$0.189

Taker fee:      -0.06% of notional
Fee cost:       -0.06% × $54 = -$0.0324

NET PROFIT:     $0.189 - $0.0108 - $0.0324 = $0.1458
ROI:            $0.1458 / $18 = 0.81% 🚀
```

---

## 📊 EXAMPLE 2: BTC SL HIT (LONG)

**SL @ -0.30%:**

```
SL price:       $100,000 × 0.9970 = $99,700
Price movement: -$300 notional
Loss (raw):     -$300 / $100,000 × $54 = -$0.162

Taker fee:      -0.06% × $54 = -$0.0324
Maker fee:      -0.02% × $54 = -$0.0108

NET LOSS:       -$0.162 - $0.0108 - $0.0324 = -$0.2052
ROI:            -$0.2052 / $18 = -1.14% 📉
```

---

## 🎲 RISK/REWARD RATIO

```
Win scenario:   +0.81% ROI → Gain $0.1458
Loss scenario:  -1.14% ROI → Lose $0.2052

Reward:Risk = 0.1458 : 0.2052 = 1 : 1.41 (BAD - risk is higher!)
```

**⚠️ PROBLEM:** TP is 0.35% but SL is 0.30% → Risk > Reward!

For 1:1 ratio needed: TP should be 0.3% to match SL risk.

---

## 📈 BREAK-EVEN ANALYSIS

To be profitable:

```
Win trades ÷ Total trades > (SL loss) ÷ (TP gain)
Win trades ÷ Total trades > 0.2052 ÷ 0.1458
Win trades ÷ Total trades > 58%

= Need 58% win rate minimum (too high for 0.35% TP!)
```

---

## 💡 IMPROVEMENTS NEEDED

### Option 1: INCREASE MARGIN

```
Current: $18 × 3 = $54 notional
If we use $30 × 3 = $90 notional:
  - TP profit: +0.35% × $90 = +$0.315 → +1.05% ROI ✅
  - SL loss:   -0.30% × $90 = -$0.27 → -0.90% ROI
  - Win rate needed: 46% ✅ (achievable!)
```

### Option 2: TIGHTER SL

```
Current TP/SL: 0.35% / 0.30%
Better: TP/SL: 0.35% / 0.25%
  - TP profit: $0.1458 (same)
  - SL loss:   -0.25% × $54 = -$0.162 (less)
  - New SL:    $100,000 × 0.9975 = $99,750
  - Win rate needed: ~52%
```

### Option 3: WIDER TP

```
Current: 0.35%
Better: 0.50%
  - New TP: $100,000 × 1.005 = $100,500
  - TP profit: +$0.27 → +1.5% ROI
  - Win rate needed: ~43%
```

---

## 🎯 RECOMMENDED CONFIG

For **BTCUSDT scalping** (0.35% TP, 0.30% SL):

```
Margin:         $30 (increase from $18)
Leverage:       3x
Position:       $90 notional
TP:             +0.35%
SL:             -0.30%
Win rate min:   ~46%
Win profit:     +1.05% per trade
Loss amount:    -0.90% per trade
```

**Expected daily (10 signals, 60% win rate):**

```
Wins:   6 trades × +$0.315 = +$1.89
Losses: 4 trades × -$0.27  = -$1.08
NET:    +$0.81 per day on $30 × 6 positions = +0.45% daily
```

---

## 📌 KEY METRICS

| Metric          | Current | Status                     |
| --------------- | ------- | -------------------------- |
| TP Distance     | 0.35%   | ✅ Tight (good for scalps) |
| SL Distance     | 0.30%   | ⚠️ Tighter than TP (risky) |
| Reward:Risk     | 1:1.41  | ❌ Risk > Reward           |
| Margin          | $18     | ⚠️ Too small               |
| Win rate needed | 58%     | ❌ Too high                |

---

## ✅ NEXT STEPS

1. **Increase margin to $30** (3x leverage = $90 notional)
2. **Adjust SL to -0.25%** (tighter risk management)
3. **Update bybitOrderExecutor.js** to use new margin
4. **Target win rate: 50%** (achievable with regime + spoofing filters)
5. **Daily P&L target: +0.5% to +1%**
