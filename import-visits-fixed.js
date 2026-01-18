const Database = require('better-sqlite3');
const fs = require('fs');

const db = new Database('local-database.db');

console.log('=== Importing Visits from Supabase JSON (FIXED) ===\n');

// 1. Read the visits from JSON file
console.log('1. Reading visits_rows.json...');
const visitsData = JSON.parse(fs.readFileSync('visits_rows.json', 'utf8'));
console.log(`   ✓ Loaded ${visitsData.data.length} visits from file\n`);

// 2. Get visits table structure
console.log('2. Checking visits table structure...');
const columns = db.prepare('PRAGMA table_info(visits)').all();
console.log(`   ✓ Found ${columns.length} columns in visits table\n`);

// 3. Clear existing visits
console.log('3. Clearing existing visits...');
db.prepare('DELETE FROM visits').run();
console.log(`   ✓ Cleared old visits\n`);

// 4. Import visits
console.log('4. Importing visits...');

// Get column names from visits table
const columnNames = columns.map(col => col.name);

let imported = 0;
let skipped = 0;

// Process in batches
const batchSize = 50;
for (let i = 0; i < visitsData.data.length; i += batchSize) {
    const batch = visitsData.data.slice(i, i + batchSize);
    
    const insertStmt = db.transaction((visits) => {
        for (const visit of visits) {
            try {
                // Map Supabase fields to SQLite fields
                const fieldMapping = {
                    'id': visit.id,
                    'tenant_id': visit.tenant_id,
                    'salesman_id': visit.salesman_id,
                    'customer_id': visit.customer_id,
                    'customer_name': visit.customer_name,
                    'customer_phone': visit.customer_phone,
                    'customer_email': visit.customer_email,
                    'customer_address': visit.customer_address,
                    'contact_person': visit.contact_person,
                    'meeting_type': visit.meeting_type,
                    'visit_type': visit.visit_type,
                    'visit_date': visit.created_at || new Date().toISOString(), // ✅ FIX: Map created_at to visit_date
                    'products_discussed': visit.products_discussed,
                    'next_action': visit.next_action,
                    'next_action_date': visit.next_action_date,
                    'potential': visit.potential,
                    'competitor_name': visit.competitor_name,
                    'can_be_switched': visit.can_be_switched,
                    'remarks': visit.remarks,
                    'notes': visit.notes,
                    'location_lat': visit.location_lat,
                    'location_lng': visit.location_lng,
                    'location_address': visit.location_address,
                    'time_in': visit.time_in,
                    'time_out': visit.time_out,
                    'visit_image': visit.visit_image,
                    'order_value': visit.order_value,
                    'status': visit.status,
                    'created_at': visit.created_at || new Date().toISOString(),
                    'updated_at': visit.updated_at || new Date().toISOString(),
                    'synced': visit.synced ? 1 : 0,
                    'offline_id': visit.offline_id,
                    'salesman_name': visit.salesman_name,
                    'plant': visit.plant,
                    'customer_name_ar': visit.customer_name_ar,
                    'contact_person_ar': visit.contact_person_ar,
                    'remarks_ar': visit.remarks_ar,
                    'deleted_at': visit.deleted_at,
                    'customer_type': visit.customer_type
                };

                // Only include fields that exist in visits table
                const fields = columnNames.filter(col => fieldMapping.hasOwnProperty(col));
                const values = fields.map(col => fieldMapping[col]);
                const placeholders = fields.map(() => '?').join(', ');

                const sql = `INSERT INTO visits (${fields.join(', ')}) VALUES (${placeholders})`;
                db.prepare(sql).run(...values);
                imported++;
            } catch (error) {
                console.log(`   ⚠ Error importing visit ${visit.id || 'unknown'}: ${error.message}`);
                skipped++;
            }
        }
    });

    insertStmt(batch);
    process.stdout.write(`   Processed ${Math.min(i + batchSize, visitsData.data.length)} / ${visitsData.data.length}...\r`);
}

console.log(`\n   ✓ Imported: ${imported} visits`);
if (skipped > 0) {
    console.log(`   ⚠ Skipped: ${skipped} visits\n`);
} else {
    console.log('');
}

// 5. Verify
console.log('5. Verification:');
const totalVisits = db.prepare('SELECT COUNT(*) as count FROM visits').get();
console.log(`   Total visits in database: ${totalVisits.count}`);

const visitsByTenant = db.prepare('SELECT tenant_id, COUNT(*) as count FROM visits GROUP BY tenant_id').all();
console.log(`   Visits by tenant:`, visitsByTenant);

const visitsBySalesman = db.prepare(`
    SELECT salesman_id, salesman_name, COUNT(*) as count 
    FROM visits 
    GROUP BY salesman_id, salesman_name 
    ORDER BY count DESC 
    LIMIT 10
`).all();
console.log(`\n   Top 10 salesmen by visit count:`);
visitsBySalesman.forEach(s => {
    console.log(`   - ${s.salesman_name || 'Unknown'} (${s.salesman_id}): ${s.count} visits`);
});

db.close();
console.log('\n✅ Import complete!');
