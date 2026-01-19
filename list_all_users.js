const Database = require('better-sqlite3');
const db = new Database('local-database.db');

// Get all users with tenant info
const users = db.prepare(`
  SELECT 
    u.phone, 
    u.name, 
    u.role, 
    u.email, 
    u.is_active,
    u.tenant_id,
    t.business_name as tenant_name
  FROM users u
  LEFT JOIN tenants t ON u.tenant_id = t.id
  ORDER BY u.created_at
`).all();

console.log('\n=== ALL USERS IN DATABASE ===\n');
console.table(users);
console.log(`\nTotal: ${users.length} users`);

// Group by tenant
const byTenant = {};
users.forEach(u => {
  const tenant = u.tenant_name || 'Unknown';
  if (!byTenant[tenant]) byTenant[tenant] = [];
  byTenant[tenant].push(u);
});

console.log('\n=== USERS BY TENANT ===');
for (const [tenant, tenantUsers] of Object.entries(byTenant)) {
  console.log(`\n${tenant}: ${tenantUsers.length} users`);
  tenantUsers.forEach(u => {
    console.log(`  - ${u.name} (${u.phone}) - ${u.role}`);
  });
}

db.close();
