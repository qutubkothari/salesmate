/**
 * Load System Permissions
 */

const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'local-database.db'));
db.pragma('foreign_keys = ON');

console.log('📋 Loading System Permissions...\n');

const permissions = [
  // Products
  { id: 'perm_products_create', code: 'products.create', name: 'Create Products', resource: 'products', action: 'create', desc: 'Add new products to catalog' },
  { id: 'perm_products_read', code: 'products.read', name: 'View Products', resource: 'products', action: 'read', desc: 'View product information' },
  { id: 'perm_products_update', code: 'products.update', name: 'Update Products', resource: 'products', action: 'update', desc: 'Modify product details' },
  { id: 'perm_products_delete', code: 'products.delete', name: 'Delete Products', resource: 'products', action: 'delete', desc: 'Remove products from catalog' },
  { id: 'perm_products_export', code: 'products.export', name: 'Export Products', resource: 'products', action: 'export', desc: 'Export product data' },
  
  // Orders
  { id: 'perm_orders_create', code: 'orders.create', name: 'Create Orders', resource: 'orders', action: 'create', desc: 'Place new orders' },
  { id: 'perm_orders_read', code: 'orders.read', name: 'View Orders', resource: 'orders', action: 'read', desc: 'View order information' },
  { id: 'perm_orders_update', code: 'orders.update', name: 'Update Orders', resource: 'orders', action: 'update', desc: 'Modify order status' },
  { id: 'perm_orders_delete', code: 'orders.delete', name: 'Cancel Orders', resource: 'orders', action: 'delete', desc: 'Cancel orders' },
  { id: 'perm_orders_approve', code: 'orders.approve', name: 'Approve Orders', resource: 'orders', action: 'approve', desc: 'Approve order discounts' },
  
  // Customers
  { id: 'perm_customers_create', code: 'customers.create', name: 'Create Customers', resource: 'customers', action: 'create', desc: 'Add new customers' },
  { id: 'perm_customers_read', code: 'customers.read', name: 'View Customers', resource: 'customers', action: 'read', desc: 'View customer information' },
  { id: 'perm_customers_update', code: 'customers.update', name: 'Update Customers', resource: 'customers', action: 'update', desc: 'Modify customer details' },
  { id: 'perm_customers_delete', code: 'customers.delete', name: 'Delete Customers', resource: 'customers', action: 'delete', desc: 'Remove customers' },
  { id: 'perm_customers_export', code: 'customers.export', name: 'Export Customers', resource: 'customers', action: 'export', desc: 'Export customer data' },
  
  // Pricing
  { id: 'perm_pricing_view', code: 'pricing.view', name: 'View Pricing', resource: 'pricing', action: 'read', desc: 'View standard pricing' },
  { id: 'perm_pricing_manage', code: 'pricing.manage', name: 'Manage Pricing', resource: 'pricing', action: 'update', desc: 'Manage pricing tiers and rules' },
  { id: 'perm_pricing_override', code: 'pricing.override', name: 'Override Pricing', resource: 'pricing', action: 'override', desc: 'Set custom prices' },
  { id: 'perm_pricing_approve', code: 'pricing.approve', name: 'Approve Pricing', resource: 'pricing', action: 'approve', desc: 'Approve price changes' },
  
  // Reports & Analytics
  { id: 'perm_reports_view', code: 'reports.view', name: 'View Reports', resource: 'reports', action: 'read', desc: 'Access reports and dashboards' },
  { id: 'perm_reports_export', code: 'reports.export', name: 'Export Reports', resource: 'reports', action: 'export', desc: 'Export report data' },
  { id: 'perm_analytics_advanced', code: 'analytics.advanced', name: 'Advanced Analytics', resource: 'analytics', action: 'read', desc: 'Access advanced analytics' },
  
  // Users & Teams
  { id: 'perm_users_create', code: 'users.create', name: 'Create Users', resource: 'users', action: 'create', desc: 'Add new users' },
  { id: 'perm_users_read', code: 'users.read', name: 'View Users', resource: 'users', action: 'read', desc: 'View user information' },
  { id: 'perm_users_update', code: 'users.update', name: 'Update Users', resource: 'users', action: 'update', desc: 'Modify user details' },
  { id: 'perm_users_delete', code: 'users.delete', name: 'Delete Users', resource: 'users', action: 'delete', desc: 'Deactivate users' },
  { id: 'perm_users_manage_roles', code: 'users.manage_roles', name: 'Manage User Roles', resource: 'users', action: 'manage_roles', desc: 'Assign/revoke user roles' },
  
  // Settings
  { id: 'perm_settings_view', code: 'settings.view', name: 'View Settings', resource: 'settings', action: 'read', desc: 'View system settings' },
  { id: 'perm_settings_update', code: 'settings.update', name: 'Update Settings', resource: 'settings', action: 'update', desc: 'Modify system settings' },
  
  // Visits (FSM)
  { id: 'perm_visits_create', code: 'visits.create', name: 'Create Visits', resource: 'visits', action: 'create', desc: 'Log field visits' },
  { id: 'perm_visits_read', code: 'visits.read', name: 'View Visits', resource: 'visits', action: 'read', desc: 'View visit records' },
  { id: 'perm_visits_update', code: 'visits.update', name: 'Update Visits', resource: 'visits', action: 'update', desc: 'Modify visit details' },
  { id: 'perm_visits_approve', code: 'visits.approve', name: 'Approve Visits', resource: 'visits', action: 'approve', desc: 'Approve visit reports' }
];

const stmt = db.prepare(`
  INSERT OR IGNORE INTO permissions (id, permission_code, permission_name, resource, action, description)
  VALUES (?, ?, ?, ?, ?, ?)
`);

let loaded = 0;
permissions.forEach(p => {
  const result = stmt.run(p.id, p.code, p.name, p.resource, p.action, p.desc);
  if (result.changes > 0) {
    console.log(`✅ ${p.code}`);
    loaded++;
  }
});

console.log(`\n✅ Loaded ${loaded} permissions`);

db.close();
