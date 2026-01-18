const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const db = new Database('/var/www/salesmate-ai/local-database.db');

console.log('=== Importing Visits from Supabase JSON ===\n');

// Read the visits JSON file
console.log('1. Reading visits_rows.json...');
const visitsFile = path.join(__dirname, 'visits_rows.json');
const visitsData = JSON.parse(fs.readFileSync(visitsFile, 'utf8'));
console.log(`   ✓ Loaded ${visitsData.length} visits from file\n`);

// Check visits table schema to know which fields to map
console.log('2. Checking visits table structure...');
const tableInfo = db.prepare("PRAGMA table_info(visits)").all();
const columnNames = tableInfo.map(col => col.name);
console.log(`   ✓ Found ${columnNames.length} columns in visits table\n`);

// Clear existing visits
console.log('3. Clearing existing visits...');
db.prepare('DELETE FROM visits').run();
console.log('   ✓ Cleared old visits\n');

// Prepare insert statement dynamically based on available columns
console.log('4. Importing visits...');

// Sample first record to see structure
if (visitsData.length > 0) {
    console.log('   Sample visit structure:');
    const sampleKeys = Object.keys(visitsData[0]).slice(0, 10);
    console.log(`   ${sampleKeys.join(', ')}...\n`);
}

let imported = 0;
let skipped = 0;
const batchSize = 100;

// Process in batches
for (let i = 0; i < visitsData.length; i += batchSize) {
    const batch = visitsData.slice(i, i + batchSize);
    
    db.transaction(() => {
        for (const visit of batch) {
            try {
                // Build dynamic insert based on available fields
                const fields = [];
                const values = [];
                const placeholders = [];
                
                // Map common fields
                const fieldMapping = {
                    'id': visit.id,
                    'tenant_id': visit.tenant_id,
                    'salesman_id': visit.salesman_id,
                    'customer_id': visit.customer_id,
                    'customer_name': visit.customer_name,
                    'visit_date': visit.visit_date,
                    'visit_time': visit.visit_time,
                    'check_in_time': visit.check_in_time,
                    'check_out_time': visit.check_out_time,
                    'latitude': visit.latitude,
                    'longitude': visit.longitude,
                    'location': visit.location,
                    'visit_type': visit.visit_type,
                    'purpose': visit.purpose,
                    'notes': visit.notes,
                    'status': visit.status,
                    'feedback': visit.feedback,
                    'created_at': visit.created_at,
                    'updated_at': visit.updated_at,
                    'plant_id': visit.plant_id,
                    'plant_name': visit.plant_name
                };
                
                for (const [field, value] of Object.entries(fieldMapping)) {
                    if (columnNames.includes(field) && value !== undefined) {
                        fields.push(field);
                        values.push(value);
                        placeholders.push('?');
                    }
                }
                
                if (fields.length > 0) {
                    const sql = `INSERT INTO visits (${fields.join(', ')}) VALUES (${placeholders.join(', ')})`;
                    db.prepare(sql).run(...values);
                    imported++;
                } else {
                    skipped++;
                }
            } catch (error) {
                console.error(`   ⚠ Error importing visit ${visit.id}: ${error.message}`);
                skipped++;
            }
        }
    })();
    
    if ((i + batchSize) % 500 === 0) {
        console.log(`   Processed ${Math.min(i + batchSize, visitsData.length)} / ${visitsData.length}...`);
    }
}

console.log(`\n   ✓ Imported: ${imported} visits`);
if (skipped > 0) {
    console.log(`   ⚠ Skipped: ${skipped} visits`);
}

// Verify
console.log('\n5. Verification:');
const totalCount = db.prepare('SELECT COUNT(*) as count FROM visits').get();
console.log(`   Total visits in database: ${totalCount.count}`);

const byTenant = db.prepare(`
    SELECT tenant_id, COUNT(*) as count
    FROM visits
    GROUP BY tenant_id
    ORDER BY count DESC
    LIMIT 5
`).all();

console.log('\n   Visits by tenant:');
byTenant.forEach(t => {
    console.log(`   - ${t.tenant_id}: ${t.count} visits`);
});

const bySalesman = db.prepare(`
    SELECT salesman_id, COUNT(*) as count
    FROM visits
    WHERE salesman_id IS NOT NULL
    GROUP BY salesman_id
    ORDER BY count DESC
    LIMIT 5
`).all();

console.log('\n   Visits by salesman (top 5):');
bySalesman.forEach(s => {
    console.log(`   - ${s.salesman_id}: ${s.count} visits`);
});

db.close();
console.log('\n✅ Import complete!');
