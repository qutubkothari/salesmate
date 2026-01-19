const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, 'local-database.db');
const db = new Database(dbPath);

const plantsData = JSON.parse(fs.readFileSync(path.join(__dirname, 'plants-data.json'), 'utf8'));

console.log(`Importing ${plantsData.length} plants to local database...\n`);

const insertPlant = db.prepare(`
  INSERT OR REPLACE INTO plants (
    id, tenant_id, name, location, city, state, country, timezone, created_at, updated_at
  ) VALUES (
    @id, @tenant_id, @name, @location, @city, @state, @country, @timezone, @created_at, @updated_at
  )
`);

const insertMany = db.transaction((plants) => {
  for (const plant of plants) {
    // Skip soft-deleted plants
    if (plant.deleted_at) {
      console.log(`  ⊗ [${getTenantName(plant.tenant_id).padEnd(15)}] ${plant.plant_name} (${plant.plant_code}) [SKIPPED - DELETED]`);
      continue;
    }
    
    insertPlant.run({
      id: plant.id,
      tenant_id: plant.tenant_id,
      name: plant.plant_name,
      location: plant.area,
      city: plant.city,
      state: null,
      country: null,
      timezone: 'UTC',
      created_at: plant.created_at,
      updated_at: plant.updated_at
    });
    
    const tenantName = getTenantName(plant.tenant_id);
    console.log(`  ✓ [${tenantName.padEnd(15)}] ${plant.plant_name} (${plant.plant_code}) - ${plant.area || 'N/A'}, ${plant.city || 'N/A'}`);
  }
});

function getTenantName(tenantId) {
  const tenantMap = {
    '112f12b8-55e9-4de8-9fda-d58e37c75796': 'Hylite',
    '84c1ba8d-53ab-43ef-9483-d997682f3072': 'GAZELLE',
    'fd43ab22-cc00-4fca-9dbf-768c0949c468': 'Gazelle Env',
    'fa47fd9f-253f-44c6-af02-86165f018321': 'Crescent',
    'aaaaaaaa-bbbb-cccc-dddd-000000000001': 'Demo Testing'
  };
  return tenantMap[tenantId] || 'Unknown';
}

try {
  insertMany(plantsData);
  
  // Count actual imported (excluding soft-deleted)
  const imported = plantsData.filter(p => !p.deleted_at).length;
  const skipped = plantsData.filter(p => p.deleted_at).length;
  
  console.log(`\n✅ Successfully imported ${imported} plants (${skipped} soft-deleted plants skipped)`);
  
  // Show summary by tenant
  console.log('\n=== PLANTS BY TENANT ===');
  const summary = db.prepare(`
    SELECT 
      tenant_id,
      COUNT(*) as total
    FROM plants
    GROUP BY tenant_id
  `).all();
  
  summary.forEach(row => {
    const tenantName = getTenantName(row.tenant_id);
    console.log(`${tenantName}: ${row.total} plants`);
  });
  
} catch (error) {
  console.error('❌ Error importing plants:', error.message);
  process.exit(1);
}

db.close();
