/**
 * Run Pricing Engine Migration
 * Creates all pricing-related tables
 */

const fs = require('fs');
const Database = require('better-sqlite3');
const path = require('path');

console.log('🚀 Running Pricing Engine Migration...\n');

try {
  // Connect to database
  const dbPath = path.join(__dirname, 'local-database.db');
  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');
  
  console.log(`📁 Database: ${dbPath}\n`);

  // Read migration SQL
  const migration = fs.readFileSync('./migrations/create_pricing_engine.sql', 'utf8');
  
  // Execute all statements at once (better-sqlite3 supports this)
  try {
    db.exec(migration);
    console.log('✅ All pricing tables and indexes created successfully\n');
  } catch (err) {
    if (!err.message.includes('already exists')) {
      throw err;
    }
    console.log('⚠️  Some tables already exist (skipped)\n');
  }

  // Verify tables exist
  console.log('\n📊 Verifying pricing tables...');
  const tables = db.prepare(`
    SELECT name FROM sqlite_master 
    WHERE type='table' AND (
      name LIKE 'pricing_%' OR 
      name LIKE '%_pricing' OR 
      name IN ('price_lists', 'product_prices', 'promotions', 'price_history')
    )
    ORDER BY name
  `).all();

  tables.forEach(t => console.log(`   ✓ ${t.name}`));
  
  db.close();
  
} catch (error) {
  console.error('❌ Migration failed:', error);
  process.exit(1);
}
