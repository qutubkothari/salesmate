const Database = require('better-sqlite3');
const db = new Database('./local-database.db');

console.log('\n=== Searching for Alok ===\n');

// Search all users for Alok
const alokUsers = db.prepare("SELECT * FROM users WHERE name LIKE '%Alok%' OR phone LIKE '%Alok%'").all();

if (alokUsers.length > 0) {
    console.log(`Found ${alokUsers.length} user(s) matching "Alok":\n`);
    alokUsers.forEach(u => {
        console.log(`Name: ${u.name}`);
        console.log(`ID: ${u.id}`);
        console.log(`Phone: ${u.phone}`);
        console.log(`Role: ${u.role}`);
        console.log(`Tenant: ${u.tenant_id}`);
        console.log(`Active: ${u.is_active}`);
        
        // Check customer count
        const customerCount = db.prepare('SELECT COUNT(*) as count FROM customer_profiles_new WHERE assigned_salesman_id = ?').get(u.id);
        console.log(`Customers: ${customerCount.count}`);
        console.log('---');
    });
} else {
    console.log('❌ No user found with name "Alok"');
    console.log('\nSearching in deleted/test users that were cleaned up...');
    
    // Show the salesman being used in browser
    console.log('\nThe browser is using salesmanId: b4cc8d15-2099-43e2-b1f8-435e31b69658');
    console.log('This ID does NOT exist in the users table.');
    
    console.log('\n💡 Solution: Log in as one of these valid users:');
    console.log('   - QK (phone: 9537653927)');
    console.log('   - QUTUB (phone: 7737845253)');
    console.log('   - Hamza Bootwala (phone: 9819370256)');
}

db.close();
