// Set up production database with Hylite Industries data only
const Database = require('better-sqlite3');

console.log('Setting up Hylite Industries database...\n');

// Open both databases
const fsmDb = new Database('local-database-with-fsm.db', { readonly: true });
const prodDb = new Database('local-database-prod-with-fsm.db');

// Get Hylite tenant ID from production
const prodTenant = prodDb.prepare('SELECT id, business_name FROM tenants LIMIT 1').get();
console.log(`Production Tenant: ${prodTenant.business_name} (${prodTenant.id})`);

// Get FSM tenant ID
const fsmTenant = fsmDb.prepare('SELECT id FROM tenants LIMIT 1').get();
console.log(`FSM Tenant ID: ${fsmTenant.id}\n`);

// Copy FSM data to production, updating tenant_id
console.log('Copying FSM data to production...');

prodDb.pragma('foreign_keys = OFF');

prodDb.exec('DELETE FROM visits');
prodDb.exec('DELETE FROM salesmen');
prodDb.exec('DELETE FROM salesman_targets');

// Get all visits and update tenant_id
const visits = fsmDb.prepare('SELECT * FROM visits').all();
const insertVisit = prodDb.prepare(`
  INSERT INTO visits (
    id, tenant_id, salesman_id, customer_id, plant_id, customer_name, contact_person,
    customer_phone, visit_type, visit_date, meeting_types, products_discussed, potential,
    competitor_name, can_be_switched, remarks, next_action, next_action_date,
    gps_latitude, gps_longitude, location_accuracy, time_in, time_out, duration_minutes,
    order_id, synced, offline_id, created_at, updated_at
  ) VALUES (
    ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
    ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
  )
`);

const insertMany = prodDb.transaction((items) => {
  for (const visit of items) {
    insertVisit.run(
      visit.id,
      prodTenant.id, // Use production tenant ID
      visit.salesman_id,
      visit.customer_id,
      visit.plant_id,
      visit.customer_name,
      visit.contact_person,
      visit.customer_phone,
      visit.visit_type,
      visit.visit_date,
      visit.meeting_types,
      visit.products_discussed,
      visit.potential,
      visit.competitor_name,
      visit.can_be_switched,
      visit.remarks,
      visit.next_action,
      visit.next_action_date,
      visit.gps_latitude,
      visit.gps_longitude,
      visit.location_accuracy,
      visit.time_in,
      visit.time_out,
      visit.duration_minutes,
      visit.order_id,
      visit.synced,
      visit.offline_id,
      visit.created_at,
      visit.updated_at
    );
  }
});

insertMany(visits);
console.log(`  Inserted ${visits.length} visits`);

// Copy salesmen
const salesmen = fsmDb.prepare('SELECT * FROM salesmen').all();
const insertSalesman = prodDb.prepare(`
  INSERT INTO salesmen (
    id, tenant_id, user_id, name, phone, email, plant_id, is_active,
    current_latitude, current_longitude, last_location_update,
    assigned_customers, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const insertSalesmen = prodDb.transaction((items) => {
  for (const s of items) {
    insertSalesman.run(
      s.id,
      prodTenant.id, // Use production tenant ID
      s.user_id,
      s.name,
      s.phone,
      s.email,
      s.plant_id,
      s.is_active,
      s.current_latitude,
      s.current_longitude,
      s.last_location_update,
      s.assigned_customers,
      s.created_at,
      s.updated_at
    );
  }
});

insertSalesmen(salesmen);
console.log(`  Inserted ${salesmen.length} salesmen`);

// Copy targets
const targets = fsmDb.prepare('SELECT * FROM salesman_targets').all();
const insertTarget = prodDb.prepare(`
  INSERT INTO salesman_targets (
    id, tenant_id, salesman_id, plant_id, period, target_visits, achieved_visits,
    target_revenue, created_at, updated_at
  ) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)
`);

const insertTargets = prodDb.transaction((items) => {
  for (const t of items) {
    // Map month_year to period (e.g., "11-2025" to "2025-11")
    const period = t.month_year || 'Unknown';
    insertTarget.run(
      t.id,
      prodTenant.id, // Use production tenant ID
      t.salesman_id,
      period,
      t.target_visits || 0,
      t.achieved_visits || 0,
      t.target_revenue || 0,
      t.created_at,
      t.updated_at
    );
  }
});

insertTargets(targets);
console.log(`  Inserted ${targets.length} targets`);

// Update tenant to Hylite Industries
prodDb.prepare(`
  UPDATE tenants
  SET business_name = 'Hylite Industries',
      email = 'admin@hylite.com',
      is_active = 1
  WHERE id = ?
`).run(prodTenant.id);

console.log('\nUpdated tenant to: Hylite Industries');

console.log('\nFinal counts in production database:');
console.log(`  Visits: ${prodDb.prepare('SELECT COUNT(*) as c FROM visits').get().c}`);
console.log(`  Salesmen: ${prodDb.prepare('SELECT COUNT(*) as c FROM salesmen').get().c}`);
console.log(`  Targets: ${prodDb.prepare('SELECT COUNT(*) as c FROM salesman_targets').get().c}`);

// Show plants
console.log('\nPlants/Branches:');
const plants = prodDb.prepare(`
  SELECT DISTINCT plant_id, COUNT(*) as count
  FROM salesmen 
  WHERE plant_id IS NOT NULL AND plant_id != ''
  GROUP BY plant_id
  ORDER BY count DESC
`).all();

plants.forEach(p => {
  console.log(`  - ${p.plant_id} (${p.count} salesmen)`);
});

prodDb.pragma('foreign_keys = ON');

fsmDb.close();
prodDb.close();

console.log('\n✅ Database ready! Save as local-database.db and upload to production');
