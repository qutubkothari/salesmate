const Database = require('better-sqlite3');
const crypto = require('crypto');

const db = new Database('local-database.db');

function hashPassword(password) {
  if (!password) return null;
  return crypto.createHash('sha512').update(password).digest('hex');
}

// ALL FSM users from your export
const allFsmUsers = [
  {"id":"04fe961c-f7f9-4a09-9a17-5f38229947c0","phone":"7737845253","name":"QUTUB","password":"515253","role":"salesman","is_active":true,"created_at":"2025-11-22 20:18:49.090667+00","updated_at":"2025-11-22 20:18:49.090667+00","tenant_id":"112f12b8-55e9-4de8-9fda-d58e37c75796","preferred_language":"en","name_ar":null,"assigned_plants":[]},
  {"id":"0667c6a1-1154-403f-ba37-0b5edf120578","phone":"9766748786","name":"Mudar Sanchawala","password":"9766748786","role":"admin","is_active":true,"created_at":"2025-11-24 13:00:46.333381+00","updated_at":"2025-11-24 13:00:46.333381+00","tenant_id":"112f12b8-55e9-4de8-9fda-d58e37c75796","preferred_language":"en","name_ar":"مودار سانشاوالا","assigned_plants":[]},
  {"id":"0c67f943-017f-42e7-b50a-c472f4aacec9","phone":"1222538476","name":"Murtaza Rangwala","password":"1222538476","role":"salesman","is_active":true,"created_at":"2025-11-24 17:24:52.546676+00","updated_at":"2025-11-24 17:24:52.546676+00","tenant_id":"84c1ba8d-53ab-43ef-9483-d997682f3072","preferred_language":"en","name_ar":"مرتضى رانجوالا","assigned_plants":[]},
  {"id":"0e7e3b62-67bd-458e-b79f-e9fe74abd5a3","phone":"9537653927","name":"QK","password":"515253","role":"super_admin","is_active":true,"created_at":"2025-11-22 20:16:53.691747+00","updated_at":"2025-11-22 20:16:53.691747+00","tenant_id":"112f12b8-55e9-4de8-9fda-d58e37c75796","preferred_language":"en","name_ar":null,"assigned_plants":[]},
  {"id":"1b29fd58-3d83-4ff6-ab99-8d19fb5e3f0e","phone":"9819370256","name":"Hamza Bootwala","password":"9819370256","role":"salesman","is_active":true,"created_at":"2025-11-24 13:08:49.195446+00","updated_at":"2025-11-24 13:08:49.195446+00","tenant_id":"112f12b8-55e9-4de8-9fda-d58e37c75796","preferred_language":"en","name_ar":"حمزة بوتوالا","assigned_plants":[]},
  {"id":"1de0d404-1946-4046-bd4d-e4145c6c8603","phone":"9769395452","name":"Yusuf  Bootwala","password":"9769395452","role":"admin","is_active":true,"created_at":"2025-11-24 13:03:16.383133+00","updated_at":"2025-11-24 13:03:16.383133+00","tenant_id":"112f12b8-55e9-4de8-9fda-d58e37c75796","preferred_language":"en","name_ar":"يوسف بوتوالا","assigned_plants":[]},
  {"id":"288bd28f-949a-4a0f-a71f-204257c7432c","phone":"9766194752","name":"Fatema Bawaji","password":"9766194752","role":"salesman","is_active":true,"created_at":"2025-11-24 13:04:55.887653+00","updated_at":"2025-11-24 13:04:55.887653+00","tenant_id":"112f12b8-55e9-4de8-9fda-d58e37c75796","preferred_language":"en","name_ar":"فاطمة بواجي","assigned_plants":[]},
  {"id":"2b45b630-06d2-4b4b-ae5e-cf29565db45f","phone":"1234567890","name":"Qasim","password":"515253","role":"admin","is_active":true,"created_at":"2025-11-25 14:12:27.651209+00","updated_at":"2025-11-25 14:12:27.651209+00","tenant_id":"112f12b8-55e9-4de8-9fda-d58e37c75796","preferred_language":"en","name_ar":"قاسم","assigned_plants":["423fb7c8-51d0-47f5-8bc5-2fdc0e4f8695"]},
  {"id":"32c999ba-6fbd-4761-97ba-be64b7ec274e","phone":"1227670286","name":"Abu Mansour","password":"1227670286","role":"salesman","is_active":true,"created_at":"2025-11-26 14:41:40.379026+00","updated_at":"2025-11-26 14:41:40.379026+00","tenant_id":"84c1ba8d-53ab-43ef-9483-d997682f3072","preferred_language":"en","name_ar":"أبو منصور","assigned_plants":[]},
  {"id":"48e61957-3431-43cf-a75f-3d95c15ab1c5","phone":"8600259300","name":"Alok","password":"8600259300","role":"salesman","is_active":true,"created_at":"2025-11-23 05:40:33.146061+00","updated_at":"2025-11-23 05:40:33.146061+00","tenant_id":"112f12b8-55e9-4de8-9fda-d58e37c75796","preferred_language":"en","name_ar":null,"assigned_plants":[]},
  {"id":"4a1fe052-6686-49c5-bf4f-0b2353de36ac","phone":"8484862949","name":"MUSTAFA","password":"515253","role":"salesman","is_active":true,"created_at":"2025-11-22 20:42:30.669463+00","updated_at":"2025-11-22 20:42:30.669463+00","tenant_id":"84c1ba8d-53ab-43ef-9483-d997682f3072","preferred_language":"en","name_ar":null,"assigned_plants":[]},
  {"id":"4c7d0b10-6577-4af9-b525-b531cea8f7be","phone":"8484830022","name":"Demo Salesman","password":"515253","role":"salesman","is_active":true,"created_at":"2025-12-10 15:52:37.51543+00","updated_at":"2025-12-10 15:52:37.51543+00","tenant_id":"aaaaaaaa-bbbb-cccc-dddd-000000000001","preferred_language":"en","name_ar":"مندوب تجريبي","assigned_plants":[]},
  {"id":"4ce4cd87-aacb-4139-b3bc-d55bd01527c3","phone":"9137783276","name":"Kiran Kamble","password":"9137783276","role":"salesman","is_active":true,"created_at":"2025-11-24 13:15:07.698242+00","updated_at":"2025-11-24 13:15:07.698242+00","tenant_id":"112f12b8-55e9-4de8-9fda-d58e37c75796","preferred_language":"en","name_ar":"كيران كامبل","assigned_plants":[]},
  {"id":"5cd01a58-2a27-45ec-8e5b-21a88c9b4d9d","phone":"12345678","name":"Alok1","password":"123456","role":"salesman","is_active":true,"created_at":"2025-11-24 17:41:01.265109+00","updated_at":"2025-11-24 17:41:01.265109+00","tenant_id":"112f12b8-55e9-4de8-9fda-d58e37c75796","preferred_language":"en","name_ar":"ألوك1","assigned_plants":[]},
  {"id":"6499b1ce-e210-403d-bcb5-6eb51333d662","phone":"1025544999","name":"Abdel Ghany","password":"515253","role":"salesman","is_active":true,"created_at":"2025-12-11 07:35:51.807894+00","updated_at":"2025-12-11 07:35:51.807894+00","tenant_id":"fa47fd9f-253f-44c6-af02-86165f018321","preferred_language":"en","name_ar":null,"assigned_plants":[]},
  {"id":"66c6e515-bd71-49a0-801f-126c6834a25b","phone":"9359338856","name":"Murtaza Bootwala","password":"9730965552","role":"salesman","is_active":true,"created_at":"2025-11-25 08:40:52.034651+00","updated_at":"2025-11-25 08:40:52.034651+00","tenant_id":"112f12b8-55e9-4de8-9fda-d58e37c75796","preferred_language":"en","name_ar":"مرتضى بوتوالا","assigned_plants":[]},
  {"id":"67fd8bd1-9f4f-4881-beba-6a9a19ea59f5","phone":"1212516013","name":"HASAN","password":"1212516013","role":"super_admin","is_active":true,"created_at":"2025-11-22 20:19:24.973023+00","updated_at":"2025-11-22 20:19:24.973023+00","tenant_id":"84c1ba8d-53ab-43ef-9483-d997682f3072","preferred_language":"en","name_ar":null,"assigned_plants":[]},
  {"id":"6e274290-a69a-4a96-8db3-e72d1c94c214","phone":"9890777102","name":"Burhanuddin Rangwala","password":"9890777102","role":"salesman","is_active":true,"created_at":"2025-11-24 13:05:28.37851+00","updated_at":"2025-11-24 13:05:28.37851+00","tenant_id":"112f12b8-55e9-4de8-9fda-d58e37c75796","preferred_language":"en","name_ar":"برهان الدين رانجوالا","assigned_plants":[]},
  {"id":"7cc5fdde-aac4-481c-b6b9-05bc64d5a3dc","phone":"8530499971","name":"abbas sales","password":"515253","role":"salesman","is_active":true,"created_at":"2025-11-26 07:12:45.685702+00","updated_at":"2025-11-26 07:12:45.685702+00","tenant_id":"112f12b8-55e9-4de8-9fda-d58e37c75796","preferred_language":"en","name_ar":null,"assigned_plants":[]},
  {"id":"8410ff83-5e4a-459c-9d85-3c537d193b95","phone":"1099880582","name":"Mohammad Yahya","password":"1099880582","role":"salesman","is_active":true,"created_at":"2025-11-29 06:37:02.743993+00","updated_at":"2025-11-29 06:37:02.743993+00","tenant_id":"fd43ab22-cc00-4fca-9dbf-768c0949c468","preferred_language":"en","name_ar":"محمد يحيى","assigned_plants":[]},
  {"id":"86279a70-2200-4079-acb6-b2ae0f7610fc","phone":"9730965552","name":"Abbas Rangoonwala","password":"515253","role":"admin","is_active":true,"created_at":"2025-11-23 04:47:18.985052+00","updated_at":"2025-11-23 04:47:18.985052+00","tenant_id":"112f12b8-55e9-4de8-9fda-d58e37c75796","preferred_language":"en","name_ar":null,"assigned_plants":[]},
  {"id":"862be90c-81f1-4772-bd39-d0b4bae9c380","phone":"1287417417","name":"Remon Nagy","password":"1287417417","role":"salesman","is_active":true,"created_at":"2025-11-29 06:35:01.995493+00","updated_at":"2025-11-29 06:35:01.995493+00","tenant_id":"fd43ab22-cc00-4fca-9dbf-768c0949c468","preferred_language":"en","name_ar":"ريمون ناجي","assigned_plants":[]},
  {"id":"8c65ebd5-6203-4f80-bf7d-34e3f64bbaa8","phone":"8888450842","name":"Sarrah Sanchawala","password":"8888450842","role":"salesman","is_active":true,"created_at":"2025-11-24 13:07:03.300236+00","updated_at":"2025-11-24 13:07:03.300236+00","tenant_id":"112f12b8-55e9-4de8-9fda-d58e37c75796","preferred_language":"en","name_ar":"سارة سانشاوالا","assigned_plants":[]},
  {"id":"a54fae0e-a6d2-4159-914a-adf1e08b4a45","phone":"8484830021","name":"Demo Super Admin","password":"515253","role":"super_admin","is_active":true,"created_at":"2025-12-10 15:52:37.51543+00","updated_at":"2025-12-10 15:52:37.51543+00","tenant_id":"aaaaaaaa-bbbb-cccc-dddd-000000000001","preferred_language":"en","name_ar":"مسؤول تجريبي","assigned_plants":[]},
  {"id":"a7594ecf-67c1-4fa5-85e1-09b4a470b412","phone":"","name":"Murtaza Rangwl","password":"1212516013","role":"salesman","is_active":true,"created_at":"2025-11-24 15:28:28.81709+00","updated_at":"2025-11-24 15:28:28.81709+00","tenant_id":"84c1ba8d-53ab-43ef-9483-d997682f3072","preferred_language":"en","name_ar":"مرتضى رانغولا","assigned_plants":[]},
  {"id":"a955a7a9-ca19-405a-b116-773178a95533","phone":"1100598936","name":"Amira","password":"1100598936","role":"salesman","is_active":true,"created_at":"2025-11-29 06:36:11.293747+00","updated_at":"2025-11-29 06:36:11.293747+00","tenant_id":"fd43ab22-cc00-4fca-9dbf-768c0949c468","preferred_language":"en","name_ar":"أميرة","assigned_plants":[]},
  {"id":"d88cc490-2cf7-42b8-a8a6-57d46c95782c","phone":"1032833937","name":"Ahmed Hassan","password":"1032833937","role":"salesman","is_active":true,"created_at":"2025-11-24 11:16:48.361663+00","updated_at":"2025-11-24 11:16:48.361663+00","tenant_id":"84c1ba8d-53ab-43ef-9483-d997682f3072","preferred_language":"en","name_ar":"أحمد حسن","assigned_plants":[]},
  {"id":"d933379c-5834-4fda-94e3-85a53d02a8a5","phone":"1234561001","name":"Salesman1","password":"123456","role":"salesman","is_active":true,"created_at":"2025-11-23 04:16:33.748554+00","updated_at":"2025-11-23 04:16:33.748554+00","tenant_id":"112f12b8-55e9-4de8-9fda-d58e37c75796","preferred_language":"en","name_ar":null,"assigned_plants":[]},
  {"id":"e800980f-dd8d-4ed9-953a-3a6adcac3390","phone":"1062419870","name":"Ahmed Sabr","password":"1062419870","role":"salesman","is_active":true,"created_at":"2025-11-24 06:11:53.633568+00","updated_at":"2025-11-24 06:11:53.633568+00","tenant_id":"84c1ba8d-53ab-43ef-9483-d997682f3072","preferred_language":"en","name_ar":"أحمد صبري","assigned_plants":[]},
  {"id":"ec109a50-c8c7-4d8c-a31b-43b253a8d294","phone":"1289993815","name":"Mufaddal","password":"352515","role":"super_admin","is_active":true,"created_at":"2025-12-11 07:10:05.343605+00","updated_at":"2025-12-11 07:10:05.343605+00","tenant_id":"fa47fd9f-253f-44c6-af02-86165f018321","preferred_language":"en","name_ar":null,"assigned_plants":[]},
  {"id":"f4ccb57a-4e32-410b-800f-9dbf7fb9771e","phone":"1110558254","name":"Murtaza R","password":"1110558254","role":"super_admin","is_active":true,"created_at":"2025-11-29 04:58:45.429214+00","updated_at":"2025-11-29 04:58:45.429214+00","tenant_id":"fd43ab22-cc00-4fca-9dbf-768c0949c468","preferred_language":"ar","name_ar":null,"assigned_plants":[]}
];

