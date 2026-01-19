const Database = require('better-sqlite3');
const crypto = require('crypto');

const db = new Database('local-database.db');

// Hash password function (matching the app's logic)
function hashPassword(password) {
  if (!password) return null;
  return crypto.createHash('sha512').update(password).digest('hex');
}

// FSM users data from your export (Hylite only)
const fsmUsers = [
  {"id":"04fe961c-f7f9-4a09-9a17-5f38229947c0","phone":"7737845253","name":"QUTUB","password":"515253","role":"salesman","is_active":true,"created_at":"2025-11-22 20:18:49.090667+00","updated_at":"2025-11-22 20:18:49.090667+00","tenant_id":"112f12b8-55e9-4de8-9fda-d58e37c75796","preferred_language":"en","name_ar":null,"assigned_plants":[]},
  {"id":"0667c6a1-1154-403f-ba37-0b5edf120578","phone":"9766748786","name":"Mudar Sanchawala","password":"9766748786","role":"admin","is_active":true,"created_at":"2025-11-24 13:00:46.333381+00","updated_at":"2025-11-24 13:00:46.333381+00","tenant_id":"112f12b8-55e9-4de8-9fda-d58e37c75796","preferred_language":"en","name_ar":"مودار سانشاوالا","assigned_plants":[]},
  {"id":"0e7e3b62-67bd-458e-b79f-e9fe74abd5a3","phone":"9537653927","name":"QK","password":"515253","role":"super_admin","is_active":true,"created_at":"2025-11-22 20:16:53.691747+00","updated_at":"2025-11-22 20:16:53.691747+00","tenant_id":"112f12b8-55e9-4de8-9fda-d58e37c75796","preferred_language":"en","name_ar":null,"assigned_plants":[]},
  {"id":"1b29fd58-3d83-4ff6-ab99-8d19fb5e3f0e","phone":"9819370256","name":"Hamza Bootwala","password":"9819370256","role":"salesman","is_active":true,"created_at":"2025-11-24 13:08:49.195446+00","updated_at":"2025-11-24 13:08:49.195446+00","tenant_id":"112f12b8-55e9-4de8-9fda-d58e37c75796","preferred_language":"en","name_ar":"حمزة بوتوالا","assigned_plants":[]},
  {"id":"1de0d404-1946-4046-bd4d-e4145c6c8603","phone":"9769395452","name":"Yusuf  Bootwala","password":"9769395452","role":"admin","is_active":true,"created_at":"2025-11-24 13:03:16.383133+00","updated_at":"2025-11-24 13:03:16.383133+00","tenant_id":"112f12b8-55e9-4de8-9fda-d58e37c75796","preferred_language":"en","name_ar":"يوسف بوتوالا","assigned_plants":[]},
  {"id":"288bd28f-949a-4a0f-a71f-204257c7432c","phone":"9766194752","name":"Fatema Bawaji","password":"9766194752","role":"salesman","is_active":true,"created_at":"2025-11-24 13:04:55.887653+00","updated_at":"2025-11-24 13:04:55.887653+00","tenant_id":"112f12b8-55e9-4de8-9fda-d58e37c75796","preferred_language":"en","name_ar":"فاطمة بواجي","assigned_plants":[]},
  {"id":"2b45b630-06d2-4b4b-ae5e-cf29565db45f","phone":"1234567890","name":"Qasim","password":"515253","role":"admin","is_active":true,"created_at":"2025-11-25 14:12:27.651209+00","updated_at":"2025-11-25 14:12:27.651209+00","tenant_id":"112f12b8-55e9-4de8-9fda-d58e37c75796","preferred_language":"en","name_ar":"قاسم","assigned_plants":["423fb7c8-51d0-47f5-8bc5-2fdc0e4f8695"]},
  {"id":"48e61957-3431-43cf-a75f-3d95c15ab1c5","phone":"8600259300","name":"Alok","password":"8600259300","role":"salesman","is_active":true,"created_at":"2025-11-23 05:40:33.146061+00","updated_at":"2025-11-23 05:40:33.146061+00","tenant_id":"112f12b8-55e9-4de8-9fda-d58e37c75796","preferred_language":"en","name_ar":null,"assigned_plants":[]},
  {"id":"4ce4cd87-aacb-4139-b3bc-d55bd01527c3","phone":"9137783276","name":"Kiran Kamble","password":"9137783276","role":"salesman","is_active":true,"created_at":"2025-11-24 13:15:07.698242+00","updated_at":"2025-11-24 13:15:07.698242+00","tenant_id":"112f12b8-55e9-4de8-9fda-d58e37c75796","preferred_language":"en","name_ar":"كيران كامبل","assigned_plants":[]},
  {"id":"5cd01a58-2a27-45ec-8e5b-21a88c9b4d9d","phone":"12345678","name":"Alok1","password":"123456","role":"salesman","is_active":true,"created_at":"2025-11-24 17:41:01.265109+00","updated_at":"2025-11-24 17:41:01.265109+00","tenant_id":"112f12b8-55e9-4de8-9fda-d58e37c75796","preferred_language":"en","name_ar":"ألوك1","assigned_plants":[]},
  {"id":"66c6e515-bd71-49a0-801f-126c6834a25b","phone":"9359338856","name":"Murtaza Bootwala","password":"9730965552","role":"salesman","is_active":true,"created_at":"2025-11-25 08:40:52.034651+00","updated_at":"2025-11-25 08:40:52.034651+00","tenant_id":"112f12b8-55e9-4de8-9fda-d58e37c75796","preferred_language":"en","name_ar":"مرتضى بوتوالا","assigned_plants":[]},
  {"id":"6e274290-a69a-4a96-8db3-e72d1c94c214","phone":"9890777102","name":"Burhanuddin Rangwala","password":"9890777102","role":"salesman","is_active":true,"created_at":"2025-11-24 13:05:28.37851+00","updated_at":"2025-11-24 13:05:28.37851+00","tenant_id":"112f12b8-55e9-4de8-9fda-d58e37c75796","preferred_language":"en","name_ar":"برهان الدين رانجوالا","assigned_plants":[]},
  {"id":"7cc5fdde-aac4-481c-b6b9-05bc64d5a3dc","phone":"8530499971","name":"abbas sales","password":"515253","role":"salesman","is_active":true,"created_at":"2025-11-26 07:12:45.685702+00","updated_at":"2025-11-26 07:12:45.685702+00","tenant_id":"112f12b8-55e9-4de8-9fda-d58e37c75796","preferred_language":"en","name_ar":null,"assigned_plants":[]},
  {"id":"86279a70-2200-4079-acb6-b2ae0f7610fc","phone":"9730965552","name":"Abbas Rangoonwala","password":"515253","role":"admin","is_active":true,"created_at":"2025-11-23 04:47:18.985052+00","updated_at":"2025-11-23 04:47:18.985052+00","tenant_id":"112f12b8-55e9-4de8-9fda-d58e37c75796","preferred_language":"en","name_ar":null,"assigned_plants":[]},
  {"id":"8c65ebd5-6203-4f80-bf7d-34e3f64bbaa8","phone":"8888450842","name":"Sarrah Sanchawala","password":"8888450842","role":"salesman","is_active":true,"created_at":"2025-11-24 13:07:03.300236+00","updated_at":"2025-11-24 13:07:03.300236+00","tenant_id":"112f12b8-55e9-4de8-9fda-d58e37c75796","preferred_language":"en","name_ar":"سارة سانشاوالا","assigned_plants":[]},
  {"id":"d933379c-5834-4fda-94e3-85a53d02a8a5","phone":"1234561001","name":"Salesman1","password":"123456","role":"salesman","is_active":true,"created_at":"2025-11-23 04:16:33.748554+00","updated_at":"2025-11-23 04:16:33.748554+00","tenant_id":"112f12b8-55e9-4de8-9fda-d58e37c75796","preferred_language":"en","name_ar":null,"assigned_plants":[]}
];

