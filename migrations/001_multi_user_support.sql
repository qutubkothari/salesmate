-- Database Migration: Multi-User Support & Enhanced Features
-- Run this to upgrade your existing database

-- ============================================
-- 1. Enhanced Sales Users Table
-- ============================================

-- Add authentication fields
ALTER TABLE sales_users ADD COLUMN email TEXT;
ALTER TABLE sales_users ADD COLUMN password_hash TEXT;
ALTER TABLE sales_users ADD COLUMN last_login_at TEXT;

-- Add invitation system
ALTER TABLE sales_users ADD COLUMN invitation_token TEXT;
ALTER TABLE sales_users ADD COLUMN invitation_sent_at TEXT;
ALTER TABLE sales_users ADD COLUMN invitation_accepted_at TEXT;
ALTER TABLE sales_users ADD COLUMN invited_by TEXT; -- user_id of inviter

-- Add Gmail integration per user
ALTER TABLE sales_users ADD COLUMN gmail_connected_email TEXT;
ALTER TABLE sales_users ADD COLUMN gmail_refresh_token TEXT;
ALTER TABLE sales_users ADD COLUMN gmail_access_token TEXT;
ALTER TABLE sales_users ADD COLUMN gmail_token_expiry TEXT;
ALTER TABLE sales_users ADD COLUMN gmail_history_id TEXT;
ALTER TABLE sales_users ADD COLUMN gmail_watch_expiry TEXT;

-- Add status and metadata
ALTER TABLE sales_users ADD COLUMN status TEXT DEFAULT 'active'; -- active, inactive, pending
ALTER TABLE sales_users ADD COLUMN avatar_url TEXT;
ALTER TABLE sales_users ADD COLUMN timezone TEXT DEFAULT 'Asia/Kolkata';
ALTER TABLE sales_users ADD COLUMN language TEXT DEFAULT 'en';

-- Create unique index on email per tenant
CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_users_tenant_email 
ON sales_users(tenant_id, email) WHERE email IS NOT NULL;

-- Create index for invitation tokens
CREATE INDEX IF NOT EXISTS idx_sales_users_invitation_token 
ON sales_users(invitation_token) WHERE invitation_token IS NOT NULL;

-- ============================================
-- 2. User Sessions Table (NEW)
-- ============================================

