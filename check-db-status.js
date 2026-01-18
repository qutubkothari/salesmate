const Database = require('better-sqlite3');
const db = new Database('./local-database.db');

console.log('\n=== Customer Database Status ===\n');

const customerCount = db.prepare('SELECT COUNT(*) as count FROM customer_profiles_new').get();
console.log('Total customers:', customerCount.count);

const visitCount = db.prepare('SELECT COUNT(*) as count FROM visits').get();
console.log('Total visits:', visitCount.count);

const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get();
console.log('Total users:', userCount.count);

db.close();
