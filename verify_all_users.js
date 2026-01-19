const Database = require('better-sqlite3');
const db = new Database('local-database.db');

console.log('\n=== TOTAL USERS BY ROLE ===');
const byRole = db.prepare('SELECT role, COUNT(*) as count FROM users GROUP BY role').all();
console.table(byRole);

console.log('\n=== USERS BY TENANT ===');
const byTenant = db.prepare(`
  SELECT 
    tenant_id,
    COUNT(CASE WHEN role = 'super_admin' THEN 1 END) as super_admins,
    COUNT(CASE WHEN role = 'admin' THEN 1 END) as admins,
    COUNT(CASE WHEN role = 'salesman' THEN 1 END) as salesmen,
    COUNT(*) as total
  FROM users
  GROUP BY tenant_id
`).all();
console.table(byTenant);

console.log('\n=== TENANT NAMES ===');
const tenants = db.prepare('SELECT id, business_name FROM tenants').all();
console.table(tenants);

db.close();
