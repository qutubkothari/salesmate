# Email System Architecture & Implementation Guide

## Current State Analysis

### ✅ What's Currently Implemented

#### 1. **Email Storage System**
- **Table**: `email_enquiries` in database
- **Fields**: 
  - `id`, `tenant_id`, `from_email`, `subject`, `body`
  - `received_at`, `assigned_to`, `is_read`, `created_at`
  - `message_id`, `thread_id`, `raw` (for Gmail integration)
  
#### 2. **Gmail Integration Service** (`services/gmailService.js`)
- OAuth2 authentication with Google
- Gmail API integration
- Message fetching and parsing
- Gmail Pub/Sub watch setup for real-time notifications
- Automatic email ingestion to database

**Current Flow**:
```
Gmail Account → OAuth → Gmail API → Parse → email_enquiries table
```

#### 3. **Multi-Salesman Support**
- **Table**: `sales_users` 
- **Fields**: `id`, `tenant_id`, `name`, `phone`, `role`, `is_active`
- **API**: `/api/sales-team/:tenantId` (CRUD operations)

#### 4. **WhatsApp Web Multi-Session**
- **Table**: `whatsapp_connections`
- **Fields**: 
  - `tenant_id`, `session_name`, `salesman_id`
  - `provider`, `is_primary`, `status`, `phone_number`
- **Support**: Each salesman can have their own WhatsApp Web session

#### 5. **Multi-Tenant Architecture**
- Tenant isolation via `tenant_id` in all tables
- Per-tenant Gmail connections stored in `tenants` table
- Per-tenant WhatsApp sessions

---

## ❌ What's NOT Implemented (Your Questions)

### 1. **Intelligent Email Filtering**
**Current**: Fetches ALL emails from connected inbox
**Needed**: Filter only company/product/enquiry related emails

**Solution Required**:
- AI-based email classification
- Keywords/rules engine
- Product/company mention detection

### 2. **Per-User Email Accounts**
**Current**: Single email account per tenant (stored in `tenants` table)
**Needed**: Each salesman has their own email account

**Current Schema**:
```sql
tenants:
  - gmail_connected_email (single)
  - gmail_refresh_token
```

**Needed Schema**:
```sql
sales_users:
  - email_address
  - gmail_refresh_token
  - gmail_access_token
  - gmail_token_expiry
  - gmail_history_id
```

### 3. **Role-Based Access Control (RBAC)**
**Current**: Basic `role` field exists but not enforced
**Needed**: Proper hierarchy

```
Super Admin (Platform Owner)
  ↓
Admin (Tenant Owner)
  ↓  
Sales Manager
  ↓
Salesman
```

### 4. **Email Assignment Logic**
**Current**: Manual assignment via UI
**Needed**: Auto-assignment based on:
- Salesman availability
- Previous customer interactions
- Product expertise
- Geographic territory

---

## 🎯 Recommended Implementation Plan

### Phase 1: Intelligent Email Filtering (Week 1)

#### 1.1 AI Classification Service
```javascript
// services/emailClassifier.js
async function classifyEmail({ tenantId, subject, body, fromEmail }) {
  // Use tenant's products/company info to determine relevance
  const tenant = await getTenantInfo(tenantId);
  const products = await getTenantProducts(tenantId);
  
  // Check if email mentions:
  // - Company name
  // - Product names/codes
  // - Industry keywords
  // - RFQ/Enquiry keywords
  
  const isRelevant = await analyzeWithAI({
    email: { subject, body },
    context: {
      companyName: tenant.business_name,
      products: products.map(p => p.name),
      keywords: tenant.industry_keywords
    }
  });
  
  return {
    isRelevant,
    category: 'product_enquiry|general|spam',
    confidence: 0.95,
    extractedProducts: [],
    intent: 'purchase|inquiry|support|other'
  };
}
```

