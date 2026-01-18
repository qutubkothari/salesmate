# 🎯 SALESMATE ENTERPRISE - GUIDED TOUR

**Your Mission:** Understand and test your enterprise platform step-by-step  
**Current Status:** ✅ System Healthy (194 tables deployed)  
**Production URL:** https://salesmate.saksolution.com

---

## 📋 STEP 1: Test User Authentication & RBAC (5 minutes)

### What This Tests:
- User login system
- Role-based access control
- Permission management

### Your Actions:

**1.1 Check Current Users**
```powershell
ssh -i ~/.ssh/hostinger_ed25519 qutubk@72.62.192.228 "cd /var/www/salesmate-ai && sqlite3 -header -column local-database.db 'SELECT id, username, phone, role, is_active FROM users LIMIT 5;'"
```

**1.2 Check Available Roles**
```powershell
Invoke-RestMethod -Uri 'https://salesmate.saksolution.com/api/rbac/roles' -Method GET
```

**1.3 Test Login (if you have credentials)**
```powershell
$body = @{
    phone = "YOUR_PHONE"
    password = "YOUR_PASSWORD"
} | ConvertTo-Json

Invoke-RestMethod -Uri 'https://salesmate.saksolution.com/api/auth/login' -Method POST -Body $body -ContentType 'application/json'
```

### Expected Results:
- ✅ See list of users from database
- ✅ See roles like: admin, sales_manager, sales_rep, finance, support
- ✅ Get JWT token on successful login

### What To Look For:
- Are there active users?
- What roles exist?
- Can you login?

**👉 STOP HERE - Tell me what you see, then I'll give you STEP 2**

---

## 📋 STEP 2: Test Enterprise Pricing (5 minutes)

### What This Tests:
- Multi-tier pricing (Wholesale, Retail, VIP)
- Customer type pricing
- Volume discounts

### Your Actions:

**2.1 Check Pricing Tiers**
```powershell
Invoke-RestMethod -Uri 'https://salesmate.saksolution.com/api/pricing/tiers' -Method GET
```

**2.2 Check Sample Products**
```powershell
ssh -i ~/.ssh/hostinger_ed25519 qutubk@72.62.192.228 "cd /var/www/salesmate-ai && sqlite3 -header -column local-database.db 'SELECT id, name, base_price FROM products LIMIT 5;'"
```

**2.3 Get Price for a Product**
```powershell
# Replace PRODUCT_ID with actual ID from step 2.2
Invoke-RestMethod -Uri 'https://salesmate.saksolution.com/api/pricing/calculate/PRODUCT_ID?tierId=1&quantity=10&customerType=contractor' -Method GET
```

### Expected Results:
- ✅ See pricing tiers (wholesale, retail, vip, member)
- ✅ See product list with base prices
- ✅ Get calculated price with tier + quantity discounts

**👉 STOP HERE - Show me the results, then STEP 3**

---

## 📋 STEP 3: Test Sales Pipeline (5 minutes)

### What This Tests:
- Deal creation
- Pipeline stages
- Deal tracking

### Your Actions:

**3.1 Check Pipelines**
```powershell
Invoke-RestMethod -Uri 'https://salesmate.saksolution.com/api/pipeline/pipelines' -Method GET
```

**3.2 Check Pipeline Stages**
```powershell
# Replace PIPELINE_ID with ID from step 3.1
Invoke-RestMethod -Uri 'https://salesmate.saksolution.com/api/pipeline/pipelines/PIPELINE_ID/stages' -Method GET
```

**3.3 View Active Deals**
```powershell
ssh -i ~/.ssh/hostinger_ed25519 qutubk@72.62.192.228 "cd /var/www/salesmate-ai && sqlite3 -header -column local-database.db 'SELECT id, title, value, probability, stage_id FROM deals LIMIT 10;'"
```

### Expected Results:
- ✅ See pipeline (e.g., "Sales Pipeline", "B2B Pipeline")
- ✅ See stages (Lead, Qualified, Proposal, Negotiation, Won, Lost)
- ✅ See deals with values and probabilities

**👉 STOP HERE - Share results, then STEP 4**

---

## 📋 STEP 4: Test AI Intelligence (5 minutes)

### What This Tests:
- Conversation AI
- Intent detection
- Sentiment analysis
- Smart replies

