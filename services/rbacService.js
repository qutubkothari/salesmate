// services/rbacService.js
// Role-Based Access Control Service

const { dbClient } = require('./config');

// ============================================
// Roles
// ============================================

const ROLES = {
  SUPER_ADMIN: 'super_admin',
  TENANT_ADMIN: 'tenant_admin',
  SALES_MANAGER: 'sales_manager',
  SALESMAN: 'salesman'
};

// ============================================
// Permissions
// ============================================

const PERMISSIONS = {
  // Email permissions
  VIEW_ALL_EMAILS: 'view_all_emails',
  VIEW_OWN_EMAILS: 'view_own_emails',
  VIEW_TEAM_EMAILS: 'view_team_emails',
  ASSIGN_EMAILS: 'assign_emails',
  DELETE_EMAILS: 'delete_emails',
  REPLY_EMAILS: 'reply_emails',
  
  // Conversation permissions
  VIEW_ALL_CONVERSATIONS: 'view_all_conversations',
  VIEW_OWN_CONVERSATIONS: 'view_own_conversations',
  VIEW_TEAM_CONVERSATIONS: 'view_team_conversations',
  MANAGE_CONVERSATIONS: 'manage_conversations',
  
  // Order permissions
  VIEW_ALL_ORDERS: 'view_all_orders',
  VIEW_OWN_ORDERS: 'view_own_orders',
  VIEW_TEAM_ORDERS: 'view_team_orders',
  CREATE_ORDERS: 'create_orders',
  EDIT_ORDERS: 'edit_orders',
  DELETE_ORDERS: 'delete_orders',
  
  // Product permissions
  VIEW_PRODUCTS: 'view_products',
  MANAGE_PRODUCTS: 'manage_products',
  
  // User management
  VIEW_TEAM: 'view_team',
  MANAGE_USERS: 'manage_users',
  INVITE_USERS: 'invite_users',
  
  // Settings
  VIEW_SETTINGS: 'view_settings',
  MANAGE_SETTINGS: 'manage_settings',
  
  // Analytics
  VIEW_OWN_ANALYTICS: 'view_own_analytics',
  VIEW_TEAM_ANALYTICS: 'view_team_analytics',
  VIEW_ALL_ANALYTICS: 'view_all_analytics',
  
  // WhatsApp
  MANAGE_OWN_WHATSAPP: 'manage_own_whatsapp',
  VIEW_ALL_WHATSAPP: 'view_all_whatsapp',
  
  // Broadcast
  SEND_BROADCAST: 'send_broadcast',
  VIEW_BROADCAST_HISTORY: 'view_broadcast_history',
  
  // Super admin only
  MANAGE_ALL_TENANTS: 'manage_all_tenants',
  VIEW_ALL_TENANTS: 'view_all_tenants'
};

// ============================================
// Role-Permission Mapping
// ============================================

