/**
 * Run Analytics & Reporting Migration
 * Creates analytics tables: dashboards, widgets, KPIs, reports, exports, insights
 */

const fs = require('fs');
const path = require('path');
const { db } = require('./services/config');

console.log('🚀 Running Analytics & Reporting Migration...\n');

try {
  // Read migration SQL
  const migrationPath = path.join(__dirname, 'migrations', 'create_analytics_reporting.sql');
  const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
  
  // Split by semicolons but preserve them in CREATE INDEX statements
  const statements = [];
  let currentStatement = '';
  let inCreateIndex = false;
  
  migrationSQL.split('\n').forEach(line => {
    const trimmed = line.trim();
    
    // Skip comments and empty lines
    if (!trimmed || trimmed.startsWith('--')) return;
    
    // Track CREATE INDEX blocks
    if (trimmed.toUpperCase().startsWith('CREATE')) {
      inCreateIndex = trimmed.toUpperCase().includes('INDEX');
    }
    
    currentStatement += line + '\n';
    
    // If line ends with semicolon and we're not in a complex CREATE INDEX
    if (trimmed.endsWith(';')) {
      if (!inCreateIndex || trimmed === ');') {
        statements.push(currentStatement.trim());
        currentStatement = '';
        inCreateIndex = false;
      }
    }
  });
  
  // Add final statement if exists
  if (currentStatement.trim()) {
    statements.push(currentStatement.trim());
  }
  
  console.log(`📄 Found ${statements.length} SQL statements to execute\n`);
  
  // Execute each statement
  let tablesCreated = 0;
  let indexesCreated = 0;
  
  statements.forEach((statement, index) => {
    try {
      if (statement.trim()) {
        db.exec(statement);
        
        if (statement.toUpperCase().includes('CREATE TABLE')) {
          const match = statement.match(/CREATE TABLE (?:IF NOT EXISTS )?(\w+)/i);
          if (match) {
            tablesCreated++;
            console.log(`✅ Created table: ${match[1]}`);
          }
        } else if (statement.toUpperCase().includes('CREATE INDEX')) {
          const match = statement.match(/CREATE INDEX (?:IF NOT EXISTS )?(\w+)/i);
          if (match) {
            indexesCreated++;
            console.log(`📊 Created index: ${match[1]}`);
          }
        }
      }
    } catch (error) {
      console.error(`❌ Error in statement ${index + 1}:`, error.message);
      console.error('Statement:', statement.substring(0, 100) + '...');
    }
  });
  
  console.log('\n✨ Migration Summary:');
  console.log(`   Tables created: ${tablesCreated}`);
  console.log(`   Indexes created: ${indexesCreated}`);
  
  // Verify tables exist
  const tables = db.prepare(`
    SELECT name FROM sqlite_master 
    WHERE type='table' AND name LIKE 'analytics_%'
    ORDER BY name
  `).all();
  
  console.log('\n📋 Analytics Tables:');
  tables.forEach(t => console.log(`   - ${t.name}`));
  
  console.log('\n✅ Analytics & Reporting migration completed successfully!');
  
} catch (error) {
  console.error('\n❌ Migration failed:', error.message);
  console.error(error.stack);
  process.exit(1);
}
