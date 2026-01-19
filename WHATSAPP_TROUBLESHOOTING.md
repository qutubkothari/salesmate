# WhatsApp Not Replying - Troubleshooting Guide

## Issue
WhatsApp messages are being received but bot is not replying.

## Diagnosis Steps

### 1. Check WhatsApp Web Connection
✅ **CONFIRMED**: WhatsApp Web is connected
- Status: `ready`
- Phone: 918484830021
- Provider: `whatsapp_web`

### 2. Check Server Logs
**Observed Errors:**
- WhatsApp Web evaluation errors (reading 'markedUnread')
- These are normal warnings from WhatsApp Web client

### 3. Likely Causes

#### A. Messages Not Reaching Webhook
**Check:** Are messages hitting the webhook endpoint?

```bash
# On production server
pm2 logs salesmate-ai --lines 200 | grep "\[WEBHOOK\]"
```

#### B. AI Handler Not Generating Responses
**Check:** Is AI generating responses but not sending?

```bash
# Check AI response logs
pm2 logs salesmate-ai | grep "\[CUSTOMER\] AI\|aiResult"
```

#### C. SendMessage Function Not Being Called
**Check:** Is sendMessage being invoked?

```bash
pm2 logs salesmate-ai | grep "WHATSAPP_SEND\|sendMessage"
```

#### D. WhatsApp Web Send Failure
**Check:** Is WhatsApp Web actually sending messages?

```bash
pm2 logs salesmate-ai | grep "sendWebMessage\|WhatsApp Web"
```

---

## Quick Fixes

### Fix 1: Restart PM2 Process
Sometimes WhatsApp Web client needs a fresh connection:

```bash
ssh qutubk@72.62.192.228
cd /var/www/salesmate-ai
pm2 restart salesmate-ai
pm2 logs salesmate-ai --lines 50
```

### Fix 2: Test Direct Message Send
Create a test script to verify send capability:

```javascript
// test-send-direct.js
const { sendMessage } = require('./services/whatsappService');

async function test() {
    const tenantId = '112f12b8-55e9-4de8-9fda-d58e37c75796';
    const phone = '919537653927@c.us'; // QK's number
    const message = 'Test message from diagnostic script';
    
    console.log('Sending test message...');
    const result = await sendMessage(phone, message, tenantId);
    console.log('Result:', result);
}

test().catch(console.error);
```

Run on production:
```bash
node test-send-direct.js
```

### Fix 3: Check Message Flow

The message flow is:
1. WhatsApp → Webhook → messageNormalizer → tenantResolver
2. → adminDetector → handleTenantMessage → AI Handler
3. → sendMessage → WhatsApp Web/Maytapi → Recipient

**Add Debug Logging:**

Check if messages reach the AI handler:
```bash
pm2 logs salesmate-ai | grep "\[CUSTOMER\] AI Routing Decision"
```

If you see "AI Routing Decision" but no response, the issue is in step 3 (sendMessage).

---

## Common Issues & Solutions

### Issue 1: AI Response Generated But Not Sent
**Symptom:** Logs show "Sending AI response" but recipient doesn't receive

**Solution:** Check if response is being sent through correct provider

```javascript
// In webhook.js around line 867
// Add this logging:
console.log('[CUSTOMER] About to send AI response via sendMessage');
console.log('[CUSTOMER] Tenant ID:', tenant.id);
console.log('[CUSTOMER] Recipient:', message.from);
console.log('[CUSTOMER] Response length:', aiResult.response.length);

await sendMessage(message.from, aiResult.response, tenant.id);  // ← Add tenant.id!

console.log('[CUSTOMER] Message sent successfully');
```

**CRITICAL FIX:** Ensure `tenant.id` is passed to `sendMessage()`!

### Issue 2: Wrong Provider Being Used
**Symptom:** Messages go to Maytapi instead of WhatsApp Web

**Check:**
```bash
# Check tenant's provider preference
sqlite3 /var/www/salesmate-ai/local-database.db "SELECT subscription_tier, subscription_status FROM tenants WHERE id='112f12b8-55e9-4de8-9fda-d58e37c75796';"
```

