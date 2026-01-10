# Automated Hostinger Deploy (artifact-based) for Salesmate AI
# - Packages this repo (Node/Express app) into a tar.gz
# - Uploads to Hostinger VPS
# - Installs production deps and restarts PM2

$ErrorActionPreference = "Stop"

# ====== CONFIG (Hostinger VPS) ======
$HOSTINGER_IP = if ($env:HOSTINGER_IP) { $env:HOSTINGER_IP } else { "72.62.192.228" }
$HOSTINGER_USER = if ($env:HOSTINGER_USER) { $env:HOSTINGER_USER } else { "root" }
$KEY_PATH = if ($env:HOSTINGER_KEY_PATH) { $env:HOSTINGER_KEY_PATH } else { "$env:USERPROFILE\.ssh\hostinger_ed25519" }

# Remote deployment path
$REMOTE_PATH = if ($env:HOSTINGER_REMOTE_PATH) { $env:HOSTINGER_REMOTE_PATH } else { "/var/www/salesmate-ai" }

# App config
$PM2_NAME = if ($env:HOSTINGER_PM2_NAME) { $env:HOSTINGER_PM2_NAME } else { "salesmate-ai" }
$APP_PORT = if ($env:HOSTINGER_APP_PORT) { [int]$env:HOSTINGER_APP_PORT } else { 8081 }

# ====== Helpers ======
function Assert-CommandExists($name) {
  $cmd = Get-Command $name -ErrorAction SilentlyContinue
  if (-not $cmd) {
    throw "Required command not found: $name"
  }
}

function Run($label, $scriptBlock) {
  Write-Host "`n=== $label ===" -ForegroundColor Cyan
  & $scriptBlock
}

function Invoke-Ssh($remoteCommand) {
  & ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=20 -i $KEY_PATH "$HOSTINGER_USER@$HOSTINGER_IP" $remoteCommand
}

function ScpToHostinger($localPath, $remotePath) {
  & scp -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=30 -i $KEY_PATH $localPath "$HOSTINGER_USER@${HOSTINGER_IP}:$remotePath"
}

# ====== Preconditions ======
Run "Preflight" {
  if (-not (Test-Path $KEY_PATH)) {
    throw "SSH key not found at: $KEY_PATH. Set HOSTINGER_KEY_PATH env var if needed."
  }

  Assert-CommandExists "ssh"
  Assert-CommandExists "scp"
  Assert-CommandExists "tar"
  Assert-CommandExists "git"
  Assert-CommandExists "node"

  Write-Host "Local repo: $(Get-Location)" -ForegroundColor Gray
  Write-Host "Hostinger VPS: $HOSTINGER_USER@$HOSTINGER_IP" -ForegroundColor Gray
  Write-Host "Remote path: $REMOTE_PATH" -ForegroundColor Gray
  Write-Host "PM2 name: $PM2_NAME" -ForegroundColor Gray
  Write-Host "App port: $APP_PORT" -ForegroundColor Gray

  Write-Host "Testing connection to Hostinger VPS..." -ForegroundColor Gray
  try {
    Invoke-Ssh "echo 'SSH_OK'; node -v 2>/dev/null || echo 'Node.js missing'; npm -v 2>/dev/null || echo 'npm missing'; pm2 -v 2>/dev/null || echo 'pm2 missing'" | Out-Host
  } catch {
    Write-Host "Connection test failed. Proceeding anyway..." -ForegroundColor Yellow
  }
}

# ====== Package artifacts ======
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$archive = "salesmate-ai-$stamp.tar.gz"

Run "Create artifact archive ($archive)" {
  if (Test-Path $archive) { Remove-Item $archive -Force }

  $required = @(
    'index.js',
    'package.json',
    'package-lock.json'
  )

  $optional = @(
    '.env.example',
    'routes',
    'services',
    'controllers',
    'middleware',
    'public',
    'scripts',
    'schedulers',
    'workers',
    'utils',
    'config',
    'handlers',
    'commands',
    'cloud-server',
    'desktop-agent'
  )

  $missingRequired = $required | Where-Object { -not (Test-Path $_) }
  if ($missingRequired.Count -gt 0) {
    throw "Missing required paths for archive: $($missingRequired -join ', ')"
  }

  $inputs = @($required + ($optional | Where-Object { Test-Path $_ }))

  # Exclude large/local-only paths (node_modules, backups, local DB, git)
  & tar -czf $archive --exclude='node_modules' --exclude='backups' --exclude='__deleted_backup' --exclude='.git' --exclude='local-database.db' @inputs

  $size = [math]::Round((Get-Item $archive).Length / 1MB, 2)
  Write-Host "Archive size: $size MB" -ForegroundColor Gray
}

# ====== Upload & deploy on Hostinger ======
Run "Upload archive to Hostinger" {
  ScpToHostinger $archive "/tmp/$archive"
}

Run "Deploy on Hostinger (extract, npm ci --omit=dev, restart PM2)" {
  $remoteCmd =
    ('set -e; ' +
     'ARCHIVE=/tmp/' + $archive + '; ' +
     'DEPLOY_DIR=' + $REMOTE_PATH + '; ' +
     'mkdir -p "' + $REMOTE_PATH + '"; cd "' + $REMOTE_PATH + '"; ' +
     'if command -v pm2 >/dev/null 2>&1; then pm2 stop ' + $PM2_NAME + ' 2>/dev/null || true; fi; ' +
     'if [ -f package.json ]; then tar -czf backup-' + $stamp + '.tar.gz index.js package.json package-lock.json routes services controllers middleware public scripts schedulers workers utils config handlers commands cloud-server desktop-agent 2>/dev/null || true; fi; ' +
     'ls -1t backup-*.tar.gz 2>/dev/null | tail -n +6 | xargs -r rm -f 2>/dev/null || true; ' +
     'rm -rf node_modules 2>/dev/null || true; ' +
     'tar -xzf "$ARCHIVE" -C "$DEPLOY_DIR"; ' +
     'rm -f "$ARCHIVE"; ' +
     'if ! command -v node >/dev/null 2>&1; then echo "Node.js missing"; exit 2; fi; ' +
     'if ! command -v npm >/dev/null 2>&1; then echo "npm missing"; exit 2; fi; ' +
     'if ! command -v pm2 >/dev/null 2>&1; then npm i -g pm2; fi; ' +
     'npm ci --omit=dev; ' +
     'export NODE_ENV=production; export PORT=' + $APP_PORT + '; ' +
     'pm2 delete ' + $PM2_NAME + ' 2>/dev/null || true; ' +
     'pm2 start index.js --name ' + $PM2_NAME + ' --time --update-env; ' +
     'pm2 save; ' +
     'for i in 1 2 3 4 5; do CODE=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:' + $APP_PORT + '/health || true); if [ "$CODE" != "000" ]; then echo HEALTH_$CODE; break; fi; sleep 2; done; ' +
     'pm2 list')

  $escapedCmd = $remoteCmd.Replace("'", "'\\''")
  Invoke-Ssh "bash -lc '$escapedCmd'" | Out-Host
}

Run "Done" {
  Write-Host "`nDeployment Complete!" -ForegroundColor Green
  Write-Host "Health: http://${HOSTINGER_IP}:${APP_PORT}/health" -ForegroundColor Green
  Write-Host "Dashboard: http://${HOSTINGER_IP}:${APP_PORT}/dashboard" -ForegroundColor Green
  Write-Host "`nNext Steps:" -ForegroundColor Yellow
  Write-Host "- Configure Nginx reverse proxy + domain SSL (see nginx-salesmate-ai.conf)" -ForegroundColor Gray
}
