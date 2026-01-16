// Clean database and set up only Hylite Industries with proper structure
const Database = require('better-sqlite3');
const db = new Database('local-database.db');

console.log('Starting database cleanup for Hylite Industries...\n');

// Get current tenant ID (assuming it's Hylite)
const currentTenant = db.prepare('SELECT id FROM tenants LIMIT 1').get();
const hyliteTenantId = currentTenant?.id || '101f04af63cbefc2bf8f0a98b9ae1205';

console.log(`Hylite Tenant ID: ${hyliteTenantId}\n`);

// Get all unique plant IDs from salesmen
const plants = db.prepare(`
  SELECT DISTINCT plant_id 
  FROM salesmen 
  WHERE plant_id IS NOT NULL 
    AND plant_id != ''
    AND plant_id NOT LIKE '%-%-%-%-%'
  ORDER BY plant_id
`).all();

console.log('Plants/Branches found:');
plants.forEach((p, i) => console.log(`  ${i + 1}. ${p.plant_id}`));
console.log();

// Keep only Hylite data, remove all other companies
console.log('Cleaning up non-Hylite data...');

// Disable foreign keys temporarily
db.pragma('foreign_keys = OFF');

// Remove visits from other tenants (if any exist)
const deleteOtherVisits = db.prepare('DELETE FROM visits WHERE tenant_id != ?');
const deletedVisits = deleteOtherVisits.run(hyliteTenantId);
console.log(`  Removed ${deletedVisits.changes} visits from other tenants`);

// Remove salesmen from other tenants
const deleteOtherSalesmen = db.prepare('DELETE FROM salesmen WHERE tenant_id != ?');
const deletedSalesmen = deleteOtherSalesmen.run(hyliteTenantId);
console.log(`  Removed ${deletedSalesmen.changes} salesmen from other tenants`);

// Remove targets from other tenants
const deleteOtherTargets = db.prepare('DELETE FROM salesman_targets WHERE tenant_id != ?');
const deletedTargets = deleteOtherTargets.run(hyliteTenantId);
console.log(`  Removed ${deletedTargets.changes} targets from other tenants`);

// Clean up tenants table - keep only Hylite
const deleteOtherTenants = db.prepare('DELETE FROM tenants WHERE id != ?');
const deletedTenants = deleteOtherTenants.run(hyliteTenantId);
console.log(`  Removed ${deletedTenants.changes} other tenants`);

// Re-enable foreign keys
db.pragma('foreign_keys = ON');

console.log('\nFinal counts:');
console.log(`  Visits: ${db.prepare('SELECT COUNT(*) as c FROM visits').get().c}`);
console.log(`  Salesmen: ${db.prepare('SELECT COUNT(*) as c FROM salesmen').get().c}`);
console.log(`  Targets: ${db.prepare('SELECT COUNT(*) as c FROM salesman_targets').get().c}`);
console.log(`  Tenants: ${db.prepare('SELECT COUNT(*) as c FROM tenants').get().c}`);

// Show plant distribution
console.log('\nSalesmen by Plant/Branch:');
const salesmenByPlant = db.prepare(`
  SELECT 
    COALESCE(plant_id, 'Unassigned') as plant,
    COUNT(*) as count,
    GROUP_CONCAT(name, ', ') as salesmen
  FROM salesmen
  GROUP BY plant_id
  ORDER BY count DESC
`).all();

salesmenByPlant.forEach(p => {
  console.log(`  ${p.plant}: ${p.count} salesmen`);
  console.log(`    (${p.salesmen.substring(0, 80)}${p.salesmen.length > 80 ? '...' : ''})`);
});

console.log('\n✅ Database cleanup complete!');
console.log('Next step: Upload to production with role-based access control');

db.close();
