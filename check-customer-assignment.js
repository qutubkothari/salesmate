const Database = require('better-sqlite3');
const db = new Database('./local-database.db');

const salesmanId = 'b4cc8d15-2099-43e2-b1f8-435e31b69658';
const tenantId = '112f12b8-55e9-4de8-9fda-d58e37c75796';

console.log('\n=== Checking Customer Assignment ===\n');

// Check if this salesman exists
const salesman = db.prepare('SELECT id, name FROM users WHERE id = ?').get(salesmanId);
console.log('Salesman:', salesman);

// Check customers assigned to this salesman
const customers = db.prepare(`
    SELECT id, business_name, assigned_salesman_id, tenant_id
    FROM customer_profiles_new
    WHERE tenant_id = ? AND assigned_salesman_id = ?
    LIMIT 5
`).all(tenantId, salesmanId);

console.log('\nCustomers assigned to this salesman:', customers.length);
if (customers.length > 0) {
    console.log('\nFirst 5 customers:');
    customers.forEach(c => {
        console.log(`  - ${c.business_name} (${c.id})`);
    });
} else {
    console.log('\n⚠️ NO CUSTOMERS ASSIGNED!');
    
    // Check total customers
    const total = db.prepare('SELECT COUNT(*) as count FROM customer_profiles_new WHERE tenant_id = ?').get(tenantId);
    console.log('\nTotal customers in database:', total.count);
    
    // Check a few customers to see their assignments
    const sample = db.prepare(`
        SELECT business_name, assigned_salesman_id 
        FROM customer_profiles_new 
        WHERE tenant_id = ? 
        LIMIT 5
    `).all(tenantId);
    
    console.log('\nSample customer assignments:');
    sample.forEach(c => {
        console.log(`  - ${c.business_name} -> ${c.assigned_salesman_id}`);
    });
}

db.close();
