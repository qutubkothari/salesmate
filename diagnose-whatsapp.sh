#!/bin/bash
# WhatsApp Diagnostic Script
# Run this on production server to diagnose WhatsApp response issues

echo "╔═══════════════════════════════════════════════════════════╗"
echo "║     WhatsApp Response Diagnostic - Salesmate AI          ║"
echo "╚═══════════════════════════════════════════════════════════╝"
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

TENANT_ID="112f12b8-55e9-4de8-9fda-d58e37c75796"
DB_PATH="./local-database.db"

echo -e "${BLUE}[1/8] Checking PM2 Process Status...${NC}"
pm2 status salesmate-ai | grep -A 1 "salesmate-ai"
if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ PM2 process is running${NC}"
else
    echo -e "${RED}✗ PM2 process not found!${NC}"
    echo "Run: pm2 start ecosystem.config.js"
    exit 1
fi
echo ""

echo -e "${BLUE}[2/8] Checking WhatsApp Web Connection...${NC}"
STATUS_JSON=$(curl -s "http://localhost:8055/api/whatsapp-web/status/$TENANT_ID")
WA_STATUS=$(echo "$STATUS_JSON" | grep -o '"status":"[^"]*"' | cut -d'"' -f4)

if [ "$WA_STATUS" == "ready" ]; then
    echo -e "${GREEN}✓ WhatsApp Web is CONNECTED${NC}"
    PHONE=$(echo "$STATUS_JSON" | grep -o '"phone_number":"[^"]*"' | cut -d'"' -f4)
    echo "  Phone: $PHONE"
else
    echo -e "${RED}✗ WhatsApp Web is NOT ready (status: $WA_STATUS)${NC}"
    echo "  Run: pm2 restart salesmate-ai"
fi
echo ""

echo -e "${BLUE}[3/8] Checking Database Tables...${NC}"
CONV_TABLES=$(sqlite3 "$DB_PATH" "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%conversation%';")
echo "  Conversation tables: $CONV_TABLES"

if echo "$CONV_TABLES" | grep -q "conversations_new"; then
    echo -e "${GREEN}✓ conversations_new table exists${NC}"
else
    echo -e "${RED}✗ conversations_new table missing!${NC}"
fi

if echo "$CONV_TABLES" | grep -q "^conversations$"; then
    echo -e "${GREEN}✓ conversations table exists${NC}"
else
    echo -e "${YELLOW}⚠ conversations table missing (may cause errors)${NC}"
    echo "  Creating view... "
    sqlite3 "$DB_PATH" "CREATE VIEW IF NOT EXISTS conversations AS SELECT * FROM conversations_new;"
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✓ Created conversations view${NC}"
    fi
fi
echo ""

echo -e "${BLUE}[4/8] Checking Recent Conversations...${NC}"
CONV_COUNT=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM conversations_new WHERE tenant_id='$TENANT_ID';")
echo "  Total conversations for tenant: $CONV_COUNT"

RECENT_CONV=$(sqlite3 "$DB_PATH" "SELECT end_user_phone, status, created_at FROM conversations_new WHERE tenant_id='$TENANT_ID' ORDER BY created_at DESC LIMIT 3;")
if [ ! -z "$RECENT_CONV" ]; then
    echo "  Recent conversations:"
    echo "$RECENT_CONV" | while IFS='|' read phone status created; do
        echo "    - $phone ($status) at $created"
    done
else
    echo -e "${YELLOW}  No conversations found${NC}"
fi
echo ""

echo -e "${BLUE}[5/8] Checking Recent Error Logs...${NC}"
ERROR_COUNT=$(pm2 logs salesmate-ai --lines 100 --nostream --err 2>/dev/null | grep -i "error\|failed" | wc -l)
echo "  Error count (last 100 lines): $ERROR_COUNT"

if [ $ERROR_COUNT -gt 0 ]; then
    echo -e "${YELLOW}  Recent errors:${NC}"
    pm2 logs salesmate-ai --lines 50 --nostream --err 2>/dev/null | grep -i "error\|failed" | tail -5 | sed 's/^/    /'
fi
echo ""