#### 1.2 Update Email Ingestion
```javascript
// services/gmailService.js - Enhanced
async function ingestGmailMessage(tenantId, message) {
  const { subject, body, from } = parseMessage(message);
  
  // AI Classification
  const classification = await classifyEmail({
    tenantId,
    subject,
    body,
    fromEmail: from
  });
  
  // Only store relevant emails
  if (!classification.isRelevant) {
    console.log('[GMAIL] Skipping irrelevant email:', subject);
    return null;
  }
  
  return upsertEmailEnquiry({
    ...messageData,
    category: classification.category,
    intent: classification.intent,
    confidence: classification.confidence,
    extracted_products: JSON.stringify(classification.extractedProducts)
  });
}
```

### Phase 2: Per-Salesman Email Accounts (Week 2)

#### 2.1 Schema Updates
```sql
ALTER TABLE sales_users ADD COLUMN email_address TEXT;
ALTER TABLE sales_users ADD COLUMN gmail_refresh_token TEXT;
ALTER TABLE sales_users ADD COLUMN gmail_access_token TEXT;
ALTER TABLE sales_users ADD COLUMN gmail_token_expiry TEXT;
ALTER TABLE sales_users ADD COLUMN gmail_history_id TEXT;
ALTER TABLE sales_users ADD COLUMN email_watch_expiry TEXT;

-- Update email_enquiries to track salesman
ALTER TABLE email_enquiries ADD COLUMN salesman_id TEXT;
```

#### 2.2 Gmail OAuth Per Salesman
```javascript
// routes/api/gmail.js - New endpoints
router.get('/connect/:salesmanId', async (req, res) => {
  const { salesmanId } = req.params;
  const oauth2Client = getOAuth2Client();
  
  // Generate auth URL with salesman context
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: GMAIL_SCOPES,
    state: JSON.stringify({ salesmanId })
  });
  
  res.redirect(authUrl);
});

router.get('/callback', async (req, res) => {
  const { code, state } = req.query;
  const { salesmanId } = JSON.parse(state);
  
  // Exchange code for tokens
  const { tokens } = await oauth2Client.getToken(code);
  
  // Store tokens in sales_users table
  await dbClient
    .from('sales_users')
    .update({
      gmail_refresh_token: tokens.refresh_token,
      gmail_access_token: tokens.access_token,
      gmail_token_expiry: tokens.expiry_date
    })
    .eq('id', salesmanId);
});
```

#### 2.3 Multi-Account Email Sync
```javascript
// services/emailSyncService.js
async function syncAllSalesmanEmails(tenantId) {
  const salespeople = await dbClient
    .from('sales_users')
    .select('*')
    .eq('tenant_id', tenantId)
    .not('gmail_refresh_token', 'is', null);
  
  for (const salesman of salespeople) {
    await syncSalesmanEmails(salesman);
  }
}

async function syncSalesmanEmails(salesman) {
  const gmail = await getAuthedGmailClient(salesman.id);
  const messages = await fetchLatestMessages(gmail);
  
  for (const msg of messages) {
    await ingestEmailForSalesman({
      salesmanId: salesman.id,
      tenantId: salesman.tenant_id,
      message: msg
    });
  }
}
```

### Phase 3: Role-Based Access Control (Week 3)

#### 3.1 Define Roles & Permissions
```javascript
// services/rbac.js
const ROLES = {
  SUPER_ADMIN: 'super_admin',    // Platform owner
  TENANT_ADMIN: 'tenant_admin',   // Company owner
  SALES_MANAGER: 'sales_manager', // Can see all team emails
  SALESMAN: 'salesman'            // Can only see own emails
};

const PERMISSIONS = {
  // Email permissions
  VIEW_ALL_EMAILS: ['super_admin', 'tenant_admin', 'sales_manager'],
  VIEW_OWN_EMAILS: ['salesman'],
  ASSIGN_EMAILS: ['tenant_admin', 'sales_manager'],
  DELETE_EMAILS: ['tenant_admin', 'sales_manager'],
  
  // User management
  MANAGE_USERS: ['super_admin', 'tenant_admin'],
  VIEW_TEAM: ['sales_manager'],
  
  // WhatsApp
  VIEW_ALL_CONVERSATIONS: ['tenant_admin', 'sales_manager'],
  VIEW_OWN_CONVERSATIONS: ['salesman']
};

function canUser(userRole, permission) {
  return PERMISSIONS[permission]?.includes(userRole) || false;
}
```

