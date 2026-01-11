const Database = require('better-sqlite3');
const db = new Database('./local-database.db');

try {
  // First, add the column without default
  db.exec(`ALTER TABLE conversations ADD COLUMN last_activity_at DATETIME`);
  console.log('✅ Added last_activity_at column');
  
  // Then update all existing rows
  db.exec(`UPDATE conversations SET last_activity_at = updated_at WHERE last_activity_at IS NULL`);
  console.log('✅ Updated last_activity_at values from updated_at');
} catch (err) {
  if (err.message.includes('duplicate column')) {
    console.log('⏭️  Column already exists');
  } else {
    console.error('❌ Error:', err.message);
  }
}

db.close();
console.log('✅ Done!');
