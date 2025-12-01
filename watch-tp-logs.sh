#!/bin/bash
# Watch TP/SL execution logs only
npm start 2>&1 | grep -E "TpslEngine|PARTIAL|positionState|onPriceUpdate|TP1|TP2|CALLING|FAILED|SUCCESSFUL|Bybit response|API Error" | grep -v "RiskEngine\|EventHub\|Metric\|heartbeat\|Decision"
