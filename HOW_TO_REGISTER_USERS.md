# How to Register Multiple Admins and Salesmen in Your Account

## Quick Start Guide

### Current Status
You now have a **complete multi-user authentication system** with role-based access control (RBAC) installed in your Salesmate application. This guide will show you how to:

1. ✅ Register multiple admins
2. ✅ Invite salesmen
3. ✅ Manage user permissions
4. ✅ Control access to emails, WhatsApp, and orders

---

## Step 1: Run the Database Migration

Before you can start inviting users, you need to update your database schema:

### On Your Server (Hostinger VPS):

```bash
# Connect to your server via SSH
ssh root@your-vps-ip

# Navigate to your app directory
cd /root/salesmate

# Run the migration
sqlite3 salesmate.db < migrations/001_multi_user_support.sql

# Verify the migration
sqlite3 salesmate.db "SELECT * FROM sqlite_master WHERE type='table' AND name='user_sessions';"
```

### Expected Output:
You should see confirmation that the following tables were created or modified:
- ✅ `sales_users` (enhanced with email, password fields)
- ✅ `user_sessions` (new - for JWT-like sessions)
- ✅ `email_enquiries` (enhanced with AI classification)
- ✅ `product_expertise` (new - for salesman specialization)
- ✅ `activity_log` (new - for audit trail)

---

## Step 2: Invite Your First Admin (via API)

Since you don't have a UI for user management yet, use these API calls to get started:

### Option A: Using cURL (from terminal)

```bash
# First, get your tenant ID and web_auth_token from tenants table
sqlite3 salesmate.db "SELECT id, web_auth_token FROM tenants LIMIT 1;"

# Then invite a tenant admin (replace YOUR_TOKEN with actual token)
curl -X POST http://localhost:8081/api/users/invite \
  -H "Content-Type: application/json" \
  -H "x-auth-token: YOUR_WEB_AUTH_TOKEN" \
  -d '{
    "email": "admin@yourbusiness.com",
    "name": "Admin Name",
    "role": "tenant_admin"
  }'
```

### Option B: Using PowerShell

```powershell
# Get your auth token first
$token = "YOUR_WEB_AUTH_TOKEN"

# Invite admin
$body = @{
    email = "admin@yourbusiness.com"
    name = "Admin Name"
    role = "tenant_admin"
} | ConvertTo-Json

Invoke-RestMethod -Uri "http://localhost:8081/api/users/invite" `
    -Method POST `
    -Headers @{ "x-auth-token" = $token; "Content-Type" = "application/json" } `
    -Body $body
```

### Response:
```json
{
  "success": true,
  "user": {
    "id": 1,
    "email": "admin@yourbusiness.com",
    "name": "Admin Name",
    "role": "tenant_admin"
  },
  "inviteUrl": "http://localhost:8081/accept-invitation?token=abc123..."
}
```

**Important:** Copy the `inviteUrl` and send it to the invited user via email/WhatsApp.

---

## Step 3: Accept the Invitation

The invited user should:

1. Click the invitation link
2. They'll see a beautiful invitation page
3. Set their password (minimum 8 characters)
4. Automatically logged in and redirected to dashboard

### What They See:
```
🚀 Salesmate
Welcome to the Team!

Name: Admin Name
Email: admin@yourbusiness.com
Role: TENANT ADMIN

[Create Password: _________]
[Confirm Password: _________]

[Complete Setup]
```

---

## Step 4: Invite Sales Managers and Salesmen

Once an admin is logged in, they can invite more users:

### Invite a Sales Manager

```bash
curl -X POST http://localhost:8081/api/users/invite \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer SESSION_TOKEN_FROM_LOGIN" \
  -d '{
    "email": "manager@yourbusiness.com",
    "name": "Sales Manager Name",
    "role": "sales_manager"
  }'
```

### Invite a Salesman

```bash
curl -X POST http://localhost:8081/api/users/invite \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer SESSION_TOKEN_FROM_LOGIN" \
  -d '{
    "email": "salesman@yourbusiness.com",
    "name": "Salesman Name",
    "role": "salesman"
  }'
```

---

## Step 5: User Login

Users can log in at: `http://localhost:8081/user-login.html`

### Login Form:
```
🚀 Salesmate
Sign in to your account

Email Address: ___________
Password: ___________

[Sign In]

OR

Using the old system?
[Sign in with Magic Token]
```

### What Happens:
1. User enters email & password
2. System validates credentials
3. Creates a secure session token
4. Stores token in localStorage and cookies
5. Redirects to dashboard

---

## Role Hierarchy & Permissions

### 🔴 Super Admin (System-wide)
- Can do EVERYTHING across ALL tenants
- Manage all tenants
- Invite tenant admins
- Access all data

### 🟠 Tenant Admin (Your Business Owner)
- Can do EVERYTHING in their tenant
- Invite managers and salesmen
- View all emails, conversations, orders
- Manage products, discounts, settings
- Access all analytics

### 🟡 Sales Manager (Team Lead)
- View team's emails, conversations, orders
- Assign emails to team members
- Send broadcasts
- View team analytics
- Cannot manage products or settings

### 🟢 Salesman (Individual Sales Rep)
- View ONLY their own emails, conversations, orders
- Reply to assigned emails
- Create orders
- View their own analytics
- Cannot see other salesmen's data

---

## What Each Role Sees

### Dashboard Access Control

