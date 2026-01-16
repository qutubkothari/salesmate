// routes/api/triage.js
const express = require('express');
const router = express.Router();
const { dbClient } = require('../../services/config');
const { autoAssignTriageItemIfNeeded } = require('../../services/triageRoutingService');
const { writeAuditLog } = require('../../services/auditLogService');

async function refetchTriageItemBestEffort({ tenantId, id, attempts = 3, delayMs = 50 }) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const { data: rows, error } = await dbClient
      .from('triage_queue')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('id', id)
      .limit(1);

    const item = Array.isArray(rows) ? rows[0] : null;
    if (!error && item) {
      const status = String(item.status || '').toUpperCase();
      if (item.assigned_to || status === 'IN_PROGRESS') return item;
    }

    if (attempt < attempts) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  // Fall back to a single fetch (even if unassigned)
  const { data: rows } = await dbClient
    .from('triage_queue')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('id', id)
    .limit(1);
  return Array.isArray(rows) ? rows[0] : null;
}

function normalizeStatus(raw) {
  const v = String(raw || '').trim().toUpperCase();
  if (v === 'NEW' || v === 'IN_PROGRESS' || v === 'CLOSED') return v;
  return null;
}

function normalizeType(raw) {
  const v = String(raw || '').trim();
  return v || 'HUMAN_ATTENTION';
}

function parseSqliteDatetimeToMs(value) {
  if (!value) return null;
  const s = String(value);
  if (s.includes('T')) {
    const ms = Date.parse(s);
    return Number.isFinite(ms) ? ms : null;
  }
  // SQLite default DATETIME('now') => "YYYY-MM-DD HH:MM:SS". Treat as UTC.
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(s)) {
    const ms = Date.parse(s.replace(' ', 'T') + 'Z');
    return Number.isFinite(ms) ? ms : null;
  }
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? ms : null;
}

async function getTriageSlaConfig(tenantId) {
  try {
    const { data: tenant } = await dbClient
      .from('tenants')
      .select('triage_sla_enabled, triage_sla_minutes')
      .eq('id', tenantId)
      .single();

    const enabled = tenant?.triage_sla_enabled === 0 || tenant?.triage_sla_enabled === false ? false : true;
    const minutes = Number.parseInt(String(tenant?.triage_sla_minutes ?? '60'), 10);
    return {
      enabled,
      minutes: Number.isFinite(minutes) && minutes > 0 ? minutes : 60,
    };
  } catch {
    return { enabled: true, minutes: 60 };
  }
}

/**
 * GET /api/triage/:tenantId/sla-config
 */
router.get('/:tenantId/sla-config', async (req, res) => {
  try {
    const { tenantId } = req.params;
    const config = await getTriageSlaConfig(tenantId);
    return res.json({ success: true, config });
  } catch (error) {
    console.error('[API][TRIAGE] sla-config get error:', error);
    return res.status(500).json({ success: false, error: error.message || String(error) });
  }
});

/**
 * PUT /api/triage/:tenantId/sla-config
 * Body: { enabled?: boolean, minutes?: number }
 */
router.put('/:tenantId/sla-config', async (req, res) => {
  try {
    const { tenantId } = req.params;
    const enabled = req.body?.enabled === false || req.body?.enabled === 0 || String(req.body?.enabled || '').toLowerCase() === 'false' ? 0 : 1;
    const minutesRaw = req.body?.minutes;
    const minutes = Number.parseInt(String(minutesRaw ?? ''), 10);
    const safeMinutes = Number.isFinite(minutes) && minutes > 0 && minutes <= 7 * 24 * 60 ? minutes : 60;

    const { error } = await dbClient
      .from('tenants')
      .update({ triage_sla_enabled: enabled, triage_sla_minutes: safeMinutes })
      .eq('id', tenantId);
    if (error) throw error;

    writeAuditLog({
      tenantId,
      action: 'triage.sla.update',
      entityType: 'tenant',
      entityId: tenantId,
      summary: `Triage SLA updated (${enabled ? 'enabled' : 'disabled'}, ${safeMinutes} min)`,
      metadata: { enabled: !!enabled, minutes: safeMinutes },
    }).catch(() => undefined);

    return res.json({ success: true, config: { enabled: !!enabled, minutes: safeMinutes } });
  } catch (error) {
    console.error('[API][TRIAGE] sla-config update error:', error);
    return res.status(500).json({ success: false, error: error.message || String(error) });
  }
});

