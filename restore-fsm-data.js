// Restore FSM data from backup
const Database = require('better-sqlite3');
const db = new Database('local-database.db');
const fs = require('fs');

// First backup current state
console.log('Creating safety backup...');
const backupPath = 'local-database-before-restore.db';
if (fs.existsSync(backupPath)) fs.unlinkSync(backupPath);
fs.copyFileSync('local-database.db', backupPath);

console.log('Restoring FSM data...');

// Get the backup file location
const tempBackup = 'C:/Users/QK/AppData/Local/Temp/local-database-backup.db';
if (!fs.existsSync(tempBackup)) {
  console.error('Backup file not found! Looking for alternate location...');
  // Try to use the one we uploaded
  process.exit(1);
}

db.exec('DELETE FROM visits');
db.exec('DELETE FROM salesmen');  
db.exec('DELETE FROM salesman_targets');

db.exec(`ATTACH DATABASE '${tempBackup.replace(/\\/g, '/')}' AS bak`);
db.exec('INSERT INTO visits SELECT * FROM bak.visits');
db.exec('INSERT INTO salesmen SELECT * FROM bak.salesmen');
db.exec('INSERT INTO salesman_targets SELECT * FROM bak.salesman_targets');
db.exec('DETACH DATABASE bak');

console.log('Restored:');
console.log('  Visits:', db.prepare('SELECT COUNT(*) as c FROM visits').get().c);
console.log('  Salesmen:', db.prepare('SELECT COUNT(*) as c FROM salesmen').get().c);
console.log('  Targets:', db.prepare('SELECT COUNT(*) as c FROM salesman_targets').get().c);

// Update tenant to Hylite Industries
const currentTenant = db.prepare('SELECT id FROM tenants LIMIT 1').get();
console.log('\nUpdating tenant to Hylite Industries...');

db.prepare(`
  UPDATE tenants 
  SET business_name = 'Hylite Industries',
      email = 'admin@hylite.com',
      is_active = 1
  WHERE id = ?
`).run(currentTenant.id);

console.log('✅ Restoration complete!');
console.log('\nNext: Upload to production');

db.close();
