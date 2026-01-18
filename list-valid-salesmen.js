const Database = require('better-sqlite3');
const db = new Database('./local-database.db');

const tenantId = '112f12b8-55e9-4de8-9fda-d58e37c75796';

console.log('\n=== Available Salesmen for Tenant ===\n');

const salesmen = db.prepare(`
    SELECT id, name, phone, role 
    FROM users 
    WHERE tenant_id = ? AND role IN ('salesman', 'super_admin')
    ORDER BY name
`).all(tenantId);

console.log(`Found ${salesmen.length} salesmen for tenant ${tenantId}:\n`);

salesmen.forEach((s, idx) => {
    const customerCount = db.prepare('SELECT COUNT(*) as count FROM customer_profiles_new WHERE assigned_salesman_id = ? AND tenant_id = ?')
        .get(s.id, tenantId);
    
    console.log(`${idx + 1}. ${s.name} (${s.role})`);
    console.log(`   ID: ${s.id}`);
    console.log(`   Phone: ${s.phone || 'N/A'}`);
    console.log(`   Customers: ${customerCount.count}`);
    console.log('');
});

console.log(`\n✨ Use one of these IDs in the browser login to see their customers!\n`);

db.close();
