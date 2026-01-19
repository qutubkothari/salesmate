const Database = require('better-sqlite3');
const db = new Database('local-database.db');

const hyliteTenantId = '112f12b8-55e9-4de8-9fda-d58e37c75796';

console.log('=== HYLITE USERS BY ROLE ===\n');

// Get all Hylite users
const users = db.prepare(`
  SELECT id, phone, name, password, role, is_active, email, preferred_language
  FROM users 
  WHERE tenant_id = ?
  ORDER BY 
    CASE role 
      WHEN 'super_admin' THEN 1 
      WHEN 'admin' THEN 2 
      WHEN 'salesman' THEN 3 
      ELSE 4 
    END,
    name
`).all(hyliteTenantId);

console.table(users);

// Group by role
const superAdmins = users.filter(u => u.role === 'super_admin');
const admins = users.filter(u => u.role === 'admin');
const salesmen = users.filter(u => u.role === 'salesman');

console.log('\n=== SUMMARY ===');
console.log(`\nSUPER ADMINS (${superAdmins.length}):`);
superAdmins.forEach(u => {
  console.log(`  ✓ ${u.name} (${u.phone}) - Password: ${u.password}`);
});

console.log(`\nADMINS (${admins.length}):`);
admins.forEach(u => {
  console.log(`  ✓ ${u.name} (${u.phone}) - Password: ${u.password}`);
});

console.log(`\nSALESMEN (${salesmen.length}):`);
salesmen.forEach(u => {
  console.log(`  ✓ ${u.name} (${u.phone}) - Password: ${u.password}`);
});

console.log('\n=== SAMPLE USERS (1 of each role) ===');
if (superAdmins.length > 0) {
  const sa = superAdmins[0];
  console.log(`\n1. SUPER ADMIN: ${sa.name}`);
  console.log(`   Phone: ${sa.phone}`);
  console.log(`   Password: ${sa.password}`);
}

if (admins.length > 0) {
  const ad = admins[0];
  console.log(`\n2. ADMIN: ${ad.name}`);
  console.log(`   Phone: ${ad.phone}`);
  console.log(`   Password: ${ad.password}`);
}

if (salesmen.length > 0) {
  const sm = salesmen[0];
  console.log(`\n3. SALESMAN: ${sm.name}`);
  console.log(`   Phone: ${sm.phone}`);
  console.log(`   Password: ${sm.password}`);
}

db.close();