const ROLE_PERMISSIONS = {
  [ROLES.SUPER_ADMIN]: ['*'], // All permissions
  
  [ROLES.TENANT_ADMIN]: [
    // Email
    PERMISSIONS.VIEW_ALL_EMAILS,
    PERMISSIONS.ASSIGN_EMAILS,
    PERMISSIONS.DELETE_EMAILS,
    PERMISSIONS.REPLY_EMAILS,
    
    // Conversations
    PERMISSIONS.VIEW_ALL_CONVERSATIONS,
    PERMISSIONS.MANAGE_CONVERSATIONS,
    
    // Orders
    PERMISSIONS.VIEW_ALL_ORDERS,
    PERMISSIONS.CREATE_ORDERS,
    PERMISSIONS.EDIT_ORDERS,
    PERMISSIONS.DELETE_ORDERS,
    
    // Products
    PERMISSIONS.VIEW_PRODUCTS,
    PERMISSIONS.MANAGE_PRODUCTS,
    
    // Users
    PERMISSIONS.VIEW_TEAM,
    PERMISSIONS.MANAGE_USERS,
    PERMISSIONS.INVITE_USERS,
    
    // Settings
    PERMISSIONS.VIEW_SETTINGS,
    PERMISSIONS.MANAGE_SETTINGS,
    
    // Analytics
    PERMISSIONS.VIEW_ALL_ANALYTICS,
    
    // WhatsApp
    PERMISSIONS.MANAGE_OWN_WHATSAPP,
    PERMISSIONS.VIEW_ALL_WHATSAPP,
    
    // Broadcast
    PERMISSIONS.SEND_BROADCAST,
    PERMISSIONS.VIEW_BROADCAST_HISTORY
  ],
  
  [ROLES.SALES_MANAGER]: [
    // Email
    PERMISSIONS.VIEW_TEAM_EMAILS,
    PERMISSIONS.VIEW_OWN_EMAILS,
    PERMISSIONS.ASSIGN_EMAILS,
    PERMISSIONS.REPLY_EMAILS,
    
    // Conversations
    PERMISSIONS.VIEW_TEAM_CONVERSATIONS,
    PERMISSIONS.VIEW_OWN_CONVERSATIONS,
    
    // Orders
    PERMISSIONS.VIEW_TEAM_ORDERS,
    PERMISSIONS.VIEW_OWN_ORDERS,
    PERMISSIONS.CREATE_ORDERS,
    
    // Products
    PERMISSIONS.VIEW_PRODUCTS,
    
    // Users
    PERMISSIONS.VIEW_TEAM,
    
    // Settings
    PERMISSIONS.VIEW_SETTINGS,
    
    // Analytics
    PERMISSIONS.VIEW_TEAM_ANALYTICS,
    PERMISSIONS.VIEW_OWN_ANALYTICS,
    
    // WhatsApp
    PERMISSIONS.MANAGE_OWN_WHATSAPP,
    
    // Broadcast
    PERMISSIONS.SEND_BROADCAST,
    PERMISSIONS.VIEW_BROADCAST_HISTORY
  ],
  
  [ROLES.SALESMAN]: [
    // Email
    PERMISSIONS.VIEW_OWN_EMAILS,
    PERMISSIONS.REPLY_EMAILS,
    
    // Conversations
    PERMISSIONS.VIEW_OWN_CONVERSATIONS,
    
    // Orders
    PERMISSIONS.VIEW_OWN_ORDERS,
    PERMISSIONS.CREATE_ORDERS,
    
    // Products
    PERMISSIONS.VIEW_PRODUCTS,
    
    // Users
    PERMISSIONS.VIEW_TEAM,
    
    // Settings
    PERMISSIONS.VIEW_SETTINGS,
    
    // Analytics
    PERMISSIONS.VIEW_OWN_ANALYTICS,
    
    // WhatsApp
    PERMISSIONS.MANAGE_OWN_WHATSAPP
  ]
};

// ============================================
// Permission Checking Functions
// ============================================

/**
 * Check if user has permission
 */
function hasPermission(userRole, permission) {
  const permissions = ROLE_PERMISSIONS[userRole];
  
  if (!permissions) {
    return false;
  }
  
  // Super admin has all permissions
  if (permissions.includes('*')) {
    return true;
  }
  
  return permissions.includes(permission);
}

/**
 * Check if user has any of the permissions
 */
function hasAnyPermission(userRole, permissionList) {
  return permissionList.some(permission => hasPermission(userRole, permission));
}

/**
 * Check if user has all permissions
 */
function hasAllPermissions(userRole, permissionList) {
  return permissionList.every(permission => hasPermission(userRole, permission));
}

/**
 * Get all permissions for a role
 */
function getRolePermissions(role) {
  return ROLE_PERMISSIONS[role] || [];
}

/**
 * Check if user can access resource
 */
