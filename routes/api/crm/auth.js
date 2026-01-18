const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const router = express.Router();

const { dbClient: supabase } = require('../../../services/config');
const { requireCrmAuth } = require('../../../middleware/crmAuth');
const { requireCrmFeature } = require('../../../middleware/requireCrmFeature');
const { CRM_FEATURES } = require('../../../services/crmFeatureFlags');

function normalizePhoneDigits(value) {
  if (!value) return '';
  const withoutSuffix = String(value).replace(/@c\.us$/i, '');
  return withoutSuffix.replace(/\D/g, '');
}

function getJwtSecret() {
  return process.env.JWT_SECRET || process.env.SAK_JWT_SECRET;
}

function signToken({ userId, tenantId, role }) {
  const secret = getJwtSecret();
  if (!secret) throw new Error('JWT secret not configured (JWT_SECRET or SAK_JWT_SECRET)');

  const expiresIn = process.env.JWT_EXPIRES_IN || '7d';
  return jwt.sign({ userId, tenantId, role }, secret, { expiresIn });
}

function setAuthCookie(res, token) {
  const secure = process.env.NODE_ENV === 'production';
  res.cookie('sak_auth', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/'
  });
}

/**
 * POST /api/crm/auth/login
 * Body: { tenantId, emailOrPhone, password }
 */
router.post('/login', async (req, res) => {
  try {
    const { tenantId, emailOrPhone, password } = req.body || {};
    if (!tenantId || !emailOrPhone || !password) {
      return res.status(400).json({ success: false, error: 'tenantId, emailOrPhone, password required' });
    }

    let { data: user, error } = await supabase
      .from('crm_users')
      .select('*')
      .eq('tenant_id', tenantId)
      .or(`email.eq.${String(emailOrPhone).toLowerCase()},phone.eq.${String(emailOrPhone)}`)
      .maybeSingle();

    if (error) throw error;

    // Lazy bootstrap: if no CRM user exists yet, allow provisioning an OWNER by validating against tenant password.
    if (!user) {
      const { data: tenant, error: tenantErr } = await supabase
        .from('tenants')
        .select('id, business_name, email, phone_number, owner_whatsapp_number, password')
        .eq('id', tenantId)
        .maybeSingle();

      if (tenantErr) throw tenantErr;

      const storedTenantPassword = tenant?.password ? String(tenant.password) : '';
      if (!tenant || !storedTenantPassword || String(password) !== storedTenantPassword) {
        return res.status(401).json({ success: false, error: 'invalid_credentials' });
      }

      const phoneDigits = normalizePhoneDigits(tenant.phone_number || tenant.owner_whatsapp_number) || normalizePhoneDigits(emailOrPhone);
      const hash = bcrypt.hashSync(String(password), 10);

      const { data: createdUser, error: createErr } = await supabase
        .from('crm_users')
        .insert({
          tenant_id: tenantId,
          role: 'OWNER',
          full_name: `${tenant.business_name || 'Tenant'} Owner`,
          email: tenant.email ? String(tenant.email).trim().toLowerCase() : null,
          phone: phoneDigits || null,
          is_active: true,
          password_hash: hash
        })
        .select('*')
        .single();

      if (createErr) throw createErr;
      user = createdUser;
    }

    if (!user || !user.is_active) return res.status(401).json({ success: false, error: 'invalid_credentials' });

    const ok = user.password_hash ? bcrypt.compareSync(String(password), String(user.password_hash)) : false;
    if (!ok) return res.status(401).json({ success: false, error: 'invalid_credentials' });

    const token = signToken({ userId: user.id, tenantId: user.tenant_id, role: user.role });
    setAuthCookie(res, token);

    return res.json({
      success: true,
      user: { id: user.id, tenantId: user.tenant_id, role: user.role, fullName: user.full_name, email: user.email, phone: user.phone }
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: 'login_failed', details: e?.message || String(e) });
  }
});

/**
 * POST /api/crm/auth/logout
 */
router.post('/logout', (req, res) => {
  res.clearCookie('sak_auth', { path: '/' });
  return res.json({ success: true });
});

/**
 * GET /api/crm/auth/me
 */
router.get('/me', requireCrmAuth, requireCrmFeature(CRM_FEATURES.CRM_CORE), async (req, res) => {
  return res.json({ success: true, user: req.user });
});

module.exports = router;
