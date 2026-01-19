const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

// Read visits data
const visitsData = JSON.parse(fs.readFileSync('visits_rows.json', 'utf8'));

console.log(`Total visits to import: ${visitsData.length}`);

// Connect to database
const dbPath = process.argv[2] || 'local-database.db';
const db = new Database(dbPath);

// Prepare insert statement - matching production schema
const insertVisit = db.prepare(`
  INSERT OR REPLACE INTO visits (
    id, tenant_id, salesman_id, customer_id, plant_id, customer_name, contact_person,
    customer_phone, visit_type, visit_date, meeting_types, products_discussed,
    potential, competitor_name, can_be_switched, remarks,
    next_action, next_action_date, gps_latitude, gps_longitude,
    time_in, time_out, synced, offline_id,
    created_at, updated_at
  ) VALUES (
    @id, @tenant_id, @salesman_id, @customer_id, @plant_id, @customer_name, @contact_person,
    @customer_phone, @visit_type, @visit_date, @meeting_types, @products_discussed,
    @potential, @competitor_name, @can_be_switched, @remarks,
    @next_action, @next_action_date, @gps_latitude, @gps_longitude,
    @time_in, @time_out, @synced, @offline_id,
    @created_at, @updated_at
  )
`);

// Start transaction
const insertMany = db.transaction((visits) => {
  let imported = 0;
  let errors = 0;
  
  for (const visit of visits) {
    try {
      // Map fields from JSON to production schema
      const visitData = {
        id: visit.id,
        tenant_id: visit.tenant_id,
        salesman_id: visit.salesman_id,
        customer_id: visit.customer_id || null,
        plant_id: visit.plant ? (typeof visit.plant === 'string' ? JSON.parse(visit.plant)[0] : visit.plant[0]) : null,
        customer_name: visit.customer_name,
        contact_person: visit.contact_person,
        customer_phone: visit.customer_phone,
        visit_type: visit.visit_type || 'personal',
        visit_date: visit.time_in ? new Date(visit.time_in).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
        meeting_types: typeof visit.meeting_type === 'string' ? visit.meeting_type : JSON.stringify(visit.meeting_type),
        products_discussed: typeof visit.products_discussed === 'string' ? visit.products_discussed : JSON.stringify(visit.products_discussed),
        potential: visit.potential || 'Medium',
        competitor_name: visit.competitor_name || '',
        can_be_switched: visit.can_be_switched === true ? 1 : 0,
        remarks: visit.remarks || '',
        next_action: typeof visit.next_action === 'string' ? visit.next_action : JSON.stringify(visit.next_action),
        next_action_date: visit.next_action_date,
        gps_latitude: parseFloat(visit.location_lat) || 0.0,
        gps_longitude: parseFloat(visit.location_lng) || 0.0,
        time_in: visit.time_in,
        time_out: visit.time_out,
        synced: visit.synced === true ? 1 : 0,
        offline_id: visit.offline_id,
        created_at: visit.created_at || new Date().toISOString(),
        updated_at: visit.updated_at || new Date().toISOString()
      };
      
      insertVisit.run(visitData);
      imported++;
    } catch (err) {
      console.error(`Error importing visit ${visit.id}: ${err.message}`);
      errors++;
    }
  }
  
  return { imported, errors };
});

// Execute import
const result = insertMany(visitsData);

console.log(`\nImport complete:`);
console.log(`✓ Imported: ${result.imported} visits`);
console.log(`✗ Errors: ${result.errors} visits`);

// Verify count
const count = db.prepare('SELECT COUNT(*) as count FROM visits').get();
console.log(`\nTotal visits in database: ${count.count}`);

db.close();
