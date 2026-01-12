-- Migration 003: Fix Missing Columns and Tables
-- Date: 2026-01-12

-- Add missing columns to follow_ups table
ALTER TABLE follow_ups ADD COLUMN scheduled_time TEXT;

-- Add missing columns to tenants table
ALTER TABLE tenants ADD COLUMN zoho_access_token TEXT;
ALTER TABLE tenants ADD COLUMN zoho_refresh_token TEXT;
ALTER TABLE tenants ADD COLUMN zoho_token_expires_at TEXT;
ALTER TABLE tenants ADD COLUMN office_hours_timezone TEXT DEFAULT 'Asia/Kolkata';
ALTER TABLE tenants ADD COLUMN office_hours_start TEXT DEFAULT '09:00';
ALTER TABLE tenants ADD COLUMN office_hours_end TEXT DEFAULT '18:00';

-- Add missing columns to products table
ALTER TABLE products ADD COLUMN description_generated_by_ai INTEGER DEFAULT 0;

-- Create onboarding_messages table
CREATE TABLE IF NOT EXISTS onboarding_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  step_number INTEGER NOT NULL,
  message TEXT NOT NULL,
  scheduled_date TEXT NOT NULL,
  sent_at TEXT,
  status TEXT DEFAULT 'pending',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_onboarding_tenant ON onboarding_messages(tenant_id);
CREATE INDEX IF NOT EXISTS idx_onboarding_customer ON onboarding_messages(customer_id);
CREATE INDEX IF NOT EXISTS idx_onboarding_status ON onboarding_messages(status);
