## Deploy using the currently open file
# Automated Salesmate Deployment to Hostinger VPS
param(
    [string]$Message = "Deploy Salesmate"
)

$ErrorActionPreference = "Stop"

Write-Host "`n===================================================" -ForegroundColor Cyan
Write-Host "   SALESMATE TO HOSTINGER DEPLOYMENT" -ForegroundColor Green
Write-Host "===================================================`n" -ForegroundColor Cyan

# ====== CONFIG ======
$HOSTINGER_IP = "72.62.192.228"
$HOSTINGER_USER = "qutubk"
$KEY_PATH = "$env:USERPROFILE\.ssh\hostinger_ed25519"
$REMOTE_PATH = "/var/www/salesmate-ai"
$PM2_PROCESS = "salesmate-ai"
$USE_SQLITE_MIGRATIONS = $false

# ====== Helper Functions ======
function Test-SshKey {
    if (-not (Test-Path $KEY_PATH)) {
        Write-Host "ERROR: SSH key not found at: $KEY_PATH" -ForegroundColor Red
        throw "SSH key missing"
    }
    Write-Host "SSH key found" -ForegroundColor Green
}

function Invoke-RemoteCommand {
    param([string]$Command)
    ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -i $KEY_PATH "$HOSTINGER_USER@$HOSTINGER_IP" $Command
    if ($LASTEXITCODE -ne 0) {
        throw "Remote command failed"
    }
}

# ====== STEP 1: Pre-deployment Checks ======
Write-Host "[1/6] Pre-deployment Checks" -ForegroundColor Yellow
Test-SshKey
git status --short

# ====== STEP 2: Commit and Push ======
Write-Host "`n[2/6] Git Commit and Push" -ForegroundColor Yellow
git add .
git commit -m "$Message"
if ($LASTEXITCODE -ne 0) {
    Write-Host "No changes to commit" -ForegroundColor Yellow
}

git push
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Git push failed!" -ForegroundColor Red
    exit 1
}
Write-Host "Code pushed to GitHub" -ForegroundColor Green

# ====== STEP 3: Test Connection ======
Write-Host "`n[3/6] Testing Connection" -ForegroundColor Yellow
ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=10 -i $KEY_PATH "$HOSTINGER_USER@$HOSTINGER_IP" "echo 'Connected'; node -v; pm2 -v"
Write-Host "Connection OK" -ForegroundColor Green

# ====== STEP 4: Pull Latest Code ======
Write-Host "`n[4/6] Pulling Latest Code" -ForegroundColor Yellow
Invoke-RemoteCommand "cd $REMOTE_PATH; git pull origin main"
Write-Host "Code updated on server" -ForegroundColor Green

# ====== STEP 5: Install Dependencies ======
Write-Host "`n[5/7] Installing Dependencies" -ForegroundColor Yellow
Invoke-RemoteCommand "cd $REMOTE_PATH; CXXFLAGS='-include cstdint' npm install --production --omit=optional"
Write-Host "Dependencies updated" -ForegroundColor Green