CREATE TABLE IF NOT EXISTS user_sessions (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  session_token TEXT UNIQUE NOT NULL,
  device_info TEXT, -- User agent, IP, etc.
  expires_at TEXT NOT NULL,
  created_at TEXT DEFAULT (DATETIME('now')),
  last_activity_at TEXT DEFAULT (DATETIME('now')),
  FOREIGN KEY (user_id) REFERENCES sales_users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_token ON user_sessions(session_token);
CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_expires ON user_sessions(expires_at);

-- ============================================
-- 3. Enhanced Email Enquiries Table
-- ============================================

-- Add AI classification fields
ALTER TABLE email_enquiries ADD COLUMN category TEXT; -- product_enquiry, support, spam, general
ALTER TABLE email_enquiries ADD COLUMN intent TEXT; -- purchase, inquiry, complaint, other
ALTER TABLE email_enquiries ADD COLUMN confidence_score REAL; -- 0.0 to 1.0
ALTER TABLE email_enquiries ADD COLUMN extracted_products TEXT; -- JSON array
ALTER TABLE email_enquiries ADD COLUMN is_relevant INTEGER DEFAULT 1;

-- Link email to specific salesman
ALTER TABLE email_enquiries ADD COLUMN salesman_id TEXT;
ALTER TABLE email_enquiries ADD COLUMN auto_assigned INTEGER DEFAULT 0;
ALTER TABLE email_enquiries ADD COLUMN assignment_reason TEXT;

-- Add reply tracking
ALTER TABLE email_enquiries ADD COLUMN replied_at TEXT;
ALTER TABLE email_enquiries ADD COLUMN reply_count INTEGER DEFAULT 0;

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_email_enquiries_salesman 
ON email_enquiries(tenant_id, salesman_id);

CREATE INDEX IF NOT EXISTS idx_email_enquiries_category 
ON email_enquiries(tenant_id, category);

CREATE INDEX IF NOT EXISTS idx_email_enquiries_assigned 
ON email_enquiries(tenant_id, assigned_to) 
WHERE assigned_to IS NOT NULL;

-- ============================================
-- 4. Enhanced Conversations Table  
-- ============================================

-- Add salesman ownership
ALTER TABLE conversations ADD COLUMN salesman_id TEXT;
ALTER TABLE conversations ADD COLUMN auto_assigned_to_salesman INTEGER DEFAULT 0;

-- Create index
CREATE INDEX IF NOT EXISTS idx_conversations_salesman 
ON conversations(tenant_id, salesman_id) 
WHERE salesman_id IS NOT NULL;

-- ============================================
-- 5. Enhanced Orders Table
-- ============================================

-- Add salesman tracking
ALTER TABLE orders ADD COLUMN salesman_id TEXT;
ALTER TABLE orders ADD COLUMN commission_rate REAL; -- For sales commission
ALTER TABLE orders ADD COLUMN commission_amount REAL;

-- Create index
CREATE INDEX IF NOT EXISTS idx_orders_salesman 
ON orders(tenant_id, salesman_id) 
WHERE salesman_id IS NOT NULL;

-- ============================================
-- 6. Product Expertise Table (NEW)
-- ============================================

CREATE TABLE IF NOT EXISTS product_expertise (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  tenant_id TEXT NOT NULL,
  salesman_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  expertise_level TEXT DEFAULT 'basic', -- basic, intermediate, expert
  assigned_at TEXT DEFAULT (DATETIME('now')),
  UNIQUE(tenant_id, salesman_id, product_id),
  FOREIGN KEY (salesman_id) REFERENCES sales_users(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_product_expertise_salesman 
ON product_expertise(salesman_id);

CREATE INDEX IF NOT EXISTS idx_product_expertise_product 
ON product_expertise(product_id);

-- ============================================
-- 7. Activity Log Table (NEW)
-- ============================================

CREATE TABLE IF NOT EXISTS activity_log (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  tenant_id TEXT NOT NULL,
  user_id TEXT,
  action_type TEXT NOT NULL, -- login, email_assigned, order_created, etc.
  resource_type TEXT, -- email, conversation, order, product
  resource_id TEXT,
  metadata TEXT, -- JSON
  ip_address TEXT,
  user_agent TEXT,
  created_at TEXT DEFAULT (DATETIME('now'))
);

CREATE INDEX IF NOT EXISTS idx_activity_log_tenant_user 
ON activity_log(tenant_id, user_id);

CREATE INDEX IF NOT EXISTS idx_activity_log_created 
ON activity_log(created_at);

CREATE INDEX IF NOT EXISTS idx_activity_log_resource 
ON activity_log(resource_type, resource_id);

-- ============================================
-- 8. Email Classification Cache (NEW)
-- ============================================

CREATE TABLE IF NOT EXISTS email_classification_cache (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  email_hash TEXT UNIQUE NOT NULL, -- MD5 of subject + body
  category TEXT,
  intent TEXT,
  confidence_score REAL,
  extracted_keywords TEXT, -- JSON array
  is_relevant INTEGER,
  classified_at TEXT DEFAULT (DATETIME('now')),
  model_version TEXT
);

CREATE INDEX IF NOT EXISTS idx_email_classification_hash 
ON email_classification_cache(email_hash);

-- ============================================
-- 9. Role Permissions Table (NEW)
-- ============================================

CREATE TABLE IF NOT EXISTS role_permissions (
  role TEXT PRIMARY KEY, -- super_admin, tenant_admin, sales_manager, salesman
  permissions TEXT NOT NULL, -- JSON array of permission strings
  created_at TEXT DEFAULT (DATETIME('now')),
  updated_at TEXT DEFAULT (DATETIME('now'))
);

-- Insert default role permissions
INSERT OR REPLACE INTO role_permissions (role, permissions) VALUES
('super_admin', '["*"]'),
('tenant_admin', '["view_all_emails","assign_emails","delete_emails","manage_users","view_all_conversations","manage_products","view_all_orders","manage_settings","view_analytics"]'),
('sales_manager', '["view_team_emails","assign_team_emails","view_team_conversations","view_team_orders","view_products","view_team_analytics"]'),
('salesman', '["view_own_emails","reply_emails","view_own_conversations","view_own_orders","view_products","view_own_analytics"]');

-- ============================================
-- 10. Update existing data
-- ============================================

-- Set default salesman_id for existing conversations based on assigned_to
UPDATE conversations 
SET salesman_id = assigned_to 
WHERE assigned_to IS NOT NULL AND salesman_id IS NULL;

-- Mark existing emails as relevant
UPDATE email_enquiries 
SET is_relevant = 1, category = 'general' 
WHERE is_relevant IS NULL;

-- ============================================
-- VERIFICATION QUERIES
-- ============================================

-- Check sales_users table structure
-- PRAGMA table_info(sales_users);

-- Check new tables
-- SELECT name FROM sqlite_master WHERE type='table' AND name IN ('user_sessions', 'product_expertise', 'activity_log', 'email_classification_cache', 'role_permissions');

-- Count users per role
-- SELECT role, COUNT(*) as count FROM sales_users WHERE is_active = 1 GROUP BY role;

-- Check email distribution
-- SELECT 
--   COALESCE(s.name, 'Unassigned') as salesman,
--   COUNT(*) as email_count
-- FROM email_enquiries e
-- LEFT JOIN sales_users s ON e.salesman_id = s.id
-- GROUP BY salesman_id;
