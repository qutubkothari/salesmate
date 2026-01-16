/**
 * Import Visits from Supabase JSON Export
 *
 * Usage:
 *   node import-visits-json.js visits.json
 *   node import-visits-json.js -  (reads JSON from stdin)
 *   node import-visits-json.js    (uses inline visitsData below)
 *
 * Notes:
 * - Maps ALL records to DEFAULT_TENANT_ID (SAK Solution)
 * - Filters out records with deleted_at
 * - Disables FK checks during import (same pattern as other import scripts)
 */

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const LOCAL_DB_PATH = path.join(__dirname, 'local-database.db');
const DEFAULT_TENANT_ID = '101f04af63cbefc2bf8f0a98b9ae1205'; // SAK Solution tenant

// Paste visits JSON from Supabase here if not using a file arg
// (Recommended: export to a visits.json file and pass it as the first argument)
const visitsData = [];

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

function parseJsonFile(jsonPath) {
  const raw = fs.readFileSync(jsonPath, 'utf8');
  const parsed = JSON.parse(raw);
  if (Array.isArray(parsed)) return parsed;
  if (parsed && Array.isArray(parsed.data)) return parsed.data;
  if (parsed && Array.isArray(parsed.visits)) return parsed.visits;
  throw new Error('Unsupported JSON shape. Expected an array, { data: [...] }, or { visits: [...] }.');
}

function coerceBoolean(value) {
  if (value === true || value === 1 || value === '1') return 1;
  return 0;
}

function asNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function formatDate(value) {
  if (!value) return null;
  // Accept YYYY-MM-DD already
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;

  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  // YYYY-MM-DD
  return d.toISOString().slice(0, 10);
}

function jsonText(value, defaultValue) {
  if (value === null || value === undefined) return JSON.stringify(defaultValue);
  if (typeof value === 'string') {
    // If it already looks like JSON, keep it (but validate if possible)
    const trimmed = value.trim();
    if ((trimmed.startsWith('[') && trimmed.endsWith(']')) || (trimmed.startsWith('{') && trimmed.endsWith('}'))) {
      try {
        JSON.parse(trimmed);
        return trimmed;
      } catch {
        // fallthrough
      }
    }
    return JSON.stringify([value]);
  }
  return JSON.stringify(value);
}

function normalizePotential(value) {
  if (!value) return null;
  const s = String(value).trim().toLowerCase();
  if (s === 'high') return 'High';
  if (s === 'medium') return 'Medium';
  if (s === 'low') return 'Low';
  return null;
}

function computeDurationMinutes(timeIn, timeOut) {
  if (!timeIn || !timeOut) return null;
  const a = new Date(timeIn);
  const b = new Date(timeOut);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 60000));
}

function getPlantId(visit) {
  if (visit.plant_id) return visit.plant_id;
  if (Array.isArray(visit.plant) && visit.plant.length > 0 && visit.plant[0]) return visit.plant[0];
  return null;
}

function getCustomerName(visit) {
  return (
    visit.customer_name ||
    visit.customer_business_name ||
    visit.business_name ||
    visit.customer?.business_name ||
    visit.customer?.name ||
    visit.customer?.customer_name ||
    null
  );
}

function getCustomerPhone(visit) {
  return (
    visit.customer_phone ||
    visit.phone ||
    visit.customer?.phone ||
    visit.customer?.customer_phone ||
    null
  );
}

function getVisitLatitude(visit) {
  return asNumber(
    visit.gps_latitude ??
      visit.latitude ??
      visit.lat ??
      visit.gps_lat ??
      null
  );
}

function getVisitLongitude(visit) {
  return asNumber(
    visit.gps_longitude ??
      visit.longitude ??
      visit.lng ??
      visit.lon ??
      visit.gps_lng ??
      visit.gps_lon ??
      null
  );
}

const db = new Database(LOCAL_DB_PATH);

// Disable foreign key checks for import
db.pragma('foreign_keys = OFF');

function extractVisitsArray(parsed, sourceLabel) {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && Array.isArray(parsed.data)) return parsed.data;
  if (parsed && Array.isArray(parsed.visits)) return parsed.visits;
  throw new Error(
    `Unsupported JSON shape from ${sourceLabel}. Expected an array, { data: [...] }, or { visits: [...] }.`
  );
}

async function loadVisits() {
  const inputPath = process.argv[2];

  if (inputPath === '-') {
    const stdinRaw = await readStdin();
    if (!stdinRaw.trim()) {
      throw new Error('No stdin provided. Paste JSON then press Ctrl+Z then Enter to finish.');
    }
    const parsed = JSON.parse(stdinRaw);
    return extractVisitsArray(parsed, 'stdin');
  }

  if (inputPath) {
    const resolved = path.isAbsolute(inputPath) ? inputPath : path.join(__dirname, inputPath);
    return parseJsonFile(resolved);
  }

  if (Array.isArray(visitsData) && visitsData.length > 0) {
    return visitsData;
  }

  throw new Error('No input provided. Pass a JSON file path, or use "-" to paste JSON via stdin.');
}

