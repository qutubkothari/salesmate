/**
 * Run database migration to create contact_groups table
 * Execute this script once to add contact groups functionality
 */

const { dbClient } = require('./services/config');
const fs = require('fs');
const path = require('path');

async function runMigration() {
    try {
        console.log('ðŸ”„ Running contact_groups table migration...');
        
        // Read the SQL file
        const sqlPath = path.join(__dirname, 'migrations', 'create_contact_groups_table.sql');
        const sql = fs.readFileSync(sqlPath, 'utf8');
        
        // Execute the SQL
        const { data, error } = await dbClient.rpc('exec_sql', { sql_query: sql });
        
        if (error) {
            // If rpc doesn't work, try direct execution
            console.log('Direct SQL execution not available via RPC');
            console.log('\nðŸ“‹ Please run this SQL manually in your dbClient SQL editor:\n');
            console.log(sql);
            console.log('\n');
            process.exit(1);
        }
        
        console.log('âœ… Migration completed successfully!');
        console.log('Contact groups table created.');
        process.exit(0);
        
    } catch (error) {
        console.error('âŒ Migration failed:', error.message);
        console.log('\nðŸ“‹ Please run this SQL manually in your dbClient SQL editor:');
        
        const sqlPath = path.join(__dirname, 'migrations', 'create_contact_groups_table.sql');
        const sql = fs.readFileSync(sqlPath, 'utf8');
        console.log('\n' + sql + '\n');
        
        process.exit(1);
    }
}

runMigration();