/**
 * GET /api/triage/:tenantId
 * List triage items
 * Query params: status=NEW|IN_PROGRESS|CLOSED
 */
router.get('/:tenantId', async (req, res) => {
  try {
    const { tenantId } = req.params;
    const status = normalizeStatus(req.query.status);
    const assignedTo = req.query.assigned_to != null ? String(req.query.assigned_to).trim() : '';
    const unassigned = String(req.query.unassigned || '').toLowerCase();

    let query = dbClient
      .from('triage_queue')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .limit(500);

    if (status) query = query.eq('status', status);

    if (unassigned === '1' || unassigned === 'true') {
      query = query.eq('assigned_to', null);
    } else if (assignedTo) {
      query = query.eq('assigned_to', assignedTo);
    }

    const { data, error } = await query;
    if (error) throw error;

    const config = await getTriageSlaConfig(tenantId);
    const nowMs = Date.now();

    const items = (data || []).map((item) => {
      if (!config.enabled) return { ...item, sla_enabled: false };
      const status = String(item.status || '').toUpperCase();
      if (status === 'CLOSED') return { ...item, sla_enabled: true, sla_status: 'closed' };

      const createdMs = parseSqliteDatetimeToMs(item.created_at) ?? parseSqliteDatetimeToMs(item.updated_at) ?? nowMs;
      const dueMs = createdMs + config.minutes * 60 * 1000;
      const overdue = nowMs > dueMs;
      return {
        ...item,
        sla_enabled: true,
        sla_minutes: config.minutes,
        sla_due_at: new Date(dueMs).toISOString(),
        sla_status: overdue ? 'overdue' : 'ok',
        sla_remaining_seconds: Math.max(0, Math.floor((dueMs - nowMs) / 1000)),
        sla_overdue_seconds: overdue ? Math.floor((nowMs - dueMs) / 1000) : 0,
      };
    });

    return res.json({ success: true, items });
  } catch (error) {
    console.error('[API][TRIAGE] list error:', error);
    return res.status(500).json({ success: false, error: error.message || String(error) });
  }
});

/**
 * POST /api/triage/:tenantId
 * Create a triage item
 */
