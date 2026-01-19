const Database = require('better-sqlite3');
const db = new Database('local-database.db');

const user = db.prepare('SELECT phone, name, role, password_hash, length(password_hash) as hash_len FROM users WHERE phone = ?').get('8600259300');

console.log('\n=== USER 8600259300 (Alok) ===');
console.log('Phone:', user.phone);
console.log('Name:', user.name);
console.log('Role:', user.role);
console.log('Password Hash Length:', user.hash_len);
console.log('Password Hash (first 20 chars):', user.password_hash ? user.password_hash.substring(0, 20) + '...' : 'NULL');

// Test the hash
const crypto = require('crypto');
const testPassword = '8600259300';
const expectedHash = crypto.createHash('sha512').update(testPassword).digest('hex');

console.log('\n=== PASSWORD VERIFICATION ===');
console.log('Expected hash matches:', user.password_hash === expectedHash ? 'YES ✓' : 'NO ✗');

if (user.password_hash !== expectedHash) {
  console.log('\nExpected:', expectedHash.substring(0, 40) + '...');
  console.log('Actual:  ', user.password_hash ? user.password_hash.substring(0, 40) + '...' : 'NULL');
}

console.log('\n=== CREDENTIALS ===');
console.log('Phone: 8600259300');
console.log('Password: 8600259300');

db.close();
