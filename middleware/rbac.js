/**
 * RBAC Middleware
 * Protect routes with role-based access control
 */

const RBACService = require('../services/rbac-service');

/**
 * Middleware to check if user has required permission
 * @param {string|string[]} requiredPermissions - Permission code(s) required
 * @param {string} mode - 'any' (has at least one) or 'all' (has all)
 */
function requirePermission(requiredPermissions, mode = 'any') {
  return (req, res, next) => {
    const userId = req.user?.id || req.userId || req.headers['x-user-id'];

    if (!userId) {
      return res.status(401).json({ 
        error: 'Authentication required',
        code: 'AUTH_REQUIRED'
      });
    }

    const permissions = Array.isArray(requiredPermissions) ? requiredPermissions : [requiredPermissions];
    
    let hasAccess = false;
    if (mode === 'all') {
      hasAccess = RBACService.hasAllPermissions(userId, permissions);
    } else {
      hasAccess = RBACService.hasAnyPermission(userId, permissions);
    }

    if (!hasAccess) {
      return res.status(403).json({ 
        error: 'Insufficient permissions',
        code: 'FORBIDDEN',
        required: permissions,
        message: `This action requires: ${permissions.join(' or ')}`
      });
    }

    // Attach permissions to request for further checks
    req.userPermissions = RBACService.getUserPermissions(userId);
    next();
  };
}

/**
 * Middleware to check if user has required role
 * @param {string|string[]} requiredRoles - Role code(s) required
 */
function requireRole(requiredRoles) {
  return (req, res, next) => {
    const userId = req.user?.id || req.userId || req.headers['x-user-id'];

    if (!userId) {
      return res.status(401).json({ 
        error: 'Authentication required',
        code: 'AUTH_REQUIRED'
      });
    }

    const roles = Array.isArray(requiredRoles) ? requiredRoles : [requiredRoles];
    const hasRole = roles.some(role => RBACService.hasRole(userId, role));

    if (!hasRole) {
      return res.status(403).json({ 
        error: 'Insufficient privileges',
        code: 'FORBIDDEN',
        required: roles,
        message: `This action requires one of these roles: ${roles.join(', ')}`
      });
    }

    req.userRoles = RBACService.getUserRoles(userId);
    next();
  };
}

/**
 * Middleware to check resource-level access
 * @param {string} resourceType - Type of resource
 * @param {string} resourceIdParam - Request parameter containing resource ID
 * @param {string} requiredLevel - Required permission level
 */
function requireResourceAccess(resourceType, resourceIdParam = 'id', requiredLevel = 'view') {
  return (req, res, next) => {
    const userId = req.user?.id || req.userId || req.headers['x-user-id'];
    const resourceId = req.params[resourceIdParam] || req.body[resourceIdParam];

    if (!userId) {
      return res.status(401).json({ 
        error: 'Authentication required',
        code: 'AUTH_REQUIRED'
      });
    }

    if (!resourceId) {
      return res.status(400).json({ 
        error: 'Resource ID required',
        code: 'INVALID_REQUEST'
      });
    }

    const hasAccess = RBACService.hasResourcePermission(userId, resourceType, resourceId, requiredLevel);

    if (!hasAccess) {
      return res.status(403).json({ 
        error: 'Access denied to this resource',
        code: 'RESOURCE_FORBIDDEN',
        message: `You don't have ${requiredLevel} access to this ${resourceType}`
      });
    }

    next();
  };
}

/**
 * Middleware to check team hierarchy access
 * Allows managers to access their team members' data
 */
function requireTeamAccess(memberIdParam = 'id') {
  return (req, res, next) => {
    const managerId = req.user?.id || req.userId || req.headers['x-user-id'];
    const memberId = req.params[memberIdParam] || req.body[memberIdParam];

    if (!managerId) {
      return res.status(401).json({ 
        error: 'Authentication required',
        code: 'AUTH_REQUIRED'
      });
    }

    if (!memberId) {
      return res.status(400).json({ 
        error: 'Member ID required',
        code: 'INVALID_REQUEST'
      });
    }

    const canAccess = RBACService.canAccessTeamMemberData(managerId, memberId);

    if (!canAccess) {
      return res.status(403).json({ 
        error: 'Access denied - not in your team',
        code: 'TEAM_ACCESS_DENIED',
        message: 'You can only access data for your team members'
      });
    }

    next();
  };
}

/**
 * Middleware to attach user's permissions and roles to request
 * Useful for conditional UI rendering
 */
function attachUserContext(req, res, next) {
  const userId = req.user?.id || req.userId || req.headers['x-user-id'];

  if (userId) {
    req.userPermissions = RBACService.getUserPermissions(userId);
    req.userRoles = RBACService.getUserRoles(userId);
    req.teamMembers = RBACService.getTeamMembers(userId);
  }

  next();
}

module.exports = {
  requirePermission,
  requireRole,
  requireResourceAccess,
  requireTeamAccess,
  attachUserContext
};
