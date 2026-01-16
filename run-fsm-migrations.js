/**
 * Run FSM Integration Migrations
 * Applies migrations 008 and 009 to local SQLite database
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbPath = process.env.SQLITE_DB_PATH || process.env.DB_PATH || path.join(__dirname, 'local-database.db');
const db = new Database(dbPath);

console.log('========================================');
console.log('  FSM Integration Migration Runner');
console.log('========================================\n');

console.log('Database:', dbPath);

// Enable foreign keys
db.pragma('foreign_keys = ON');

// Migration files to run
const migrations = [
  {
    name: '008_fsm_integration.sql',
    path: path.join(__dirname, 'migrations', '008_fsm_integration.sql')
  },
  {
    name: '009_fix_duplicate_columns.sql',
    path: path.join(__dirname, 'migrations', '009_fix_duplicate_columns.sql')
  }
];

// Run migrations
migrations.forEach((migration, index) => {
  console.log(`\n[${index + 1}/${migrations.length}] Running ${migration.name}...`);
  
  try {
    // Check if file exists
    if (!fs.existsSync(migration.path)) {
      console.log(`  ⚠️  File not found, skipping`);
      return;
    }

    // Read SQL file
    const sql = fs.readFileSync(migration.path, 'utf8');
    
    // Execute entire SQL file (SQLite can handle multiple statements)
    try {
      db.exec(sql);
      console.log(`  ✅ Migration executed successfully`);
    } catch (error) {
      // Ignore "already exists" errors
      if (error.message.includes('already exists') || 
          error.message.includes('duplicate column') ||
          error.message.includes('no such table')) {
        console.log(`  ⚠️  ${error.message.substring(0, 80)}... (ignored)`);
      } else {
        throw error;
      }
    }

  } catch (error) {
    console.error(`  ❌ Error: ${error.message}`);
    console.error(`     Continuing with next migration...`);
  }
});

// Verify tables created
console.log('\n========================================');
console.log('  Verification');
console.log('========================================\n');

const fsmTables = [
  'salesmen',
  'visits', 
  'salesman_targets',
  'customers_engaged',
  'visit_images',
  'salesman_locations',
  'salesman_activity_log',
  'daily_summaries',
  'customer_profiles_extra_fields'
];

let created = 0;
let missing = 0;

fsmTables.forEach(table => {
  try {
    const result = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(table);
    if (result) {
      console.log(`  ✅ ${table}`);
      created++;
    } else {
      console.log(`  ❌ ${table} - not created`);
      missing++;
    }
  } catch (error) {
    console.log(`  ❌ ${table} - error: ${error.message}`);
    missing++;
  }
});

console.log(`\n  Summary: ${created} created, ${missing} missing\n`);

db.close();

if (missing === 0) {
  console.log('✅ All FSM tables created successfully!\n');
  console.log('Next steps:');
  console.log('1. Get Supabase URL and API key');
  console.log('2. Run: node migrate-fsm-data.js');
  console.log('3. Run: node test-fsm-integration.js\n');
} else {
  console.log('⚠️  Some tables are missing. Please check the migration files.\n');
  process.exit(1);
}
