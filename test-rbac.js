/**
 * Test RBAC System
 */

const RBACService = require('./services/rbac-service');
const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'local-database.db'));

console.log('🧪 Testing RBAC System\n');

// Get tenant and test user
const tenant = db.prepare('SELECT id FROM tenants LIMIT 1').get();
const user = db.prepare(`SELECT id, phone, role FROM users WHERE phone LIKE '%8484830022%' LIMIT 1`).get();

console.log(`Tenant: ${tenant.id}`);
console.log(`User: ${user.phone} (${user.id})\n`);

// Test 1: Get available roles
console.log('📌 Test 1: Available Roles');
const roles = db.prepare('SELECT role_code, role_name, hierarchy_level FROM roles WHERE tenant_id = ? ORDER BY hierarchy_level DESC').all(tenant.id);
roles.forEach(r => console.log(`   ${r.role_code.padEnd(20)} - ${r.role_name} (Level ${r.hierarchy_level})`));
console.log('');

// Test 2: Assign Salesman role to user
console.log('📌 Test 2: Assign "salesman" role to user');
const salesmanRole = db.prepare('SELECT id FROM roles WHERE tenant_id = ? AND role_code = ?').get(tenant.id, 'salesman');
if (salesmanRole) {
  try {
    RBACService.assignRole(user.id, salesmanRole.id, 'system');
    console.log('   ✅ Role assigned successfully\n');
  } catch (err) {
    console.log(`   ⚠️  ${err.message}\n`);
  }
} else {
  console.log('   ❌ Salesman role not found\n');
}

// Test 3: Check user's roles
console.log('📌 Test 3: User Roles');
const userRoles = RBACService.getUserRoles(user.id);
userRoles.forEach(r => console.log(`   ✅ ${r.role_name} (${r.role_code})`));
console.log('');

// Test 4: Check user's permissions
console.log('📌 Test 4: User Permissions');
const permissions = RBACService.getUserPermissions(user.id);
console.log(`   Total permissions: ${permissions.length}`);
const permsByResource = permissions.reduce((acc, p) => {
  if (!acc[p.resource]) acc[p.resource] = [];
  acc[p.resource].push(p.action);
  return acc;
}, {});

Object.keys(permsByResource).forEach(resource => {
  console.log(`   ${resource}: ${permsByResource[resource].join(', ')}`);
});
console.log('');

// Test 5: Permission checks
console.log('📌 Test 5: Permission Checks');
const checksToTest = [
  'products.read',
  'products.create',
  'orders.create',
  'orders.approve',
  'pricing.manage',
  'users.create'
];

checksToTest.forEach(perm => {
  const has = RBACService.hasPermission(user.id, perm);
  console.log(`   ${perm.padEnd(25)} ${has ? '✅ ALLOWED' : '❌ DENIED'}`);
});
console.log('');

// Test 6: Role checks
console.log('📌 Test 6: Role Checks');
const rolesToCheck = ['salesman', 'sales_manager', 'admin'];
rolesToCheck.forEach(role => {
  const has = RBACService.hasRole(user.id, role);
  console.log(`   ${role.padEnd(20)} ${has ? '✅ HAS' : '❌ NO'}`);
});
console.log('');

// Test 7: Assign Admin role
console.log('📌 Test 7: Assign "admin" role');
const adminRole = db.prepare('SELECT id FROM roles WHERE tenant_id = ? AND role_code = ?').get(tenant.id, 'admin');
if (adminRole) {
  RBACService.assignRole(user.id, adminRole.id, 'system');
  console.log('   ✅ Admin role assigned\n');
  
  // Re-check permissions
  console.log('   Updated permissions check:');
  const newPerms = RBACService.getUserPermissions(user.id);
  console.log(`   Total permissions now: ${newPerms.length}`);
  
  console.log('\n   Can now manage pricing?', RBACService.hasPermission(user.id, 'pricing.manage') ? '✅ YES' : '❌ NO');
  console.log('   Can create users?', RBACService.hasPermission(user.id, 'users.create') ? '✅ YES' : '❌ NO');
}

console.log('\n✅ All RBAC tests complete!');

db.close();
