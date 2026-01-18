const Database = require('better-sqlite3');
const db = new Database('./local-database.db');

console.log('🔄 Assigning customers to all salesmen proportionally...\n');

db.exec('PRAGMA foreign_keys = OFF');

try {
  // Get all salesmen
  const salesmen = db.prepare("SELECT id, name FROM users WHERE role IN ('salesman', 'super_admin')").all();
  
  console.log(`Found ${salesmen.length} salesmen:\n`);
  salesmen.forEach(s => console.log(`   - ${s.name} (${s.id})`));
  
  if (salesmen.length === 0) {
    console.log('❌ No salesmen found!');
    process.exit(1);
  }
  
  // Get all customers
  const customers = db.prepare('SELECT id, business_name, assigned_salesman_id FROM customer_profiles_new').all();
  
  console.log(`\nFound ${customers.length} customers\n`);
  
  // Distribute customers evenly among salesmen
  db.exec('BEGIN TRANSACTION');
  
  let assigned = 0;
  customers.forEach((customer, index) => {
    const salesmanIndex = index % salesmen.length;
    const salesman = salesmen[salesmanIndex];
    
    db.prepare('UPDATE customer_profiles_new SET assigned_salesman_id = ? WHERE id = ?')
      .run(salesman.id, customer.id);
    
    assigned++;
  });
  
  db.exec('COMMIT');
  
  console.log(`✅ Assigned ${assigned} customers to ${salesmen.length} salesmen\n`);
  
  // Show distribution
  console.log('📊 Distribution:\n');
  salesmen.forEach(salesman => {
    const count = db.prepare('SELECT COUNT(*) as count FROM customer_profiles_new WHERE assigned_salesman_id = ?')
      .get(salesman.id);
    console.log(`   ${salesman.name.padEnd(25)} : ${count.count} customers`);
  });
  
  console.log('\n✅ Done!');
  
} catch (error) {
  console.error('❌ Error:', error.message);
  db.exec('ROLLBACK');
  db.exec('PRAGMA foreign_keys = ON');
  process.exit(1);
}

db.exec('PRAGMA foreign_keys = ON');
db.close();
