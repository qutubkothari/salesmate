-- 20260108_crm_core_tables.sql
-- Core CRM tables: users/roles, leads, conversations/messages, triage, templates, notifications, audit, SLA.
-- Designed to be tenant-scoped and feature-flagged by subscription tier.

-- Users
CREATE TABLE IF NOT EXISTS crm_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  email TEXT,
  phone TEXT,
  full_name TEXT,
  role TEXT NOT NULL CHECK (role IN ('OWNER','ADMIN','MANAGER','SALESMAN')),
  password_hash TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, email),
  UNIQUE(tenant_id, phone)
);

CREATE INDEX IF NOT EXISTS idx_crm_users_tenant ON crm_users(tenant_id);

-- Leads
CREATE TABLE IF NOT EXISTS crm_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  created_by_user_id UUID,
  assigned_user_id UUID,

  name TEXT,
  phone TEXT,
  email TEXT,

  channel TEXT NOT NULL DEFAULT 'WHATSAPP',
  status TEXT NOT NULL DEFAULT 'NEW' CHECK (status IN ('NEW','CONTACTED','QUALIFIED','QUOTED','WON','LOST','ON_HOLD')),
  heat TEXT NOT NULL DEFAULT 'COLD' CHECK (heat IN ('COLD','WARM','HOT','ON_FIRE')),
  score INTEGER NOT NULL DEFAULT 0,

  last_activity_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crm_leads_tenant ON crm_leads(tenant_id);
CREATE INDEX IF NOT EXISTS idx_crm_leads_tenant_status ON crm_leads(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_crm_leads_tenant_assigned ON crm_leads(tenant_id, assigned_user_id);

-- Lead events (timeline)
CREATE TABLE IF NOT EXISTS crm_lead_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  lead_id UUID NOT NULL,
  actor_user_id UUID,
  event_type TEXT NOT NULL,
  event_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crm_lead_events_tenant_lead ON crm_lead_events(tenant_id, lead_id);

-- Conversations
CREATE TABLE IF NOT EXISTS crm_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  lead_id UUID NOT NULL,
  external_thread_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, lead_id)
);

CREATE INDEX IF NOT EXISTS idx_crm_conversations_tenant ON crm_conversations(tenant_id);

-- Messages
CREATE TABLE IF NOT EXISTS crm_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  lead_id UUID NOT NULL,
  conversation_id UUID,

  direction TEXT NOT NULL CHECK (direction IN ('INBOUND','OUTBOUND')),
  channel TEXT NOT NULL,
  body TEXT,
  external_id TEXT,
  raw_payload JSONB,

  created_by_user_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crm_messages_tenant_lead ON crm_messages(tenant_id, lead_id);

-- Triage
CREATE TABLE IF NOT EXISTS crm_triage_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  lead_id UUID,
  conversation_id UUID,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','ASSIGNED','CLOSED')),
  escalation_level TEXT,
  reason TEXT,
  assigned_user_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crm_triage_tenant_status ON crm_triage_items(tenant_id, status);

-- Templates
CREATE TABLE IF NOT EXISTS crm_message_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  channel TEXT NOT NULL,
  name TEXT NOT NULL,
  body TEXT NOT NULL,
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, channel, name)
);

-- Notifications
CREATE TABLE IF NOT EXISTS crm_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  user_id UUID NOT NULL,
  type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_crm_notifications_tenant_user_read ON crm_notifications(tenant_id, user_id, read_at);

-- Audit logs
CREATE TABLE IF NOT EXISTS crm_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  actor_user_id UUID,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id UUID,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crm_audit_tenant_created ON crm_audit_logs(tenant_id, created_at DESC);

-- SLA rules
CREATE TABLE IF NOT EXISTS crm_sla_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  name TEXT NOT NULL,
  response_time_minutes INTEGER NOT NULL,
  escalation_time_minutes INTEGER,
  notify_roles JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, name)
);

CREATE INDEX IF NOT EXISTS idx_crm_sla_rules_tenant_active ON crm_sla_rules(tenant_id, is_active);
