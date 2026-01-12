const express = require('express');
const router = express.Router();

const { requireCrmAuth, requireRole } = require('../../../middleware/crmAuth');
const { CRM_FEATURES, getEffectiveFeaturesForTenant } = require('../../../services/crmFeatureFlags');

/**
 * GET /api/crm/features
 * Returns effective feature set for the authenticated tenant.
 */
router.get('/', requireCrmAuth, async (req, res) => {
  try {
    const info = await getEffectiveFeaturesForTenant(req.user.tenantId);
    if (!info) return res.status(404).json({ success: false, error: 'tenant_not_found' });
    return res.json({ success: true, ...info, keys: CRM_FEATURES });
  } catch (e) {
    return res.status(500).json({ success: false, error: 'failed', details: e?.message || String(e) });
  }
});

module.exports = router;
