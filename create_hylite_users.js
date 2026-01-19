const Database = require('better-sqlite3');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

// Connect to database
const dbPath = process.argv[2] || 'local-database.db';
const db = new Database(dbPath);

// Hylite tenant ID
const HYLITE_TENANT_ID = '112f12b8-55e9-4de8-9fda-d58e37c75796';

// Function to hash password
function hashPassword(password) {
  return crypto.createHash('sha512').update(password).digest('hex');
}

// Users to create
const users = [
  {
    id: uuidv4(),
    tenant_id: HYLITE_TENANT_ID,
    phone: '9876543210',
    name: 'Hylite Super Admin',
    email: 'superadmin@hylite.com',
    password_hash: hashPassword('admin123'),
    role: 'super_admin',
    is_active: 1,
    preferred_language: 'en'
  },
  {
    id: uuidv4(),
    tenant_id: HYLITE_TENANT_ID,
    phone: '9876543211',
    name: 'Hylite Admin',
    email: 'admin@hylite.com',
    password_hash: hashPassword('admin123'),
    role: 'admin',
    is_active: 1,
    preferred_language: 'en'
  },
  {
    id: uuidv4(),
    tenant_id: HYLITE_TENANT_ID,
    phone: '9876543212',
    name: 'Hylite Salesman',
    email: 'salesman@hylite.com',
    password_hash: hashPassword('admin123'),
    role: 'salesman',
    is_active: 1,
    preferred_language: 'en'
  }
];

// Prepare insert statement
const insertUser = db.prepare(`
  INSERT INTO users (
    id, tenant_id, phone, name, email, password_hash, role, is_active, preferred_language, created_at, updated_at
  ) VALUES (
    @id, @tenant_id, @phone, @name, @email, @password_hash, @role, @is_active, @preferred_language, datetime('now'), datetime('now')
  )
`);

console.log('Creating Hylite users...\n');

// Insert users
const createUsers = db.transaction((usersData) => {
  let created = 0;
  for (const user of usersData) {
    try {
      insertUser.run(user);
      console.log(`✓ Created ${user.role}: ${user.name} (${user.phone})`);
      created++;
    } catch (err) {
      console.error(`✗ Error creating ${user.name}: ${err.message}`);
    }
  }
  return created;
});

const result = createUsers(users);

console.log(`\nTotal users created: ${result}`);

// Display credentials
console.log('\n=== LOGIN CREDENTIALS ===');
console.log('\nSuper Admin:');
console.log(`  Phone: 9876543210`);
console.log(`  Password: admin123`);
console.log('\nAdmin:');
console.log(`  Phone: 9876543211`);
console.log(`  Password: admin123`);
console.log('\nSalesman:');
console.log(`  Phone: 9876543212`);
console.log(`  Password: admin123`);
console.log('\n=========================');

// Verify
const count = db.prepare('SELECT COUNT(*) as count FROM users WHERE tenant_id = ?').get(HYLITE_TENANT_ID);
console.log(`\nTotal Hylite users in database: ${count.count}`);

db.close();
