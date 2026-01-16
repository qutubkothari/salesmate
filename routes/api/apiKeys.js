const express = require('express');
const router = express.Router();
const { dbClient } = require('../../services/config');
const { requireBearerTenant, createApiKey } = require('../../services/tenantAuth');

// List API keys (safe fields only)
router.get('/:tenantId', requireBearerTenant(), async (req, res) => {
  try {
    const { tenantId } = req.params;
    const { data, error } = await dbClient
      .from('api_keys')
      .select('id, tenant_id, name, key_prefix, created_at, last_used_at, revoked_at')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false });

    if (error) throw error;

    res.json({ success: true, apiKeys: data || [] });
  } catch (e) {
    console.error('[API_KEYS] list error:', e?.message || e);
    res.status(500).json({ success: false, error: 'Failed to list API keys' });
  }
});

// Create a new API key (returns plaintext key once)
router.post('/:tenantId', requireBearerTenant(), async (req, res) => {
  try {
    const { tenantId } = req.params;
    const { name } = req.body || {};

    const created = await createApiKey({ tenantId, name });
    res.json({ success: true, apiKey: created.apiKey, record: created.record });
  } catch (e) {
    console.error('[API_KEYS] create error:', e?.message || e);
    res.status(500).json({ success: false, error: 'Failed to create API key' });
  }
});

// Revoke an API key
router.delete('/:tenantId/:keyId', requireBearerTenant(), async (req, res) => {
  try {
    const { tenantId, keyId } = req.params;

    const { error } = await dbClient
      .from('api_keys')
      .update({ revoked_at: new Date().toISOString() })
      .eq('tenant_id', tenantId)
      .eq('id', keyId);

    if (error) throw error;

    res.json({ success: true });
  } catch (e) {
    console.error('[API_KEYS] revoke error:', e?.message || e);
    res.status(500).json({ success: false, error: 'Failed to revoke API key' });
  }
});

module.exports = router;

