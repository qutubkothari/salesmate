// Create test login credentials for FSM role testing
const Database = require('better-sqlite3');

console.log('Setting up FSM test credentials...\n');

// Local database
const db = new Database('local-database.db');

// Get current tenant (Hylite Industries)
const mainTenant = db.prepare('SELECT * FROM tenants LIMIT 1').get();
console.log('Main Tenant:', mainTenant.business_name, '- Phone:', mainTenant.owner_whatsapp_number);

// Get a salesman to use for testing
const testSalesman = db.prepare(`
  SELECT * FROM salesmen 
  WHERE phone = '9730965552'
  LIMIT 1
`).get();

if (!testSalesman) {
  console.log('❌ Test salesman not found!');
  process.exit(1);
}

console.log('\nTest Salesman:', testSalesman.name);
console.log('  Phone:', testSalesman.phone);
console.log('  Plant:', testSalesman.plant_id);
console.log('  Salesman ID:', testSalesman.id);

// Create a new tenant record for the salesman (so they can login)
const salesmanPhone = testSalesman.phone;
const salesmanPhoneWithCountry = '91' + salesmanPhone; // Add country code

// Check if tenant already exists for this salesman
const existingSalesmanTenant = db.prepare(`
  SELECT * FROM tenants 
  WHERE owner_whatsapp_number LIKE ?
`).get(`%${salesmanPhone}%`);

if (existingSalesmanTenant) {
  console.log('\n✓ Salesman tenant already exists!');
  console.log('  Login Phone:', salesmanPhone);
  console.log('  Password:', existingSalesmanTenant.password);
} else {
  // Create new tenant for salesman
  const crypto = require('crypto');
  const newTenantId = crypto.randomUUID().replace(/-/g, '').substring(0, 32);
  const salesmanPassword = '1234'; // Simple test password
  
  db.prepare(`
    INSERT INTO tenants (
      id, business_name, phone_number, owner_whatsapp_number, email,
      subscription_tier, subscription_status, bot_language, is_active, status,
      password, daily_message_limit, messages_sent_today, last_message_reset_date,
      currency_symbol, daily_summary_enabled, abandoned_cart_delay_hours,
      created_at, updated_at, gst_rate, business_state, free_shipping_threshold,
      standard_shipping_rate, bulk_shipping_rate, bulk_threshold, triage_sla_enabled,
      triage_sla_minutes, preferred_ai_provider, ai_model
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    newTenantId,
    `${testSalesman.name} (Salesman)`,
    salesmanPhoneWithCountry,
    salesmanPhoneWithCountry + '@c.us',
    `${testSalesman.name.toLowerCase().replace(/\s+/g, '')}@hylite.com`,
    'standard',
    'active',
    'English',
    1,
    'active',
    salesmanPassword,
    10,
    0,
    new Date().toISOString().split('T')[0],
    '₹',
    1,
    2,
    new Date().toISOString(),
    new Date().toISOString(),
    18,
    'maharashtra',
    10000,
    20,
    15,
    15,
    1,
    30,
    'OPENAI',
    'gpt-4o-mini'
  );
  
  console.log('\n✅ Created salesman tenant!');
  console.log('  Login Phone:', salesmanPhone, 'or', salesmanPhoneWithCountry);
  console.log('  Password:', salesmanPassword);
}

console.log('\n═══════════════════════════════════════');
console.log('TEST CREDENTIALS SUMMARY');
console.log('═══════════════════════════════════════\n');

console.log('🔑 SUPER ADMIN (All Plants Access):');
console.log('   Phone: 918484862949 or 8484862949');
console.log('   Password: 5253');
console.log('   Access: All 9 plants, all 307 visits\n');

console.log('👤 SALESMAN (Personal Visits Only):');
console.log(`   Phone: ${salesmanPhone}`);
console.log(`   Password: ${existingSalesmanTenant?.password || '1234'}`);
console.log(`   Name: ${testSalesman.name}`);
console.log(`   Plant: ${testSalesman.plant_id}`);
console.log('   Access: Only own visits\n');

console.log('📋 Total FSM Data:');
console.log('   Visits:', db.prepare('SELECT COUNT(*) as c FROM visits').get().c);
console.log('   Salesmen:', db.prepare('SELECT COUNT(*) as c FROM salesmen').get().c);
console.log('   Plants:', db.prepare('SELECT COUNT(DISTINCT plant_id) as c FROM salesmen WHERE plant_id IS NOT NULL').get().c);

console.log('\n✓ Ready to upload to production!');

db.close();