**Tenant Admin sees:**
- All conversations (every customer)
- All emails (from all salesmen)
- All orders (entire business)
- All WhatsApp sessions
- Team management
- Settings & configuration

**Sales Manager sees:**
- Team conversations
- Team emails (all salesmen under them)
- Team orders
- Team analytics
- Cannot change settings

**Salesman sees:**
- ONLY their own conversations
- ONLY emails assigned to them
- ONLY orders they created
- Their own analytics
- Cannot see other salesmen's work

---

## Email System Integration

### How Emails are Assigned:

1. **AI Classification** (Coming soon)
   - System reads email content
   - Identifies product mentioned
   - Finds salesman expert in that product
   - Auto-assigns email

2. **Manual Assignment** (Available now)
   - Manager/Admin opens email
   - Clicks "Assign to..." 
   - Selects salesman from dropdown
   - Email appears in that salesman's inbox

### Per-Salesman Gmail Accounts:

Each salesman will be able to connect their own Gmail:

```bash
# Admin enables Gmail for a salesman
curl -X PUT http://localhost:8081/api/users/123 \
  -H "Authorization: Bearer ADMIN_TOKEN" \
  -d '{
    "gmail_access_token": "ya29.xxx",
    "gmail_refresh_token": "xxx",
    "gmail_email": "salesman@company.com"
  }'
```

Now emails from `salesman@company.com` automatically appear in that salesman's dashboard.

---

## WhatsApp Multi-Session Setup

### Already Working! ✅

Your WhatsApp system already supports multiple sessions per salesman:

```sql
-- Link WhatsApp session to salesman
UPDATE whatsapp_connections 
SET salesman_id = 5 
WHERE session_name = 'salesman-abc';
```

### What This Means:
- Salesman A has their own WhatsApp number
- Salesman B has different WhatsApp number
- Each only sees their own customers
- Managers see all conversations

---

## API Endpoints Reference

### Authentication
- `POST /api/users/login` - Login with email/password
- `POST /api/users/logout` - Logout current session
- `GET /api/users/me` - Get current user info

### User Management
- `POST /api/users/invite` - Invite new user
- `POST /api/users/accept-invite` - Accept invitation
- `GET /api/users` - List all users (filtered by role)
- `GET /api/users/:id` - Get specific user
- `PUT /api/users/:id` - Update user
- `DELETE /api/users/:id` - Deactivate user
- `POST /api/users/:id/change-password` - Change password

### Permissions Required
Most endpoints check permissions automatically:
- `INVITE_USERS` - Can send invitations
- `MANAGE_USERS` - Can edit/delete users
- `VIEW_TEAM` - Can see team members
- `VIEW_ALL_EMAILS` - Can see all emails
- `VIEW_OWN_EMAILS` - Can see only assigned emails

---

## Security Features

### Password Security
- ✅ Bcrypt hashing (12 rounds)
- ✅ Minimum 8 characters
- ✅ Stored as hash, never plain text

### Session Management
- ✅ JWT-style tokens (64 characters)
- ✅ 24-hour expiry (configurable)
- ✅ Automatic cleanup of expired sessions

### Invitation System
- ✅ Secure random tokens (32 bytes)
- ✅ 7-day expiration
- ✅ One-time use only

### Access Control
- ✅ Role-based permissions
- ✅ Tenant isolation
- ✅ Data filtering by role

---

## Troubleshooting

### "Invalid or expired session"
**Solution:** User needs to log in again. Session expired after 24 hours.

### "Access denied" when inviting users
**Solution:** Only admins can invite. Check user role.

### "Invitation token not found"
**Solution:** Invitation expired (7 days). Resend invitation.

### Can't see emails/orders
**Solution:** Check user role. Salesmen only see assigned data.

---

## Next Steps (Development Roadmap)

### Week 1-2: AI Email Classification ⏳
- Implement email content analysis
- Auto-categorize: sales inquiry, support, billing
- Auto-assign to relevant salesman

### Week 3: Per-Salesman Gmail OAuth ⏳
- UI for Gmail connection
- OAuth flow per user
- Automatic email syncing

### Week 4: User Management UI ⏳
- Admin panel for inviting users
- Team overview dashboard
- Permission management interface

### Week 5: Advanced Features ⏳
- Product expertise tagging
- Auto-assignment rules
- Performance analytics per salesman

---

## FAQ

**Q: Can I have multiple tenant admins?**
A: Yes! Invite as many tenant admins as you need.

**Q: How do I reset a user's password?**
A: Admins can use `POST /api/users/:id/change-password` without requiring current password.

**Q: Can salesmen see each other's data?**
A: No. Complete isolation. Only managers/admins see cross-team data.

**Q: What happens if I delete a user?**
A: User is deactivated (soft delete). Their historical data remains for audit.

**Q: Can I change someone's role?**
A: Yes. Use `PUT /api/users/:id` with `{"role": "new_role"}`.

---

## Support

If you encounter issues:
1. Check logs: `pm2 logs salesmate`
2. Verify database migration completed
3. Confirm user has correct role
4. Check session token is valid

For urgent help, contact your development team with:
- Error message
- User role attempting action
- API endpoint called
- Expected vs. actual behavior

---

## Summary Checklist

✅ Database migration completed
✅ First admin invited
✅ Admin accepted invitation
✅ Admin logged in successfully
✅ Sales manager invited
✅ Salesmen invited
✅ Email assignment working
✅ WhatsApp multi-session working
✅ Role-based access verified

**Your multi-user Salesmate system is now live!** 🎉
