const jwt = require('jsonwebtoken');

function getJwtSecret() {
  const secret = process.env.JWT_SECRET || process.env.SAK_JWT_SECRET;
  if (!secret) {
    // Fail closed.
    throw new Error('JWT secret not configured (set JWT_SECRET or SAK_JWT_SECRET)');
  }
  return secret;
}

function readAuthToken(req) {
  // cookie-parser populates req.cookies
  const cookieToken = req.cookies?.sak_auth;
  if (cookieToken) return cookieToken;

  const hdr = req.get('authorization') || req.get('Authorization');
  if (hdr && /^Bearer\s+/i.test(hdr)) return hdr.replace(/^Bearer\s+/i, '').trim();

  return null;
}

function getDevHeaderIdentity(req) {
  if (process.env.DEV_HEADER_AUTH !== '1') return null;
  const tenantId = req.get('x-tenant-id');
  const userId = req.get('x-user-id');
  const role = req.get('x-role');
  if (!tenantId || !userId || !role) return null;
  return { tenantId, userId, role };
}

function requireCrmAuth(req, res, next) {
  try {
    const dev = getDevHeaderIdentity(req);
    if (dev) {
      req.user = { id: dev.userId, tenantId: dev.tenantId, role: String(dev.role).toUpperCase() };
      return next();
    }

    const token = readAuthToken(req);
    if (!token) return res.status(401).json({ success: false, error: 'unauthorized' });

    const payload = jwt.verify(token, getJwtSecret());
    if (!payload?.tenantId || !payload?.userId || !payload?.role) {
      return res.status(401).json({ success: false, error: 'invalid_token' });
    }

    req.user = { id: payload.userId, tenantId: payload.tenantId, role: String(payload.role).toUpperCase() };
    return next();
  } catch (e) {
    return res.status(401).json({ success: false, error: 'unauthorized', details: e?.message || String(e) });
  }
}

function requireRole(allowedRoles) {
  const allowed = (allowedRoles || []).map(r => String(r).toUpperCase());
  return (req, res, next) => {
    const role = req.user?.role;
    if (!role) return res.status(401).json({ success: false, error: 'unauthorized' });
    if (!allowed.includes(role)) {
      return res.status(403).json({ success: false, error: 'forbidden', role, allowed });
    }
    return next();
  };
}

module.exports = {
  requireCrmAuth,
  requireRole
};