### Your Actions:

**4.1 Check AI Sessions**
```powershell
ssh -i ~/.ssh/hostinger_ed25519 qutubk@72.62.192.228 "cd /var/www/salesmate-ai && sqlite3 -header -column local-database.db 'SELECT id, customer_phone, intent_summary, sentiment, message_count FROM ai_conversation_sessions ORDER BY created_at DESC LIMIT 5;'"
```

**4.2 Test Intent Detection**
```powershell
$body = @{
    conversationId = "test-123"
    customerPhone = "1234567890"
    message = "I want to buy 10 units of Product A. What's the price?"
} | ConvertTo-Json

Invoke-RestMethod -Uri 'https://salesmate.saksolution.com/api/ai/analyze' -Method POST -Body $body -ContentType 'application/json'
```

**4.3 Get Smart Replies**
```powershell
$body = @{
    message = "What's your best price?"
    context = @{
        customerType = "contractor"
        previousMessages = 5
    }
} | ConvertTo-Json

Invoke-RestMethod -Uri 'https://salesmate.saksolution.com/api/ai/suggest-reply' -Method POST -Body $body -ContentType 'application/json'
```

### Expected Results:
- ✅ See AI conversation history
- ✅ Get intent (e.g., "purchase_intent", "price_inquiry")
- ✅ Get sentiment (positive/neutral/negative)
- ✅ Get smart reply suggestions

**👉 STOP HERE - Show me AI results, then STEP 5**

---

## 📋 STEP 5: Test Analytics & Reporting (5 minutes)

### What This Tests:
- Custom dashboards
- KPI tracking
- Reports

### Your Actions:

**5.1 List Available Dashboards**
```powershell
Invoke-RestMethod -Uri 'https://salesmate.saksolution.com/api/analytics/dashboards' -Method GET
```

**5.2 Get Sales Metrics**
```powershell
ssh -i ~/.ssh/hostinger_ed25519 qutubk@72.62.192.228 "cd /var/www/salesmate-ai && sqlite3 -header -column local-database.db 'SELECT COUNT(*) as total_deals, SUM(value) as total_value, AVG(value) as avg_value FROM deals WHERE status = \"active\";'"
```

**5.3 Check Available KPIs**
```powershell
Invoke-RestMethod -Uri 'https://salesmate.saksolution.com/api/analytics/kpis' -Method GET
```

### Expected Results:
- ✅ See dashboards (Sales Overview, Manager Dashboard, etc.)
- ✅ See deal statistics (count, total value, average)
- ✅ See KPIs (revenue, conversion rate, pipeline value)

**👉 STOP HERE - Share analytics results, then STEP 6**

---

## 📋 STEP 6: Test Document Generation (5 minutes)

### What This Tests:
- Invoice generation
- Quotation builder
- PDF creation

### Your Actions:

**6.1 List Document Templates**
```powershell
Invoke-RestMethod -Uri 'https://salesmate.saksolution.com/api/documents/templates' -Method GET
```

**6.2 Check Generated Documents**
```powershell
ssh -i ~/.ssh/hostinger_ed25519 qutubk@72.62.192.228 "cd /var/www/salesmate-ai && sqlite3 -header -column local-database.db 'SELECT id, template_id, document_type, status, created_at FROM generated_documents ORDER BY created_at DESC LIMIT 5;'"
```

**6.3 Generate Test Invoice (Optional)**
```powershell
$body = @{
    templateId = 1  # Use ID from step 6.1
    documentType = "invoice"
    recipientName = "Test Customer"
    recipientEmail = "test@example.com"
    lineItems = @(
        @{
            description = "Product A"
            quantity = 5
            unitPrice = 100
            total = 500
        }
    )
    subtotal = 500
    tax = 50
    total = 550
} | ConvertTo-Json

Invoke-RestMethod -Uri 'https://salesmate.saksolution.com/api/documents/generate' -Method POST -Body $body -ContentType 'application/json'
```

### Expected Results:
- ✅ See templates (invoice, quotation, purchase_order)
- ✅ See previously generated documents
- ✅ Get document ID on generation

**👉 STOP HERE - Show me documents, then STEP 7**

---

## 📋 STEP 7: Test Mobile App Features (5 minutes)

