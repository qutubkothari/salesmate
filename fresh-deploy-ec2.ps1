# Fresh Deployment Script - Complete reinstall on EC2
param(
    [string]$Message = "Fresh deployment - Clean install"
)

Write-Host "================================" -ForegroundColor Cyan
Write-Host "  FRESH EC2 DEPLOYMENT" -ForegroundColor Cyan
Write-Host "================================" -ForegroundColor Cyan
Write-Host ""

# Configuration
$EC2_IP = "43.205.192.171"
$EC2_USER = "ubuntu"
$EC2_KEY = "$HOME\Downloads\whatsapp-ai-key.pem"
$EC2_APP_DIR = "/home/ubuntu/SAK-Whatsapp-AI-Hybrid"
$GITHUB_REPO = "https://github.com/qutubkothari/SAK-Whatsapp-AI-Hybrid.git"

# Step 1: Push latest code to GitHub
Write-Host "[1/6] Pushing latest code to GitHub..." -ForegroundColor Yellow
git add .
git commit -m "$Message" -a
git push origin main

if ($LASTEXITCODE -ne 0 -and $LASTEXITCODE -ne 1) {
    Write-Host "Warning: Git operations had issues, but continuing..." -ForegroundColor Yellow
}

Write-Host "Code pushed to GitHub!" -ForegroundColor Green

# Step 2: Connect to EC2 and perform fresh installation
Write-Host ""
Write-Host "[2/6] Connecting to EC2..." -ForegroundColor Yellow

$DEPLOY_SCRIPT = "cd /home/ubuntu && pm2 stop all; pm2 delete all; rm -rf SAK-Whatsapp-AI-Hybrid whatsapp-ai; git clone https://github.com/qutubkothari/SAK-Whatsapp-AI-Hybrid.git && cd SAK-Whatsapp-AI-Hybrid && npm install --production && pm2 start index.js --name whatsapp-ai && pm2 save && pm2 list"

ssh -i $EC2_KEY -o StrictHostKeyChecking=no $EC2_USER@$EC2_IP $DEPLOY_SCRIPT

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "================================" -ForegroundColor Green
    Write-Host "  FRESH DEPLOYMENT SUCCESSFUL!" -ForegroundColor Green
    Write-Host "================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "Application URL: http://$EC2_IP`:8080" -ForegroundColor Cyan
    Write-Host "Login URL: http://$EC2_IP`:8080/login.html" -ForegroundColor Cyan
    Write-Host "Dashboard URL: http://$EC2_IP`:8080/dashboard.html" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Status: Fresh installation complete!" -ForegroundColor Green
    Write-Host ""
}
else {
    Write-Host ""
    Write-Host "================================" -ForegroundColor Red
    Write-Host "  DEPLOYMENT FAILED!" -ForegroundColor Red
    Write-Host "================================" -ForegroundColor Red
    Write-Host ""
    Write-Host "Check SSH connection and EC2 service status" -ForegroundColor Yellow
}