function canAccessResource(user, resourceType, resource) {
  const role = user.role;
  
  // Super admin can access everything
  if (role === ROLES.SUPER_ADMIN) {
    return true;
  }
  
  // Tenant admin can access everything in their tenant
  if (role === ROLES.TENANT_ADMIN && resource.tenant_id === user.tenant_id) {
    return true;
  }
  
  // Sales manager can access team resources
  if (role === ROLES.SALES_MANAGER) {
    if (resourceType === 'email' || resourceType === 'conversation' || resourceType === 'order') {
      // Can access if resource belongs to their tenant and is assigned to someone in their team
      return resource.tenant_id === user.tenant_id;
    }
  }
  
  // Salesman can only access own resources
  if (role === ROLES.SALESMAN) {
    if (resourceType === 'email') {
      return resource.salesman_id === user.id || resource.assigned_to === user.id;
    }
    if (resourceType === 'conversation') {
      return resource.salesman_id === user.id || resource.assigned_to === user.id;
    }
    if (resourceType === 'order') {
      return resource.salesman_id === user.id;
    }
  }
  
  return false;
}

/**
 * Apply role-based query filters
 */
function applyRoleFilters(query, user, resourceType) {
  const role = user.role;
  
  // Super admin sees everything
  if (role === ROLES.SUPER_ADMIN) {
    return query;
  }
  
  // All other roles are filtered by tenant
  query = query.eq('tenant_id', user.tenant_id);
  
  // Tenant admin sees everything in their tenant
  if (role === ROLES.TENANT_ADMIN) {
    return query;
  }
  
  // Sales manager sees team data
  if (role === ROLES.SALES_MANAGER) {
    // For now, sales manager sees all data in tenant
    // Could be enhanced to filter by team assignment
    return query;
  }
  
  // Salesman only sees own data
  if (role === ROLES.SALESMAN) {
    if (resourceType === 'email') {
      query = query.or(`salesman_id.eq.${user.id},assigned_to.eq.${user.id}`);
    } else if (resourceType === 'conversation') {
      query = query.or(`salesman_id.eq.${user.id},assigned_to.eq.${user.id}`);
    } else if (resourceType === 'order') {
      query = query.eq('salesman_id', user.id);
    }
  }
  
  return query;
}

/**
 * Middleware to check permission
 */
function requirePermission(...permissions) {
  return (req, res, next) => {
    const user = req.user;
    
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    const hasRequired = permissions.every(permission => hasPermission(user.role, permission));
    
    if (!hasRequired) {
      return res.status(403).json({ 
        error: 'Forbidden',
        message: 'You do not have permission to perform this action'
      });
    }
    
    next();
  };
}

/**
 * Middleware to require any of the permissions
 */
function requireAnyPermission(...permissions) {
  return (req, res, next) => {
    const user = req.user;
    
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    const hasRequired = hasAnyPermission(user.role, permissions);
    
    if (!hasRequired) {
      return res.status(403).json({ 
        error: 'Forbidden',
        message: 'You do not have permission to perform this action'
      });
    }
    
    next();
  };
}

/**
 * Middleware to check role
 */
function requireRole(...roles) {
  return (req, res, next) => {
    const user = req.user;
    
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    if (!roles.includes(user.role)) {
      return res.status(403).json({ 
        error: 'Forbidden',
        message: 'You do not have the required role to perform this action'
      });
    }
    
    next();
  };
}

/**
 * Check if user is admin (tenant admin or super admin)
 */
function isAdmin(userRole) {
  return [ROLES.SUPER_ADMIN, ROLES.TENANT_ADMIN].includes(userRole);
}

/**
 * Check if user is manager or above
 */
function isManagerOrAbove(userRole) {
  return [ROLES.SUPER_ADMIN, ROLES.TENANT_ADMIN, ROLES.SALES_MANAGER].includes(userRole);
}

// ============================================
// Exports
// ============================================

module.exports = {
  ROLES,
  PERMISSIONS,
  ROLE_PERMISSIONS,
  hasPermission,
  hasAnyPermission,
  hasAllPermissions,
  getRolePermissions,
  canAccessResource,
  applyRoleFilters,
  requirePermission,
  requireAnyPermission,
  requireRole,
  isAdmin,
  isManagerOrAbove
};

