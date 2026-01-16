/**
 * List Supabase Tables
 * Checks what tables exist in Supabase
 */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Error: SUPABASE_URL and SUPABASE_KEY environment variables required');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function listTables() {
  console.log('Checking Supabase tables...\n');
  
  const tablesToCheck = [
    'salesmen',
    'visits',
    'targets',
    'salesman_targets',
    'customers_engaged',
    'customer_engaged',
    'orders',
    'users'
  ];

  for (const table of tablesToCheck) {
    try {
      const { data, error, count } = await supabase
        .from(table)
        .select('*', { count: 'exact', head: true });
      
      if (error) {
        console.log(`❌ ${table.padEnd(25)} - ${error.message}`);
      } else {
        console.log(`✅ ${table.padEnd(25)} - ${count || 0} rows`);
      }
    } catch (err) {
      console.log(`❌ ${table.padEnd(25)} - ${err.message}`);
    }
  }
}

listTables().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
