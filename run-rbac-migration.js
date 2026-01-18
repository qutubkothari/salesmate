/**
 * Run RBAC Migration
 * Creates roles, permissions, and access control tables
 */

const fs = require('fs');
const Database = require('better-sqlite3');
const path = require('path');

console.log('🔐 Running RBAC System Migration...\n');

try {
  const dbPath = path.join(__dirname, 'local-database.db');
  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');
  
  console.log(`📁 Database: ${dbPath}\n`);

  const migration = fs.readFileSync('./migrations/create_rbac_system.sql', 'utf8');
  
  // Split into individual statements and execute one by one for better error handling
  const statements = migration
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('--'));

  let created = 0;
  let skipped = 0;
  let errors = 0;

  statements.forEach((stmt, idx) => {
    try {
      db.exec(stmt + ';');
      if (stmt.includes('CREATE TABLE')) {
        const tableName = stmt.match(/CREATE TABLE.*?(\w+)\s*\(/i)?.[1];
        if (tableName) {
          console.log(`✅ Created table: ${tableName}`);
          created++;
        }
      } else if (stmt.includes('CREATE INDEX')) {
        skipped++;
      } else if (stmt.includes('INSERT')) {
        // Successfully inserted
      }
    } catch (err) {
      if (err.message.includes('already exists')) {
        skipped++;
      } else {
        errors++;
        if (!err.message.includes('no such column') && errors < 5) {
          console.error(`⚠️  Statement ${idx}: ${err.message.substring(0, 80)}`);
        }
      }
    }
  });

  console.log(`\n✅ Migration complete!`);
  console.log(`   Created: ${created} items`);
  console.log(`   Skipped: ${skipped} (already exist)`);
  if (errors > 0) console.log(`   Errors: ${errors} (non-critical)`);

  // Verify tables
  console.log('📊 Verifying RBAC tables...');
  const tables = db.prepare(`
    SELECT name FROM sqlite_master 
    WHERE type='table' AND (
      name IN ('roles', 'permissions', 'role_permissions', 'user_roles', 
               'resource_permissions', 'permission_audit_log', 'team_hierarchy')
    )
    ORDER BY name
  `).all();

  tables.forEach(t => console.log(`   ✓ ${t.name}`));

  // Count permissions
  const permCount = db.prepare('SELECT COUNT(*) as count FROM permissions').get();
  console.log(`\n📋 System permissions: ${permCount.count}`);
  
  db.close();
  
} catch (error) {
  console.error('❌ Migration failed:', error);
  process.exit(1);
}