### What This Tests:
- Feature flags
- Offline sync queue
- Mobile sessions

### Your Actions:

**7.1 Get Feature Flags**
```powershell
Invoke-RestMethod -Uri 'https://salesmate.saksolution.com/api/mobile-app/feature-flags?platform=android&appVersion=1.0.0' -Method GET
```

**7.2 Check Offline Queue**
```powershell
ssh -i ~/.ssh/hostinger_ed25519 qutubk@72.62.192.228 "cd /var/www/salesmate-ai && sqlite3 -header -column local-database.db 'SELECT COUNT(*) as pending_items, SUM(CASE WHEN status=\"synced\" THEN 1 ELSE 0 END) as synced FROM offline_sync_queue;'"
```

**7.3 Check Mobile Devices**
```powershell
ssh -i ~/.ssh/hostinger_ed25519 qutubk@72.62.192.228 "cd /var/www/salesmate-ai && sqlite3 -header -column local-database.db 'SELECT device_id, platform, app_version, is_active FROM mobile_devices LIMIT 5;'"
```

### Expected Results:
- ✅ See feature flags (offline_mode, push_notifications, ai_chat)
- ✅ See sync queue statistics
- ✅ See registered mobile devices

**👉 STOP HERE - Share mobile results, then STEP 8**

---

## 📋 STEP 8: Test Performance & Caching (5 minutes)

### What This Tests:
- Cache system
- Query performance
- Health monitoring

### Your Actions:

**8.1 Set Cache Value**
```powershell
$body = @{
    key = "test:tour:001"
    value = @{
        message = "Testing cache system"
        timestamp = Get-Date -Format "o"
    }
    ttl = 3600
} | ConvertTo-Json

Invoke-RestMethod -Uri 'https://salesmate.saksolution.com/api/performance/cache' -Method POST -Body $body -ContentType 'application/json'
```

**8.2 Get Cache Value**
```powershell
Invoke-RestMethod -Uri 'https://salesmate.saksolution.com/api/performance/cache/test:tour:001' -Method GET
```

**8.3 Get Cache Statistics**
```powershell
Invoke-RestMethod -Uri 'https://salesmate.saksolution.com/api/performance/cache/stats' -Method GET
```

**8.4 Check System Health**
```powershell
Invoke-RestMethod -Uri 'https://salesmate.saksolution.com/api/performance/health/status' -Method GET
```

### Expected Results:
- ✅ Cache set success
- ✅ Retrieve cached value
- ✅ See cache stats (hit rate, memory/DB entries)
- ✅ See overall system health

**👉 STOP HERE - Show me performance results, then STEP 9**

---

## 📋 STEP 9: Test WhatsApp Integration (5 minutes)

### What This Tests:
- WhatsApp connections
- Message templates
- Broadcast campaigns

### Your Actions:

**9.1 Check WhatsApp Connections**
```powershell
ssh -i ~/.ssh/hostinger_ed25519 qutubk@72.62.192.228 "cd /var/www/salesmate-ai && sqlite3 -header -column local-database.db 'SELECT phone_number, status, is_active FROM whatsapp_connections LIMIT 3;'"
```

**9.2 Check Message Templates**
```powershell
ssh -i ~/.ssh/hostinger_ed25519 qutubk@72.62.192.228 "cd /var/www/salesmate-ai && sqlite3 -header -column local-database.db 'SELECT id, name, category, usage_count FROM smart_reply_templates ORDER BY usage_count DESC LIMIT 5;'"
```

**9.3 Check Broadcast Campaigns**
```powershell
ssh -i ~/.ssh/hostinger_ed25519 qutubk@72.62.192.228 "cd /var/www/salesmate-ai && sqlite3 -header -column local-database.db 'SELECT id, name, status, total_recipients, sent_count FROM broadcast_campaigns ORDER BY created_at DESC LIMIT 5;'"
```

### Expected Results:
- ✅ See active WhatsApp connections
- ✅ See smart reply templates
- ✅ See broadcast campaign history

**👉 STOP HERE - Share WhatsApp results, then STEP 10**

---

## 📋 STEP 10: Create Your First Complete Workflow (10 minutes)

### What This Tests:
- End-to-end workflow
- Multiple features working together

### Your Scenario:
**"New customer inquiry → AI analysis → Create deal → Generate quote → Send via WhatsApp"**

