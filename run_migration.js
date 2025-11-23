/**
 * Run database migration to create contact_groups table
 * Execute this script once to add contact groups functionality
 */

const { supabase } = require('./services/config');
const fs = require('fs');
const path = require('path');

async function runMigration() {
    try {
        console.log('🔄 Running contact_groups table migration...');
        
        // Read the SQL file
        const sqlPath = path.join(__dirname, 'migrations', 'create_contact_groups_table.sql');
        const sql = fs.readFileSync(sqlPath, 'utf8');
        
        // Execute the SQL
        const { data, error } = await supabase.rpc('exec_sql', { sql_query: sql });
        
        if (error) {
            // If rpc doesn't work, try direct execution
            console.log('Direct SQL execution not available via RPC');
            console.log('\n📋 Please run this SQL manually in your Supabase SQL editor:\n');
            console.log(sql);
            console.log('\n');
            process.exit(1);
        }
        
        console.log('✅ Migration completed successfully!');
        console.log('Contact groups table created.');
        process.exit(0);
        
    } catch (error) {
        console.error('❌ Migration failed:', error.message);
        console.log('\n📋 Please run this SQL manually in your Supabase SQL editor:');
        
        const sqlPath = path.join(__dirname, 'migrations', 'create_contact_groups_table.sql');
        const sql = fs.readFileSync(sqlPath, 'utf8');
        console.log('\n' + sql + '\n');
        
        process.exit(1);
    }
}

runMigration();
