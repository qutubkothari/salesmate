# Deploy Pipeline Management System
Write-Host ' Deploying Pipeline Management System...' -ForegroundColor Cyan

# Git operations
git add .
git commit -m "Phase 1 Step 3: Enterprise Pipeline Management System"
git push origin main

# SSH to production
$cmd = 'cd /var/www/salesmate-ai && git pull && node run-pipeline-migration.js && node init-pipeline.js && pm2 restart salesmate-ai && pm2 save'
ssh qutubk@72.62.192.228 $cmd

Write-Host ' Deployed successfully!' -ForegroundColor Green
