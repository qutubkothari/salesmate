/**
 * Pipeline System Migration Runner
 * Creates tables for sales pipeline management
 */

const fs = require('fs');
const path = require('path');
const { db } = require('./services/config');

console.log('🚀 Starting pipeline migration...');

try {
  // Read SQL file
  const sqlPath = path.join(__dirname, 'migrations', 'create_pipeline_system.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');

  // Remove comments
  const sqlNoComments = sql
    .split('\n')
    .filter(line => !line.trim().startsWith('--'))
    .join('\n');

  // Split by semicolon, but keep CREATE TABLE blocks together
  const statements = [];
  let currentStatement = '';
  let inCreateTable = false;
  
  sqlNoComments.split('\n').forEach(line => {
    currentStatement += line + '\n';
    
    if (line.trim().toUpperCase().startsWith('CREATE TABLE')) {
      inCreateTable = true;
    }
    
    if (line.includes(');') && inCreateTable) {
      inCreateTable = false;
      statements.push(currentStatement.trim());
      currentStatement = '';
    } else if (line.includes(';') && !inCreateTable) {
      statements.push(currentStatement.trim());
      currentStatement = '';
    }
  });

  const validStatements = statements.filter(s => s.length > 0);
  console.log(`📄 Found ${validStatements.length} SQL statements`);

  // Execute each statement
  validStatements.forEach((statement, index) => {
    try {
      // Skip CREATE INDEX statements for tables that don't exist yet
      if (statement.toUpperCase().startsWith('CREATE INDEX') || 
          statement.toUpperCase().startsWith('CREATE UNIQUE INDEX')) {
        // Check if referenced table exists
        const tableMatch = statement.match(/ON\s+(\w+)\s*\(/i);
        if (tableMatch) {
          const tableName = tableMatch[1];
          const tableExists = db.prepare(`
            SELECT name FROM sqlite_master WHERE type='table' AND name=?
          `).get(tableName);
          
          if (!tableExists) {
            console.log(`⏭️  Statement ${index + 1} skipped (table ${tableName} doesn't exist yet)`);
            return;
          }
        }
      }
      
      db.prepare(statement).run();
      
      // Extract table name if this is a CREATE TABLE statement
      const createTableMatch = statement.match(/CREATE TABLE\s+IF NOT EXISTS\s+(\w+)/i);
      if (createTableMatch) {
        console.log(`✅ Created table: ${createTableMatch[1]}`);
      } else {
        console.log(`✅ Statement ${index + 1} executed`);
      }
    } catch (error) {
      if (error.message.includes('already exists')) {
        console.log(`⚠️  Statement ${index + 1} skipped (already exists)`);
      } else {
        console.error(`❌ Statement ${index + 1} failed:`, error.message);
        console.error(`Statement was: ${statement.substring(0, 150)}...`);
        throw error;
      }
    }
  });

  // Verify tables
  const tables = db.prepare(`
    SELECT name FROM sqlite_master 
    WHERE type='table' AND name LIKE '%pipeline%' OR name LIKE '%deal%'
  `).all();

  console.log('\n📊 Pipeline Tables Created:');
  tables.forEach(t => console.log(`   - ${t.name}`));

  console.log('\n✅ Pipeline migration completed successfully!');

} catch (error) {
  console.error('❌ Migration failed:', error);
  process.exit(1);
}
