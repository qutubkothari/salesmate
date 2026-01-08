const { isFeatureEnabled } = require('../services/crmFeatureFlags');

function requireCrmFeature(featureKey) {
  return async (req, res, next) => {
    try {
      const tenantId = req.user?.tenantId || req.params?.tenantId;
      if (!tenantId) return res.status(400).json({ success: false, error: 'missing_tenant' });

      const enabled = await isFeatureEnabled(tenantId, featureKey);
      if (!enabled) {
        return res.status(403).json({ success: false, error: 'feature_disabled', feature: featureKey });
      }

      return next();
    } catch (e) {
      return res.status(500).json({ success: false, error: 'feature_check_failed', details: e?.message || String(e) });
    }
  };
}

module.exports = {
  requireCrmFeature
};
