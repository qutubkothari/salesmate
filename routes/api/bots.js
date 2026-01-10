const express = require('express');
const router = express.Router();
const { dbClient } = require('../../services/config');
const { requireTenantAuth } = require('../../services/tenantAuth');

// List bots
router.get('/:tenantId', requireTenantAuth(), async (req, res) => {
  try {
    const { tenantId } = req.params;
    const { data, error } = await dbClient
      .from('tenant_bots')
      .select('id, tenant_id, name, provider, config, is_active, created_at, updated_at')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json({ success: true, bots: data || [] });
  } catch (e) {
    console.error('[BOTS] list error:', e?.message || e);
    res.status(500).json({ success: false, error: 'Failed to list bots' });
  }
});

// Create bot
router.post('/:tenantId', requireTenantAuth({ allowApiKey: false, allowBearer: true }), async (req, res) => {
  try {
    const { tenantId } = req.params;
    const { name, provider, config, is_active } = req.body || {};

    if (!name) return res.status(400).json({ success: false, error: 'name is required' });

    const row = {
      tenant_id: tenantId,
      name: String(name),
      provider: String(provider || 'default'),
      config: config ? JSON.stringify(config) : null,
      is_active: typeof is_active === 'number' ? is_active : (is_active ? 1 : 1),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await dbClient
      .from('tenant_bots')
      .insert(row)
      .select('id, tenant_id, name, provider, config, is_active, created_at, updated_at')
      .single();

    if (error) throw error;
    res.json({ success: true, bot: data });
  } catch (e) {
    console.error('[BOTS] create error:', e?.message || e);
    res.status(500).json({ success: false, error: 'Failed to create bot' });
  }
});

// Update bot
router.put('/:tenantId/:botId', requireTenantAuth({ allowApiKey: false, allowBearer: true }), async (req, res) => {
  try {
    const { tenantId, botId } = req.params;
    const { name, provider, config, is_active } = req.body || {};

    const patch = {
      updated_at: new Date().toISOString(),
    };
    if (name !== undefined) patch.name = String(name);
    if (provider !== undefined) patch.provider = String(provider);
    if (config !== undefined) patch.config = config ? JSON.stringify(config) : null;
    if (is_active !== undefined) patch.is_active = is_active ? 1 : 0;

    const { data, error } = await dbClient
      .from('tenant_bots')
      .update(patch)
      .eq('tenant_id', tenantId)
      .eq('id', botId)
      .select('id, tenant_id, name, provider, config, is_active, created_at, updated_at')
      .single();

    if (error) throw error;
    res.json({ success: true, bot: data });
  } catch (e) {
    console.error('[BOTS] update error:', e?.message || e);
    res.status(500).json({ success: false, error: 'Failed to update bot' });
  }
});

// Delete bot
router.delete('/:tenantId/:botId', requireTenantAuth({ allowApiKey: false, allowBearer: true }), async (req, res) => {
  try {
    const { tenantId, botId } = req.params;

    const { error } = await dbClient
      .from('tenant_bots')
      .delete()
      .eq('tenant_id', tenantId)
      .eq('id', botId);

    if (error) throw error;
    res.json({ success: true });
  } catch (e) {
    console.error('[BOTS] delete error:', e?.message || e);
    res.status(500).json({ success: false, error: 'Failed to delete bot' });
  }
});

module.exports = router;
