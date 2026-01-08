-- 20260108_crm_leads_qualification_level.sql
-- Add qualification level tracking to CRM leads

ALTER TABLE crm_leads
  ADD COLUMN IF NOT EXISTS qualification_level TEXT;

-- Default existing rows (best-effort)
UPDATE crm_leads
SET qualification_level = COALESCE(qualification_level, 'UNQUALIFIED');
