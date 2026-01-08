# Automated Deployment Script - Windows to EC2
param(
    [string]$Message = "Auto deploy from Windows",
    [switch]$NoCommit,
    [string]$KeyPath
)

$ErrorActionPreference = 'Stop'

function New-Stopwatch {
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    return $sw
}

function Format-Duration([TimeSpan]$ts) {
    if (-not $ts) { return "" }
    if ($ts.TotalSeconds -lt 60) { return "{0:n1}s" -f $ts.TotalSeconds }
    return "{0}m {1:n1}s" -f [int]$ts.TotalMinutes, ($ts.TotalSeconds % 60)
}

Write-Host "================================" -ForegroundColor Cyan
Write-Host "  EC2 Deployment Script" -ForegroundColor Cyan
Write-Host "================================" -ForegroundColor Cyan
Write-Host ""

# Configuration (SalesMate bot)
$EC2_IP = "13.126.234.92"
$EC2_USER = "ubuntu"
$defaultKeyCandidates = @(
    $env:EC2_KEY_PATH,
    (Join-Path $HOME "Downloads/whatsapp-ai-key.pem"),
    (Join-Path $HOME ".ssh/whatsapp-ai-key.pem"),
    (Join-Path $HOME ".ssh/my-new-salesmate"),
    (Join-Path $HOME "Downloads/my-new-salesmate")
) | Where-Object { $_ -and $_.Trim().Length -gt 0 }

$EC2_KEY = $null
if ($KeyPath) {
    $EC2_KEY = $KeyPath
} else {
    foreach ($candidate in $defaultKeyCandidates) {
        if (Test-Path -LiteralPath $candidate) {
            $EC2_KEY = $candidate
            break
        }
    }
}

if (-not $EC2_KEY -or -not (Test-Path -LiteralPath $EC2_KEY)) {
    Write-Host "ERROR: SSH key not found. Provide -KeyPath or set EC2_KEY_PATH env var." -ForegroundColor Red
    Write-Host "Tried:" -ForegroundColor Yellow
    $defaultKeyCandidates | ForEach-Object { Write-Host (" - " + $_) -ForegroundColor DarkYellow }
    throw "SSH key not found"
}

Write-Host ("Using SSH key: {0}" -f $EC2_KEY) -ForegroundColor DarkGray
$EC2_APP_DIR = "/home/ubuntu/salesmate"
$EC2_SERVICE = "salesmate-bot"
$EC2_TARGET = "$EC2_USER@$EC2_IP"

# Avoid indefinite hangs on flaky networks
$SSH_OPTS = @(
    "-o", "StrictHostKeyChecking=no",
    "-o", "ConnectTimeout=12",
    "-o", "ServerAliveInterval=15",
    "-o", "ServerAliveCountMax=2"
)

# Step 1: Git Status (and capture changed files)
Write-Host "[1/4] Checking Git status..." -ForegroundColor Yellow
$swAll = New-Stopwatch
$sw = New-Stopwatch
$statusLines = @(git status --porcelain)
git status --short
Write-Host ("[1/4] Git status done in {0}" -f (Format-Duration $sw.Elapsed)) -ForegroundColor DarkGray

# Determine which files to deploy (from git status)
$changed = New-Object System.Collections.Generic.List[object]
foreach ($line in $statusLines) {
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    $code = $line.Substring(0, 2)
    $pathPart = $line.Substring(3)

    $oldPath = $null
    $newPath = $pathPart
    if ($pathPart -match "\s->\s") {
        $parts = $pathPart -split "\s->\s", 2
        $oldPath = $parts[0]
        $newPath = $parts[1]
    }

    $changed.Add([pscustomobject]@{
        Code = $code
        OldPath = $oldPath
        Path = $newPath
    })
}

if ($changed.Count -eq 0) {
    Write-Host "No local changes detected. Will restart service only." -ForegroundColor Yellow
}

# Step 2: Optionally commit locally (no push)
if (-not $NoCommit) {
    Write-Host ""
    Write-Host "[2/4] Committing changes locally (no push)..." -ForegroundColor Yellow
    $sw = New-Stopwatch
    git add -A
    git commit -m "$Message" | Out-Host
    if ($LASTEXITCODE -ne 0) {
        Write-Host "No changes to commit or commit failed (continuing)." -ForegroundColor Yellow
    }
    Write-Host ("[2/4] Commit step done in {0}" -f (Format-Duration $sw.Elapsed)) -ForegroundColor DarkGray
} else {
    Write-Host ""
    Write-Host "[2/4] Skipping git commit (-NoCommit)." -ForegroundColor Yellow
}

# Step 3: Deploy changed files to EC2
Write-Host ""
Write-Host "[3/4] Deploying to EC2..." -ForegroundColor Yellow

$sw = New-Stopwatch

# Remove deleted / renamed-old files first (quick remote cleanup)
foreach ($item in $changed) {
    $rel = $item.Path
    if ([string]::IsNullOrWhiteSpace($rel)) { continue }

    $remoteRel = $rel -replace "\\", "/"
    $remoteFile = "$EC2_APP_DIR/$remoteRel"

    if ($item.Code -match "D") {
        Write-Host "Deleting on EC2: $remoteRel" -ForegroundColor DarkYellow
        ssh -i $EC2_KEY @SSH_OPTS $EC2_TARGET "rm -f '$remoteFile'" | Out-Host
        continue
    }

    if ($item.OldPath) {
        $oldRemoteRel = ($item.OldPath -replace "\\", "/")
        $oldRemoteFile = "$EC2_APP_DIR/$oldRemoteRel"
        Write-Host "Renamed on EC2: $oldRemoteRel -> $remoteRel" -ForegroundColor DarkYellow
        ssh -i $EC2_KEY @SSH_OPTS $EC2_TARGET "rm -f '$oldRemoteFile'" | Out-Host
    }
}

