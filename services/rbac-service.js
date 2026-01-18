/**
 * Enterprise RBAC Service
 * Provides role-based access control, permission checking, and authorization
 */

const { db } = require('./config');

class RBACService {
  /**
   * Check if user has a specific permission
   * @param {string} userId - User ID
   * @param {string} permissionCode - Permission code (e.g., 'products.create')
   * @returns {boolean}
   */
  static hasPermission(userId, permissionCode) {
    try {
      const result = db.prepare(`
        SELECT 1
        FROM user_roles ur
        JOIN role_permissions rp ON ur.role_id = rp.role_id
        JOIN permissions p ON rp.permission_id = p.id
        WHERE ur.user_id = ? 
          AND p.permission_code = ?
          AND ur.is_active = 1
          AND (ur.expires_at IS NULL OR ur.expires_at > datetime('now'))
        LIMIT 1
      `).get(userId, permissionCode);

      return !!result;
    } catch (error) {
      console.error('Permission check error:', error);
      return false;
    }
  }

  /**
   * Check if user has any of the specified permissions
   * @param {string} userId - User ID
   * @param {string[]} permissionCodes - Array of permission codes
   * @returns {boolean}
   */
  static hasAnyPermission(userId, permissionCodes) {
    return permissionCodes.some(code => this.hasPermission(userId, code));
  }

  /**
   * Check if user has all specified permissions
   * @param {string} userId - User ID
   * @param {string[]} permissionCodes - Array of permission codes
   * @returns {boolean}
   */
  static hasAllPermissions(userId, permissionCodes) {
    return permissionCodes.every(code => this.hasPermission(userId, code));
  }

  /**
   * Get all permissions for a user
   * @param {string} userId - User ID
   * @returns {Array} List of permission codes
   */
  static getUserPermissions(userId) {
    try {
      const permissions = db.prepare(`
        SELECT DISTINCT p.permission_code, p.permission_name, p.resource, p.action, p.description
        FROM user_roles ur
        JOIN role_permissions rp ON ur.role_id = rp.role_id
        JOIN permissions p ON rp.permission_id = p.id
        WHERE ur.user_id = ? 
          AND ur.is_active = 1
          AND (ur.expires_at IS NULL OR ur.expires_at > datetime('now'))
        ORDER BY p.resource, p.action
      `).all(userId);

      return permissions;
    } catch (error) {
      console.error('Get permissions error:', error);
      return [];
    }
  }

  /**
   * Get user's roles
   * @param {string} userId - User ID
   * @returns {Array} List of roles
   */
  static getUserRoles(userId) {
    try {
      const roles = db.prepare(`
        SELECT r.id, r.role_name, r.role_code, r.description, r.hierarchy_level,
               ur.assigned_at, ur.expires_at
        FROM user_roles ur
        JOIN roles r ON ur.role_id = r.id
        WHERE ur.user_id = ? 
          AND ur.is_active = 1
          AND (ur.expires_at IS NULL OR ur.expires_at > datetime('now'))
        ORDER BY r.hierarchy_level DESC
      `).all(userId);

      return roles;
    } catch (error) {
      console.error('Get roles error:', error);
      return [];
    }
  }

  /**
   * Check if user has a specific role
   * @param {string} userId - User ID
   * @param {string} roleCode - Role code (e.g., 'admin', 'manager')
   * @returns {boolean}
   */
  static hasRole(userId, roleCode) {
    try {
      const result = db.prepare(`
        SELECT 1
        FROM user_roles ur
        JOIN roles r ON ur.role_id = r.id
        WHERE ur.user_id = ? 
          AND r.role_code = ?
          AND ur.is_active = 1
          AND (ur.expires_at IS NULL OR ur.expires_at > datetime('now'))
        LIMIT 1
      `).get(userId, roleCode);

      return !!result;
    } catch (error) {
      console.error('Role check error:', error);
      return false;
    }
  }

