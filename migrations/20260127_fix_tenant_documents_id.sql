-- 20260127_fix_tenant_documents_id.sql
-- Ensure tenant_documents.id has a default
ALTER TABLE tenant_documents
  ALTER COLUMN id SET DEFAULT gen_random_uuid()::text;
