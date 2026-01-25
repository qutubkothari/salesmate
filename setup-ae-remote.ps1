# Wrapper to deploy and set up the AE domain on Hostinger
$ErrorActionPreference = "Stop"

Write-Host ">>> Starting Deployment..." -ForegroundColor Green
.\deploy-salesmate-hostinger.ps1 -Message "Adding AE domain support"

Write-Host "`n>>> Running AE Domain Setup on Server..." -ForegroundColor Green
$HOSTINGER_IP = "72.62.192.228"
$HOSTINGER_USER = "qutubk"
$KEY_PATH = "$env:USERPROFILE\.ssh\hostinger_ed25519"
$REMOTE_PATH = "/var/www/salesmate-ai"

# Command to run on server
$SETUP_CMD = "cd $REMOTE_PATH && chmod +x setup-ae-domain.sh && sudo ./setup-ae-domain.sh"

ssh -o StrictHostKeyChecking=no -i $KEY_PATH "$HOSTINGER_USER@$HOSTINGER_IP" $SETUP_CMD

Write-Host "`n>>> Done! Check https://sak-ai.saksolution.ae" -ForegroundColor Cyan