  /**
   * Assign role to user
   * @param {string} userId - User ID
   * @param {string} roleId - Role ID
   * @param {string} assignedBy - User ID who is assigning
   * @param {string} expiresAt - Optional expiration date
   */
  static assignRole(userId, roleId, assignedBy, expiresAt = null) {
    try {
      const id = require('crypto').randomBytes(16).toString('hex');
      
      db.prepare(`
        INSERT OR REPLACE INTO user_roles (id, user_id, role_id, assigned_by, expires_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(id, userId, roleId, assignedBy, expiresAt);

      // Log the assignment
      this.logPermissionChange(
        this.getUserTenantId(userId),
        assignedBy,
        'role_assigned',
        userId,
        roleId,
        null,
        null,
        null,
        { roleId, expiresAt }
      );

      return { success: true, id };
    } catch (error) {
      console.error('Assign role error:', error);
      throw error;
    }
  }

  /**
   * Revoke role from user
   * @param {string} userId - User ID
   * @param {string} roleId - Role ID
   * @param {string} revokedBy - User ID who is revoking
   */
  static revokeRole(userId, roleId, revokedBy) {
    try {
      db.prepare(`
        UPDATE user_roles 
        SET is_active = 0
        WHERE user_id = ? AND role_id = ?
      `).run(userId, roleId);

      // Log the revocation
      this.logPermissionChange(
        this.getUserTenantId(userId),
        revokedBy,
        'role_revoked',
        userId,
        roleId,
        null,
        null,
        null,
        { roleId }
      );

      return { success: true };
    } catch (error) {
      console.error('Revoke role error:', error);
      throw error;
    }
  }

  /**
   * Check resource-level permission
   * @param {string} userId - User ID
   * @param {string} resourceType - Type of resource (e.g., 'customer', 'order')
   * @param {string} resourceId - ID of the specific resource
   * @param {string} requiredLevel - Required permission level ('owner', 'edit', 'view')
   * @returns {boolean}
   */
  static hasResourcePermission(userId, resourceType, resourceId, requiredLevel = 'view') {
    try {
      const levels = { owner: 3, edit: 2, view: 1 };
      const required = levels[requiredLevel] || 1;

      const result = db.prepare(`
        SELECT permission_level
        FROM resource_permissions
        WHERE user_id = ? 
          AND resource_type = ? 
          AND resource_id = ?
      `).get(userId, resourceType, resourceId);

      if (!result) return false;

      const userLevel = levels[result.permission_level] || 0;
      return userLevel >= required;
    } catch (error) {
      console.error('Resource permission check error:', error);
      return false;
    }
  }

  /**
   * Check if user can access another user's data (team hierarchy)
   * @param {string} managerId - Manager's user ID
   * @param {string} memberId - Team member's user ID
   * @returns {boolean}
   */
  static canAccessTeamMemberData(managerId, memberId) {
    // Self-access always allowed
    if (managerId === memberId) return true;

    try {
      const result = db.prepare(`
        SELECT 1
        FROM team_hierarchy
        WHERE manager_id = ? 
          AND member_id = ?
          AND is_active = 1
          AND (effective_from IS NULL OR effective_from <= datetime('now'))
          AND (effective_to IS NULL OR effective_to >= datetime('now'))
        LIMIT 1
      `).get(managerId, memberId);

      return !!result;
    } catch (error) {
      console.error('Team access check error:', error);
      return false;
    }
  }

  /**
   * Get team members for a manager
   * @param {string} managerId - Manager's user ID
   * @returns {Array} List of team member IDs
   */
  static getTeamMembers(managerId) {
    try {
      const members = db.prepare(`
        SELECT th.member_id, u.phone, u.role,
               th.relationship_type, th.effective_from
        FROM team_hierarchy th
        JOIN users u ON th.member_id = u.id
        WHERE th.manager_id = ?
          AND th.is_active = 1
          AND (th.effective_from IS NULL OR th.effective_from <= datetime('now'))
          AND (th.effective_to IS NULL OR th.effective_to >= datetime('now'))
      `).all(managerId);

      return members;
    } catch (error) {
      console.error('Get team members error:', error);
      return [];
    }
  }

  /**
   * Log permission-related action for audit
   */
  static logPermissionChange(tenantId, userId, action, targetUserId, roleId, permissionId, resourceType, resourceId, details) {
    try {
      const id = require('crypto').randomBytes(16).toString('hex');
      
      db.prepare(`
        INSERT INTO permission_audit_log 
        (id, tenant_id, user_id, action, target_user_id, role_id, permission_id, 
         resource_type, resource_id, details)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id, tenantId, userId, action, targetUserId, roleId, permissionId,
        resourceType, resourceId, JSON.stringify(details)
      );
    } catch (error) {
      console.error('Log permission change error:', error);
    }
  }

