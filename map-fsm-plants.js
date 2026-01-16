/**
 * Map FSM salesman plant values to plant IDs in SQLite.
 *
 * Usage: node map-fsm-plants.js
 * Env:
 *   SQLITE_DB_PATH or DB_PATH
 *   FSM_IMPORT_FILE (default: fsm-import-data.json)
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const dataFile = process.env.FSM_IMPORT_FILE || path.join(__dirname, 'fsm-import-data.json');
const dbPath = process.env.SQLITE_DB_PATH || process.env.DB_PATH || path.join(__dirname, 'local-database.db');

if (!fs.existsSync(dataFile)) {
  console.error('❌ Import file not found:', dataFile);
  process.exit(1);
}

const payload = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
const salesmen = payload.salesmen || [];
const plants = payload.plants || [];

const normalize = (value) => String(value || '').trim().toLowerCase();

const plantIdSet = new Set(plants.map((p) => p.id));
const plantNameMap = new Map();
for (const p of plants) {
  if (p.plant_name) plantNameMap.set(normalize(p.plant_name), p.id);
  if (p.plant_code) plantNameMap.set(normalize(p.plant_code), p.id);
}

const db = new Database(dbPath);

const updateSalesman = db.prepare(`
  UPDATE salesmen
  SET plant_id = ?, updated_at = ?
  WHERE id = ?
`);

const findPlantId = (plantValue) => {
  if (!plantValue) return null;
  if (plantIdSet.has(plantValue)) return plantValue;
  const key = normalize(plantValue);
  return plantNameMap.get(key) || null;
};

const transaction = db.transaction(() => {
  let updated = 0;
  let skipped = 0;

  for (const s of salesmen) {
    const plantValues = Array.isArray(s.plant) ? s.plant : (s.plant ? [s.plant] : []);
    let matchedPlantId = null;

    for (const value of plantValues) {
      matchedPlantId = findPlantId(value);
      if (matchedPlantId) break;
    }

    if (!matchedPlantId) {
      skipped++;
      continue;
    }

    const result = updateSalesman.run(
      matchedPlantId,
      new Date().toISOString(),
      s.id
    );

    if (result.changes > 0) updated++;
  }

  return { updated, skipped };
});

const summary = transaction();
console.log('✅ Plant mapping complete');
console.log(summary);

const check = db.prepare(`
  SELECT COUNT(*) as c FROM salesmen WHERE plant_id IS NOT NULL
`).get();
console.log('Salesmen with plant_id:', check.c);

try {
  db.close();
} catch {}
