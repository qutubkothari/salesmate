# Emergency Recovery Script - Windows to VPS
# This script diagnoses and fixes 502 Bad Gateway errors

Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  Salesmate - Emergency Recovery" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host ""

# Configuration
$VPS_IP = "72.62.192.228"
$VPS_USER = "root"
$SSH_KEY = "$HOME\.ssh\salesmate_key.pem"
$APP_DIR = "/var/www/salesmate"

Write-Host "[1/6] Testing VPS Connection..." -ForegroundColor Yellow
$testResult = ssh -o StrictHostKeyChecking=no -i $SSH_KEY "$VPS_USER@$VPS_IP" "echo 'Connected'" 2>&1
if ($testResult -eq "Connected") {
    Write-Host "✅ Connected to VPS" -ForegroundColor Green
} else {
    Write-Host "❌ Cannot connect to VPS: $testResult" -ForegroundColor Red
    Write-Host ""
    Write-Host "Try manually:"
    Write-Host "ssh -i $SSH_KEY $VPS_USER@$VPS_IP"
    exit 1
}

Write-Host ""
Write-Host "[2/6] Checking PM2 Status..." -ForegroundColor Yellow
ssh -o StrictHostKeyChecking=no -i $SSH_KEY "$VPS_USER@$VPS_IP" "cd $APP_DIR && pm2 status"

Write-Host ""
Write-Host "[3/6] Checking Recent Logs (last 30 lines)..." -ForegroundColor Yellow
ssh -o StrictHostKeyChecking=no -i $SSH_KEY "$VPS_USER@$VPS_IP" "cd $APP_DIR && pm2 logs --lines 30 --nostream 2>/dev/null | tail -30"

Write-Host ""
Write-Host "[4/6] Checking Port 8055..." -ForegroundColor Yellow
ssh -o StrictHostKeyChecking=no -i $SSH_KEY "$VPS_USER@$VPS_IP" "netstat -tlnp 2>/dev/null | grep 8055 || ss -tlnp 2>/dev/null | grep 8055 || echo 'Port 8055 NOT LISTENING - This is the problem!'"

Write-Host ""
Write-Host "[5/6] Checking Process Status..." -ForegroundColor Yellow
ssh -o StrictHostKeyChecking=no -i $SSH_KEY "$VPS_USER@$VPS_IP" "ps aux | grep -E 'node|sak-api' | grep -v grep | head -5"

Write-Host ""
Write-Host "[6/6] Attempting Recovery..." -ForegroundColor Yellow
Write-Host ""

Write-Host "Step 1: Stopping all services..."
ssh -o StrictHostKeyChecking=no -i $SSH_KEY "$VPS_USER@$VPS_IP" "cd $APP_DIR && pm2 stop all"

Write-Host "Step 2: Waiting 5 seconds..."
Start-Sleep -Seconds 5

Write-Host "Step 3: Starting all services..."
ssh -o StrictHostKeyChecking=no -i $SSH_KEY "$VPS_USER@$VPS_IP" "cd $APP_DIR && pm2 start all"

Write-Host "Step 4: Waiting 10 seconds for startup..."
Start-Sleep -Seconds 10

Write-Host "Step 5: Checking new status..."
ssh -o StrictHostKeyChecking=no -i $SSH_KEY "$VPS_USER@$VPS_IP" "cd $APP_DIR && pm2 status"

Write-Host ""
Write-Host "Step 6: Testing API..."
$apiTest = ssh -o StrictHostKeyChecking=no -i $SSH_KEY "$VPS_USER@$VPS_IP" "curl -s -o /dev/null -w '%{http_code}' http://localhost:8055/api/health"
if ($apiTest -eq "200") {
    Write-Host "✅ API is responding (HTTP $apiTest)" -ForegroundColor Green
} else {
    Write-Host "⚠️  API returned HTTP $apiTest" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "Recovery complete!" -ForegroundColor Green
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "If still seeing 502 errors:" -ForegroundColor Yellow
Write-Host "1. Check nginx configuration: sudo systemctl status nginx"
Write-Host "2. Restart nginx: sudo systemctl restart nginx"
Write-Host "3. Check application logs: pm2 logs sak-api"
Write-Host "4. Rebuild database: npm run migrate"
Write-Host ""
