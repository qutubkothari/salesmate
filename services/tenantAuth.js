const crypto = require('crypto');
const { dbClient } = require('./config');

function sha256Hex(input) {
  return crypto.createHash('sha256').update(String(input), 'utf8').digest('hex');
}

function getHeader(req, name) {
  const key = String(name || '').toLowerCase();
  return req?.headers?.[key] || req?.headers?.[name] || null;
}

function getBearerToken(req) {
  const auth = getHeader(req, 'authorization');
  if (!auth) return null;
  const m = String(auth).match(/^\s*Bearer\s+(.+?)\s*$/i);
  return m ? m[1] : null;
}

function getApiKey(req) {
  // Common variants
  return (
    getHeader(req, 'x-api-key') ||
    getHeader(req, 'x-api_key') ||
    getHeader(req, 'x-apikey') ||
    null
  );
}

async function resolveTenantByBearerToken(token) {
  const t = String(token || '').trim();
  if (!t) return null;

  // Preserve existing demo behavior
  if (t === 'demo' || t === 'demo-token') {
    const { data: tenants } = await dbClient.from('tenants').select('id, business_name').limit(1);
    if (tenants && tenants.length > 0) {
      return { tenantId: tenants[0].id, tenant: tenants[0], authType: 'bearer_demo' };
    }
    return null;
  }

  const nowIso = new Date().toISOString();

  // Match existing token model (magic link / web_auth_token)
  const { data: tenant, error } = await dbClient
    .from('tenants')
    .select('id, business_name, web_auth_token_expires_at')
    .eq('web_auth_token', t)
    .or(`web_auth_token_expires_at.is.null,web_auth_token_expires_at.gt.${nowIso}`)
    .maybeSingle();

  if (!error && tenant) {
    return { tenantId: tenant.id, tenant, authType: 'bearer' };
  }

  // Fallback: treat bearer as tenantId directly for internal dashboard usage
  try {
    const { data: tenantById, error: err2 } = await dbClient
      .from('tenants')
      .select('id, business_name')
      .eq('id', t)
      .maybeSingle();
    if (!err2 && tenantById) {
      return { tenantId: tenantById.id, tenant: tenantById, authType: 'bearer_tenant_id' };
    }
  } catch (_) {}

  return null;
}

async function resolveTenantByApiKey(apiKey) {
  const raw = String(apiKey || '').trim();
  if (!raw) return null;

  const keyHash = sha256Hex(raw);

  const { data: keyRow, error } = await dbClient
    .from('api_keys')
    .select('id, tenant_id, revoked_at')
    .eq('key_hash', keyHash)
    .is('revoked_at', null)
    .maybeSingle();

  if (error || !keyRow) return null;

  // Best-effort last_used_at update (fail-open)
  try {
    await dbClient
      .from('api_keys')
      .update({ last_used_at: new Date().toISOString() })
      .eq('id', keyRow.id);
  } catch (_) {}

  return { tenantId: keyRow.tenant_id, apiKeyId: keyRow.id, authType: 'api_key' };
}

async function authenticateRequest(req) {
  // Prefer API key when present (integrations)
  const apiKey = getApiKey(req);
  if (apiKey) {
    const resolved = await resolveTenantByApiKey(apiKey);
    if (resolved) return resolved;
  }

  const bearer = getBearerToken(req);
  if (bearer) {
    const resolved = await resolveTenantByBearerToken(bearer);
    if (resolved) return resolved;
  }

  // Fallback: accept explicit tenant hint header for trusted, internal dashboard requests
  // This is less secure than API keys or web_auth_token, so only use when explicitly allowed by route options
  const tenantHint = getHeader(req, 'x-tenant-id') || getHeader(req, 'x-tenant') || getHeader(req, 'x-tenantid');
  if (tenantHint) {
    try {
      const { data: tenant, error } = await dbClient
        .from('tenants')
        .select('id, business_name')
        .eq('id', String(tenantHint))
        .maybeSingle();
      if (!error && tenant && tenant.id) {
        return { tenantId: tenant.id, tenant, authType: 'tenant_hint' };
      }
    } catch (_) {}
  }

  return null;
}

function requireTenantAuth(options = {}) {
  const {
    allowApiKey = true,
    allowBearer = true,
    requireMatchParamTenantId = true,
    tenantIdParam = 'tenantId'
  } = options;

  return async (req, res, next) => {
    try {
      const apiKey = allowApiKey ? getApiKey(req) : null;
      const bearer = allowBearer ? getBearerToken(req) : null;

      let resolved = null;
      if (apiKey) resolved = await resolveTenantByApiKey(apiKey);
      if (!resolved && bearer) resolved = await resolveTenantByBearerToken(bearer);
      // Allow fallback tenant hint header when no apiKey/bearer was provided
      if (!resolved) {
        const tenantHint = getHeader(req, 'x-tenant-id') || getHeader(req, 'x-tenant') || getHeader(req, 'x-tenantid');
        if (tenantHint) {
          try {
            const { data: tenant, error } = await dbClient
              .from('tenants')
              .select('id, business_name')
              .eq('id', String(tenantHint))
              .maybeSingle();
            if (!error && tenant && tenant.id) {
              resolved = { tenantId: tenant.id, tenant, authType: 'tenant_hint' };
            }
          } catch (_) {}
        }
      }

      if (!resolved || !resolved.tenantId) {
        const hasBearer = Boolean(bearer);
        const hasApiKey = Boolean(apiKey);
        const tenantHint = getHeader(req, 'x-tenant-id') || getHeader(req, 'x-tenant') || getHeader(req, 'x-tenantid');
        console.warn('[AUTH] Unauthorized request', {
          path: req.originalUrl,
          hasBearer,
          hasApiKey,
          hasTenantHint: Boolean(tenantHint),
        });
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }

      if (requireMatchParamTenantId && req.params?.[tenantIdParam]) {
        if (String(req.params[tenantIdParam]) !== String(resolved.tenantId)) {
          return res.status(403).json({ success: false, error: 'Forbidden' });
        }
      }

      req.auth = resolved;
      next();
    } catch (e) {
      console.error('[AUTH] tenant auth error:', e?.message || e);
      res.status(500).json({ success: false, error: 'Auth error' });
    }
  };
}

function requireBearerTenant(options = {}) {
  return requireTenantAuth({ ...options, allowApiKey: false, allowBearer: true });
}

function generateApiKeyString() {
  // Human-identifiable prefix, then strong random
  const rnd = crypto.randomBytes(32).toString('hex');
  return `smk_${rnd}`;
}

async function createApiKey({ tenantId, name }) {
  const apiKey = generateApiKeyString();
  const keyHash = sha256Hex(apiKey);
  const keyPrefix = apiKey.slice(0, 12);

  const row = {
    tenant_id: String(tenantId),
    name: String(name || 'API Key'),
    key_hash: keyHash,
    key_prefix: keyPrefix,
    created_at: new Date().toISOString()
  };

  const { data, error } = await dbClient.from('api_keys').insert(row).select('id, tenant_id, name, key_prefix, created_at').single();
  if (error) throw error;

  return { apiKey, record: data };
}

module.exports = {
  sha256Hex,
  getBearerToken,
  getApiKey,
  authenticateRequest,
  requireTenantAuth,
  requireBearerTenant,
  createApiKey,
};

