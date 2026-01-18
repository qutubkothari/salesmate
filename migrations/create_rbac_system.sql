-- Enterprise Role-Based Access Control (RBAC) System
-- Supports: Roles, Permissions, User-Role assignments, Resource-level permissions

-- Roles (Admin, Manager, Salesman, Customer Service, etc.)
CREATE TABLE IF NOT EXISTS roles (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    tenant_id TEXT NOT NULL,
    role_name TEXT NOT NULL,
    role_code TEXT NOT NULL,
    description TEXT,
    is_system_role INTEGER DEFAULT 0, -- 1 for built-in roles (can't be deleted)
    hierarchy_level INTEGER DEFAULT 0, -- Higher number = more authority
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (DATETIME('now')),
    updated_at TEXT DEFAULT (DATETIME('now')),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    UNIQUE(tenant_id, role_code)
);

-- Permissions (granular actions users can perform)
CREATE TABLE IF NOT EXISTS permissions (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    permission_code TEXT NOT NULL UNIQUE,
    permission_name TEXT NOT NULL,
    resource TEXT NOT NULL, -- e.g., 'products', 'orders', 'customers', 'reports'
    action TEXT NOT NULL, -- e.g., 'create', 'read', 'update', 'delete', 'export'
    description TEXT,
    created_at TEXT DEFAULT (DATETIME('now'))
);

-- Role-Permission Mappings
CREATE TABLE IF NOT EXISTS role_permissions (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    role_id TEXT NOT NULL,
    permission_id TEXT NOT NULL,
    created_at TEXT DEFAULT (DATETIME('now')),
    FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
    FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE,
    UNIQUE(role_id, permission_id)
);

-- User-Role Assignments (users can have multiple roles)
CREATE TABLE IF NOT EXISTS user_roles (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    user_id TEXT NOT NULL,
    role_id TEXT NOT NULL,
    assigned_by TEXT, -- user_id of who assigned this role
    assigned_at TEXT DEFAULT (DATETIME('now')),
    expires_at TEXT, -- Optional expiration for temporary roles
    is_active INTEGER DEFAULT 1,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
    UNIQUE(user_id, role_id)
);

-- Resource-Level Permissions (for row-level security)
CREATE TABLE IF NOT EXISTS resource_permissions (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    user_id TEXT NOT NULL,
    resource_type TEXT NOT NULL, -- 'customer', 'order', 'territory'
    resource_id TEXT NOT NULL, -- ID of the specific resource
    permission_level TEXT NOT NULL, -- 'owner', 'edit', 'view'
    granted_by TEXT,
    granted_at TEXT DEFAULT (DATETIME('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(user_id, resource_type, resource_id)
);

-- Audit Log for Permission Changes
CREATE TABLE IF NOT EXISTS permission_audit_log (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    tenant_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    action TEXT NOT NULL, -- 'role_assigned', 'role_revoked', 'permission_granted', 'permission_denied'
    target_user_id TEXT, -- User affected by the action
    role_id TEXT,
    permission_id TEXT,
    resource_type TEXT,
    resource_id TEXT,
    details TEXT, -- JSON with additional context
    ip_address TEXT,
    user_agent TEXT,
    created_at TEXT DEFAULT (DATETIME('now')),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

-- Team Hierarchy (for manager-salesman relationships)
CREATE TABLE IF NOT EXISTS team_hierarchy (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    tenant_id TEXT NOT NULL,
    manager_id TEXT NOT NULL,
    member_id TEXT NOT NULL,
    relationship_type TEXT DEFAULT 'direct_report', -- 'direct_report', 'team_member', 'supervised'
    effective_from TEXT DEFAULT (DATETIME('now')),
    effective_to TEXT,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (DATETIME('now')),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (manager_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (member_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(manager_id, member_id, relationship_type)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_roles_tenant ON roles(tenant_id);
CREATE INDEX IF NOT EXISTS idx_roles_code ON roles(role_code);
CREATE INDEX IF NOT EXISTS idx_role_permissions_role ON role_permissions(role_id);
CREATE INDEX IF NOT EXISTS idx_role_permissions_perm ON role_permissions(permission_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_user ON user_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_role ON user_roles(role_id);
CREATE INDEX IF NOT EXISTS idx_resource_perms_user ON resource_permissions(user_id);
CREATE INDEX IF NOT EXISTS idx_resource_perms_resource ON resource_permissions(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_audit_user ON permission_audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON permission_audit_log(created_at);
CREATE INDEX IF NOT EXISTS idx_team_manager ON team_hierarchy(manager_id);
CREATE INDEX IF NOT EXISTS idx_team_member ON team_hierarchy(member_id);

-- Insert System Permissions (Core resources and actions)
INSERT OR IGNORE INTO permissions (id, permission_code, permission_name, resource, action, description) VALUES
-- Products
('perm_products_create', 'products.create', 'Create Products', 'products', 'create', 'Add new products to catalog'),
('perm_products_read', 'products.read', 'View Products', 'products', 'read', 'View product information'),
('perm_products_update', 'products.update', 'Update Products', 'products', 'update', 'Modify product details'),
('perm_products_delete', 'products.delete', 'Delete Products', 'products', 'delete', 'Remove products from catalog'),
('perm_products_export', 'products.export', 'Export Products', 'products', 'export', 'Export product data'),

-- Orders
('perm_orders_create', 'orders.create', 'Create Orders', 'orders', 'create', 'Place new orders'),
('perm_orders_read', 'orders.read', 'View Orders', 'orders', 'read', 'View order information'),
('perm_orders_update', 'orders.update', 'Update Orders', 'orders', 'update', 'Modify order status'),
('perm_orders_delete', 'orders.delete', 'Cancel Orders', 'orders', 'delete', 'Cancel orders'),
('perm_orders_approve', 'orders.approve', 'Approve Orders', 'orders', 'approve', 'Approve order discounts'),

-- Customers
('perm_customers_create', 'customers.create', 'Create Customers', 'customers', 'create', 'Add new customers'),
('perm_customers_read', 'customers.read', 'View Customers', 'customers', 'read', 'View customer information'),
('perm_customers_update', 'customers.update', 'Update Customers', 'customers', 'update', 'Modify customer details'),
('perm_customers_delete', 'customers.delete', 'Delete Customers', 'customers', 'delete', 'Remove customers'),
('perm_customers_export', 'customers.export', 'Export Customers', 'customers', 'export', 'Export customer data'),

-- Pricing
('perm_pricing_view', 'pricing.view', 'View Pricing', 'pricing', 'read', 'View standard pricing'),
('perm_pricing_manage', 'pricing.manage', 'Manage Pricing', 'pricing', 'update', 'Manage pricing tiers and rules'),
('perm_pricing_override', 'pricing.override', 'Override Pricing', 'pricing', 'override', 'Set custom prices'),
('perm_pricing_approve', 'pricing.approve', 'Approve Pricing', 'pricing', 'approve', 'Approve price changes'),

-- Reports & Analytics
('perm_reports_view', 'reports.view', 'View Reports', 'reports', 'read', 'Access reports and dashboards'),
('perm_reports_export', 'reports.export', 'Export Reports', 'reports', 'export', 'Export report data'),
('perm_analytics_advanced', 'analytics.advanced', 'Advanced Analytics', 'analytics', 'read', 'Access advanced analytics'),

-- Users & Teams
('perm_users_create', 'users.create', 'Create Users', 'users', 'create', 'Add new users'),
('perm_users_read', 'users.read', 'View Users', 'users', 'read', 'View user information'),
('perm_users_update', 'users.update', 'Update Users', 'users', 'update', 'Modify user details'),
('perm_users_delete', 'users.delete', 'Delete Users', 'users', 'delete', 'Deactivate users'),
('perm_users_manage_roles', 'users.manage_roles', 'Manage User Roles', 'users', 'manage_roles', 'Assign/revoke user roles'),

-- Settings
('perm_settings_view', 'settings.view', 'View Settings', 'settings', 'read', 'View system settings'),
('perm_settings_update', 'settings.update', 'Update Settings', 'settings', 'update', 'Modify system settings'),

-- Visits (FSM)
('perm_visits_create', 'visits.create', 'Create Visits', 'visits', 'create', 'Log field visits'),
('perm_visits_read', 'visits.read', 'View Visits', 'visits', 'read', 'View visit records'),
('perm_visits_update', 'visits.update', 'Update Visits', 'visits', 'update', 'Modify visit details'),
('perm_visits_approve', 'visits.approve', 'Approve Visits', 'visits', 'approve', 'Approve visit reports');