router.post('/:tenantId', async (req, res) => {
  try {
    const { tenantId } = req.params;
    const body = req.body || {};

    const endUserPhone = String(body.end_user_phone || body.phone || '').trim();
    const conversationId = body.conversation_id ? String(body.conversation_id) : null;

    const type = normalizeType(body.type);
    const messagePreview = body.message_preview ? String(body.message_preview) : null;
    const metadata = body.metadata ?? null;

    if (!endUserPhone && !conversationId) {
      return res.status(400).json({ success: false, error: 'end_user_phone or conversation_id is required' });
    }

    const row = {
      tenant_id: tenantId,
      conversation_id: conversationId,
      end_user_phone: endUserPhone || null,
      type,
      status: 'NEW',
      assigned_to: null,
      message_preview: messagePreview,
      metadata,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await dbClient
      .from('triage_queue')
      .insert(row)
      .select('*')
      .single();

    if (error) throw error;

    writeAuditLog({
      tenantId,
      action: 'triage.create',
      entityType: 'triage',
      entityId: data?.id,
      summary: 'Triage item created',
      metadata: {
        conversation_id: conversationId,
        end_user_phone: endUserPhone || null,
        type,
      },
    }).catch(() => undefined);

    // Best-effort smart assign
    if (data?.id && !data?.assigned_to) {
      await autoAssignTriageItemIfNeeded(dbClient, {
        tenantId,
        triageId: data.id,
        seed: data.conversation_id || data.id,
      });

      const updated = await refetchTriageItemBestEffort({ tenantId, id: data.id });
      if (updated) return res.json({ success: true, item: updated });
    }

    return res.json({ success: true, item: data });
  } catch (error) {
    console.error('[API][TRIAGE] create error:', error);
    return res.status(500).json({ success: false, error: error.message || String(error) });
  }
});

/**
 * POST /api/triage/:tenantId/:id/assign
 * Body: { assigned_to: string }
 */
router.post('/:tenantId/:id/assign', async (req, res) => {
  try {
    const { tenantId, id } = req.params;
    const assignedTo = String(req.body?.assigned_to || '').trim();

    if (!assignedTo) {
      return res.status(400).json({ success: false, error: 'assigned_to is required' });
    }

    const { data, error } = await dbClient
      .from('triage_queue')
      .update({
        assigned_to: assignedTo,
        status: 'IN_PROGRESS',
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select('*')
      .single();

    if (error) throw error;

    writeAuditLog({
      tenantId,
      action: 'triage.assign',
      entityType: 'triage',
      entityId: id,
      summary: `Triage assigned to ${assignedTo}`,
      metadata: { assigned_to: assignedTo },
    }).catch(() => undefined);

    return res.json({ success: true, item: data });
  } catch (error) {
    console.error('[API][TRIAGE] assign error:', error);
    return res.status(500).json({ success: false, error: error.message || String(error) });
  }
});

/**
 * POST /api/triage/:tenantId/:id/close
 * Body: { reason?: string }
 */
router.post('/:tenantId/:id/close', async (req, res) => {
  try {
    const { tenantId, id } = req.params;
    const reason = req.body?.reason != null ? String(req.body.reason) : null;

    const now = new Date().toISOString();

    const { data, error } = await dbClient
      .from('triage_queue')
      .update({
        status: 'CLOSED',
        closed_reason: reason,
        closed_at: now,
        updated_at: now,
      })
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select('*')
      .single();

    if (error) throw error;

    writeAuditLog({
      tenantId,
      action: 'triage.close',
      entityType: 'triage',
      entityId: id,
      summary: 'Triage closed',
      metadata: { reason },
    }).catch(() => undefined);

    return res.json({ success: true, item: data });
  } catch (error) {
    console.error('[API][TRIAGE] close error:', error);
    return res.status(500).json({ success: false, error: error.message || String(error) });
  }
});

/**
 * POST /api/triage/:tenantId/:id/reopen
 */
router.post('/:tenantId/:id/reopen', async (req, res) => {
  try {
    const { tenantId, id } = req.params;
    const now = new Date().toISOString();

    const { data, error } = await dbClient
      .from('triage_queue')
      .update({
        status: 'IN_PROGRESS',
        closed_reason: null,
        closed_at: null,
        updated_at: now,
      })
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select('*')
      .single();

    if (error) throw error;

    writeAuditLog({
      tenantId,
      action: 'triage.reopen',
      entityType: 'triage',
      entityId: id,
      summary: 'Triage reopened',
      metadata: { assigned_to: data?.assigned_to || null },
    }).catch(() => undefined);

    // Best-effort smart assign if unassigned
    if (data?.id && !data?.assigned_to) {
      await autoAssignTriageItemIfNeeded(dbClient, { tenantId, triageId: data.id, seed: data.conversation_id || data.id });

      const updated = await refetchTriageItemBestEffort({ tenantId, id: data.id });
      if (updated) return res.json({ success: true, item: updated });
    }

    return res.json({ success: true, item: data });
  } catch (error) {
    console.error('[API][TRIAGE] reopen error:', error);
    return res.status(500).json({ success: false, error: error.message || String(error) });
  }
});

module.exports = router;



