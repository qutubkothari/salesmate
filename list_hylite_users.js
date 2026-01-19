const Database = require('better-sqlite3');
const db = new Database('local-database.db');

const users = db.prepare(`
  SELECT phone, name, role, email, is_active 
  FROM users 
  WHERE tenant_id = ?
  ORDER BY 
    CASE role 
      WHEN 'super_admin' THEN 1 
      WHEN 'admin' THEN 2 
      WHEN 'salesman' THEN 3 
      ELSE 4 
    END
`).all('112f12b8-55e9-4de8-9fda-d58e37c75796');

console.log('\n=== HYLITE USERS ===\n');
console.table(users);
console.log(`Total: ${users.length} users\n`);

db.close();
