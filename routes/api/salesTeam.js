const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { dbClient } = require('../../services/config');

const USE_LOCAL_DB = String(process.env.USE_LOCAL_DB || '').toLowerCase() === 'true';

function isMissingTableError(err) {
  const msg = String(err?.message || err || '').toLowerCase();
  return msg.includes('no such table') || msg.includes('does not exist');
}

function nowIso() {
  return new Date().toISOString();
}

// GET /api/sales-team/:tenantId
router.get('/:tenantId', async (req, res) => {
  const { tenantId } = req.params;

  try {
    let q = dbClient.from('sales_users');
    q = USE_LOCAL_DB ? q.select('*') : q.select('id, tenant_id, name, phone, role, is_active, created_at, updated_at');

    const { data, error } = await q
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: true });

    if (error) throw error;

    const users = (Array.isArray(data) ? data : []).filter((u) => (u.is_active === undefined ? true : (u.is_active === true || u.is_active === 1)));
    return res.json({ success: true, users });
  } catch (e) {
    if (isMissingTableError(e)) {
      return res.json({ success: true, users: [] });
    }
    console.error('[SALES_TEAM] list failed', e);
    return res.status(500).json({ success: false, error: e?.message || String(e) });
  }
});

// POST /api/sales-team/:tenantId  body: { name, phone?, role? }
router.post('/:tenantId', async (req, res) => {
  const { tenantId } = req.params;
  const { name, phone, role } = req.body || {};

  if (!name || !String(name).trim()) {
    return res.status(400).json({ success: false, error: 'name is required' });
  }

  const row = {
    id: crypto.randomUUID(),
    tenant_id: tenantId,
    name: String(name).trim(),
    phone: phone ? String(phone).trim() : null,
    role: role ? String(role).trim() : null,
    is_active: 1,
    created_at: nowIso(),
    updated_at: nowIso(),
  };

  try {
    const { data, error } = await dbClient
      .from('sales_users')
      .insert(row)
      .select('*')
      .single();

    if (error) throw error;

    return res.json({ success: true, user: data });
  } catch (e) {
    if (isMissingTableError(e)) {
      return res.status(501).json({ success: false, error: 'sales_users table missing in this environment' });
    }
    console.error('[SALES_TEAM] create failed', e);
    return res.status(500).json({ success: false, error: e?.message || String(e) });
  }
});

// PUT /api/sales-team/:tenantId/:id  body: { name?, phone?, role?, is_active? }
router.put('/:tenantId/:id', async (req, res) => {
  const { tenantId, id } = req.params;
  const body = req.body || {};

  const update = {
    updated_at: nowIso(),
  };

  if (body.name != null) {
    const n = String(body.name).trim();
    if (!n) return res.status(400).json({ success: false, error: 'name cannot be empty' });
    update.name = n;
  }
  if (body.phone !== undefined) {
    update.phone = body.phone ? String(body.phone).trim() : null;
  }
  if (body.role !== undefined) {
    update.role = body.role ? String(body.role).trim() : null;
  }
  if (body.is_active !== undefined) {
    const v = body.is_active === true || body.is_active === 1 || String(body.is_active).toLowerCase() === 'true';
    update.is_active = v ? 1 : 0;
  }

  try {
    const { data, error } = await dbClient
      .from('sales_users')
      .update(update)
      .eq('tenant_id', tenantId)
      .eq('id', id)
      .select('*')
      .limit(1);

    if (error) throw error;
    const user = Array.isArray(data) ? data[0] : null;
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });

    return res.json({ success: true, user });
  } catch (e) {
    if (isMissingTableError(e)) {
      return res.status(501).json({ success: false, error: 'sales_users table missing in this environment' });
    }
    console.error('[SALES_TEAM] update failed', e);
    return res.status(500).json({ success: false, error: e?.message || String(e) });
  }
});

// DELETE /api/sales-team/:tenantId/:id
router.delete('/:tenantId/:id', async (req, res) => {
  const { tenantId, id } = req.params;

  try {
    const { error } = await dbClient
      .from('sales_users')
      .delete()
      .eq('tenant_id', tenantId)
      .eq('id', id);

    if (error) throw error;

    return res.json({ success: true });
  } catch (e) {
    if (isMissingTableError(e)) {
      return res.status(501).json({ success: false, error: 'sales_users table missing in this environment' });
    }
    console.error('[SALES_TEAM] delete failed', e);
    return res.status(500).json({ success: false, error: e?.message || String(e) });
  }
});

module.exports = router;