console.log(`Importing ${fsmUsers.length} Hylite users...`);

const insertUser = db.prepare(`
  INSERT OR REPLACE INTO users (
    id, tenant_id, phone, name, password_hash, role, email, 
    assigned_plants, preferred_language, is_active, created_at, updated_at
  ) VALUES (
    @id, @tenant_id, @phone, @name, @password_hash, @role, @email,
    @assigned_plants, @preferred_language, @is_active, @created_at, @updated_at
  )
`);

const importUsers = db.transaction((users) => {
  let imported = 0;
  for (const user of users) {
    try {
      insertUser.run({
        id: user.id,
        tenant_id: user.tenant_id,
        phone: user.phone,
        name: user.name,
        password_hash: hashPassword(user.password),
        role: user.role,
        email: null,
        assigned_plants: JSON.stringify(user.assigned_plants || []),
        preferred_language: user.preferred_language || 'en',
        is_active: user.is_active ? 1 : 0,
        created_at: user.created_at,
        updated_at: user.updated_at
      });
      imported++;
      console.log(`  ✓ ${user.role.padEnd(12)} - ${user.name} (${user.phone})`);
    } catch (err) {
      console.error(`  ✗ Error: ${user.name} - ${err.message}`);
    }
  }
  return imported;
});

const result = importUsers(fsmUsers);
console.log(`\n✓ Imported ${result} users`);

// Show summary
const summary = db.prepare(`
  SELECT role, COUNT(*) as count
  FROM users
  WHERE tenant_id = '112f12b8-55e9-4de8-9fda-d58e37c75796'
  GROUP BY role
  ORDER BY 
    CASE role 
      WHEN 'super_admin' THEN 1 
      WHEN 'admin' THEN 2 
      WHEN 'salesman' THEN 3 
      ELSE 4 
    END
`).all();

console.log('\n=== HYLITE USERS BY ROLE ===');
console.table(summary);

// Show sample users
console.log('\n=== SAMPLE CREDENTIALS (1 of each role) ===');
const superAdmin = db.prepare(`SELECT * FROM users WHERE tenant_id = '112f12b8-55e9-4de8-9fda-d58e37c75796' AND role = 'super_admin' LIMIT 1`).get();
const admin = db.prepare(`SELECT * FROM users WHERE tenant_id = '112f12b8-55e9-4de8-9fda-d58e37c75796' AND role = 'admin' LIMIT 1`).get();
const salesman = db.prepare(`SELECT * FROM users WHERE tenant_id = '112f12b8-55e9-4de8-9fda-d58e37c75796' AND role = 'salesman' LIMIT 1`).get();

if (superAdmin) {
  console.log(`\n1. SUPER ADMIN: ${superAdmin.name}`);
  console.log(`   Phone: ${superAdmin.phone}`);
  console.log(`   Password: [use original password]`);
}

if (admin) {
  console.log(`\n2. ADMIN: ${admin.name}`);
  console.log(`   Phone: ${admin.phone}`);
  console.log(`   Password: [use original password]`);
}

if (salesman) {
  console.log(`\n3. SALESMAN: ${salesman.name}`);
  console.log(`   Phone: ${salesman.phone}`);
  console.log(`   Password: [use original password]`);
}

db.close();
