# Automated Deploy to GitHub and Hostinger
# This script:
# 1. Commits and pushes code to GitHub
# 2. Builds the app locally
# 3. Deploys to Hostinger VPS

$ErrorActionPreference = "Stop"

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "GitHub + Hostinger Deployment" -ForegroundColor Green
Write-Host "========================================`n" -ForegroundColor Cyan

# ====== STEP 1: GitHub Push ======
Write-Host "=== Step 1: Pushing to GitHub ===" -ForegroundColor Yellow

$commitMessage = Read-Host "Enter commit message (or press Enter for auto)"
if ([string]::IsNullOrWhiteSpace($commitMessage)) {
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm"
    $commitMessage = "Auto deploy - $timestamp"
}

try {
    git add -A
    git commit -m $commitMessage
    git push origin main
    Write-Host "✅ Pushed to GitHub successfully`n" -ForegroundColor Green
} catch {
    if ($_ -like "*nothing to commit*") {
        Write-Host "✅ No changes to commit`n" -ForegroundColor Green
    } else {
        Write-Host "⚠️  GitHub push failed: $_" -ForegroundColor Yellow
        $continue = Read-Host "Continue with Hostinger deployment? (y/n)"
        if ($continue -ne "y") { exit 1 }
    }
}

# ====== STEP 2: Deploy to Hostinger ======
Write-Host "=== Step 2: Deploying to Hostinger ===" -ForegroundColor Yellow

# Run the Hostinger deployment script
.\deploy-hostinger.ps1

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "✅ Deployment Complete!" -ForegroundColor Green
Write-Host "========================================`n" -ForegroundColor Cyan
Write-Host "GitHub: https://github.com/qutubkothari/sak-erp" -ForegroundColor White
Write-Host "Hostinger: http://72.62.192.228`n" -ForegroundColor White