# Decide deployment mode
$filesToCopy = @($changed | Where-Object { $_.Code -notmatch 'D' } | ForEach-Object { $_.Path } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
$useArchive = $filesToCopy.Count -ge 6

if ($filesToCopy.Count -eq 0) {
    Write-Host "No files to copy." -ForegroundColor DarkGray
} elseif ($useArchive) {
    Write-Host ("Using archive deploy for {0} files..." -f $filesToCopy.Count) -ForegroundColor Cyan

    $tempBase = $env:TEMP
    if (-not $tempBase) { $tempBase = $env:TMPDIR }
    if (-not $tempBase) { $tempBase = [System.IO.Path]::GetTempPath() }
    if (-not $tempBase) { throw "No temp directory available (TEMP/TMPDIR/GetTempPath)" }

    $tempRoot = Join-Path $tempBase ("salesmate-deploy-" + [Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $tempRoot | Out-Null

    $listFile = Join-Path $tempRoot "files.txt"
    $archive = Join-Path $tempRoot "deploy.tar.gz"

    # Create file list for tar (relative paths, one per line)
    ($filesToCopy | ForEach-Object { $_ -replace "\\", "/" }) | Set-Content -Encoding ASCII -Path $listFile

    # Build archive from workspace root
    $cwd = Get-Location
    try {
        tar -czf $archive -C $cwd -T $listFile | Out-Null
    } catch {
        # Fallback for tar implementations without -T
        tar -czf $archive -C $cwd ($filesToCopy) | Out-Null
    }

    $remoteTmp = "/tmp/salesmate-deploy-$([Guid]::NewGuid().ToString('N')).tar.gz"
    Write-Host "Uploading archive..." -ForegroundColor DarkYellow
    scp -i $EC2_KEY @SSH_OPTS $archive "${EC2_TARGET}:$remoteTmp" | Out-Host

    Write-Host "Extracting on EC2..." -ForegroundColor DarkYellow
    $extractCmd = "mkdir -p '$EC2_APP_DIR' && tar -xzf '$remoteTmp' -C '$EC2_APP_DIR' && rm -f '$remoteTmp'"
    ssh -i $EC2_KEY @SSH_OPTS $EC2_TARGET $extractCmd | Out-Host

    Remove-Item -Recurse -Force $tempRoot
} else {
    Write-Host ("Using per-file deploy for {0} files..." -f $filesToCopy.Count) -ForegroundColor Cyan
    foreach ($item in $changed) {
        $rel = $item.Path
        if ([string]::IsNullOrWhiteSpace($rel)) { continue }

        $remoteRel = $rel -replace "\\", "/"
        $remoteFile = "$EC2_APP_DIR/$remoteRel"
        $remoteDir = [System.IO.Path]::GetDirectoryName($remoteRel) -replace "\\", "/"

        if ($item.Code -match "D") { continue }

        if ($remoteDir -and $remoteDir -ne ".") {
            ssh -i $EC2_KEY @SSH_OPTS $EC2_TARGET "mkdir -p '$EC2_APP_DIR/$remoteDir'" | Out-Host
        }

        Write-Host "Copying to EC2: $rel" -ForegroundColor DarkYellow
        scp -i $EC2_KEY @SSH_OPTS "$rel" "${EC2_TARGET}:$remoteFile" | Out-Host
    }
}

Write-Host ("[3/4] Deploy step done in {0}" -f (Format-Duration $sw.Elapsed)) -ForegroundColor DarkGray

# Step 4: Restart service
Write-Host ""
Write-Host "[4/5] Restarting service on EC2..." -ForegroundColor Yellow
$sw = New-Stopwatch
$SSH_COMMAND = "cd $EC2_APP_DIR && sudo systemctl restart $EC2_SERVICE && sudo systemctl is-active $EC2_SERVICE"
ssh -i $EC2_KEY @SSH_OPTS $EC2_TARGET $SSH_COMMAND
Write-Host ("[4/5] Restart done in {0}" -f (Format-Duration $sw.Elapsed)) -ForegroundColor DarkGray

# Step 5: Run demo fix scripts (populate demo data and fix displays)
Write-Host ""
Write-Host "[5/5] Running demo data fixes on EC2..." -ForegroundColor Yellow
$sw = New-Stopwatch
$DEMO_FIX_CMD = "cd $EC2_APP_DIR && node scripts/fix_product_ids.js 2>&1 && node scripts/final_demo_fix.js 2>&1 && node scripts/fix_display_data.js 2>&1"
ssh -i $EC2_KEY @SSH_OPTS $EC2_TARGET $DEMO_FIX_CMD | Out-Host
Write-Host ("[5/5] Demo fixes done in {0}" -f (Format-Duration $sw.Elapsed)) -ForegroundColor DarkGray

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "================================" -ForegroundColor Green
    Write-Host "  DEPLOYMENT SUCCESSFUL!" -ForegroundColor Green
    Write-Host "================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "Status: $EC2_SERVICE running on EC2" -ForegroundColor Cyan
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

Write-Host ("Total deploy time: {0}" -f (Format-Duration $swAll.Elapsed)) -ForegroundColor DarkGray