console.log(`\nImporting ${allFsmUsers.length} users from ALL tenants...\n`);

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
        phone: user.phone || '',
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
      const tenantName = user.tenant_id === '112f12b8-55e9-4de8-9fda-d58e37c75796' ? 'Hylite' :
                         user.tenant_id === '84c1ba8d-53ab-43ef-9483-d997682f3072' ? 'GAZELLE' :
                         user.tenant_id === 'aaaaaaaa-bbbb-cccc-dddd-000000000001' ? 'DEMO' :
                         user.tenant_id === 'fd43ab22-cc00-4fca-9dbf-768c0949c468' ? 'Gazelle Env' : 'Crescent';
      console.log(`  ✓ [${tenantName.padEnd(12)}] ${user.role.padEnd(12)} - ${user.name} (${user.phone})`);
    } catch (err) {
      console.error(`  ✗ Error: ${user.name} - ${err.message}`);
    }
  }
  return imported;
});

const result = importUsers(allFsmUsers);
console.log(`\n✅ Imported ${result} total users`);

// Summary by tenant
const summary = db.prepare(`
  SELECT 
    t.company_name as tenant,
    u.role,
    COUNT(*) as count
  FROM users u
  LEFT JOIN tenants t ON u.tenant_id = t.id
  GROUP BY u.tenant_id, u.role
  ORDER BY t.company_name, 
    CASE u.role 
      WHEN 'super_admin' THEN 1 
      WHEN 'admin' THEN 2 
      WHEN 'salesman' THEN 3 
      ELSE 4 
    END
`).all();

console.log('\n=== USERS BY TENANT AND ROLE ===');
console.table(summary);

// Total summary
const totals = db.prepare(`
  SELECT role, COUNT(*) as total
  FROM users
  GROUP BY role
  ORDER BY 
    CASE role 
      WHEN 'super_admin' THEN 1 
      WHEN 'admin' THEN 2 
      WHEN 'salesman' THEN 3 
      ELSE 4 
    END
`).all();

console.log('\n=== TOTAL BY ROLE ===');
console.table(totals);

db.close();
