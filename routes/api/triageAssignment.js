const express = require('express');
const router = express.Router();
const { dbClient } = require('../../services/config');
const { getTriageAssignmentConfig } = require('../../services/triageRoutingService');
const crypto = require('crypto');

function isMissingTableError(err) {
  const msg = String(err?.message || err || '').toLowerCase();
  return (
    msg.includes('no such table') ||
    msg.includes('does not exist') ||
    (msg.includes('relation') && msg.includes('does not exist'))
  );
}

/**
 * GET /api/triage-assignment/:tenantId/status
 * Returns whether smart-assign is effectively enabled (autoAssign + at least 1 active sales user).
 */
router.get('/:tenantId/status', async (req, res) => {
  try {
    const { tenantId } = req.params;

    const config = await getTriageAssignmentConfig(dbClient, tenantId);

    let hasAssignees = false;
    try {
      const { data, error } = await dbClient
        .from('sales_users')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('is_active', 1)
        .limit(1);
      if (error) throw error;
      hasAssignees = Array.isArray(data) && data.length > 0;
    } catch (e) {
      if (!isMissingTableError(e)) {
        console.warn('[API][TRIAGE_ASSIGNMENT] hasAssignees check failed:', e?.message || String(e));
      }
    }

    const enabled = Boolean(config?.autoAssign) && hasAssignees;

    return res.json({
      success: true,
      enabled,
      hasAssignees,
      config: {
        strategy: config?.strategy,
        autoAssign: Boolean(config?.autoAssign),
        considerCapacity: Boolean(config?.considerCapacity),
        considerScore: Boolean(config?.considerScore),
      }
    });
  } catch (error) {
    console.error('[API][TRIAGE_ASSIGNMENT] status error:', error);
    return res.status(500).json({ success: false, error: error.message || String(error) });
  }
});

module.exports = router;

function nowIso() {
  return new Date().toISOString();
}

function normalizeStrategy(v) {
  const s = String(v || '').trim().toUpperCase();
  if (s === 'LEAST_ACTIVE' || s === 'ROUND_ROBIN') return s;
  return null;
}

function asBoolInt(v, defaultValue) {
  if (v === undefined) return defaultValue;
  return (v === true || v === 1 || String(v).toLowerCase() === 'true') ? 1 : 0;
}

/**
 * GET /api/triage-assignment/:tenantId/config
 * Returns tenant config for triage smart-assign. Creates default row (local) if missing.
 */
router.get('/:tenantId/config', async (req, res) => {
  try {
    const { tenantId } = req.params;

    try {
      const { data, error } = await dbClient
        .from('triage_assignment_config')
        .select('*')
        .eq('tenant_id', tenantId)
        .limit(1);
      if (error) throw error;

      const row = Array.isArray(data) ? data[0] : null;
      if (row) return res.json({ success: true, config: row, readonly: false });

      const def = {
        id: crypto.randomUUID(),
        tenant_id: tenantId,
        strategy: 'LEAST_ACTIVE',
        auto_assign: 1,
        consider_capacity: 1,
        consider_score: 0,
        created_at: nowIso(),
        updated_at: nowIso(),
      };

      const { data: inserted, error: insErr } = await dbClient
        .from('triage_assignment_config')
        .insert(def)
        .select('*')
        .limit(1);
      if (insErr) throw insErr;
      const out = Array.isArray(inserted) ? inserted[0] : def;
      return res.json({ success: true, config: out, readonly: false });
    } catch (e) {
      if (isMissingTableError(e)) {
        return res.json({
          success: true,
          readonly: true,
          config: {
            strategy: 'LEAST_ACTIVE',
            auto_assign: 1,
            consider_capacity: 1,
            consider_score: 0,
          }
        });
      }
      throw e;
    }
  } catch (error) {
    console.error('[API][TRIAGE_ASSIGNMENT] config get error:', error);
    return res.status(500).json({ success: false, error: error.message || String(error) });
  }
});

/**
 * PUT /api/triage-assignment/:tenantId/config
 * Body: { strategy?, auto_assign? }
 */
router.put('/:tenantId/config', async (req, res) => {
  try {
    const { tenantId } = req.params;
    const body = req.body || {};

    const strategy = body.strategy !== undefined ? normalizeStrategy(body.strategy) : null;
    if (body.strategy !== undefined && !strategy) {
      return res.status(400).json({ success: false, error: 'Invalid strategy' });
    }

    const update = {
      updated_at: nowIso(),
    };
    if (strategy) update.strategy = strategy;
    if (body.auto_assign !== undefined) update.auto_assign = asBoolInt(body.auto_assign, 1);

    // Upsert manually for compatibility
    const { data: existingRows, error: selErr } = await dbClient
      .from('triage_assignment_config')
      .select('*')
      .eq('tenant_id', tenantId)
      .limit(1);
    if (selErr) throw selErr;

    const existing = Array.isArray(existingRows) ? existingRows[0] : null;
    if (!existing) {
      const row = {
        id: crypto.randomUUID(),
        tenant_id: tenantId,
        strategy: update.strategy || 'LEAST_ACTIVE',
        auto_assign: update.auto_assign ?? 1,
        consider_capacity: 1,
        consider_score: 0,
        created_at: nowIso(),
        updated_at: update.updated_at,
      };
      const { data: inserted, error: insErr } = await dbClient
        .from('triage_assignment_config')
        .insert(row)
        .select('*')
        .limit(1);
      if (insErr) throw insErr;
      const out = Array.isArray(inserted) ? inserted[0] : row;
      return res.json({ success: true, config: out });
    }

    const { data: updatedRows, error: updErr } = await dbClient
      .from('triage_assignment_config')
      .update(update)
      .eq('tenant_id', tenantId)
      .select('*')
      .limit(1);
    if (updErr) throw updErr;
    const out = Array.isArray(updatedRows) ? updatedRows[0] : null;
    return res.json({ success: true, config: out || { ...existing, ...update } });
  } catch (error) {
    if (isMissingTableError(error)) {
      return res.status(501).json({ success: false, error: 'triage_assignment_config missing in this environment' });
    }
    console.error('[API][TRIAGE_ASSIGNMENT] config update error:', error);
    return res.status(500).json({ success: false, error: error.message || String(error) });
  }
});


