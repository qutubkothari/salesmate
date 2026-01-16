// routes/api/users.js
// User Management API Endpoints

const express = require('express');
const router = express.Router();
const userAuthService = require('../../services/userAuthService');
const { requirePermission, requireRole, PERMISSIONS, ROLES } = require('../../services/rbacService');
const { requireAuth } = require('../../middleware/authMiddleware');

// ============================================
// Authentication Endpoints (Public)
// ============================================

/**
 * POST /api/users/login
 * Login with email and password
 */
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    
    const result = await userAuthService.loginWithPassword(email, password);
    
    if (!result.success) {
      return res.status(401).json({ error: result.error });
    }
    
    res.json({
      success: true,
      user: result.user,
      session: result.session
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Failed to login' });
  }
});

/**
 * POST /api/users/logout
 * Logout and invalidate session
 */
router.post('/logout', requireAuth, async (req, res) => {
  try {
    const sessionId = req.session?.id;
    
    if (sessionId) {
      await userAuthService.logout(sessionId);
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ error: 'Failed to logout' });
  }
});

/**
 * GET /api/users/me
 * Get current user info
 */
router.get('/me', requireAuth, async (req, res) => {
  try {
    const user = await userAuthService.getUserById(req.user.id);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json({ user });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Failed to get user' });
  }
});

// ============================================
// Invitation Endpoints
// ============================================

/**
 * POST /api/users/invite
 * Invite a new user (admin only)
 */
router.post('/invite', requireAuth, requirePermission(PERMISSIONS.INVITE_USERS), async (req, res) => {
  try {
    const { email, name, role } = req.body;
    const invitedBy = req.user;
    
    if (!email || !name || !role) {
      return res.status(400).json({ error: 'Email, name and role are required' });
    }
    
    // Validate role
    if (!Object.values(ROLES).includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }
    
    // Only super admin can invite tenant admins
    if (role === ROLES.TENANT_ADMIN && invitedBy.role !== ROLES.SUPER_ADMIN) {
      return res.status(403).json({ error: 'Only super admin can invite tenant admins' });
    }
    
    // Only admin/super admin can invite managers
    if (role === ROLES.SALES_MANAGER && ![ROLES.SUPER_ADMIN, ROLES.TENANT_ADMIN].includes(invitedBy.role)) {
      return res.status(403).json({ error: 'Only admins can invite sales managers' });
    }
    
    const result = await userAuthService.createUserInvitation(
      invitedBy.tenant_id,
      email,
      name,
      role,
      invitedBy.id
    );
    
    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }
    
    res.json({
      success: true,
      user: result.user,
      inviteUrl: `${req.protocol}://${req.get('host')}/accept-invitation?token=${result.inviteToken}`
    });
  } catch (error) {
    console.error('Invite user error:', error);
    res.status(500).json({ error: 'Failed to invite user' });
  }
});

/**
 * POST /api/users/accept-invite
 * Accept invitation and set password
 */
router.post('/accept-invite', async (req, res) => {
  try {
    const { token, password } = req.body;
    
    if (!token || !password) {
      return res.status(400).json({ error: 'Token and password are required' });
    }
    
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }
    
    const result = await userAuthService.acceptInvitation(token, password);
    
    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }
    
    res.json({
      success: true,
      user: result.user,
      session: result.session
    });
  } catch (error) {
    console.error('Accept invitation error:', error);
    res.status(500).json({ error: 'Failed to accept invitation' });
  }
});

// ============================================
// User Management Endpoints
// ============================================

/**
 * GET /api/users
 * Get all users (filtered by role)
 */
router.get('/', requireAuth, requirePermission(PERMISSIONS.VIEW_TEAM), async (req, res) => {
  try {
    const currentUser = req.user;
    
    // Build query based on role
    let query = dbClient.from('sales_users').select('*');
    
    // Super admin sees all users
    if (currentUser.role === ROLES.SUPER_ADMIN) {
      // No filter
    } else {
      // Others only see users in their tenant
      query = query.eq('tenant_id', currentUser.tenant_id);
    }
    
    // Filter out deleted users
    query = query.eq('is_active', true);
    
    const { data: users, error } = await query.order('created_at', { ascending: false });
    
    if (error) {
      throw error;
    }
    
    // Remove sensitive fields
    const safeUsers = users.map(user => ({
      ...user,
      password_hash: undefined,
      invitation_token: undefined
    }));
    
    res.json({ users: safeUsers });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ error: 'Failed to get users' });
  }
});

