const Database = require('better-sqlite3');
const db = new Database('local-database.db');

// Delete the 3 users I incorrectly created
const deleteUsers = db.prepare(`
  DELETE FROM users 
  WHERE phone IN ('9876543210', '9876543211', '9876543212')
`);

const result = deleteUsers.run();
console.log(`Deleted ${result.changes} incorrectly created users`);

// Now show all actual users
const users = db.prepare('SELECT * FROM users').all();
console.log('\n=== REMAINING USERS ===');
console.table(users);

// Show salesmen table (actual live data)
const salesmen = db.prepare(`
  SELECT id, name, phone, email, plant_id, is_active, tenant_id
  FROM salesmen 
  WHERE tenant_id = '112f12b8-55e9-4de8-9fda-d58e37c75796'
`).all();

console.log('\n=== SALESMEN (ACTUAL LIVE DATA) ===');
console.table(salesmen);
console.log(`Total salesmen: ${salesmen.length}`);

db.close();
