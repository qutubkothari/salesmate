// middleware/authMiddleware.js
// Authentication Middleware for Multi-User System

const userAuthService = require('../services/userAuthService');
const { dbClient } = require('../services/config');

/**
 * Middleware to validate user session
 * Adds user object to req.user
 */
async function requireAuth(req, res, next) {
  try {
    // Check for session token in headers
    const authHeader = req.headers.authorization;
    let sessionToken = null;
    
    if (authHeader && authHeader.startsWith('Bearer ')) {
      sessionToken = authHeader.substring(7);
    }
    
    // Also check cookies for web sessions
    if (!sessionToken && req.cookies && req.cookies.session_token) {
      sessionToken = req.cookies.session_token;
    }
    
    if (!sessionToken) {
      return res.status(401).json({ error: 'No session token provided' });
    }
    
    // Validate session
    const result = await userAuthService.validateSession(sessionToken);
    
    if (!result.success) {
      return res.status(401).json({ error: 'Invalid or expired session' });
    }
    
    // Attach user and session to request
    req.user = result.user;
    req.session = result.session;
    
    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    res.status(500).json({ error: 'Authentication failed' });
  }
}

/**
 * Optional auth - doesn't fail if no token, but validates if present
 */
async function optionalAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    let sessionToken = null;
    
    if (authHeader && authHeader.startsWith('Bearer ')) {
      sessionToken = authHeader.substring(7);
    }
    
    if (!sessionToken && req.cookies && req.cookies.session_token) {
      sessionToken = req.cookies.session_token;
    }
    
    if (sessionToken) {
      const result = await userAuthService.validateSession(sessionToken);
      
      if (result.success) {
        req.user = result.user;
        req.session = result.session;
      }
    }
    
    next();
  } catch (error) {
    console.error('Optional auth error:', error);
    next();
  }
}

/**
 * Legacy tenant auth middleware (for backward compatibility)
 * This checks the old web_auth_token system
 */
async function requireTenantAuth(req, res, next) {
  try {
    const authToken = req.headers['x-auth-token'] || req.query.authToken;
    
    if (!authToken) {
      return res.status(401).json({ error: 'No auth token provided' });
    }
    
    // Check if it's a user session token (new system)
    if (authToken.length > 32) {
      const result = await userAuthService.validateSession(authToken);
      
      if (result.success) {
        req.user = result.user;
        req.session = result.session;
        req.tenantId = result.user.tenant_id;
        return next();
      }
    }
    
    // Fall back to old tenant auth system
    const { data: tenant, error } = await dbClient
      .from('tenants')
      .select('*')
      .eq('web_auth_token', authToken)
      .single();
    
    if (error || !tenant) {
      return res.status(401).json({ error: 'Invalid auth token' });
    }
    
    req.tenantId = tenant.id;
    req.tenant = tenant;
    
    next();
  } catch (error) {
    console.error('Tenant auth error:', error);
    res.status(500).json({ error: 'Authentication failed' });
  }
}

/**
 * Hybrid auth - accepts both user sessions and tenant tokens
 * Prioritizes user sessions
 */
async function requireHybridAuth(req, res, next) {
  try {
    // Try user session first
    const authHeader = req.headers.authorization;
    let sessionToken = null;
    
    if (authHeader && authHeader.startsWith('Bearer ')) {
      sessionToken = authHeader.substring(7);
    }
    
    if (!sessionToken && req.cookies && req.cookies.session_token) {
      sessionToken = req.cookies.session_token;
    }
    
    if (sessionToken) {
      const result = await userAuthService.validateSession(sessionToken);
      
      if (result.success) {
        req.user = result.user;
        req.session = result.session;
        req.tenantId = result.user.tenant_id;
        return next();
      }
    }
    
    // Fall back to tenant token
    const authToken = req.headers['x-auth-token'] || req.query.authToken;
    
    if (authToken) {
      const { data: tenant, error } = await dbClient
        .from('tenants')
        .select('*')
        .eq('web_auth_token', authToken)
        .single();
      
      if (!error && tenant) {
        req.tenantId = tenant.id;
        req.tenant = tenant;
        return next();
      }
    }
    
    return res.status(401).json({ error: 'Authentication required' });
  } catch (error) {
    console.error('Hybrid auth error:', error);
    res.status(500).json({ error: 'Authentication failed' });
  }
}

/**
 * Extract tenant ID from request
 */
function getTenantId(req) {
  if (req.user) {
    return req.user.tenant_id;
  }
  if (req.tenantId) {
    return req.tenantId;
  }
  return null;
}

/**
 * Extract user ID from request (returns null if tenant-level auth)
 */
function getUserId(req) {
  if (req.user) {
    return req.user.id;
  }
  return null;
}

module.exports = {
  requireAuth,
  optionalAuth,
  requireTenantAuth,
  requireHybridAuth,
  getTenantId,
  getUserId
};