async function run() {
  console.log('========================================');
  console.log('  Importing Visits from JSON');
  console.log('========================================\n');

  try {
    const rawVisits = await loadVisits();

    if (!Array.isArray(rawVisits)) {
      throw new Error('Visits input must be an array of records.');
    }

    // Filter out deleted visits (if column exists in export)
    const activeVisits = rawVisits.filter(v => !v.deleted_at);

  console.log(`Total visits: ${rawVisits.length}`);
  console.log(`Active visits: ${activeVisits.length}`);
  console.log(`Deleted (skipped): ${rawVisits.length - activeVisits.length}\n`);

  const insertStmt = db.prepare(`
    INSERT OR REPLACE INTO visits (
      id, tenant_id, salesman_id, customer_id, plant_id,
      customer_name, contact_person, customer_phone,
      visit_type, visit_date,
      meeting_types, products_discussed,
      potential, competitor_name, can_be_switched,
      remarks, next_action, next_action_date,
      gps_latitude, gps_longitude, location_accuracy,
      time_in, time_out, duration_minutes,
      order_id, synced, offline_id,
      created_at, updated_at
    ) VALUES (
      ?, ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?,
      ?, ?,
      ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?,
      ?, ?
    )
  `);

  const nowIso = new Date().toISOString();

  const transaction = db.transaction((visits) => {
    let imported = 0;
    let skippedInvalid = 0;

    for (const visit of visits) {
      const customerName = getCustomerName(visit);
      const gpsLat = getVisitLatitude(visit);
      const gpsLng = getVisitLongitude(visit);
      const timeIn = visit.time_in || visit.check_in_time || visit.created_at || nowIso;
      const timeOut = visit.time_out || visit.check_out_time || null;

      // Schema constraints
      if (!visit.id || !visit.salesman_id || !customerName) {
        skippedInvalid++;
        continue;
      }
      if (gpsLat === null || gpsLng === null) {
        skippedInvalid++;
        continue;
      }

      const durationMinutes =
        asNumber(visit.duration_minutes) ??
        computeDurationMinutes(timeIn, timeOut);

      insertStmt.run(
        visit.id,
        DEFAULT_TENANT_ID,
        visit.salesman_id,
        visit.customer_id || null,
        getPlantId(visit),

        customerName,
        visit.contact_person || visit.customer?.contact_person || null,
        getCustomerPhone(visit),

        visit.visit_type || visit.type || null,
        formatDate(visit.visit_date || visit.date || timeIn) || formatDate(visit.created_at) || formatDate(nowIso),

        jsonText(visit.meeting_types, []),
        jsonText(visit.products_discussed, []),

        normalizePotential(visit.potential),
        visit.competitor_name || null,
        coerceBoolean(visit.can_be_switched),

        visit.remarks || null,
        jsonText(visit.next_action, []),
        visit.next_action_date || null,

        gpsLat,
        gpsLng,
        asNumber(visit.location_accuracy),

        timeIn,
        timeOut,
        durationMinutes,

        visit.order_id || null,
        visit.synced === undefined || visit.synced === null ? 1 : coerceBoolean(visit.synced),
        visit.offline_id || null,

        visit.created_at || nowIso,
        visit.updated_at || visit.created_at || nowIso
      );

      imported++;
    }

    return { imported, skippedInvalid };
  });

    const result = transaction(activeVisits);

  console.log(`✅ Imported ${result.imported} visits successfully!`);
  if (result.skippedInvalid > 0) {
    console.log(`⚠️  Skipped ${result.skippedInvalid} invalid visits (missing required fields or GPS)`);
  }

  // Verify
  const count = db.prepare('SELECT COUNT(*) as count FROM visits').get();
  console.log(`\nTotal visits in database: ${count.count}`);

  const range = db.prepare(`
    SELECT MIN(visit_date) as min_date, MAX(visit_date) as max_date
    FROM visits
  `).get();
  console.log(`Date range: ${range.min_date || 'N/A'} → ${range.max_date || 'N/A'}`);

  const topSalesmen = db.prepare(`
    SELECT salesman_id, COUNT(*) as visits
    FROM visits
    GROUP BY salesman_id
    ORDER BY visits DESC
    LIMIT 10
  `).all();

  console.log('\nTop salesmen by visits (top 10):');
  topSalesmen.forEach(row => {
    console.log(`  ${row.salesman_id}: ${row.visits}`);
  });

  const orphaned = db.prepare(`
    SELECT COUNT(*) as count
    FROM visits v
    WHERE NOT EXISTS (SELECT 1 FROM salesmen s WHERE s.id = v.salesman_id)
  `).get();

    if (orphaned.count > 0) {
      console.log(`\n⚠️  Orphaned visits (missing salesman): ${orphaned.count}`);
    } else {
      console.log('\n✅ All visits reference an existing salesman');
    }

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    process.exitCode = 1;
  } finally {
    db.close();
  }
}

run();