  /**
   * Get user's tenant ID
   */
  static getUserTenantId(userId) {
    try {
      const user = db.prepare('SELECT tenant_id FROM users WHERE id = ?').get(userId);
      return user?.tenant_id || null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Initialize system roles for a tenant
   */
  static initializeSystemRoles(tenantId) {
    try {
      const systemRoles = [
        {
          code: 'super_admin',
          name: 'Super Administrator',
          desc: 'Full system access with all permissions',
          level: 100,
          permissions: [
            'products.*', 'orders.*', 'customers.*', 'pricing.*',
            'reports.*', 'analytics.*', 'users.*', 'settings.*', 'visits.*'
          ]
        },
        {
          code: 'admin',
          name: 'Administrator',
          desc: 'Administrative access to most features',
          level: 90,
          permissions: [
            'products.*', 'orders.*', 'customers.*', 'pricing.view', 'pricing.manage',
            'reports.*', 'analytics.*', 'users.read', 'users.update', 'visits.*'
          ]
        },
        {
          code: 'sales_manager',
          name: 'Sales Manager',
          desc: 'Manage sales team and approve orders',
          level: 70,
          permissions: [
            'products.read', 'orders.*', 'customers.*', 'pricing.view', 'pricing.override',
            'reports.view', 'reports.export', 'analytics.advanced', 'visits.approve'
          ]
        },
        {
          code: 'salesman',
          name: 'Field Salesman',
          desc: 'Create orders and manage assigned customers',
          level: 50,
          permissions: [
            'products.read', 'orders.create', 'orders.read', 'orders.update',
            'customers.create', 'customers.read', 'customers.update',
            'pricing.view', 'visits.create', 'visits.read', 'visits.update'
          ]
        },
        {
          code: 'customer_service',
          name: 'Customer Service',
          desc: 'Handle customer inquiries and order support',
          level: 40,
          permissions: [
            'products.read', 'orders.read', 'orders.update',
            'customers.read', 'customers.update', 'pricing.view', 'reports.view'
          ]
        },
        {
          code: 'accountant',
          name: 'Accountant',
          desc: 'Financial reporting and analytics',
          level: 60,
          permissions: [
            'orders.read', 'customers.read', 'pricing.view',
            'reports.*', 'analytics.advanced'
          ]
        }
      ];

      systemRoles.forEach(role => {
        const roleId = require('crypto').randomBytes(16).toString('hex');
        
        // Create role
        db.prepare(`
          INSERT OR IGNORE INTO roles (id, tenant_id, role_name, role_code, description, hierarchy_level, is_system_role)
          VALUES (?, ?, ?, ?, ?, ?, 1)
        `).run(roleId, tenantId, role.name, role.code, role.desc, role.level);

        // Assign permissions (simplified - assign all matching permissions)
        const createdRole = db.prepare('SELECT id FROM roles WHERE tenant_id = ? AND role_code = ?').get(tenantId, role.code);
        
        if (createdRole) {
          role.permissions.forEach(permPattern => {
            // Handle wildcard permissions like 'products.*'
            let permQuery;
            if (permPattern.endsWith('.*')) {
              const resource = permPattern.replace('.*', '');
              permQuery = `SELECT id FROM permissions WHERE resource = '${resource}'`;
            } else {
              permQuery = `SELECT id FROM permissions WHERE permission_code = '${permPattern}'`;
            }

            const perms = db.prepare(permQuery).all();
            perms.forEach(perm => {
              const rpId = require('crypto').randomBytes(16).toString('hex');
              db.prepare(`
                INSERT OR IGNORE INTO role_permissions (id, role_id, permission_id)
                VALUES (?, ?, ?)
              `).run(rpId, createdRole.id, perm.id);
            });
          });
        }
      });

      return { success: true, rolesCreated: systemRoles.length };
    } catch (error) {
      console.error('Initialize system roles error:', error);
      throw error;
    }
  }
}

module.exports = RBACService;
