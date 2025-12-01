# Watch TP/SL execution logs only - Windows PowerShell
# Usage: .\watch-tp-logs.ps1

Write-Host "Starting engine with TP/SL focused logging..." -ForegroundColor Cyan

npm start 2>&1 | Select-String -Pattern "TpslEngine|PARTIAL|positionState|onPriceUpdate|TP1|TP2|CALLING|FAILED|SUCCESSFUL|Bybit response|API Error|TP Close details|partialClosePosition" | Where-Object { $_ -notmatch "RiskEngine|EventHub|Metric|heartbeat|Decision" }
