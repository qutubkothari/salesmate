/**
 * Import Visits from Supabase Export (visits_rows.json)
 * Handles Supabase column names (location_lat vs gps_latitude, meeting_type vs meeting_types, etc.)
 */

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const LOCAL_DB_PATH = path.join(__dirname, 'local-database.db');
const DEFAULT_TENANT_ID = '101f04af63cbefc2bf8f0a98b9ae1205'; // SAK Solution tenant

const db = new Database(LOCAL_DB_PATH);
db.pragma('foreign_keys = OFF');

console.log('========================================');
console.log('  Importing Visits from Supabase Export');
console.log('========================================\n');

try {
  const jsonPath = process.argv[2] || path.join(__dirname, 'visits_rows.json');
  const raw = fs.readFileSync(jsonPath, 'utf8');
  const parsed = JSON.parse(raw);

  const visits = Array.isArray(parsed) ? parsed : parsed.data || parsed.visits || [];

  if (!Array.isArray(visits) || visits.length === 0) {
    throw new Error('No visits found in JSON.');
  }

  // Filter out soft-deleted
  const activeVisits = visits.filter(v => !v.deleted_at);

  console.log(`Total visits: ${visits.length}`);
  console.log(`Active visits: ${activeVisits.length}`);
  console.log(`Deleted (skipped): ${visits.length - activeVisits.length}\n`);

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

  const ensureJsonText = (value) => {
    if (value == null) return null;
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
        try {
          JSON.parse(trimmed);
          return trimmed;
        } catch {
          // fallthrough
        }
      }
      return JSON.stringify([trimmed]);
    }
    return JSON.stringify(value);
  };

  const normalizePotential = (value) => {
    if (!value) return null;
    const str = String(value).trim().toLowerCase();
    if (str === 'high') return 'High';
    if (str === 'medium' || str === 'med') return 'Medium';
    if (str === 'low') return 'Low';
    return null;
  };

  const toIsoDateOnly = (value) => {
    if (!value) return null;
    const dateObj = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(dateObj.getTime())) return null;
    return dateObj.toISOString().slice(0, 10);
  };

  const toIsoDateTime = (value) => {
    if (!value) return null;
    const dateObj = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(dateObj.getTime())) return null;
    return dateObj.toISOString();
  };

  const asNumber = (value) => {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  };

  const computeDurationMinutes = (timeIn, timeOut) => {
    if (!timeIn || !timeOut) return null;
    const a = new Date(timeIn);
    const b = new Date(timeOut);
    if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
    return Math.max(0, Math.round((b.getTime() - a.getTime()) / 60000));
  };

  let imported = 0;
  let skipped = 0;

  const transaction = db.transaction(() => {
    for (const visit of activeVisits) {
      // Supabase uses location_lat/location_lng instead of gps_latitude/gps_longitude
      const gpsLat = asNumber(visit.location_lat ?? visit.gps_latitude ?? visit.latitude ?? visit.lat ?? null);
      const gpsLng = asNumber(visit.location_lng ?? visit.gps_longitude ?? visit.longitude ?? visit.lng ?? null);

      // Supabase uses time_in/time_out
      const timeIn = toIsoDateTime(visit.time_in || visit.created_at);
      const timeOut = toIsoDateTime(visit.time_out || null);

      // Visit_date not in Supabase, derive from time_in
      const visitDate = toIsoDateOnly(visit.time_in || visit.created_at);

      // Supabase uses meeting_type (singular), products_discussed, next_action
      const meetingTypes = ensureJsonText(visit.meeting_type || visit.meeting_types);
      const productsDiscussed = ensureJsonText(visit.products_discussed);
      const nextAction = ensureJsonText(visit.next_action);

      // Supabase uses plant as a JSON array; extract first element if available
      let plantId = visit.plant_id || null;
      if (!plantId && visit.plant) {
        try {
          const plantArr = typeof visit.plant === 'string' ? JSON.parse(visit.plant) : visit.plant;
          if (Array.isArray(plantArr) && plantArr.length > 0) {
            plantId = plantArr[0];
          }
        } catch {
          // ignore parse errors
        }
      }

      // Required fields validation
      if (!visit.id || !visit.salesman_id || !visit.customer_name || !visitDate || gpsLat === null || gpsLng === null || !timeIn) {
        skipped++;
        continue;
      }

      let durationMinutes = asNumber(visit.duration_minutes);
      if ((durationMinutes == null || Number.isNaN(durationMinutes)) && timeIn && timeOut) {
        durationMinutes = computeDurationMinutes(timeIn, timeOut);
      }

      insertStmt.run(
        visit.id,
        DEFAULT_TENANT_ID,
        visit.salesman_id,
        visit.customer_id || null,
        plantId,

        visit.customer_name,
        visit.contact_person || null,
        visit.customer_phone || null,

        visit.visit_type || 'Regular',
        visitDate,

        meetingTypes,
        productsDiscussed,

        normalizePotential(visit.potential),
        visit.competitor_name || null,
        visit.can_be_switched ? 1 : 0,

        visit.remarks || null,
        nextAction,
        toIsoDateTime(visit.next_action_date) || null,

        gpsLat,
        gpsLng,
        asNumber(visit.location_accuracy) || null,

        timeIn,
        timeOut,
        durationMinutes,

        visit.order_id || null,
        visit.synced == null ? 1 : (visit.synced ? 1 : 0),
        visit.offline_id || null,

        toIsoDateTime(visit.created_at) || new Date().toISOString(),
        toIsoDateTime(visit.updated_at) || toIsoDateTime(visit.created_at) || new Date().toISOString()
      );

      imported++;
    }
  });

  transaction();

  console.log(`✅ Imported ${imported} visits successfully!`);
  if (skipped > 0) {
    console.log(`⚠️  Skipped ${skipped} visits (missing required fields)`);
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

  console.log('\n========================================');
  console.log('  Import Complete!');
  console.log('========================================\n');

} catch (error) {
  console.error('\n❌ Error:', error.message);
  process.exitCode = 1;
} finally {
  db.close();
}
