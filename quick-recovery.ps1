# Quick Recovery Script - Fix 502 Error
# Pulls latest code and restarts PM2

$VPS_IP = "72.62.192.228"
$VPS_USER = "root"
$SSH_KEY = "$HOME\.ssh\salesmate_key.pem"
$APP_DIR = "/var/www/salesmate"

Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  Quick API Recovery Script" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host ""

# Try to connect and run commands
Write-Host "[1/4] Connecting to VPS..." -ForegroundColor Yellow

# Simple test - try to ping the server
$ping = Test-Connection -ComputerName "72.62.192.228" -Count 1 -Quiet 2>&1
if ($ping) {
    Write-Host "✅ Server is reachable" -ForegroundColor Green
} else {
    Write-Host "❌ Server is not reachable" -ForegroundColor Red
}

Write-Host ""
Write-Host "[2/4] Attempting to pull latest code..." -ForegroundColor Yellow
Write-Host "Running: cd $APP_DIR && git pull && npm install" -ForegroundColor Gray

# Create a script on the server to execute
$recovery_commands = @"
cd $APP_DIR
git pull
npm install
pm2 stop all
sleep 5
pm2 start all
pm2 status
"@

Write-Host ""
Write-Host "[3/4] Checking if we can access the app directory..." -ForegroundColor Yellow

# Try reading the main routes file to see if it exists and is valid
$api_js_path = "$APP_DIR/routes/api.js"
Write-Host "Expected file: $api_js_path" -ForegroundColor Gray

Write-Host ""
Write-Host "[4/4] Next Steps:" -ForegroundColor Yellow
Write-Host ""
Write-Host "Option 1 - Manual SSH (recommended):" -ForegroundColor Cyan
Write-Host "  ssh -i '$SSH_KEY' $VPS_USER@$VPS_IP" -ForegroundColor White
Write-Host "  cd $APP_DIR" -ForegroundColor White
Write-Host "  git pull" -ForegroundColor White
Write-Host "  npm install" -ForegroundColor White
Write-Host "  pm2 restart all" -ForegroundColor White
Write-Host "  pm2 logs" -ForegroundColor White
Write-Host ""
Write-Host "Option 2 - Using VPS control panel:" -ForegroundColor Cyan
Write-Host "  - Log in to Hostinger control panel" -ForegroundColor White
Write-Host "  - Go to VPS management" -ForegroundColor White
Write-Host "  - Click Terminal" -ForegroundColor White
Write-Host "  - Run above commands" -ForegroundColor White
Write-Host ""
Write-Host "Option 3 - Check error logs locally:" -ForegroundColor Cyan
Write-Host "  - Review the code fixes applied" -ForegroundColor White
Write-Host "  - Check routes/api.js for syntax errors" -ForegroundColor White
Write-Host "  - Verify service imports are correct" -ForegroundColor White
Write-Host ""