#### 3.2 Update Email List Endpoint
```javascript
// routes/api/email.js - Enhanced with RBAC
router.get('/list', requireTenantAuth(), async (req, res) => {
  const tenantId = req.auth.tenantId;
  const userId = req.auth.userId; // From session
  
  // Get user info
  const user = await dbClient
    .from('sales_users')
    .select('role')
    .eq('id', userId)
    .single();
  
  let query = dbClient
    .from('email_enquiries')
    .select('*')
    .eq('tenant_id', tenantId);
  
  // Apply role-based filtering
  if (canUser(user.role, 'VIEW_ALL_EMAILS')) {
    // Show all emails
  } else if (canUser(user.role, 'VIEW_OWN_EMAILS')) {
    // Show only emails assigned to this salesman
    query = query.eq('salesman_id', userId);
  } else {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  
  const { data, error } = await query.order('received_at', { ascending: false });
  res.json({ success: true, emails: data });
});
```

### Phase 4: Smart Auto-Assignment (Week 4)

#### 4.1 Assignment Strategy
```javascript
// services/emailAssignmentService.js
async function autoAssignEmail(emailId, tenantId) {
  const email = await getEmail(emailId);
  const classification = email.classification;
  
  // Strategy 1: Previous interaction
  const previousSalesman = await findPreviousHandler({
    tenantId,
    customerEmail: email.from_email
  });
  
  if (previousSalesman) {
    return assignEmail(emailId, previousSalesman.id);
  }
  
  // Strategy 2: Product expertise
  if (classification.extractedProducts?.length > 0) {
    const expert = await findProductExpert({
      tenantId,
      products: classification.extractedProducts
    });
    
    if (expert) {
      return assignEmail(emailId, expert.id);
    }
  }
  
  // Strategy 3: Load balancing
  const leastBusy = await findLeastBusySalesman(tenantId);
  return assignEmail(emailId, leastBusy.id);
}
```

---

## 📊 Current Data Flow

### Email Ingestion
```
1. Gmail Account → Gmail API
2. Gmail API → gmailService.js
3. Parse message → Extract metadata
4. Store in email_enquiries table
5. Trigger notification (optional)
```

### WhatsApp Multi-Session
```
1. Each salesman → Own WhatsApp Web session
2. Session stored in whatsapp_connections table
3. Linked via salesman_id
4. Messages route to correct salesman
```

---

## 🚀 Quick Start Implementation

### Step 1: Add Email Classification (This Week)
```bash
# Add AI classification to email ingestion
npm install openai  # or your preferred AI service

# Update services/gmailService.js
# Add classification logic before storing emails
```

### Step 2: Enable Per-Salesman Email (Next Week)
```bash
# Run migration
node migrate-add-salesman-email-fields.js

# Update Gmail OAuth flow
# Add salesman context to OAuth state
```

### Step 3: Implement RBAC (Week 3)
```bash
# Add role checks to all email endpoints
# Update session to include user role
# Filter data based on permissions
```

---

## 💡 Key Recommendations

1. **Start with Classification**: This will immediately improve email quality
2. **Per-Salesman Email**: Implement gradually (start with 1-2 test accounts)
3. **RBAC**: Essential for security and data privacy
4. **Auto-Assignment**: Can be basic initially (round-robin), refine later

## 🔧 Technical Debt to Address

1. **Session Management**: Currently using tenantId only, needs userId
2. **Authentication**: Need to track which salesman is logged in
3. **Email Deduplication**: Better handling of email threads
4. **Sync Scheduling**: Need cron jobs for regular email sync per salesman

---

**Priority Order**:
1. **Intelligent Filtering** (Highest ROI, easiest to implement)
2. **RBAC** (Security critical)
3. **Per-Salesman Email** (Complex but valuable)
4. **Auto-Assignment** (Nice to have, can be basic initially)
