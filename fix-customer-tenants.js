const Database = require('better-sqlite3');
const db = new Database('./local-database.db');

console.log('\n=== Fixing Customer Tenant IDs ===\n');

const correctTenantId = '112f12b8-55e9-4de8-9fda-d58e37c75796';
const wrongTenantId = '101f04af63cbefc2bf8f0a98b9ae1205';

// Check current state
const beforeCount = db.prepare('SELECT COUNT(*) as count FROM customer_profiles_new WHERE tenant_id = ?').get(wrongTenantId);
console.log(`Customers with wrong tenant_id: ${beforeCount.count}`);

// Update customer tenant IDs
db.prepare('UPDATE customer_profiles_new SET tenant_id = ? WHERE tenant_id = ?').run(correctTenantId, wrongTenantId);

// Verify
const afterCount = db.prepare('SELECT COUNT(*) as count FROM customer_profiles_new WHERE tenant_id = ?').get(correctTenantId);
console.log(`Customers with correct tenant_id: ${afterCount.count}`);

console.log('\n✅ Customer tenant IDs updated successfully!');

db.close();
