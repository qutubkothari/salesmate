const express = require('express');
const router = express.Router();

const { dbClient: supabase } = require('../../../services/config');
const { requireCrmAuth, requireRole } = require('../../../middleware/crmAuth');
const { requireCrmFeature } = require('../../../middleware/requireCrmFeature');
const { CRM_FEATURES } = require('../../../services/crmFeatureFlags');

router.get('/', requireCrmAuth, requireCrmFeature(CRM_FEATURES.CRM_NOTIFICATIONS), async (req, res) => {
  try {
    const { unreadOnly, limit = 100 } = req.query;

    let q = supabase
      .from('crm_notifications')
      .select('*')
      .eq('tenant_id', req.user.tenantId)
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false })
      .limit(parseInt(limit, 10) || 100);

    if (String(unreadOnly) === 'true') q = q.is('read_at', null);

    const { data, error } = await q;
    if (error) throw error;

    return res.json({ success: true, notifications: data || [] });
  } catch (e) {
    return res.status(500).json({ success: false, error: 'list_failed', details: e?.message || String(e) });
  }
});

router.get('/unread-count', requireCrmAuth, requireCrmFeature(CRM_FEATURES.CRM_NOTIFICATIONS), async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('crm_notifications')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', req.user.tenantId)
      .eq('user_id', req.user.id)
      .is('read_at', null);

    if (error) throw error;
    return res.json({ success: true, unread: data?.length || 0 });
  } catch (e) {
    return res.status(500).json({ success: false, error: 'count_failed', details: e?.message || String(e) });
  }
});

router.post('/:id/mark-read', requireCrmAuth, requireCrmFeature(CRM_FEATURES.CRM_NOTIFICATIONS), async (req, res) => {
  try {
    const { id } = req.params;

    const { data, error } = await supabase
      .from('crm_notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('tenant_id', req.user.tenantId)
      .eq('user_id', req.user.id)
      .eq('id', id)
      .select('*')
      .maybeSingle();

    if (error) throw error;
    if (!data) return res.status(404).json({ success: false, error: 'not_found' });

    return res.json({ success: true, notification: data });
  } catch (e) {
    return res.status(500).json({ success: false, error: 'mark_read_failed', details: e?.message || String(e) });
  }
});

module.exports = router;
