# Simple TP/SL Log Filter
# Usage: .\watch-tp.ps1
# Runs npm start and shows only TP/SL related logs with nice formatting

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "   TP/SL EXECUTION LOG MONITOR" -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan

$filterKeywords = @(
    "TpslEngine"
    "TP1"
    "TP2"
    "PARTIAL CLOSE"
    "positionState"
    "CALLING partialClosePosition"
    "Bybit response"
    "API Error"
    "SUCCESSFUL"
    "FAILED"
)

$excludeKeywords = @("RiskEngine", "EventHub", "Metric", "heartbeat", "Decision")

npm start 2>&1 | ForEach-Object {
    $line = $_
    $shouldShow = $false

    # Check if line contains any filter keyword
    foreach ($keyword in $filterKeywords) {
        if ($line -match [regex]::Escape($keyword)) {
            $shouldShow = $true
            break
        }
    }

    # Check if line should be excluded
    if ($shouldShow) {
        foreach ($exclude in $excludeKeywords) {
            if ($line -match [regex]::Escape($exclude)) {
                $shouldShow = $false
                break
            }
        }
    }

    # Display filtered line with color coding
    if ($shouldShow) {
        if ($line -match "TP1 HIT|TP2 HIT|SUCCESSFUL") {
            Write-Host $line -ForegroundColor Green
        }
        elseif ($line -match "FAILED|ERROR|Exception") {
            Write-Host $line -ForegroundColor Red
        }
        elseif ($line -match "CALLING|Submitting|Starting") {
            Write-Host $line -ForegroundColor Cyan
        }
        elseif ($line -match "onPriceUpdate") {
            Write-Host $line -ForegroundColor Gray
        }
        else {
            Write-Host $line -ForegroundColor White
        }
    }
}
