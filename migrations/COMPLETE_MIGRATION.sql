-- =====================================================
-- SALESMATE AI - COMPLETE MIGRATION SCRIPT
-- Run this in Supabase SQL Editor
-- Date: January 30, 2026
-- Features: Follow-ups, Push Notifications, Location, Commission
-- =====================================================

-- =====================================================
-- 1. FOLLOW-UP SYSTEM
-- =====================================================

ALTER TABLE conversations_new 
ADD COLUMN IF NOT EXISTS follow_up_at TIMESTAMP,
ADD COLUMN IF NOT EXISTS follow_up_note TEXT,
ADD COLUMN IF NOT EXISTS follow_up_type TEXT,
ADD COLUMN IF NOT EXISTS follow_up_priority TEXT DEFAULT 'medium',
ADD COLUMN IF NOT EXISTS follow_up_completed_at TIMESTAMP,
ADD COLUMN IF NOT EXISTS follow_up_created_by TEXT,
ADD COLUMN IF NOT EXISTS follow_up_reminder_sent_at TIMESTAMP,
ADD COLUMN IF NOT EXISTS follow_up_overdue_alert_sent_at TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_conversations_followup_at 
ON conversations_new(follow_up_at) WHERE follow_up_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_followup_salesman 
ON conversations_new(salesman_id, follow_up_at) WHERE follow_up_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_followup_reminders 
ON conversations_new(follow_up_at) 
WHERE follow_up_at IS NOT NULL 
  AND follow_up_completed_at IS NULL
  AND salesman_id IS NOT NULL;

-- =====================================================
-- 2. PUSH NOTIFICATION SYSTEM
-- =====================================================

