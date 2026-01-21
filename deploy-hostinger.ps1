#!/usr/bin/env pwsh

# Deployment script for Hostinger VPS
# Uses SSH to pull latest code and restart PM2

param(
    [string]$HostName = "72.62.192.228",
    [string]$Port = "22",
    [string]$UserName = "root",
    [string]$AppPath = "/var/www/salesmate-ai"
)

Write-Host "================================" -ForegroundColor Cyan
Write-Host "  Hostinger VPS Deployment" -ForegroundColor Cyan
Write-Host "================================" -ForegroundColor Cyan

# Check if plink (PuTTY SSH client) is available
$plinkPath = "C:\Program Files\PuTTY\plink.exe"
if (-not (Test-Path $plinkPath)) {
    Write-Host "ERROR: plink.exe not found. Install PuTTY or configure SSH differently." -ForegroundColor Red
    exit 1
}

# Use stored SSH key or prompt for password
Write-Host "`n[1/3] Connecting to $HostName..." -ForegroundColor Yellow

# Deploy commands to run on server
$deployCommands = @"
cd $AppPath
echo 'Pulling latest code...'
git pull origin main
echo 'Code pulled successfully'
echo 'Restarting PM2...'
pm2 restart salesmate-ai
echo 'PM2 restarted'
pm2 logs salesmate-ai --lines 5
"@

# Execute commands via SSH using plink
try {
    $tempFile = [System.IO.Path]::GetTempFileName()
    Set-Content -Path $tempFile -Value $deployCommands -Encoding UTF8

    & $plinkPath -l $UserName -P $Port $HostName -m $tempFile 2>&1
    Remove-Item -Path $tempFile -ErrorAction SilentlyContinue
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "`n✅ Deployment successful!" -ForegroundColor Green
    } else {
        Write-Host "`n❌ Deployment failed with exit code: $LASTEXITCODE" -ForegroundColor Red
        exit 1
    }
} catch {
    Write-Host "`n❌ SSH connection error: $_" -ForegroundColor Red
    exit 1
}