# ====== STEP 6: Run Migrations (if any) ======
Write-Host "`n[6/7] Running Database Migrations" -ForegroundColor Yellow
if ($USE_SQLITE_MIGRATIONS) {
    # Check if sqlite3 is installed, install if missing
    Write-Host "  Checking SQLite installation..." -ForegroundColor Gray
    $sqliteCheck = ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -i $KEY_PATH "$HOSTINGER_USER@$HOSTINGER_IP" "which sqlite3 2>/dev/null || echo 'missing'"
    if ($sqliteCheck -match "missing") {
        Write-Host "  Installing SQLite..." -ForegroundColor Yellow
        ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -i $KEY_PATH "$HOSTINGER_USER@$HOSTINGER_IP" "sudo apt-get update -qq && sudo apt-get install -y sqlite3"
        Write-Host "  SQLite installed" -ForegroundColor Green
    }

    # Run all migrations in order
    $migrations = @(
        "001_multi_user_support.sql",
        "002_missing_tables.sql",
        "003_fix_schema_issues.sql",
        "004_additional_columns.sql",
        "005_fix_interactive_schema.sql",
        "006_conversation_learning.sql",
        "007_document_management_embeddings.sql",
        "008_fsm_integration.sql",
        "009_fix_duplicate_columns.sql",
        "010_salesman_empowerment.sql",
        "011_salesman_auth_tokens.sql"
    )
    foreach ($migration in $migrations) {
        $migrationExists = ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -i $KEY_PATH "$HOSTINGER_USER@$HOSTINGER_IP" "test -f $REMOTE_PATH/migrations/$migration && echo 'exists' || echo 'missing'"
        if ($migrationExists -match "exists") {
            Write-Host "  Applying migration: $migration" -ForegroundColor Gray
            ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -i $KEY_PATH "$HOSTINGER_USER@$HOSTINGER_IP" "cd $REMOTE_PATH && sqlite3 local-database.db < migrations/$migration 2>&1 || true"
        }
    }
    Write-Host "  All migrations processed" -ForegroundColor Green
} else {
    Write-Host "  Skipping SQLite migrations (Supabase in use)" -ForegroundColor Green
}

# ====== STEP 7: Configure Nginx for sak-ai.saksolution.com ======
Write-Host "`n[7/8] Configuring Nginx for sak-ai.saksolution.com" -ForegroundColor Yellow
$nginxConfig = @'
server {
    listen 80;
    server_name sak-ai.saksolution.com;

    location / {
        proxy_pass http://localhost:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_cache_bypass \$http_upgrade;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        
        proxy_connect_timeout 600;
        proxy_send_timeout 600;
        proxy_read_timeout 600;
        send_timeout 600;
    }

    location /socket.io/ {
        proxy_pass http://localhost:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    
    client_max_body_size 50M;
}
'@

Invoke-RemoteCommand "echo '$nginxConfig' | sudo tee /etc/nginx/sites-available/sak-ai.saksolution.com > /dev/null"
Invoke-RemoteCommand "sudo ln -sf /etc/nginx/sites-available/sak-ai.saksolution.com /etc/nginx/sites-enabled/"
Invoke-RemoteCommand "sudo nginx -t && sudo systemctl reload nginx"
Write-Host "Nginx configured for sak-ai.saksolution.com" -ForegroundColor Green

# ====== STEP 8: Install SSL Certificate ======
Write-Host "`n[8/9] Installing SSL Certificate for sak-ai.saksolution.com" -ForegroundColor Yellow
$certbotOutput = ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -i $KEY_PATH "$HOSTINGER_USER@$HOSTINGER_IP" "sudo certbot --nginx -d sak-ai.saksolution.com --non-interactive --agree-tos --email qutubkothari@gmail.com --redirect 2>&1 || echo 'CERT_ERROR'"
if ($certbotOutput -match "CERT_ERROR|error") {
    Write-Host "SSL certificate installation skipped or failed (may already exist)" -ForegroundColor Yellow
} else {
    Write-Host "SSL certificate installed successfully" -ForegroundColor Green
}

# ====== STEP 9: Restart PM2 ======
Write-Host "`n[9/9] Restarting Application" -ForegroundColor Yellow
Invoke-RemoteCommand "cd $REMOTE_PATH; pm2 restart $PM2_PROCESS; sleep 2; pm2 list"
Write-Host "Application restarted" -ForegroundColor Green

# ====== COMPLETE ======
Write-Host "`n===================================================" -ForegroundColor Cyan
Write-Host "   DEPLOYMENT SUCCESSFUL!" -ForegroundColor Green
Write-Host "===================================================`n" -ForegroundColor Cyan
Write-Host "Live at:" -ForegroundColor Cyan
Write-Host "  - https://salesmate.saksolution.com" -ForegroundColor White
Write-Host "  - https://sak-ai.saksolution.com (NEW)" -ForegroundColor Green
Write-Host "`nCheck logs: pm2 logs $PM2_PROCESS" -ForegroundColor Gray
Write-Host ""
