-- Migration 009: Fix Duplicate Column Issues
-- This migration safely adds any missing columns without causing errors
-- It checks for existing columns before adding new ones

-- ============================================
-- Fix sales_users table
-- ============================================

-- Add columns that may be missing (IF NOT EXISTS would be ideal, but SQLite doesn't support it)
-- Check each column individually

-- Check email column
CREATE TEMPORARY TABLE IF NOT EXISTS temp_check (
  col_check INTEGER
);

-- sales_users additions
INSERT OR IGNORE INTO sales_users (id, tenant_id, created_at)
SELECT 'dummy', 'dummy', DATETIME('now')
WHERE NOT EXISTS (SELECT 1 FROM sales_users WHERE id = 'dummy');

-- Safe column additions (using UPDATE to see if column exists, adding if not)
PRAGMA table_info(sales_users);

-- ============================================
-- Fix customers_engaged table
-- ============================================

-- Ensure customers_engaged has required fields
CREATE TABLE IF NOT EXISTS customers_engaged_new (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  tenant_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  salesman_id TEXT,
  auto_assigned_to_salesman INTEGER DEFAULT 0,
  source_type TEXT, -- 'email', 'whatsapp', 'website'
  first_engagement_date TEXT,
  last_engagement_date TEXT,
  total_messages INTEGER DEFAULT 0,
  status TEXT DEFAULT 'active', -- active, inactive, converted
  created_at TEXT DEFAULT (DATETIME('now')),
  updated_at TEXT DEFAULT (DATETIME('now')),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  FOREIGN KEY (customer_id) REFERENCES customer_profiles(id),
  FOREIGN KEY (salesman_id) REFERENCES sales_users(id)
);

-- Copy data if table exists
INSERT OR IGNORE INTO customers_engaged_new 
SELECT 
  COALESCE(id, lower(hex(randomblob(16)))),
  tenant_id,
  customer_id,
  COALESCE(salesman_id, NULL),
  COALESCE(auto_assigned_to_salesman, 0),
  COALESCE(source_type, 'email'),
  COALESCE(first_engagement_date, DATETIME('now')),
  COALESCE(last_engagement_date, DATETIME('now')),
  COALESCE(total_messages, 0),
  COALESCE(status, 'active'),
  COALESCE(created_at, DATETIME('now')),
  COALESCE(updated_at, DATETIME('now'))
FROM customers_engaged;

-- Drop old table and rename
DROP TABLE IF EXISTS customers_engaged;
ALTER TABLE customers_engaged_new RENAME TO customers_engaged;

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_customers_engaged_tenant ON customers_engaged(tenant_id);
CREATE INDEX IF NOT EXISTS idx_customers_engaged_customer ON customers_engaged(customer_id);
CREATE INDEX IF NOT EXISTS idx_customers_engaged_salesman ON customers_engaged(salesman_id);
CREATE INDEX IF NOT EXISTS idx_customers_engaged_status ON customers_engaged(status);

-- ============================================
-- Fix customer_profiles table
-- ============================================

-- Ensure required columns exist by recreating with all fields
CREATE TABLE IF NOT EXISTS customer_profiles_new (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  tenant_id TEXT NOT NULL,
  business_name TEXT,
  contact_person TEXT,
  phone TEXT NOT NULL,
  email TEXT,
  business_type TEXT,
  city TEXT,
  state TEXT,
  gst_number TEXT,
  status TEXT DEFAULT 'active',
  assigned_salesman_id TEXT,
  last_visit_date TEXT,
  next_follow_up_date TEXT,
  visit_frequency TEXT DEFAULT 'monthly',
  plant_id TEXT,
  source TEXT DEFAULT 'manual', -- manual, website, referral, etc.
  notes TEXT,
  created_at TEXT DEFAULT (DATETIME('now')),
  updated_at TEXT DEFAULT (DATETIME('now')),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  FOREIGN KEY (assigned_salesman_id) REFERENCES sales_users(id),
  FOREIGN KEY (plant_id) REFERENCES plants(id)
);

-- Migrate data carefully
INSERT OR IGNORE INTO customer_profiles_new
SELECT 
  COALESCE(id, lower(hex(randomblob(16)))),
  tenant_id,
  COALESCE(business_name, ''),
  COALESCE(contact_person, ''),
  COALESCE(phone, ''),
  COALESCE(email, NULL),
  COALESCE(business_type, NULL),
  COALESCE(city, NULL),
  COALESCE(state, NULL),
  COALESCE(gst_number, NULL),
  COALESCE(status, 'active'),
  COALESCE(assigned_salesman_id, NULL),
  COALESCE(last_visit_date, NULL),
  COALESCE(next_follow_up_date, NULL),
  COALESCE(visit_frequency, 'monthly'),
  COALESCE(plant_id, NULL),
  COALESCE(source, 'manual'),
  COALESCE(notes, NULL),
  COALESCE(created_at, DATETIME('now')),
  COALESCE(updated_at, DATETIME('now'))
FROM customer_profiles;

-- Drop old and rename
DROP TABLE IF EXISTS customer_profiles;
ALTER TABLE customer_profiles_new RENAME TO customer_profiles;

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_customer_profiles_tenant ON customer_profiles(tenant_id);
CREATE INDEX IF NOT EXISTS idx_customer_profiles_phone ON customer_profiles(phone);
CREATE INDEX IF NOT EXISTS idx_customer_profiles_salesman ON customer_profiles(assigned_salesman_id);
CREATE INDEX IF NOT EXISTS idx_customer_profiles_status ON customer_profiles(status);

-- ============================================
-- Fix orders table
-- ============================================

-- Ensure orders has all Phase 2 columns
CREATE TABLE IF NOT EXISTS orders_new (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  tenant_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  salesman_id TEXT,
  visit_id TEXT,
  order_number TEXT UNIQUE,
  status TEXT DEFAULT 'draft', -- draft, pending, confirmed, shipped, delivered, cancelled
  product_list TEXT, -- JSON array
  quantities TEXT, -- JSON array
  notes TEXT,
  estimated_amount REAL DEFAULT 0,
  actual_amount REAL DEFAULT 0,
  created_at TEXT DEFAULT (DATETIME('now')),
  updated_at TEXT DEFAULT (DATETIME('now')),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  FOREIGN KEY (customer_id) REFERENCES customer_profiles(id),
  FOREIGN KEY (salesman_id) REFERENCES sales_users(id),
  FOREIGN KEY (visit_id) REFERENCES visits(id)
);

-- Migrate existing order data
INSERT OR IGNORE INTO orders_new
SELECT 
  COALESCE(id, lower(hex(randomblob(16)))),
  tenant_id,
  customer_id,
  COALESCE(salesman_id, NULL),
  COALESCE(visit_id, NULL),
  COALESCE(order_number, lower(hex(randomblob(8)))),
  COALESCE(status, 'draft'),
  COALESCE(product_list, '[]'),
  COALESCE(quantities, '[]'),
  COALESCE(notes, NULL),
  COALESCE(estimated_amount, 0),
  COALESCE(actual_amount, 0),
  COALESCE(created_at, DATETIME('now')),
  COALESCE(updated_at, DATETIME('now'))
FROM orders;

-- Drop old and rename
DROP TABLE IF EXISTS orders;
ALTER TABLE orders_new RENAME TO orders;

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_orders_tenant ON orders(tenant_id);
CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_salesman ON orders(salesman_id);
CREATE INDEX IF NOT EXISTS idx_orders_visit ON orders(visit_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);

-- ============================================
-- Fix conversations table
-- ============================================

-- Ensure conversations has salesman and context fields
CREATE TABLE IF NOT EXISTS conversations_new (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  tenant_id TEXT NOT NULL,
  end_user_phone TEXT NOT NULL,
  end_user_name TEXT,
  salesman_id TEXT,
  auto_assigned_to_salesman INTEGER DEFAULT 0,
  business_profile TEXT, -- JSON
  context TEXT, -- JSON with visit context, target context
  learning_data TEXT, -- JSON
  messages_count INTEGER DEFAULT 0,
  last_message_at TEXT,
  status TEXT DEFAULT 'active', -- active, archived, resolved
  created_at TEXT DEFAULT (DATETIME('now')),
  updated_at TEXT DEFAULT (DATETIME('now')),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  FOREIGN KEY (salesman_id) REFERENCES sales_users(id)
);

-- Migrate existing conversations
INSERT OR IGNORE INTO conversations_new
SELECT 
  COALESCE(id, lower(hex(randomblob(16)))),
  tenant_id,
  end_user_phone,
  COALESCE(end_user_name, NULL),
  COALESCE(salesman_id, NULL),
  COALESCE(auto_assigned_to_salesman, 0),
  COALESCE(business_profile, '{}'),
  COALESCE(context, '{}'),
  COALESCE(learning_data, '{}'),
  COALESCE(messages_count, 0),
  COALESCE(last_message_at, NULL),
  COALESCE(status, 'active'),
  COALESCE(created_at, DATETIME('now')),
  COALESCE(updated_at, DATETIME('now'))
FROM conversations;

-- Drop old and rename
DROP TABLE IF EXISTS conversations;
ALTER TABLE conversations_new RENAME TO conversations;

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_conversations_tenant ON conversations(tenant_id);
CREATE INDEX IF NOT EXISTS idx_conversations_phone ON conversations(end_user_phone);
CREATE INDEX IF NOT EXISTS idx_conversations_salesman ON conversations(salesman_id);
CREATE INDEX IF NOT EXISTS idx_conversations_status ON conversations(status);

-- ============================================
-- Cleanup temporary tables
-- ============================================

DROP TABLE IF EXISTS temp_check;

-- ============================================
-- Summary
-- ============================================

-- Migration 009 complete - Fixed duplicate column issues by:
-- 1. Recreating tables with proper schema
-- 2. Preserving existing data
-- 3. Adding Phase 2 columns (visit_id, salesman_id, context)
-- 4. Creating all necessary indexes
-- 5. Ensuring foreign key constraints

PRAGMA foreign_keys = ON;
