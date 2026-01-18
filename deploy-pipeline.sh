#!/bin/bash
# Deploy Pipeline Management System to Production

echo "🚀 Deploying Pipeline Management System to Production..."
echo ""

# Step 1: Git operations
echo "📦 Step 1: Committing and pushing changes..."
git add .
git commit -m "Phase 1 Step 3: Enterprise Pipeline Management System"
git push origin main

if [ $? -ne 0 ]; then
  echo "❌ Git push failed"
  exit 1
fi

echo "✅ Code pushed successfully"
echo ""

# Step 2: SSH to production and deploy
echo "🌐 Step 2: Deploying to production server..."
ssh qutubk@72.62.192.228 << 'ENDSSH'
cd /var/www/salesmate-ai

# Pull latest code
echo "📥 Pulling latest code..."
git pull origin main

# Run migration
echo "🗄️  Running pipeline migration..."
node run-pipeline-migration.js

if [ $? -ne 0 ]; then
  echo "❌ Migration failed"
  exit 1
fi

# Initialize default pipeline
echo "📋 Initializing default pipeline..."
node init-pipeline.js

if [ $? -ne 0 ]; then
  echo "❌ Initialization failed"
  exit 1
fi

# Restart PM2
echo "🔄 Restarting PM2..."
pm2 restart salesmate-ai
pm2 save

echo ""
echo "✅ Deployment complete!"
echo ""
echo "📊 Testing pipeline API..."
sleep 3

# Test API
curl -s https://salesmate.saksolution.com/api/pipeline/pipelines/101f04af63cbefc2bf8f0a98b9ae1205 | head -20

ENDSSH

if [ $? -eq 0 ]; then
  echo ""
  echo "✅ Pipeline Management System deployed successfully!"
  echo ""
  echo "🔗 API Endpoints:"
  echo "   https://salesmate.saksolution.com/api/pipeline/pipelines/:tenantId"
  echo "   https://salesmate.saksolution.com/api/pipeline/deals/:tenantId"
  echo "   https://salesmate.saksolution.com/api/pipeline/analytics/:tenantId/pipeline"
  echo "   https://salesmate.saksolution.com/api/pipeline/analytics/:tenantId/forecast"
else
  echo "❌ Deployment failed"
  exit 1
fi
