const Database = require('better-sqlite3');
const db = new Database('local-database.db');

console.log('=== SALES_USERS TABLE ===');
const salesUsers = db.prepare(`SELECT * FROM sales_users WHERE tenant_id = '112f12b8-55e9-4de8-9fda-d58e37c75796'`).all();
console.table(salesUsers);

console.log('\n=== CRM_USERS TABLE ===');
const crmUsers = db.prepare(`SELECT * FROM crm_users WHERE tenant_id = '112f12b8-55e9-4de8-9fda-d58e37c75796'`).all();
console.table(crmUsers);

db.close();
