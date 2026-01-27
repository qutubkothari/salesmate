const { Client } = require('pg');
const fs = require('fs');

const sql = fs.readFileSync('migrations/20260127_fix_tenant_documents_id.sql', 'utf8');

const client = new Client({
  connectionString: 'postgresql://postgres:Sak3998515253%23@db.taqkfimlrlkyjbutashe.supabase.co:5432/postgres',
  ssl: { rejectUnauthorized: false }
});

(async () => {
  await client.connect();
  await client.query(sql);
  console.log('✅ tenant_documents id default fixed');
  await client.end();
})();
