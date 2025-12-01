# Save ALL logs to file, then filter and display only TP/SL logs
# Usage: .\watch-tp-logs-file.ps1

$logFile = "tp-sl-logs.txt"
$filterPattern = "TpslEngine|PARTIAL|positionState|onPriceUpdate|TP1|TP2|CALLING|FAILED|SUCCESSFUL|Bybit response|API Error|TP Close details|partialClosePosition"
$excludePattern = "RiskEngine|EventHub|Metric|heartbeat|Decision"

Write-Host "Starting engine - logs saved to $logFile" -ForegroundColor Cyan
Write-Host "Filtered logs displayed below:" -ForegroundColor Green
Write-Host ""

# Start process in background and capture output
$process = Start-Process -FilePath "npm" -ArgumentList "start" -NoNewWindow -PassThru -RedirectStandardOutput $logFile -RedirectStandardError $logFile

# Monitor log file in real-time
Get-Content $logFile -Wait -Tail 0 | Where-Object {
    ($_ -match $filterPattern) -and ($_ -notmatch $excludePattern)
} | ForEach-Object {
    # Color coding for different log types
    if ($_ -match "TP1 HIT|TP2 HIT") {
        Write-Host $_ -ForegroundColor Yellow
    }
    elseif ($_ -match "SUCCESSFUL|SUCCESS") {
        Write-Host $_ -ForegroundColor Green
    }
    elseif ($_ -match "FAILED|ERROR|Exception") {
        Write-Host $_ -ForegroundColor Red
    }
    elseif ($_ -match "CALLING|Submitting") {
        Write-Host $_ -ForegroundColor Cyan
    }
    else {
        Write-Host $_
    }
}
