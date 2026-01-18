const express = require('express');
const router = express.Router();

const { dbClient: supabase } = require('../../../services/config');
const { requireCrmAuth, requireRole } = require('../../../middleware/crmAuth');
const { requireCrmFeature } = require('../../../middleware/requireCrmFeature');
const { CRM_FEATURES } = require('../../../services/crmFeatureFlags');

function nowIso() {
  return new Date().toISOString();
}

router.get('/', requireCrmAuth, requireCrmFeature(CRM_FEATURES.CRM_TEMPLATES), requireRole(['OWNER', 'ADMIN', 'MANAGER', 'SALESMAN']), async (req, res) => {
  try {
    const { channel } = req.query;
    let q = supabase
      .from('crm_message_templates')
      .select('*')
      .eq('tenant_id', req.user.tenantId)
      .order('created_at', { ascending: false });

    if (channel) q = q.eq('channel', String(channel).toUpperCase());

    const { data, error } = await q;
    if (error) throw error;
    return res.json({ success: true, templates: data || [] });
  } catch (e) {
    return res.status(500).json({ success: false, error: 'list_failed', details: e?.message || String(e) });
  }
});

router.post('/', requireCrmAuth, requireCrmFeature(CRM_FEATURES.CRM_TEMPLATES), requireRole(['OWNER', 'ADMIN', 'MANAGER']), async (req, res) => {
  try {
    const { channel, name, body, isEnabled = true } = req.body || {};
    if (!channel || !name || !body) return res.status(400).json({ success: false, error: 'channel, name, body required' });

    const { data, error } = await supabase
      .from('crm_message_templates')
      .insert({
        tenant_id: req.user.tenantId,
        channel: String(channel).toUpperCase(),
        name: String(name).trim(),
        body: String(body),
        is_enabled: Boolean(isEnabled),
        created_at: nowIso(),
        updated_at: nowIso()
      })
      .select('*')
      .single();

    if (error) throw error;
    return res.status(201).json({ success: true, template: data });
  } catch (e) {
    return res.status(500).json({ success: false, error: 'create_failed', details: e?.message || String(e) });
  }
});

router.patch('/:id', requireCrmAuth, requireCrmFeature(CRM_FEATURES.CRM_TEMPLATES), requireRole(['OWNER', 'ADMIN', 'MANAGER']), async (req, res) => {
  try {
    const { id } = req.params;
    const updates = { updated_at: nowIso() };
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'body')) updates.body = String(req.body.body);
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'isEnabled')) updates.is_enabled = Boolean(req.body.isEnabled);

    const { data, error } = await supabase
      .from('crm_message_templates')
      .update(updates)
      .eq('tenant_id', req.user.tenantId)
      .eq('id', id)
      .select('*')
      .maybeSingle();

    if (error) throw error;
    if (!data) return res.status(404).json({ success: false, error: 'not_found' });

    return res.json({ success: true, template: data });
  } catch (e) {
    return res.status(500).json({ success: false, error: 'update_failed', details: e?.message || String(e) });
  }
});

module.exports = router;
