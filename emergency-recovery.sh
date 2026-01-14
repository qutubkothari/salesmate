#!/bin/bash

# Emergency Recovery Script for 502 Bad Gateway

echo "=========================================="
echo "  Salesmate - Emergency Recovery"
echo "=========================================="
echo ""

# Configuration
VPS_IP="72.62.192.228"
VPS_USER="root"
VPS_APP_DIR="/var/www/salesmate"

echo "[1/5] Checking PM2 Status..."
echo ""
echo "$ pm2 status"
pm2 status

echo ""
echo "[2/5] Checking Recent Logs..."
echo ""
echo "$ pm2 logs --lines 20 --nostream"
pm2 logs --lines 20 --nostream

echo ""
echo "[3/5] Checking Node Process..."
ps aux | grep -E 'node|sak-api' | grep -v grep

echo ""
echo "[4/5] Checking Port 8055..."
netstat -tlnp 2>/dev/null | grep 8055 || ss -tlnp 2>/dev/null | grep 8055 || echo "Port 8055 not listening"

echo ""
echo "[5/5] Checking Database..."
ls -lah "$VPS_APP_DIR/local-database.db"

echo ""
echo "=========================================="
echo "Recovery Options:"
echo "=========================================="
echo ""
echo "Option 1: Restart all services"
echo "  pm2 restart all"
echo ""
echo "Option 2: Restart specific service"
echo "  pm2 restart sak-api"
echo ""
echo "Option 3: Stop and start"
echo "  pm2 stop all && sleep 5 && pm2 start all"
echo ""
echo "Option 4: View full logs"
echo "  pm2 logs sak-api"
echo ""
echo "Option 5: Check npm errors"
echo "  npm start (from $VPS_APP_DIR)"
echo ""