echo -e "${BLUE}[6/8] Checking Webhook Activity...${NC}"
WEBHOOK_LOGS=$(pm2 logs salesmate-ai --lines 100 --nostream 2>/dev/null | grep -i "webhook\|from.*c.us" | tail -5)
if [ ! -z "$WEBHOOK_LOGS" ]; then
    echo "  Recent webhook activity:"
    echo "$WEBHOOK_LOGS" | sed 's/^/    /'
else
    echo -e "${YELLOW}  No webhook activity in last 100 logs${NC}"
    echo "  This is normal if no messages were sent recently"
fi
echo ""

echo -e "${BLUE}[7/8] Checking Message Flow...${NC}"
# Check if sendMessage is being called
SEND_MSG_LOGS=$(pm2 logs salesmate-ai --lines 100 --nostream 2>/dev/null | grep -i "sendmessage\|whatsapp.*send" | tail -3)
if [ ! -z "$SEND_MSG_LOGS" ]; then
    echo "  Recent send attempts:"
    echo "$SEND_MSG_LOGS" | sed 's/^/    /'
else
    echo -e "${YELLOW}  No send message activity in last 100 logs${NC}"
fi
echo ""

echo -e "${BLUE}[8/8] Checking Environment Variables...${NC}"
if [ -f ".env" ]; then
    PROVIDER_MODE=$(grep "WHATSAPP_PROVIDER_MODE" .env | cut -d'=' -f2)
    DESKTOP_MODE=$(grep "DESKTOP_AGENT_MODE" .env | cut -d'=' -f2)
    
    echo "  WHATSAPP_PROVIDER_MODE: ${PROVIDER_MODE:-not set}"
    echo "  DESKTOP_AGENT_MODE: ${DESKTOP_MODE:-not set}"
    
    if [ "$DESKTOP_MODE" == "true" ] || [ "$DESKTOP_MODE" == "1" ]; then
        echo -e "${RED}  ⚠ WARNING: Desktop agent mode is ON - messages will not be sent!${NC}"
        echo "  Fix: Set DESKTOP_AGENT_MODE=false in .env"
    fi
else
    echo -e "${YELLOW}  .env file not found${NC}"
fi
echo ""

echo "╔═══════════════════════════════════════════════════════════╗"
echo "║                     Diagnostic Summary                    ║"
echo "╚═══════════════════════════════════════════════════════════╝"
echo ""

# Summary
echo -e "${BLUE}Status Summary:${NC}"
if [ "$WA_STATUS" == "ready" ]; then
    echo -e "  WhatsApp Web: ${GREEN}✓ Connected${NC}"
else
    echo -e "  WhatsApp Web: ${RED}✗ Not Connected${NC}"
fi

if [ $CONV_COUNT -gt 0 ]; then
    echo -e "  Conversations: ${GREEN}✓ $CONV_COUNT found${NC}"
else
    echo -e "  Conversations: ${YELLOW}⚠ None found${NC}"
fi

if [ $ERROR_COUNT -eq 0 ]; then
    echo -e "  Error Logs: ${GREEN}✓ No recent errors${NC}"
else
    echo -e "  Error Logs: ${YELLOW}⚠ $ERROR_COUNT errors found${NC}"
fi

echo ""
echo -e "${BLUE}Next Steps:${NC}"
echo ""
echo "1. Send a test WhatsApp message to: +91 84848 30021"
echo "   Message: 'Hello'"
echo ""
echo "2. Watch live logs:"
echo "   pm2 logs salesmate-ai"
echo ""
echo "3. Look for these log entries:"
echo "   [WEBHOOK] Message received from ..."
echo "   [CUSTOMER] AI Routing Decision ..."
echo "   [WHATSAPP_SEND] Sending message ..."
echo ""
echo "4. If no response after 5 seconds, check for errors:"
echo "   pm2 logs salesmate-ai --err"
echo ""
echo -e "${YELLOW}Common Fixes:${NC}"
echo "  • No webhook activity? → pm2 restart salesmate-ai"
echo "  • Database errors? → Run migrations or create missing tables"
echo "  • Desktop mode ON? → Set DESKTOP_AGENT_MODE=false in .env"
echo ""

echo "╔═══════════════════════════════════════════════════════════╗"
echo "║                     Diagnostic Complete                   ║"
echo "╚═══════════════════════════════════════════════════════════╝"
