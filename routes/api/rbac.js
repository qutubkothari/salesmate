/**
 * RBAC Management API
 * Endpoints for managing roles, permissions, and user access
 */

const express = require('express');
const router = express.Router();
const { db } = require('../../services/config');
const RBACService = require('../../services/rbac-service');
const { requirePermission, requireRole } = require('../../middleware/rbac');

// ===== ROLES MANAGEMENT =====

// Get all roles for tenant
router.get('/roles/:tenantId', (req, res) => {
  try {
    const { tenantId } = req.params;
    
    const roles = db.prepare(`
      SELECT r.*, 
             COUNT(DISTINCT ur.user_id) as user_count,
             COUNT(DISTINCT rp.permission_id) as permission_count
      FROM roles r
      LEFT JOIN user_roles ur ON r.id = ur.role_id AND ur.is_active = 1
      LEFT JOIN role_permissions rp ON r.id = rp.role_id
      WHERE r.tenant_id = ?
      GROUP BY r.id
      ORDER BY r.hierarchy_level DESC, r.role_name
    `).all(tenantId);

    res.json({ roles });
  } catch (error) {
    console.error('Get roles error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get role details with permissions
router.get('/roles/:tenantId/:roleId', (req, res) => {
  try {
    const { tenantId, roleId } = req.params;
    
    const role = db.prepare(`
      SELECT * FROM roles WHERE id = ? AND tenant_id = ?
    `).get(roleId, tenantId);

    if (!role) {
      return res.status(404).json({ error: 'Role not found' });
    }

    const permissions = db.prepare(`
      SELECT p.*
      FROM role_permissions rp
      JOIN permissions p ON rp.permission_id = p.id
      WHERE rp.role_id = ?
      ORDER BY p.resource, p.action
    `).all(roleId);

    res.json({ role: { ...role, permissions } });
  } catch (error) {
    console.error('Get role details error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Create new role
router.post('/roles', (req, res) => {
  try {
    const { tenantId, roleName, roleCode, description, hierarchyLevel } = req.body;
    
    if (!tenantId || !roleName || !roleCode) {
      return res.status(400).json({ error: 'tenantId, roleName, and roleCode are required' });
    }

    const id = require('crypto').randomBytes(16).toString('hex');
    
    db.prepare(`
      INSERT INTO roles (id, tenant_id, role_name, role_code, description, hierarchy_level)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, tenantId, roleName, roleCode, description || null, hierarchyLevel || 0);

    res.json({ success: true, id });
  } catch (error) {
    console.error('Create role error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update role
router.put('/roles/:roleId', (req, res) => {
  try {
    const { roleId } = req.params;
    const { roleName, description, hierarchyLevel, isActive } = req.body;

    const updates = [];
    const values = [];

    if (roleName !== undefined) { updates.push('role_name = ?'); values.push(roleName); }
    if (description !== undefined) { updates.push('description = ?'); values.push(description); }
    if (hierarchyLevel !== undefined) { updates.push('hierarchy_level = ?'); values.push(hierarchyLevel); }
    if (isActive !== undefined) { updates.push('is_active = ?'); values.push(isActive ? 1 : 0); }
    
    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    updates.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(roleId);

    db.prepare(`
      UPDATE roles 
      SET ${updates.join(', ')}
      WHERE id = ?
    `).run(...values);

    res.json({ success: true });
  } catch (error) {
    console.error('Update role error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete role (only if not system role and no active users)
router.delete('/roles/:roleId', (req, res) => {
  try {
    const { roleId } = req.params;

    // Check if system role
    const role = db.prepare('SELECT is_system_role FROM roles WHERE id = ?').get(roleId);
    if (role?.is_system_role) {
      return res.status(400).json({ error: 'Cannot delete system role' });
    }

    // Check if has active users
    const userCount = db.prepare(`
      SELECT COUNT(*) as count FROM user_roles WHERE role_id = ? AND is_active = 1
    `).get(roleId);

    if (userCount.count > 0) {
      return res.status(400).json({ 
        error: 'Cannot delete role with active users',
        activeUsers: userCount.count 
      });
    }

    // Delete role and associated permissions
    db.prepare('DELETE FROM role_permissions WHERE role_id = ?').run(roleId);
    db.prepare('DELETE FROM roles WHERE id = ?').run(roleId);

    res.json({ success: true });
  } catch (error) {
    console.error('Delete role error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ===== PERMISSIONS MANAGEMENT =====

// Get all permissions
router.get('/permissions', (req, res) => {
  try {
    const { resource } = req.query;
    
    let query = 'SELECT * FROM permissions';
    const params = [];

    if (resource) {
      query += ' WHERE resource = ?';
      params.push(resource);
    }

    query += ' ORDER BY resource, action';

    const permissions = db.prepare(query).all(...params);

    // Group by resource
    const grouped = permissions.reduce((acc, perm) => {
      if (!acc[perm.resource]) acc[perm.resource] = [];
      acc[perm.resource].push(perm);
      return acc;
    }, {});

    res.json({ permissions, grouped });
  } catch (error) {
    console.error('Get permissions error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Assign permissions to role
router.post('/roles/:roleId/permissions', (req, res) => {
  try {
    const { roleId } = req.params;
    const { permissionIds } = req.body;

    if (!Array.isArray(permissionIds)) {
      return res.status(400).json({ error: 'permissionIds must be an array' });
    }

    // Clear existing permissions
    db.prepare('DELETE FROM role_permissions WHERE role_id = ?').run(roleId);

    // Add new permissions
    permissionIds.forEach(permId => {
      const id = require('crypto').randomBytes(16).toString('hex');
      db.prepare(`
        INSERT INTO role_permissions (id, role_id, permission_id)
        VALUES (?, ?, ?)
      `).run(id, roleId, permId);
    });

    res.json({ success: true, assigned: permissionIds.length });
  } catch (error) {
    console.error('Assign permissions error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ===== USER ROLE MANAGEMENT =====

// Get user's roles and permissions
router.get('/users/:userId/access', (req, res) => {
  try {
    const { userId } = req.params;

    const roles = RBACService.getUserRoles(userId);
    const permissions = RBACService.getUserPermissions(userId);
    const teamMembers = RBACService.getTeamMembers(userId);

    res.json({ roles, permissions, teamMembers });
  } catch (error) {
    console.error('Get user access error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Assign role to user
router.post('/users/:userId/roles', (req, res) => {
  try {
    const { userId } = req.params;
    const { roleId, assignedBy, expiresAt } = req.body;

    if (!roleId) {
      return res.status(400).json({ error: 'roleId is required' });
    }

    const result = RBACService.assignRole(userId, roleId, assignedBy, expiresAt);
    res.json(result);
  } catch (error) {
    console.error('Assign role error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Revoke role from user
router.delete('/users/:userId/roles/:roleId', (req, res) => {
  try {
    const { userId, roleId } = req.params;
    const { revokedBy } = req.body;

    const result = RBACService.revokeRole(userId, roleId, revokedBy);
    res.json(result);
  } catch (error) {
    console.error('Revoke role error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ===== TEAM HIERARCHY =====

// Get team hierarchy for manager
router.get('/teams/:managerId', (req, res) => {
  try {
    const { managerId } = req.params;
    const members = RBACService.getTeamMembers(managerId);

    res.json({ manager_id: managerId, members });
  } catch (error) {
    console.error('Get team error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Add team member
router.post('/teams/:managerId/members', (req, res) => {
  try {
    const { managerId } = req.params;
    const { memberId, tenantId, relationshipType } = req.body;

    const id = require('crypto').randomBytes(16).toString('hex');

    db.prepare(`
      INSERT INTO team_hierarchy (id, tenant_id, manager_id, member_id, relationship_type)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, tenantId, managerId, memberId, relationshipType || 'direct_report');

    res.json({ success: true, id });
  } catch (error) {
    console.error('Add team member error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Remove team member
router.delete('/teams/:managerId/members/:memberId', (req, res) => {
  try {
    const { managerId, memberId } = req.params;

    db.prepare(`
      UPDATE team_hierarchy 
      SET is_active = 0
      WHERE manager_id = ? AND member_id = ?
    `).run(managerId, memberId);

    res.json({ success: true });
  } catch (error) {
    console.error('Remove team member error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ===== AUDIT LOG =====

// Get permission audit log
router.get('/audit/:tenantId', (req, res) => {
  try {
    const { tenantId } = req.params;
    const { limit = 100 } = req.query;

    const logs = db.prepare(`
      SELECT pal.*, u.phone as user_phone, tu.phone as target_phone
      FROM permission_audit_log pal
      LEFT JOIN users u ON pal.user_id = u.id
      LEFT JOIN users tu ON pal.target_user_id = tu.id
      WHERE pal.tenant_id = ?
      ORDER BY pal.created_at DESC
      LIMIT ?
    `).all(tenantId, parseInt(limit));

    res.json({ logs });
  } catch (error) {
    console.error('Get audit log error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ===== INITIALIZATION =====

// Initialize system roles for tenant
router.post('/initialize/:tenantId', (req, res) => {
  try {
    const { tenantId } = req.params;
    
    const result = RBACService.initializeSystemRoles(tenantId);
    res.json(result);
  } catch (error) {
    console.error('Initialize roles error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
