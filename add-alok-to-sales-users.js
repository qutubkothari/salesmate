const Database = require('better-sqlite3');
const db = new Database('/var/www/salesmate-ai/local-database.db');

console.log('=== Adding Alok to sales_users ===\n');

// Alok's data from Supabase
const alokUserId = '48e61957-3431-43cf-a75f-3d95c15ab1c5';
const tenantId = '112f12b8-55e9-4de8-9fda-d58e37c75796';

// Check if Alok exists in sales_users
const existing = db.prepare("SELECT * FROM sales_users WHERE phone = '8600259300'").get();

if (existing) {
    console.log(`✓ Alok already exists in sales_users with ID: ${existing.id}`);
} else {
    console.log('Adding Alok to sales_users...');
    db.prepare(`
        INSERT INTO sales_users (
            id, tenant_id, name, phone, role, is_active, created_at, updated_at,
            capacity, score, status, timezone, language
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        alokUserId,
        tenantId,
        'Alok',
        '8600259300',
        'sales',
        1,
        '2025-11-23T05:40:33.146Z',
        '2025-11-23T05:40:33.146Z',
        0, // capacity
        0, // score
        'active',
        'Asia/Kolkata',
        'en'
    );
    console.log('✓ Alok added to sales_users');
}

console.log('\nAssigning 13 customers to Alok...');
const updated = db.prepare(`
    UPDATE customer_profiles_new
    SET assigned_salesman_id = ?
    WHERE tenant_id = ?
    AND assigned_salesman_id = '04fe961c-f7f9-4a09-9a17-5f38229947c0'
    AND id IN (
        SELECT id FROM customer_profiles_new
        WHERE tenant_id = ?
        AND assigned_salesman_id = '04fe961c-f7f9-4a09-9a17-5f38229947c0'
        LIMIT 13
    )
`).run(alokUserId, tenantId, tenantId);

console.log(`✓ Assigned ${updated.changes} customers to Alok`);

// Verify
const count = db.prepare(`
    SELECT COUNT(*) as count
    FROM customer_profiles_new
    WHERE tenant_id = ? AND assigned_salesman_id = ?
`).get(tenantId, alokUserId);

console.log(`✓ Alok now has ${count.count} customers\n`);

// Show sample customers
console.log('Sample assigned customers:');
const samples = db.prepare(`
    SELECT business_name, city, phone
    FROM customer_profiles_new
    WHERE assigned_salesman_id = ?
    LIMIT 5
`).all(alokUserId);

samples.forEach(c => {
    console.log(`  - ${c.business_name} (${c.city || 'N/A'})`);
});

db.close();

console.log('\n✅ Complete!');
console.log('\nAlok can now log in with:');
console.log('  Phone: 8600259300');
console.log('  Password: 8600259300');
console.log(`  User ID: ${alokUserId}`);
console.log('  Will see 13 assigned customers on the dashboard');