/**
 * GET /api/users/:id
 * Get specific user
 */
router.get('/:id', requireAuth, requirePermission(PERMISSIONS.VIEW_TEAM), async (req, res) => {
  try {
    const user = await userAuthService.getUserById(req.params.id);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Check permissions
    if (req.user.role !== ROLES.SUPER_ADMIN && user.tenant_id !== req.user.tenant_id) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    res.json({ user });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Failed to get user' });
  }
});

/**
 * PUT /api/users/:id
 * Update user
 */
router.put('/:id', requireAuth, requirePermission(PERMISSIONS.MANAGE_USERS), async (req, res) => {
  try {
    const userId = req.params.id;
    const updates = req.body;
    const currentUser = req.user;
    
    // Get existing user
    const existingUser = await userAuthService.getUserById(userId);
    
    if (!existingUser) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Check permissions
    if (currentUser.role !== ROLES.SUPER_ADMIN && existingUser.tenant_id !== currentUser.tenant_id) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    // Prevent role escalation
    if (updates.role) {
      if (updates.role === ROLES.SUPER_ADMIN && currentUser.role !== ROLES.SUPER_ADMIN) {
        return res.status(403).json({ error: 'Cannot assign super admin role' });
      }
      if (updates.role === ROLES.TENANT_ADMIN && currentUser.role !== ROLES.SUPER_ADMIN) {
        return res.status(403).json({ error: 'Cannot assign tenant admin role' });
      }
    }
    
    // Don't allow updating sensitive fields
    delete updates.password_hash;
    delete updates.invitation_token;
    delete updates.tenant_id;
    
    const result = await userAuthService.updateUser(userId, updates);
    
    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }
    
    res.json({ success: true, user: result.user });
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

/**
 * DELETE /api/users/:id
 * Deactivate user
 */
router.delete('/:id', requireAuth, requirePermission(PERMISSIONS.MANAGE_USERS), async (req, res) => {
  try {
    const userId = req.params.id;
    const currentUser = req.user;
    
    // Get existing user
    const existingUser = await userAuthService.getUserById(userId);
    
    if (!existingUser) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Check permissions
    if (currentUser.role !== ROLES.SUPER_ADMIN && existingUser.tenant_id !== currentUser.tenant_id) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    // Can't delete yourself
    if (userId === currentUser.id) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }
    
    const result = await userAuthService.deactivateUser(userId);
    
    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

/**
 * POST /api/users/:id/change-password
 * Change password
 */
router.post('/:id/change-password', requireAuth, async (req, res) => {
  try {
    const userId = req.params.id;
    const { currentPassword, newPassword } = req.body;
    const requestingUser = req.user;
    
    if (!newPassword || newPassword.length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters' });
    }
    
    // Users can only change their own password (unless admin)
    if (userId !== requestingUser.id && ![ROLES.SUPER_ADMIN, ROLES.TENANT_ADMIN].includes(requestingUser.role)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    // If changing own password, require current password
    if (userId === requestingUser.id && !currentPassword) {
      return res.status(400).json({ error: 'Current password is required' });
    }
    
    const result = await userAuthService.changePassword(userId, currentPassword, newPassword);
    
    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ error: 'Failed to change password' });
  }
});

/**
 * POST /api/users/resend-invitation
 * Resend invitation email
 */
router.post('/resend-invitation', requireAuth, requirePermission(PERMISSIONS.INVITE_USERS), async (req, res) => {
  try {
    const { userId } = req.body;
    const currentUser = req.user;
    
    const user = await userAuthService.getUserById(userId);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Check permissions
    if (currentUser.role !== ROLES.SUPER_ADMIN && user.tenant_id !== currentUser.tenant_id) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    if (user.is_active && user.password_hash) {
      return res.status(400).json({ error: 'User has already accepted invitation' });
    }
    
    // Generate new invitation token
    const crypto = require('crypto');
    const newToken = crypto.randomBytes(32).toString('hex');
    const newExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
    
    const { dbClient } = require('../../services/config');
    const { error } = await dbClient
      .from('sales_users')
      .update({
        invitation_token: newToken,
        invitation_expires_at: newExpiry.toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', userId);
    
    if (error) {
      throw error;
    }
    
    res.json({
      success: true,
      inviteUrl: `${req.protocol}://${req.get('host')}/accept-invitation?token=${newToken}`
    });
  } catch (error) {
    console.error('Resend invitation error:', error);
    res.status(500).json({ error: 'Failed to resend invitation' });
  }
});

module.exports = router;

