# WhatsApp Test Guide - Quick Steps

## Current Status
✅ WhatsApp Web is CONNECTED (918484830021)
✅ PM2 process is ONLINE
✅ Server is receiving health check requests
❓ Not seeing incoming WhatsApp messages in logs

## IMMEDIATE TEST

### Step 1: Send a WhatsApp Message
📱 **From your phone**, send a WhatsApp message to: **+91 84848 30021**

Send this exact message:
```
Hello
```

### Step 2: Watch the Logs in Real-Time
Open PowerShell and run:
```powershell
ssh -i ~/.ssh/hostinger_ed25519 qutubk@72.62.192.228 "pm2 logs salesmate-ai --lines 0"
```

This will show LIVE logs as they happen.

### Step 3: What to Look For

**✅ GOOD - You should see:**
```
[WEBHOOK] Message received from 91xxxxxxxxxx@c.us
[CUSTOMER] AI Routing Decision: ...
[WHATSAPP_SEND] Sending message via WhatsApp Web
Message sent successfully
```

**❌ BAD - If you see:**
```
Error: no such table: conversations
[MAIN_HANDLER] No conversationId; skipping bot message save
```

### Step 4: Check Response
Look at your WhatsApp - you should get a reply within 2-3 seconds.

---

## IF NO RESPONSE - Debug Steps

### A. Check if Message Reached Server
```powershell
ssh -i ~/.ssh/hostinger_ed25519 qutubk@72.62.192.228 "cd /var/www/salesmate-ai && pm2 logs salesmate-ai --lines 200 --nostream | grep -i 'webhook\|from.*c.us'"
```

If you see **nothing**, it means:
- WhatsApp Web is connected but not receiving messages
- OR webhook is not being triggered

**Fix:** Restart WhatsApp Web connection:
```bash
ssh -i ~/.ssh/hostinger_ed25519 qutubk@72.62.192.228
cd /var/www/salesmate-ai
pm2 restart salesmate-ai
```

Wait 30 seconds for WhatsApp Web to reconnect, then try sending message again.

### B. Check if AI Processed It
```powershell
ssh -i ~/.ssh/hostinger_ed25519 qutubk@72.62.192.228 "cd /var/www/salesmate-ai && pm2 logs salesmate-ai --lines 200 --nostream | grep -i 'customer.*ai\|routing'"
```

If you see "AI Routing" but **no response**, it means:
- Message was processed
- AI generated a response
- But sending failed

**Check:** Are there database errors?
```bash
pm2 logs salesmate-ai --lines 50 | grep -i "error\|failed"
```

### C. Force Restart Everything
If nothing works:
```bash
ssh -i ~/.ssh/hostinger_ed25519 qutubk@72.62.192.228
cd /var/www/salesmate-ai
pm2 stop salesmate-ai
pm2 delete salesmate-ai
pm2 start ecosystem.config.js
pm2 save
```

Wait 1 minute, then try sending WhatsApp message again.

---

## Most Likely Issues

### Issue 1: Database Table Mismatch
**Symptom:** Logs show "no such table: conversations"

**Quick Fix:**
```bash
ssh -i ~/.ssh/hostinger_ed25519 qutubk@72.62.192.228
cd /var/www/salesmate-ai

# Check which tables exist
sqlite3 local-database.db "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%conversation%';"
```

If you see only `conversations_new` but code references `conversations`, run:
```bash
# Create alias
sqlite3 local-database.db "CREATE VIEW conversations AS SELECT * FROM conversations_new;"
pm2 restart salesmate-ai
```

### Issue 2: WhatsApp Web Session Expired
**Symptom:** No messages coming through at all

**Fix:**
```bash
ssh -i ~/.ssh/hostinger_ed25519 qutubk@72.62.192.228
cd /var/www/salesmate-ai

# Check connection status
curl http://localhost:8055/api/whatsapp-web/status/112f12b8-55e9-4de8-9fda-d58e37c75796

# If status is not "ready", reconnect:
pm2 restart salesmate-ai

# Check logs for QR code or connection status
pm2 logs salesmate-ai --lines 100
```

### Issue 3: Tenant ID Not Being Passed
**Symptom:** Messages processed but sent to wrong provider or fail silently

**Check webhook.js around line 867:**
```javascript
// Should be:
await sendMessage(message.from, aiResult.response, tenant.id);

// NOT:
await sendMessage(message.from, aiResult.response);  // ❌ Missing tenant.id
```

**Fix on server:**
```bash
ssh -i ~/.ssh/hostinger_ed25519 qutubk@72.62.192.228
cd /var/www/salesmate-ai
nano routes/webhook.js
```

Find line ~867 and ensure `tenant.id` is passed:
```javascript
await sendMessage(message.from, aiResult.response, tenant.id);
```

Save (Ctrl+X, Y, Enter), then:
```bash
pm2 restart salesmate-ai
```

---

## Emergency Diagnostic Script

Run this to check everything at once:
```bash
ssh -i ~/.ssh/hostinger_ed25519 qutubk@72.62.192.228 << 'EOF'
cd /var/www/salesmate-ai
echo "=== PM2 Status ==="
pm2 status salesmate-ai

echo -e "\n=== WhatsApp Web Status ==="
curl -s http://localhost:8055/api/whatsapp-web/status/112f12b8-55e9-4de8-9fda-d58e37c75796 | grep -o '"status":"[^"]*"'

echo -e "\n=== Database Tables (conversations) ==="
sqlite3 local-database.db "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%conversation%';"

echo -e "\n=== Last 10 Error Logs ==="
pm2 logs salesmate-ai --lines 10 --nostream --err

echo -e "\n=== Last Webhook Activity ==="
pm2 logs salesmate-ai --lines 50 --nostream | grep -i webhook | tail -5
EOF
```

---

## Test Results Checklist

After sending a WhatsApp message, fill this in:

- [ ] Message appears in PM2 logs
- [ ] AI routing decision logged
- [ ] Response generated
- [ ] sendMessage called
- [ ] WhatsApp reply received
- [ ] No database errors
- [ ] No WhatsApp Web errors

If ANY box is unchecked, share the PM2 logs:
```bash
pm2 logs salesmate-ai --lines 200 > ~/whatsapp-debug.log
cat ~/whatsapp-debug.log
```

---

## Quick Contact Test

**Fastest way to test:**

1. Open WhatsApp on your phone
2. Send message to +91 84848 30021: `Hello`
3. Wait 3 seconds
4. Did you get a reply?
   - ✅ YES → System working! Proceed with full testing
   - ❌ NO → Run emergency diagnostic above

---

## Next Steps After Fix

Once WhatsApp responds correctly:

1. ✅ Test with all 3 users (QK, Abbas, Alok)
2. ✅ Test route optimization
3. ✅ Test payment intelligence
4. ✅ Test objection detection
5. ✅ Test follow-up sequences
6. ✅ Test admin commands

See [SMOKE_TEST_REPORT.md](SMOKE_TEST_REPORT.md) for complete test plan.
