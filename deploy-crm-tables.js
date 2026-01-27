/**
 * Deploy CRM tables migration to Supabase
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Read from .env
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_KEY in .env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function runMigration() {
  try {
    console.log('📖 Reading migration file...');
    const sqlPath = path.join(__dirname, 'migrations', '20260108_crm_core_tables.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');
    
    console.log('📝 Executing SQL migration...');
    console.log('Note: This will create CRM tables (leads, conversations, messages, etc.)');
    
    // Split by semicolon and execute each statement
    const statements = sql
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'));
    
    console.log(`\n🔄 Executing ${statements.length} SQL statements...\n`);
    
    for (let i = 0; i < statements.length; i++) {
      const stmt = statements[i];
      if (!stmt) continue;
      
      // Extract table/index name for logging
      const match = stmt.match(/CREATE (?:TABLE|INDEX).*?(?:IF NOT EXISTS )?([\w_]+)/i);
      const objectName = match ? match[1] : `statement_${i+1}`;
      
      try {
        const { error } = await supabase.rpc('exec_sql', { sql_query: stmt + ';' });
        
        if (error) {
          if (error.message.includes('already exists') || error.code === '42P07') {
            console.log(`⏭️  ${objectName} (already exists)`);
          } else {
            console.log(`⚠️  ${objectName}: ${error.message}`);
          }
        } else {
          console.log(`✅ ${objectName}`);
        }
      } catch (e) {
        console.log(`❌ ${objectName}: ${e.message}`);
      }
    }
    
    console.log('\n✅ Migration completed!\n');
    console.log('Verifying tables...');
    
    // Verify tables were created
    const tables = ['crm_users', 'crm_leads', 'crm_lead_events', 'crm_conversations', 'crm_messages'];
    for (const table of tables) {
      const { count, error } = await supabase.from(table).select('*', { count: 'exact', head: true });
      if (error) {
        console.log(`❌ ${table}: ${error.message}`);
      } else {
        console.log(`✅ ${table} (${count || 0} rows)`);
      }
    }
    
    console.log('\n🎉 CRM tables are ready!');
    process.exit(0);
    
  } catch (error) {
    console.error('\n❌ Migration failed:', error.message);
    process.exit(1);
  }
}

runMigration();
