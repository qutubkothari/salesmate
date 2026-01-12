# 👥 User Management & Access Control Guide

## Current User Access Method

### For Tenant/Business Owner:
1. **Register via WhatsApp**: Send "register" to the bot
2. **Web Dashboard Login**: Get magic link via WhatsApp
3. **Access**: Full admin access to all features

### Problem: No Multi-User Support Yet ❌

Currently there's NO way to:
- Add multiple admins
- Add salespeople
- Give them separate logins
- Control their permissions

---

## 🚀 NEW IMPLEMENTATION: Complete User Management System

### Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│                  SUPER ADMIN                         │
│              (Platform Owner - You)                  │
└──────────────────┬──────────────────────────────────┘
                   │
    ┌──────────────┴──────────────┐
    │                             │
┌───▼────────────────┐    ┌──────▼───────────────┐
│   TENANT ADMIN     │    │   TENANT ADMIN       │
│  (Business Owner)  │    │  (Business Owner)    │
└───┬────────────────┘    └──────┬───────────────┘
    │                             │
    ├─────────┬─────────┐        │
┌───▼──┐  ┌──▼──┐  ┌───▼──┐     │
│SALES │  │SALES│  │SALES │     │
│MAN   │  │MGR  │  │MAN   │     │
└──────┘  └─────┘  └──────┘     │
                                 │
```

---

## 📋 Step-by-Step: How to Register & Manage Users

### Step 1: Initial Tenant Registration (Already Working)
```
User sends "register" to WhatsApp bot
   ↓
Bot creates tenant account
   ↓
Owner becomes TENANT_ADMIN automatically
```

### Step 2: Add Team Members (NEW)

#### Option A: Via Dashboard (Recommended)
```
1. Login to dashboard
2. Go to "Settings" → "Team Management"
3. Click "Add Team Member"
4. Fill in:
   - Name: "John Doe"
   - Email: "john@company.com"
   - Phone: "+919876543210"
   - Role: Select from dropdown
     • Tenant Admin (Full access)
     • Sales Manager (Team oversight)
     • Salesman (Own data only)
5. Click "Send Invitation"
   ↓
System sends:
   - WhatsApp invitation link
   - Email invitation (if email provided)
   - SMS with access code (optional)
```

#### Option B: Via API
```bash
curl -X POST https://salesmate.saksolution.com/api/users/invite \
  -H "Authorization: Bearer YOUR_TENANT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "John Doe",
    "email": "john@company.com",
    "phone": "+919876543210",
    "role": "salesman"
  }'
```

### Step 3: User Accepts Invitation
```
User receives invitation link
   ↓
Clicks link → Opens registration form
   ↓
Sets password
   ↓
Account activated
   ↓
Can login to dashboard
```

---

## 🔐 Login Methods

### Method 1: Email + Password (NEW)
```
1. Go to https://salesmate.saksolution.com/login
2. Enter email
3. Enter password
4. Click "Login"
   ↓
Dashboard opens with role-based view
```

### Method 2: WhatsApp Magic Link (Existing)
```
1. Send "login" to WhatsApp bot
2. Receive magic link
3. Click link
4. Auto-login to dashboard
```

### Method 3: Phone OTP (NEW)
```
1. Go to login page
2. Enter phone number
3. Receive OTP via SMS/WhatsApp
4. Enter OTP
5. Login
```

---

## 👮 Role-Based Permissions

### 🔴 SUPER ADMIN (You - Platform Owner)
**Access**: Everything across all tenants

| Feature | Permission |
|---------|-----------|
| View all tenants | ✅ |
| Create/delete tenants | ✅ |
| Access any tenant's data | ✅ |
| Manage pricing/subscriptions | ✅ |
| System configuration | ✅ |

### 🟡 TENANT ADMIN (Business Owner)
**Access**: Full control within their company

| Feature | Permission |
|---------|-----------|
| Team management | ✅ Add/remove users |
| All emails | ✅ View/assign/delete |
| All conversations | ✅ Full access |
| All orders | ✅ Full access |
| Products | ✅ Add/edit/delete |
| Settings | ✅ Full control |
| Analytics | ✅ All reports |
| WhatsApp connections | ✅ Manage all sessions |

### 🟢 SALES MANAGER
**Access**: Oversee team performance

| Feature | Permission |
|---------|-----------|
| Team management | ✅ View team |
| All team emails | ✅ View/assign |
| All team conversations | ✅ View/monitor |
| Team orders | ✅ View all |
| Products | ✅ View/edit |
| Settings | ❌ Read-only |
| Analytics | ✅ Team reports |
| WhatsApp connections | ✅ Own session only |

### 🔵 SALESMAN
**Access**: Own customers and leads only

| Feature | Permission |
|---------|-----------|
| Team management | ❌ View only |
| Own emails | ✅ View/reply |
| Others' emails | ❌ Cannot see |
| Own conversations | ✅ Full access |
| Others' conversations | ❌ Cannot see |
| Own orders | ✅ View/manage |
| Others' orders | ❌ Cannot see |
| Products | ✅ View-only |
| Settings | ❌ Cannot access |
| Analytics | ✅ Own performance only |
| WhatsApp connections | ✅ Own session only |

---

## 📧 Email Management Per User

### How Each Salesman Gets Their Own Email

#### Setup Process:
```
1. Salesman logs in to dashboard
2. Goes to "Settings" → "Email Integration"
3. Clicks "Connect Gmail"
4. Authorizes Gmail OAuth
5. System stores:
   - Their Gmail refresh token
   - Access token
   - Email address
6. Emails start syncing automatically
```

#### Email Routing:
```
Incoming Email
   ↓
