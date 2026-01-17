#!/bin/bash
cd /var/www/salesmate-ai

echo "=== Salesman 8484830022 details ==="
sqlite3 -header -column local-database.db "SELECT s.id, s.tenant_id as s_tenant, s.phone as s_phone, s.user_id, u.id as u_id, u.tenant_id as u_tenant, u.phone as u_phone, u.role, u.is_active FROM salesmen s LEFT JOIN users u ON s.user_id = u.id WHERE s.phone LIKE '%8484830022%';"

echo ""
echo "=== Testing login logic ==="
node -e "
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const db = new Database('local-database.db');

const phone = '8484830022';
const password = 'Test@123';

// Find user by phone
const users = db.prepare('SELECT * FROM users').all();
const normalizePhone = (p) => String(p || '').replace(/\D/g, '');
const matchedUser = users.find(u => normalizePhone(u.phone).endsWith(normalizePhone(phone)));

console.log('Matched user:', matchedUser ? { id: matchedUser.id, phone: matchedUser.phone, role: matchedUser.role, tenant: matchedUser.tenant_id, has_hash: !!matchedUser.password_hash } : 'NOT FOUND');

if (matchedUser && matchedUser.password_hash) {
  const valid = bcrypt.compareSync(password, matchedUser.password_hash);
  console.log('Password valid:', valid);
}

// Find salesman
const salesmen = db.prepare('SELECT * FROM salesmen').all();
const matchedSalesman = salesmen.find(s => normalizePhone(s.phone).endsWith(normalizePhone(phone)));
console.log('Matched salesman:', matchedSalesman ? { id: matchedSalesman.id, phone: matchedSalesman.phone, tenant: matchedSalesman.tenant_id, user_id: matchedSalesman.user_id } : 'NOT FOUND');

if (matchedUser && matchedSalesman) {
  console.log('Tenant match:', matchedUser.tenant_id === matchedSalesman.tenant_id);
  console.log('User link match:', matchedUser.id === matchedSalesman.user_id);
}
"