**Fix:** Ensure environment variable is set:
```bash
# In .env file
WHATSAPP_PROVIDER_MODE=auto
# Or force WhatsApp Web:
WHATSAPP_PROVIDER_MODE=whatsapp_web
```

### Issue 3: Desktop Agent Mode Capturing Messages
**Symptom:** Messages get captured instead of sent

**Check:**
```javascript
// In whatsappService.js line 169
if (global.desktopAgentMode) {
    console.log('[WHATSAPP_SERVICE] Desktop agent mode - capturing message instead of sending');
    // ... messages are captured, not sent
}
```

**Fix:** Ensure global.desktopAgentMode is false:
```bash
pm2 restart salesmate-ai
```

---

## Immediate Action Plan

**Step 1: Enable Verbose Logging**

Add to production temporarily:
```bash
ssh qutubk@72.62.192.228
cd /var/www/salesmate-ai
```

Edit `services/whatsappService.js`:
```javascript
// After line 168 in sendMessage function
const sendMessage = async (to, text, tenantId = null) => {
    console.log('🔍 [SEND_MESSAGE_DEBUG] Called with:', { 
        to, 
        textLength: text?.length, 
        tenantId,
        desktopMode: global.desktopAgentMode 
    });
    
    // ... rest of code
```

**Step 2: Test with Real Message**

Send a message from WhatsApp to the bot and watch logs:
```bash
pm2 logs salesmate-ai --lines 0  # Live tail
```

Look for:
1. `[WEBHOOK]` - Message received?
2. `[CUSTOMER] AI Routing Decision` - AI processing?
3. `[SEND_MESSAGE_DEBUG]` - SendMessage called?
4. `[WHATSAPP_SEND]` - Provider selected?
5. `sendWebMessage` - WhatsApp Web sending?

**Step 3: Check Database**

Verify conversation is being saved:
```bash
sqlite3 local-database.db "SELECT * FROM conversations_new WHERE end_user_phone='919537653927@c.us' ORDER BY created_at DESC LIMIT 1;"

sqlite3 local-database.db "SELECT sender, message_body, created_at FROM messages WHERE conversation_id=(SELECT id FROM conversations_new WHERE end_user_phone='919537653927@c.us' ORDER BY created_at DESC LIMIT 1) ORDER BY created_at DESC LIMIT 5;"
```

---

## Quick Test Commands

```bash
# Test 1: Check if webhook is accessible
curl -X POST https://salesmate.saksolution.com/webhook \
  -H "Content-Type: application/json" \
  -d '{"type":"message","message":{"from":"919537653927@c.us","id":"test1","type":"text","text":{"body":"test"},"body":"test"}}'

# Test 2: Check WhatsApp Web status
curl https://salesmate.saksolution.com/api/whatsapp-web/status/112f12b8-55e9-4de8-9fda-d58e37c75796

# Test 3: Monitor live logs
ssh qutubk@72.62.192.228 "pm2 logs salesmate-ai"
```

---

## Most Likely Issue

Based on the logs and configuration, the most likely issue is:

**The `tenantId` parameter is not being passed to `sendMessage()`**

### Quick Fix:

```bash
ssh qutubk@72.62.192.228
cd /var/www/salesmate-ai
nano routes/webhook.js
```

Find line ~867:
```javascript
await sendMessage(message.from, aiResult.response);
```

Change to:
```javascript
await sendMessage(message.from, aiResult.response, tenant.id);
```

Save and restart:
```bash
pm2 restart salesmate-ai
```

This ensures messages go through WhatsApp Web (which is connected) instead of trying Maytapi (which may not be configured).

---

## Verification

After applying the fix, test:

1. Send "Hello" to the WhatsApp number
2. Check logs: `pm2 logs salesmate-ai`
3. Should see:
   - `[WHATSAPP_SEND] Provider: WhatsApp Web (tenant)`
   - Message sent successfully
4. Receive reply in WhatsApp

---

## Need More Help?

If issue persists:
1. Share the output of: `pm2 logs salesmate-ai --lines 200 > logs.txt`
2. Share: `pm2 status salesmate-ai`
3. Check if any firewall blocking outbound connections