CREATE TABLE IF NOT EXISTS salesman_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  salesman_id UUID NOT NULL REFERENCES salesmen(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  device_token TEXT NOT NULL UNIQUE,
  platform TEXT NOT NULL CHECK (platform IN ('ios', 'android')),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  last_active_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_salesman_devices_salesman 
ON salesman_devices(salesman_id) WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_salesman_devices_tenant 
ON salesman_devices(tenant_id);

CREATE TABLE IF NOT EXISTS notification_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  salesman_id UUID NOT NULL REFERENCES salesmen(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  notification_type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  data JSONB,
  sent_at TIMESTAMP DEFAULT NOW(),
  success BOOLEAN DEFAULT true,
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_notification_logs_salesman 
ON notification_logs(salesman_id, sent_at DESC);

-- =====================================================
-- 3. LOCATION TRACKING & GEO-FENCING
-- =====================================================

CREATE TABLE IF NOT EXISTS salesman_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  salesman_id UUID NOT NULL REFERENCES salesmen(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  latitude DECIMAL(10, 8) NOT NULL,
  longitude DECIMAL(11, 8) NOT NULL,
  accuracy DECIMAL(10, 2),
  recorded_at TIMESTAMP DEFAULT NOW(),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_salesman_locations_salesman 
ON salesman_locations(salesman_id, recorded_at DESC);

CREATE TABLE IF NOT EXISTS customer_visits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  salesman_id UUID NOT NULL REFERENCES salesmen(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES customer_profiles_new(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  visit_type TEXT NOT NULL,
  check_in_time TIMESTAMP NOT NULL,
  check_in_latitude DECIMAL(10, 8) NOT NULL,
  check_in_longitude DECIMAL(11, 8) NOT NULL,
  check_in_accuracy DECIMAL(10, 2),
  check_in_address TEXT,
  check_out_time TIMESTAMP,
  check_out_latitude DECIMAL(10, 8),
  check_out_longitude DECIMAL(11, 8),
  check_out_accuracy DECIMAL(10, 2),
  duration_minutes INTEGER,
  distance_from_customer DECIMAL(10, 2),
  notes TEXT,
  outcome TEXT,
  conversation_id UUID REFERENCES conversations_new(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customer_visits_salesman 
ON customer_visits(salesman_id, check_in_time DESC);

CREATE INDEX IF NOT EXISTS idx_customer_visits_customer 
ON customer_visits(customer_id, check_in_time DESC);

CREATE TABLE IF NOT EXISTS daily_routes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  salesman_id UUID NOT NULL REFERENCES salesmen(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  route_date DATE NOT NULL,
  total_customers INTEGER DEFAULT 0,
  total_distance_km DECIMAL(10, 2),
  estimated_duration_minutes INTEGER,
  optimized_order JSONB,
  optimization_algorithm TEXT,
  optimized_at TIMESTAMP,
  status TEXT DEFAULT 'planned',
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_daily_routes_salesman_date 
ON daily_routes(salesman_id, route_date DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_routes_unique 
ON daily_routes(salesman_id, route_date);

CREATE TABLE IF NOT EXISTS geo_fence_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  rule_name TEXT NOT NULL,
  rule_type TEXT NOT NULL,
  center_latitude DECIMAL(10, 8),
  center_longitude DECIMAL(11, 8),
  radius_meters INTEGER,
  min_visit_duration_minutes INTEGER DEFAULT 5,
  max_distance_from_customer DECIMAL(10, 2) DEFAULT 100.0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

ALTER TABLE customer_profiles_new
ADD COLUMN IF NOT EXISTS latitude DECIMAL(10, 8),
ADD COLUMN IF NOT EXISTS longitude DECIMAL(11, 8),
ADD COLUMN IF NOT EXISTS address_geocoded_at TIMESTAMP;

-- =====================================================
-- 4. COMMISSION TRACKING
-- =====================================================

CREATE TABLE IF NOT EXISTS commission_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  rule_name TEXT NOT NULL,
  commission_type TEXT NOT NULL,
  base_percentage DECIMAL(5, 2),
  fixed_amount DECIMAL(10, 2),
  tiers JSONB,
  applies_to TEXT DEFAULT 'all',
  product_ids TEXT[],
  category_ids TEXT[],
  effective_from DATE,
  effective_to DATE,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_commission_rules_tenant 
ON commission_rules(tenant_id) WHERE is_active = true;

CREATE TABLE IF NOT EXISTS salesman_targets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  salesman_id UUID NOT NULL REFERENCES salesmen(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  target_period TEXT NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  sales_target_amount DECIMAL(12, 2) NOT NULL,
  orders_target_count INTEGER,
  customers_target_count INTEGER,
  bonus_percentage DECIMAL(5, 2),
  bonus_amount DECIMAL(10, 2),
  status TEXT DEFAULT 'active',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_salesman_targets_salesman 
ON salesman_targets(salesman_id, period_start DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_salesman_targets_unique 
ON salesman_targets(salesman_id, target_period, period_start);

CREATE TABLE IF NOT EXISTS commission_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  salesman_id UUID NOT NULL REFERENCES salesmen(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_id TEXT,
  conversation_id UUID REFERENCES conversations_new(id) ON DELETE SET NULL,
  customer_id UUID REFERENCES customer_profiles_new(id) ON DELETE SET NULL,
  sale_amount DECIMAL(12, 2) NOT NULL,
  commission_rate DECIMAL(5, 2) NOT NULL,
  commission_amount DECIMAL(10, 2) NOT NULL,
  rule_id UUID REFERENCES commission_rules(id) ON DELETE SET NULL,
  rule_name TEXT,
  transaction_date DATE NOT NULL,
  transaction_type TEXT DEFAULT 'sale',
  description TEXT,
  payout_status TEXT DEFAULT 'pending',
  payout_id UUID,
  paid_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_commission_transactions_salesman 
ON commission_transactions(salesman_id, transaction_date DESC);

CREATE INDEX IF NOT EXISTS idx_commission_transactions_payout 
ON commission_transactions(payout_status, salesman_id) 
WHERE payout_status = 'pending';

CREATE TABLE IF NOT EXISTS commission_payouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  salesman_id UUID NOT NULL REFERENCES salesmen(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  total_commission DECIMAL(12, 2) NOT NULL,
  total_bonus DECIMAL(10, 2) DEFAULT 0,
  deductions DECIMAL(10, 2) DEFAULT 0,
  net_payout DECIMAL(12, 2) NOT NULL,
  transaction_count INTEGER DEFAULT 0,
  payment_method TEXT,
  payment_reference TEXT,
  payment_notes TEXT,
  status TEXT DEFAULT 'pending',
  approved_by UUID REFERENCES users(id),
  approved_at TIMESTAMP,
  paid_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_commission_payouts_salesman 
ON commission_payouts(salesman_id, created_at DESC);

ALTER TABLE salesmen
ADD COLUMN IF NOT EXISTS commission_percentage DECIMAL(5, 2) DEFAULT 5.00,
ADD COLUMN IF NOT EXISTS total_earnings DECIMAL(12, 2) DEFAULT 0.00,
ADD COLUMN IF NOT EXISTS pending_commission DECIMAL(12, 2) DEFAULT 0.00,
ADD COLUMN IF NOT EXISTS paid_commission DECIMAL(12, 2) DEFAULT 0.00;

-- =====================================================
-- MIGRATION COMPLETE
-- =====================================================

SELECT 'Migration completed successfully!' as status;
