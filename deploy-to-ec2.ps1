# Automated Deployment Script - Windows to EC2
param(
    [string]$Message = "Auto deploy from Windows"
)

Write-Host "================================" -ForegroundColor Cyan
Write-Host "  EC2 Deployment Script" -ForegroundColor Cyan
Write-Host "================================" -ForegroundColor Cyan
Write-Host ""

# Configuration
$EC2_IP = "13.235.18.119"
$EC2_USER = "ubuntu"
$EC2_KEY = "$HOME\Downloads\whatsapp-ai-key.pem"
$EC2_APP_DIR = "/home/ubuntu/whatsapp-ai"

# Step 1: Git Status
Write-Host "[1/5] Checking Git status..." -ForegroundColor Yellow
git status --short

# Step 2: Add all changes
Write-Host ""
Write-Host "[2/5] Adding changes to Git..." -ForegroundColor Yellow
git add .

# Step 3: Commit changes
Write-Host ""
Write-Host "[3/5] Committing changes..." -ForegroundColor Yellow
git commit -m "$Message"

if ($LASTEXITCODE -ne 0) {
    Write-Host "No changes to commit or commit failed" -ForegroundColor Yellow
}

# Step 4: Push to GitHub
Write-Host ""
Write-Host "[4/5] Pushing to GitHub..." -ForegroundColor Yellow
git push

if ($LASTEXITCODE -ne 0) {
    Write-Host "Git push failed!" -ForegroundColor Red
    exit 1
}

Write-Host "Code pushed to GitHub successfully!" -ForegroundColor Green

# Step 5: Deploy to EC2
Write-Host ""
Write-Host "[5/5] Deploying to EC2..." -ForegroundColor Yellow

$SSH_COMMAND = "cd $EC2_APP_DIR && echo 'Pulling latest code...' && git pull && echo 'Restarting service...' && sudo systemctl restart whatsapp-ai && echo 'Service restarted!' && sudo systemctl status whatsapp-ai --no-pager -l"

ssh -i $EC2_KEY -o StrictHostKeyChecking=no $EC2_USER@$EC2_IP $SSH_COMMAND

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "================================" -ForegroundColor Green
    Write-Host "  DEPLOYMENT SUCCESSFUL!" -ForegroundColor Green
    Write-Host "================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "Dashboard: http://$EC2_IP`:8080/dashboard" -ForegroundColor Cyan
    Write-Host "Status: Service running on EC2" -ForegroundColor Cyan
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
