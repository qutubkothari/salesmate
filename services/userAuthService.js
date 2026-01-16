// services/userAuthService.js
// User Authentication & Session Management

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { dbClient } = require('./config');

// ============================================
// Constants
// ============================================

const SESSION_DURATION_DAYS = 7;
const INVITATION_EXPIRY_DAYS = 7;
const BCRYPT_ROUNDS = 12;

const ROLES = {
  SUPER_ADMIN: 'super_admin',
  TENANT_ADMIN: 'tenant_admin',
  SALES_MANAGER: 'sales_manager',
  SALESMAN: 'salesman'
};

// ============================================
// Helper Functions
// ============================================

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function generateInvitationToken() {
  return crypto.randomBytes(24).toString('base64url');
}

async function hashPassword(password) {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

function getSessionExpiry() {
  const expires = new Date();
  expires.setDate(expires.getDate() + SESSION_DURATION_DAYS);
  return expires.toISOString();
}

function getInvitationExpiry() {
  const expires = new Date();
  expires.setDate(expires.getDate() + INVITATION_EXPIRY_DAYS);
  return expires.toISOString();
}

// ============================================
// User Management
// ============================================

/**
 * Create invitation for new user
 */
async function createUserInvitation({ tenantId, invitedBy, name, email, phone, role }) {
  const invitationToken = generateInvitationToken();
  const expiresAt = getInvitationExpiry();

  const userId = crypto.randomUUID();
  
  const { data, error } = await dbClient
    .from('sales_users')
    .insert({
      id: userId,
      tenant_id: tenantId,
      name,
      email,
      phone,
      role: role || ROLES.SALESMAN,
      status: 'pending',
      invitation_token: invitationToken,
      invitation_sent_at: new Date().toISOString(),
      invited_by: invitedBy,
      is_active: 0, // Inactive until invitation accepted
      created_at: new Date().toISOString()
    })
    .select()
    .single();

  if (error) throw error;

  // Generate invitation link
  const invitationLink = `${process.env.APP_URL || 'https://salesmate.saksolution.com'}/accept-invitation?token=${invitationToken}`;

  return {
    user: data,
    invitationToken,
    invitationLink,
    expiresAt
  };
}

/**
 * Accept invitation and set password
 */
async function acceptInvitation({ invitationToken, password }) {
  // Find user by invitation token
  const { data: user, error: findError } = await dbClient
    .from('sales_users')
    .select('*')
    .eq('invitation_token', invitationToken)
    .eq('status', 'pending')
    .single();

  if (findError || !user) {
    throw new Error('Invalid or expired invitation');
  }

  // Check if invitation is expired
  const sentAt = new Date(user.invitation_sent_at);
  const now = new Date();
  const diffDays = (now - sentAt) / (1000 * 60 * 60 * 24);

  if (diffDays > INVITATION_EXPIRY_DAYS) {
    throw new Error('Invitation has expired');
  }

  // Hash password
  const passwordHash = await hashPassword(password);

  // Update user
  const { data: updatedUser, error: updateError } = await dbClient
    .from('sales_users')
    .update({
      password_hash: passwordHash,
      status: 'active',
      is_active: 1,
      invitation_token: null,
      invitation_accepted_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
    .eq('id', user.id)
    .select()
    .single();

  if (updateError) throw updateError;

  return updatedUser;
}

/**
 * Login with email and password
 */
async function loginWithPassword({ email, password }) {
  // Find user by email
  const { data: user, error } = await dbClient
    .from('sales_users')
    .select('*')
    .eq('email', email)
    .eq('status', 'active')
    .eq('is_active', 1)
    .single();

  if (error || !user) {
    throw new Error('Invalid email or password');
  }

  // Verify password
  const isValid = await verifyPassword(password, user.password_hash);

  if (!isValid) {
    throw new Error('Invalid email or password');
  }

  // Create session
  const session = await createSession({
    userId: user.id,
    tenantId: user.tenant_id
  });

  // Update last login
  await dbClient
    .from('sales_users')
    .update({ last_login_at: new Date().toISOString() })
    .eq('id', user.id);

  return {
    user: sanitizeUser(user),
    session
  };
}

/**
 * Create session token
 */
async function createSession({ userId, tenantId, deviceInfo = null }) {
  const sessionToken = generateToken();
  const expiresAt = getSessionExpiry();

  const { data, error } = await dbClient
    .from('user_sessions')
    .insert({
      id: crypto.randomUUID(),
      user_id: userId,
      tenant_id: tenantId,
      session_token: sessionToken,
      device_info: deviceInfo ? JSON.stringify(deviceInfo) : null,
      expires_at: expiresAt,
      created_at: new Date().toISOString(),
      last_activity_at: new Date().toISOString()
    })
    .select()
    .single();

  if (error) throw error;

  return {
    sessionToken,
    expiresAt,
    session: data
  };
}

/**
 * Validate session token
 */
async function validateSession(sessionToken) {
  const now = new Date().toISOString();

  const { data: session, error } = await dbClient
    .from('user_sessions')
    .select('*, sales_users(*)')
    .eq('session_token', sessionToken)
    .gt('expires_at', now)
    .single();

  if (error || !session) {
    return null;
  }

  // Update last activity
  await dbClient
    .from('user_sessions')
    .update({ last_activity_at: new Date().toISOString() })
    .eq('id', session.id);

  return {
    session,
    user: session.sales_users
  };
}

/**
 * Logout - invalidate session
 */
async function logout(sessionToken) {
  const { error } = await dbClient
    .from('user_sessions')
    .delete()
    .eq('session_token', sessionToken);

  if (error) throw error;

  return { success: true };
}

/**
 * Logout all sessions for a user
 */
async function logoutAllSessions(userId) {
  const { error } = await dbClient
    .from('user_sessions')
    .delete()
    .eq('user_id', userId);

  if (error) throw error;

  return { success: true };
}

/**
 * Get user by ID
 */
async function getUserById(userId) {
  const { data, error } = await dbClient
    .from('sales_users')
    .select('*')
    .eq('id', userId)
    .single();

  if (error) throw error;

  return sanitizeUser(data);
}

/**
 * Get users by tenant
 */
async function getUsersByTenant(tenantId, { includeInactive = false } = {}) {
  let query = dbClient
    .from('sales_users')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: true });

  if (!includeInactive) {
    query = query.eq('is_active', 1);
  }

  const { data, error } = await query;

  if (error) throw error;

  return data.map(sanitizeUser);
}

/**
 * Update user
 */
async function updateUser(userId, updates) {
  const allowedUpdates = ['name', 'email', 'phone', 'role', 'avatar_url', 'timezone', 'language'];
  const sanitizedUpdates = {};

  Object.keys(updates).forEach(key => {
    if (allowedUpdates.includes(key)) {
      sanitizedUpdates[key] = updates[key];
    }
  });

  sanitizedUpdates.updated_at = new Date().toISOString();

  const { data, error } = await dbClient
    .from('sales_users')
    .update(sanitizedUpdates)
    .eq('id', userId)
    .select()
    .single();

  if (error) throw error;

  return sanitizeUser(data);
}

/**
 * Deactivate user
 */
async function deactivateUser(userId) {
  const { data, error } = await dbClient
    .from('sales_users')
    .update({
      is_active: 0,
      status: 'inactive',
      updated_at: new Date().toISOString()
    })
    .eq('id', userId)
    .select()
    .single();

  if (error) throw error;

  // Logout all sessions
  await logoutAllSessions(userId);

  return sanitizeUser(data);
}

/**
 * Change password
 */
async function changePassword(userId, { currentPassword, newPassword }) {
  // Get user
  const { data: user, error } = await dbClient
    .from('sales_users')
    .select('password_hash')
    .eq('id', userId)
    .single();

  if (error) throw error;

  // Verify current password
  const isValid = await verifyPassword(currentPassword, user.password_hash);

  if (!isValid) {
    throw new Error('Current password is incorrect');
  }

  // Hash new password
  const newPasswordHash = await hashPassword(newPassword);

  // Update password
  await dbClient
    .from('sales_users')
    .update({
      password_hash: newPasswordHash,
      updated_at: new Date().toISOString()
    })
    .eq('id', userId);

  return { success: true };
}

/**
 * Reset password (admin function)
 */
async function resetPassword(userId, newPassword) {
  const newPasswordHash = await hashPassword(newPassword);

  await dbClient
    .from('sales_users')
    .update({
      password_hash: newPasswordHash,
      updated_at: new Date().toISOString()
    })
    .eq('id', userId);

  // Logout all sessions
  await logoutAllSessions(userId);

  return { success: true };
}

/**
 * Remove sensitive fields from user object
 */
function sanitizeUser(user) {
  if (!user) return null;

  const { password_hash, invitation_token, gmail_refresh_token, gmail_access_token, ...sanitized } = user;
  return sanitized;
}

/**
 * Clean up expired sessions
 */
async function cleanupExpiredSessions() {
  const now = new Date().toISOString();

  const { error } = await dbClient
    .from('user_sessions')
    .delete()
    .lt('expires_at', now);

  if (error) {
    console.error('[SESSION_CLEANUP] Error:', error);
  } else {
    console.log('[SESSION_CLEANUP] Expired sessions cleaned up');
  }
}

// Run cleanup daily
if (process.env.NODE_ENV !== 'test') {
  setInterval(cleanupExpiredSessions, 24 * 60 * 60 * 1000); // Once per day
}

// ============================================
// Exports
// ============================================

module.exports = {
  ROLES,
  createUserInvitation,
  acceptInvitation,
  loginWithPassword,
  createSession,
  validateSession,
  logout,
  logoutAllSessions,
  getUserById,
  getUsersByTenant,
  updateUser,
  deactivateUser,
  changePassword,
  resetPassword,
  sanitizeUser,
  cleanupExpiredSessions
};

