const express = require('express');
const router = express.Router();

const { supabase } = require('../../../services/config');
const { requireCrmAuth, requireRole } = require('../../../middleware/crmAuth');
const { requireCrmFeature } = require('../../../middleware/requireCrmFeature');
const { CRM_FEATURES } = require('../../../services/crmFeatureFlags');

router.get('/', requireCrmAuth, requireCrmFeature(CRM_FEATURES.CRM_AUDIT), requireRole(['OWNER', 'ADMIN', 'MANAGER']), async (req, res) => {
  try {
    const { entityType, entityId, limit = 200 } = req.query;

    let q = supabase
      .from('crm_audit_logs')
      .select('*')
      .eq('tenant_id', req.user.tenantId)
      .order('created_at', { ascending: false })
      .limit(parseInt(limit, 10) || 200);

    if (entityType) q = q.eq('entity_type', String(entityType));
    if (entityId) q = q.eq('entity_id', entityId);

    const { data, error } = await q;
    if (error) throw error;

    return res.json({ success: true, logs: data || [] });
  } catch (e) {
    return res.status(500).json({ success: false, error: 'list_failed', details: e?.message || String(e) });
  }
});

module.exports = router;