### Your Actions:

**10.1 Create a Test Customer**
```powershell
$body = @{
    name = "John Test Customer"
    phone = "9999999999"
    customerType = "contractor"
    email = "john@test.com"
} | ConvertTo-Json

# Save the result - you'll need the customer ID
Invoke-RestMethod -Uri 'https://salesmate.saksolution.com/api/customers' -Method POST -Body $body -ContentType 'application/json'
```

**10.2 Analyze Customer Message**
```powershell
$body = @{
    conversationId = "tour-test-001"
    customerPhone = "9999999999"
    message = "Hi, I need 50 units of cement. What's your best price for contractors?"
} | ConvertTo-Json

# This will detect intent and sentiment
Invoke-RestMethod -Uri 'https://salesmate.saksolution.com/api/ai/analyze' -Method POST -Body $body -ContentType 'application/json'
```

**10.3 Create a Deal**
```powershell
$body = @{
    title = "John Test - Cement Order"
    value = 25000
    customerId = "CUSTOMER_ID_FROM_10.1"
    pipelineId = 1  # Use actual pipeline ID
    stageId = 1     # Use actual stage ID
    probability = 50
    description = "50 units of cement, contractor pricing"
} | ConvertTo-Json

Invoke-RestMethod -Uri 'https://salesmate.saksolution.com/api/pipeline/deals' -Method POST -Body $body -ContentType 'application/json'
```

**10.4 Generate Quotation**
```powershell
$body = @{
    templateId = 2  # Quotation template
    documentType = "quotation"
    recipientName = "John Test Customer"
    recipientEmail = "john@test.com"
    lineItems = @(
        @{
            description = "Cement (50 units)"
            quantity = 50
            unitPrice = 500
            total = 25000
        }
    )
    subtotal = 25000
    tax = 2500
    total = 27500
} | ConvertTo-Json

Invoke-RestMethod -Uri 'https://salesmate.saksolution.com/api/documents/generate' -Method POST -Body $body -ContentType 'application/json'
```

### Expected Results:
- ✅ Customer created with ID
- ✅ AI detects "purchase_intent" + positive sentiment
- ✅ Deal created in pipeline
- ✅ Quotation generated

**👉 STOP HERE - Show me your complete workflow results!**

---

## 🎯 BONUS: Quick Database Exploration

Want to explore what's in your database? Use these:

**See All Table Counts:**
```powershell
ssh -i ~/.ssh/hostinger_ed25519 qutubk@72.62.192.228 "cd /var/www/salesmate-ai && sqlite3 local-database.db \"SELECT 'users' as tbl, COUNT(*) as cnt FROM users UNION ALL SELECT 'products', COUNT(*) FROM products UNION ALL SELECT 'deals', COUNT(*) FROM deals UNION ALL SELECT 'orders', COUNT(*) FROM orders;\""
```

**See Recent Activity:**
```powershell
ssh -i ~/.ssh/hostinger_ed25519 qutubk@72.62.192.228 "cd /var/www/salesmate-ai && sqlite3 -header -column local-database.db 'SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 10;'"
```

---

## 📚 What Each Feature Does (Quick Reference)

1. **Enterprise Pricing** - Multi-tier pricing, volume discounts, customer type pricing
2. **RBAC** - Role-based access, permissions, audit logs
3. **Pipeline** - Sales pipeline, deal tracking, forecasting
4. **AI Intelligence** - Intent detection, sentiment analysis, smart replies, lead scoring
5. **Analytics** - Custom dashboards, KPIs, reports, exports
6. **ERP Integration** - Zoho, Tally, QuickBooks sync
7. **Documents** - Invoice, quotation, PO generation with templates
8. **WhatsApp AI** - Smart replies, broadcasts, conversation context
9. **Mobile App** - Offline sync, feature flags, push notifications
10. **Performance** - Caching, query optimization, health monitoring

---

## 🆘 Need Help?

**If API returns 404:** The endpoint might need authentication token  
**If API returns 500:** Check PM2 logs: `ssh -i ~/.ssh/hostinger_ed25519 qutubk@72.62.192.228 "pm2 logs salesmate-ai --lines 50"`  
**If confused:** Just tell me which step you're on and what you see!

---

**Ready? Let's start with STEP 1! 👆**
