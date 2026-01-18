const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();

const { dbClient: supabase } = require('../../../services/config');
const { requireCrmAuth, requireRole } = require('../../../middleware/crmAuth');
const { requireCrmFeature } = require('../../../middleware/requireCrmFeature');
const { CRM_FEATURES } = require('../../../services/crmFeatureFlags');

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

/**
 * POST /api/crm/users
 * Create a tenant-scoped user
 */
router.post('/', requireCrmAuth, requireCrmFeature(CRM_FEATURES.CRM_USERS), requireRole(['OWNER', 'ADMIN']), async (req, res) => {
  try {
    const { email, phone, fullName, role, password } = req.body || {};
    if (!role) return res.status(400).json({ success: false, error: 'role required' });
    if (!password) return res.status(400).json({ success: false, error: 'password required' });

    const passwordHash = bcrypt.hashSync(String(password), 10);

    const insert = {
      tenant_id: req.user.tenantId,
      email: email ? normalizeEmail(email) : null,
      phone: phone ? String(phone).trim() : null,
      full_name: fullName ? String(fullName).trim() : null,
      role: String(role).toUpperCase(),
      password_hash: passwordHash,
      is_active: true
    };

    const { data, error } = await supabase
      .from('crm_users')
      .insert(insert)
      .select('id, tenant_id, email, phone, full_name, role, is_active, created_at')
      .single();

    if (error) throw error;

    return res.status(201).json({ success: true, user: data });
  } catch (e) {
    return res.status(500).json({ success: false, error: 'create_failed', details: e?.message || String(e) });
  }
});

/**
 * GET /api/crm/users
 */
router.get('/', requireCrmAuth, requireCrmFeature(CRM_FEATURES.CRM_USERS), requireRole(['OWNER', 'ADMIN', 'MANAGER']), async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('crm_users')
      .select('id, email, phone, full_name, role, is_active, created_at')
      .eq('tenant_id', req.user.tenantId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return res.json({ success: true, users: data || [] });
  } catch (e) {
    return res.status(500).json({ success: false, error: 'list_failed', details: e?.message || String(e) });
  }
});

module.exports = router;
