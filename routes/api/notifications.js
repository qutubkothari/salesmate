const express = require('express');
const router = express.Router();
const { dbClient } = require('../../services/config');
const { requireTenantAuth } = require('../../services/tenantAuth');

// List notifications
router.get('/:tenantId', requireTenantAuth(), async (req, res) => {
  try {
    const { tenantId } = req.params;
    const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 50));
    const unreadOnly = String(req.query.unreadOnly || '0') === '1';

    let q = dbClient
      .from('notifications')
      .select('id, tenant_id, title, body, type, is_read, created_at, read_at, metadata')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (unreadOnly) q = q.eq('is_read', 0);

    const { data, error } = await q;
    if (error) throw error;

    res.json({ success: true, notifications: data || [] });
  } catch (e) {
    console.error('[NOTIFICATIONS] list error:', e?.message || e);
    res.status(500).json({ success: false, error: 'Failed to list notifications' });
  }
});

// Create notification (internal/admin usage)
router.post('/:tenantId', requireTenantAuth({ allowApiKey: false, allowBearer: true }), async (req, res) => {
  try {
    const { tenantId } = req.params;
    const { title, body, type, metadata } = req.body || {};

    if (!title && !body) {
      return res.status(400).json({ success: false, error: 'title or body is required' });
    }

    const row = {
      tenant_id: tenantId,
      title: String(title || ''),
      body: String(body || ''),
      type: String(type || 'info'),
      metadata: metadata ? JSON.stringify(metadata) : null,
      is_read: 0,
      created_at: new Date().toISOString()
    };

    const { data, error } = await dbClient
      .from('notifications')
      .insert(row)
      .select('id, tenant_id, title, body, type, is_read, created_at, read_at, metadata')
      .single();

    if (error) throw error;

    res.json({ success: true, notification: data });
  } catch (e) {
    console.error('[NOTIFICATIONS] create error:', e?.message || e);
    res.status(500).json({ success: false, error: 'Failed to create notification' });
  }
});

// Mark single notification read
router.post('/:tenantId/:notificationId/read', requireTenantAuth(), async (req, res) => {
  try {
    const { tenantId, notificationId } = req.params;

    const { error } = await dbClient
      .from('notifications')
      .update({ is_read: 1, read_at: new Date().toISOString() })
      .eq('tenant_id', tenantId)
      .eq('id', notificationId);

    if (error) throw error;

    res.json({ success: true });
  } catch (e) {
    console.error('[NOTIFICATIONS] mark read error:', e?.message || e);
    res.status(500).json({ success: false, error: 'Failed to mark read' });
  }
});

// Mark all read
router.post('/:tenantId/read-all', requireTenantAuth(), async (req, res) => {
  try {
    const { tenantId } = req.params;

    const { error } = await dbClient
      .from('notifications')
      .update({ is_read: 1, read_at: new Date().toISOString() })
      .eq('tenant_id', tenantId)
      .eq('is_read', 0);

    if (error) throw error;

    res.json({ success: true });
  } catch (e) {
    console.error('[NOTIFICATIONS] read-all error:', e?.message || e);
    res.status(500).json({ success: false, error: 'Failed to mark all read' });
  }
});

module.exports = router;