System checks: "Is this relevant to company?"
   ↓ (AI Classification)
Yes → Store in database
   ↓
Check: "Who handled this customer before?"
   ↓
If previous contact exists:
   → Assign to same salesman
Else:
   → Auto-assign based on:
      • Product expertise
      • Current workload
      • Availability
```

---

## 📱 WhatsApp Web Per Salesman

### Already Implemented! ✅

Each salesman can have their own WhatsApp Web session:

```
1. Salesman logs in to dashboard
2. Goes to "WhatsApp Web" tab
3. Clicks "Connect New Session"
4. Scans QR code with their phone
5. Session saved with their salesman_id
6. All messages from this session → Tagged to this salesman
```

**Database Structure**:
```sql
whatsapp_connections:
  - tenant_id: "company_id"
  - salesman_id: "john_doe_id"  ← Links to specific user
  - session_name: "john_session"
  - phone_number: "+919876543210"
  - status: "connected"
```

---

## 📊 What Each Role Sees

### Dashboard View by Role:

#### TENANT ADMIN Dashboard:
```
┌─────────────────────────────────────┐
│ Dashboard                    [Logout]│
├─────────────────────────────────────┤
│ 📊 Overview                         │
│   - Total Conversations: 1,234      │
│   - All Team Members                │
│   - All Orders: ₹5,67,890           │
│                                      │
│ 📧 Email (All)                      │
│ 💬 Conversations (All)              │
│ 📦 Orders (All)                     │
│ 👥 Team Management ← Can add/remove │
│ ⚙️  Settings (Full Access)          │
│ 📈 Analytics (Company-wide)         │
└─────────────────────────────────────┘
```

#### SALESMAN Dashboard:
```
┌─────────────────────────────────────┐
│ Dashboard                    [Logout]│
├─────────────────────────────────────┤
│ 📊 My Performance                   │
│   - My Conversations: 45            │
│   - My Orders: ₹1,23,450            │
│                                      │
│ 📧 Email (Mine Only)  ← Filtered!   │
│ 💬 Conversations (Mine Only)        │
│ 📦 Orders (Mine Only)               │
│ 👥 Team (View Only)                 │
│ ⚙️  Settings (Read Only)            │
│ 📈 Analytics (My Stats Only)        │
└─────────────────────────────────────┘
```

---

## 🔧 Technical Implementation

### Database Schema Changes:

#### 1. Enhanced `sales_users` table:
```sql
ALTER TABLE sales_users ADD COLUMN email TEXT;
ALTER TABLE sales_users ADD COLUMN password_hash TEXT;
ALTER TABLE sales_users ADD COLUMN gmail_refresh_token TEXT;
ALTER TABLE sales_users ADD COLUMN gmail_access_token TEXT;
ALTER TABLE sales_users ADD COLUMN gmail_token_expiry TEXT;
ALTER TABLE sales_users ADD COLUMN last_login_at TEXT;
ALTER TABLE sales_users ADD COLUMN invitation_token TEXT;
ALTER TABLE sales_users ADD COLUMN invitation_sent_at TEXT;
ALTER TABLE sales_users ADD COLUMN invitation_accepted_at TEXT;
```

#### 2. New `user_sessions` table:
```sql
CREATE TABLE user_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  session_token TEXT UNIQUE,
  expires_at TEXT,
  created_at TEXT DEFAULT (DATETIME('now')),
  last_activity_at TEXT
);
```

### New API Endpoints:

```javascript
// User Management
POST   /api/users/invite           // Send invitation
POST   /api/users/accept-invite    // Accept invitation
POST   /api/users/login            // Email/password login
POST   /api/users/logout           // Invalidate session
GET    /api/users/me               // Get current user info
PUT    /api/users/:id              // Update user
DELETE /api/users/:id              // Deactivate user

// Email per user
POST   /api/users/:id/connect-gmail    // OAuth for salesman
GET    /api/users/:id/emails            // Get salesman's emails
POST   /api/users/:id/sync-emails       // Manual sync

// WhatsApp per user (already exists!)
POST   /api/whatsapp-web/connect        // Connect session
GET    /api/whatsapp-web/sessions       // List sessions
```

---

## 🎯 Quick Start Guide

### For Business Owners (Tenant Admins):

**Day 1: Set up your account**
1. Register via WhatsApp: Send "register"
2. Complete business profile
3. Login to dashboard

**Day 2: Add your team**
1. Go to Team Management
2. Add first salesman:
   - Name: "Rahul Kumar"
   - Email: "rahul@yourcompany.com"
   - Phone: "+919876543210"
   - Role: "Salesman"
3. Click "Send Invitation"

**Day 3: Configure**
1. Each salesman connects their Gmail
2. Each salesman connects their WhatsApp Web
3. System starts routing emails/messages

### For Salespeople:

**After receiving invitation:**
1. Click invitation link from WhatsApp/Email
2. Set your password
3. Login to dashboard
4. Connect Gmail:
   - Settings → Email Integration → Connect
5. Connect WhatsApp Web:
   - WhatsApp Web tab → Scan QR
6. Start receiving your assigned leads!

---

## 🚨 Important Security Notes

1. **Passwords**: Hashed with bcrypt (12 rounds)
2. **Sessions**: JWT tokens, expire after 7 days
3. **Email OAuth**: Tokens encrypted in database
4. **WhatsApp Sessions**: Encrypted auth data
5. **API Keys**: SHA-256 hashed, prefix-only stored

---

## 📞 Support

Need help setting up multi-user access?
- WhatsApp: Send "help users" to bot
- Email: support@saksolution.com
- Dashboard: Settings → Help Center
