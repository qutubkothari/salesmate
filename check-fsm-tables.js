/**
 * Quick Database Schema Check
 * Checks if FSM tables exist in local database
 */

const Database = require('better-sqlite3');
const path = require('path');

const dbPath = process.env.SQLITE_DB_PATH || process.env.DB_PATH || path.join(__dirname, 'local-database.db');
const db = new Database(dbPath);

console.log('Checking database:', dbPath);
console.log('\nFSM Tables:');
console.log('='.repeat(50));

const fsmTables = ['salesmen', 'visits', 'salesman_targets', 'customers_engaged', 'visit_images', 'salesman_locations', 'salesman_activity_log'];

fsmTables.forEach(table => {
  try {
    const result = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(table);
    if (result) {
      const count = db.prepare(`SELECT COUNT(*) as count FROM ${table}`).get();
      console.log(`✅ ${table.padEnd(30)} (${count.count} rows)`);
    } else {
      console.log(`❌ ${table.padEnd(30)} (missing)`);
    }
  } catch (error) {
    console.log(`❌ ${table.padEnd(30)} (error: ${error.message})`);
  }
});

console.log('\n' + '='.repeat(50));

db.close();
