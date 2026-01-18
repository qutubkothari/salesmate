const Database = require('better-sqlite3');
const db = new Database('/var/www/salesmate-ai/local-database.db');

console.log('=== Checking Alok Status ===\n');

// Check if Alok exists in users table
const alokInUsers = db.prepare("SELECT * FROM users WHERE phone = '8600259300'").get();

if (alokInUsers) {
    console.log('✓ Alok EXISTS in users table:');
    console.log(`  ID: ${alokInUsers.id}`);
    console.log(`  Name: ${alokInUsers.name}`);
    console.log(`  Role: ${alokInUsers.role}`);
} else {
    console.log('❌ Alok NOT FOUND in users table');
    console.log('\nAdding Alok from Supabase data...');
    
    // Add Alok with hashed password
    const crypto = require('crypto');
    const password = '8600259300';
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
    
    db.prepare(`
        INSERT INTO users (
            id, phone, name, password_hash, role, is_active, created_at, 
            updated_at, tenant_id, preferred_language
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        '48e61957-3431-43cf-a75f-3d95c15ab1c5', // Supabase users.id
        '8600259300',
        'Alok',
        hash,
        'salesman',
        1,
        '2025-11-23 05:40:33.146061+00',
        '2025-11-23 05:40:33.146061+00',
        '112f12b8-55e9-4de8-9fda-d58e37c75796',
        'en'
    );
    
    console.log('✓ Alok added to users table');
}

// Now assign customers
console.log('\nAssigning customers to Alok...');
const updated = db.prepare(`
    UPDATE customer_profiles_new
    SET assigned_salesman_id = ?
    WHERE tenant_id = '112f12b8-55e9-4de8-9fda-d58e37c75796'
    AND assigned_salesman_id = '04fe961c-f7f9-4a09-9a17-5f38229947c0'
    AND id IN (
        SELECT id FROM customer_profiles_new
        WHERE tenant_id = '112f12b8-55e9-4de8-9fda-d58e37c75796'
        AND assigned_salesman_id = '04fe961c-f7f9-4a09-9a17-5f38229947c0'
        LIMIT 13
    )
`).run('48e61957-3431-43cf-a75f-3d95c15ab1c5');

console.log(`✓ Assigned ${updated.changes} customers to Alok`);

// Verify
const alokCustomers = db.prepare(`
    SELECT COUNT(*) as count
    FROM customer_profiles_new
    WHERE tenant_id = '112f12b8-55e9-4de8-9fda-d58e37c75796'
    AND assigned_salesman_id = '48e61957-3431-43cf-a75f-3d95c15ab1c5'
`).get();

console.log(`✓ Alok now has ${alokCustomers.count} customers\n`);

console.log('Sample customers:');
const samples = db.prepare(`
    SELECT business_name, phone
    FROM customer_profiles_new
    WHERE assigned_salesman_id = '48e61957-3431-43cf-a75f-3d95c15ab1c5'
    LIMIT 3
`).all();

samples.forEach(c => console.log(`  - ${c.business_name}`));

db.close();

console.log('\n✅ Complete! Alok can now log in with phone 8600259300');
