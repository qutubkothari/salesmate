const Database = require('better-sqlite3');

// Alok's Supabase salesmen ID
const alokSupabaseSalesmanId = 'b4cc8d15-2099-43e2-b1f8-435e31b69658';
const correctTenantId = '112f12b8-55e9-4de8-9fda-d58e37c75796';

console.log('=== Checking Customer Salesman ID Assignments ===\n');

// Check what salesman IDs are actually in customer_profiles_new
const db = new Database('/var/www/salesmate-ai/local-database.db');

// Get distinct assigned_salesman_id values
console.log('1. Distinct assigned_salesman_id values in customer_profiles_new:');
const distinctIds = db.prepare(`
    SELECT DISTINCT assigned_salesman_id, COUNT(*) as count
    FROM customer_profiles_new
    WHERE tenant_id = ?
    GROUP BY assigned_salesman_id
`).all(correctTenantId);

distinctIds.forEach(row => {
    console.log(`   - ${row.assigned_salesman_id}: ${row.count} customers`);
});

// Check if Alok's Supabase ID exists
console.log(`\n2. Customers assigned to Alok's Supabase ID (${alokSupabaseSalesmanId}):`);
const alokCustomers = db.prepare(`
    SELECT COUNT(*) as count
    FROM customer_profiles_new
    WHERE tenant_id = ? AND assigned_salesman_id = ?
`).get(correctTenantId, alokSupabaseSalesmanId);

console.log(`   Found: ${alokCustomers.count} customers`);

// Sample a few customers to see their assigned_salesman_id
console.log('\n3. Sample customer records (first 5):');
const sampleCustomers = db.prepare(`
    SELECT id, business_name, assigned_salesman_id
    FROM customer_profiles_new
    WHERE tenant_id = ?
    LIMIT 5
`).all(correctTenantId);

sampleCustomers.forEach(c => {
    console.log(`   - ${c.business_name}: ${c.assigned_salesman_id}`);
});

db.close();

console.log('\n✅ Analysis complete!');
console.log('\nSupabase Salesman IDs from your data:');
console.log('   - QUTUB: 04fe961c-f7f9-4a09-9a17-5f38229947c0');
console.log('   - QK: 0e7e3b62-67bd-458e-b79f-e9fe74abd5a3');
console.log('   - Hamza: 1b29fd58-3d83-4ff6-ab99-8d19fb5e3f0e');
console.log('   - Alok: b4cc8d15-2099-43e2-b1f8-435e31b69658');
