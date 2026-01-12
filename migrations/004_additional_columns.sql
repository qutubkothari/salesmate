-- Migration 004: Additional Missing Columns
-- Date: 2026-01-12

-- Add missing columns to tenants table
ALTER TABLE tenants ADD COLUMN zoho_organization_id TEXT;

-- Add missing columns to onboarding_messages table
ALTER TABLE onboarding_messages ADD COLUMN delay_hours INTEGER DEFAULT 0;
