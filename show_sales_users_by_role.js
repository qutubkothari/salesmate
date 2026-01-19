const Database = require('better-sqlite3');
const db = new Database('local-database.db');

console.log('=== ALL SALES_USERS (by role) ===\n');
const allSalesUsers = db.prepare(`
  SELECT id, name, phone, role, email, is_active, tenant_id
  FROM sales_users 
  ORDER BY 
    CASE role 
      WHEN 'super_admin' THEN 1 
      WHEN 'admin' THEN 2 
      WHEN 'sales' THEN 3 
      ELSE 4 
    END,
    name
`).all();

console.table(allSalesUsers);

// Group by role
const byRole = {};
allSalesUsers.forEach(u => {
  if (!byRole[u.role]) byRole[u.role] = [];
  byRole[u.role].push(u);
});

console.log('\n=== USERS BY ROLE ===');
for (const [role, users] of Object.entries(byRole)) {
  console.log(`\n${role.toUpperCase()}: ${users.length} users`);
  users.forEach(u => {
    const tenant = u.tenant_id === '112f12b8-55e9-4de8-9fda-d58e37c75796' ? 'Hylite' : 'Other';
    console.log(`  - ${u.name} (${u.phone}) [${tenant}]`);
  });
}

// Hylite users specifically
console.log('\n=== HYLITE USERS ===');
const hyliteUsers = allSalesUsers.filter(u => u.tenant_id === '112f12b8-55e9-4de8-9fda-d58e37c75796');
console.table(hyliteUsers);

db.close();
