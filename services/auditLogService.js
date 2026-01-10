// services/auditLogService.js
const { dbClient } = require('./config');

function safeJsonStringify(value) {
  try {
    if (value == null) return null;
    return typeof value === 'string' ? value : JSON.stringify(value);
  } catch (_) {
    return null;
  }
}

async function writeAuditLog(input) {
  const {
    tenantId,
    actorType = null,
    actorId = null,
    actorName = null,
    action,
    entityType = null,
    entityId = null,
    summary = null,
    metadata = null,
  } = input || {};

  if (!tenantId || !action) return { ok: false, skipped: true };

  const row = {
    tenant_id: tenantId,
    actor_type: actorType,
    actor_id: actorId,
    actor_name: actorName,
    action,
    entity_type: entityType,
    entity_id: entityId,
    summary,
    metadata: safeJsonStringify(metadata),
    created_at: new Date().toISOString(),
  };

  try {
    const { error } = await dbClient.from('audit_logs').insert(row);
    if (error) return { ok: false, error };
    return { ok: true };
  } catch (err) {
    // Audit logging must never break primary flows.
    return { ok: false, error: err };
  }
}

module.exports = {
  writeAuditLog,
};

