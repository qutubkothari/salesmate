const express = require('express');
const router = express.Router();

const { dbClient: supabase } = require('../../../services/config');
const { requireCrmAuth, requireRole } = require('../../../middleware/crmAuth');
const { requireCrmFeature } = require('../../../middleware/requireCrmFeature');
const { CRM_FEATURES } = require('../../../services/crmFeatureFlags');

function nowIso() {
  return new Date().toISOString();
}

/**
 * GET /api/crm/triage?status=OPEN|ASSIGNED|CLOSED
 */
router.get('/', requireCrmAuth, requireCrmFeature(CRM_FEATURES.CRM_TRIAGE), requireRole(['OWNER', 'ADMIN', 'MANAGER']), async (req, res) => {
  try {
    const { status, limit = 200 } = req.query;

    let q = supabase
      .from('crm_triage_items')
      .select('*')
      .eq('tenant_id', req.user.tenantId)
      .order('updated_at', { ascending: false })
      .limit(parseInt(limit, 10) || 200);

    if (status) q = q.eq('status', String(status).toUpperCase());

    const { data, error } = await q;
    if (error) throw error;

    return res.json({ success: true, items: data || [] });
  } catch (e) {
    return res.status(500).json({ success: false, error: 'list_failed', details: e?.message || String(e) });
  }
});

/**
 * POST /api/crm/triage
 * Body: { leadId, reason, escalationLevel }
 */
router.post('/', requireCrmAuth, requireCrmFeature(CRM_FEATURES.CRM_TRIAGE), requireRole(['OWNER', 'ADMIN', 'MANAGER', 'SALESMAN']), async (req, res) => {
  try {
    const { leadId, reason, escalationLevel } = req.body || {};
    if (!leadId) return res.status(400).json({ success: false, error: 'leadId required' });

    const { data: item, error } = await supabase
      .from('crm_triage_items')
      .insert({
        tenant_id: req.user.tenantId,
        lead_id: leadId,
        status: 'OPEN',
        reason: reason != null ? String(reason) : null,
        escalation_level: escalationLevel != null ? String(escalationLevel) : null,
        created_at: nowIso(),
        updated_at: nowIso()
      })
      .select('*')
      .single();

    if (error) throw error;
    return res.status(201).json({ success: true, item });
  } catch (e) {
    return res.status(500).json({ success: false, error: 'create_failed', details: e?.message || String(e) });
  }
});

/**
 * PATCH /api/crm/triage/:id
 */
router.patch('/:id', requireCrmAuth, requireCrmFeature(CRM_FEATURES.CRM_TRIAGE), requireRole(['OWNER', 'ADMIN', 'MANAGER']), async (req, res) => {
  try {
    const { id } = req.params;
    const updates = { updated_at: nowIso() };
    if (req.body?.status) updates.status = String(req.body.status).toUpperCase();
    if (req.body?.assignedUserId) updates.assigned_user_id = req.body.assignedUserId;
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'reason')) updates.reason = req.body.reason;
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'escalationLevel')) updates.escalation_level = req.body.escalationLevel;

    const { data: item, error } = await supabase
      .from('crm_triage_items')
      .update(updates)
      .eq('tenant_id', req.user.tenantId)
      .eq('id', id)
      .select('*')
      .maybeSingle();

    if (error) throw error;
    if (!item) return res.status(404).json({ success: false, error: 'not_found' });

    return res.json({ success: true, item });
  } catch (e) {
    return res.status(500).json({ success: false, error: 'update_failed', details: e?.message || String(e) });
  }
});

module.exports = router;
