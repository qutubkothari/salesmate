const Database = require('better-sqlite3');
const db = new Database('./local-database.db');

const salesmanId = 'b4cc8d15-2099-43e2-b1f8-435e31b69658';
const tenantId = '112f12b8-55e9-4de8-9fda-d58e37c75796';

console.log('\n=== Investigating Salesman and Customers ===\n');
console.log('Looking for salesmanId:', salesmanId);
console.log('Tenant ID:', tenantId);

// Check users table for this ID
const user = db.prepare('SELECT * FROM users WHERE id = ?').get(salesmanId);
console.log('\nUser in users table:', user ? `${user.name} (${user.role})` : 'NOT FOUND');

// Check all customers to see what tenant_id they have
const customerTenants = db.prepare('SELECT DISTINCT tenant_id, COUNT(*) as count FROM customer_profiles_new GROUP BY tenant_id').all();
console.log('\nCustomer tenant distribution:');
customerTenants.forEach(t => {
    console.log(`  - Tenant ${t.tenant_id}: ${t.count} customers`);
});

// Check all users to see what tenant_id they have  
const userTenants = db.prepare('SELECT DISTINCT tenant_id, COUNT(*) as count FROM users GROUP BY tenant_id').all();
console.log('\nUser tenant distribution:');
userTenants.forEach(t => {
    console.log(`  - Tenant ${t.tenant_id}: ${t.count} users`);
});

// Show a few salesmen with their tenant IDs
const salesmen = db.prepare("SELECT id, name, tenant_id, role FROM users WHERE role IN ('salesman', 'super_admin') LIMIT 5").all();
console.log('\nSample salesmen:');
salesmen.forEach(s => {
    console.log(`  - ${s.name} (${s.role})`);
    console.log(`    ID: ${s.id}`);
    console.log(`    Tenant: ${s.tenant_id}`);
});

// Check if customers have assigned_salesman_id
const assignedCount = db.prepare('SELECT COUNT(*) as count FROM customer_profiles_new WHERE assigned_salesman_id IS NOT NULL').get();
console.log(`\nCustomers with assigned_salesman_id: ${assignedCount.count} / 273`);

// Sample customer assignments
const sampleCustomers = db.prepare('SELECT id, business_name, tenant_id, assigned_salesman_id FROM customer_profiles_new LIMIT 5').all();
console.log('\nSample customers:');
sampleCustomers.forEach(c => {
    console.log(`  - ${c.business_name}`);
    console.log(`    Tenant: ${c.tenant_id}`);
    console.log(`    Assigned to: ${c.assigned_salesman_id || 'NULL'}`);
});

db.close();
