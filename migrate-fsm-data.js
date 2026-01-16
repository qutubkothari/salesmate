/**
 * FSM Data Migration Script
 * Migrates data from Supabase to Local SQLite Database
 * 
 * Usage: node migrate-fsm-data.js
 */

const { createClient } = require('@supabase/supabase-js');
const Database = require('better-sqlite3');
const path = require('path');

// Configuration
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://your-project.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'your-supabase-key';
const LOCAL_DB_PATH = path.join(__dirname, 'local-database.db');
const DEFAULT_TENANT_ID = '101f04af63cbefc2bf8f0a98b9ae1205'; // SAK Solution tenant

// Initialize Supabase client
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Initialize SQLite database
const db = new Database(LOCAL_DB_PATH);

// Keep imports resilient to partial FK data during migration
db.pragma('foreign_keys = OFF');

console.log('========================================');
console.log('  FSM Data Migration: Supabase → SQLite');
console.log('========================================\n');

/**
 * Migrate Salesmen
 */
async function migrateSalesmen() {
  console.log('[1/3] Migrating Salesmen...');
  
  try {
    // Fetch from Supabase
    const { data: supabaseSalesmen, error } = await supabase
      .from('salesmen')
      .select('*');
    
    if (error) throw error;
    
    if (!supabaseSalesmen || supabaseSalesmen.length === 0) {
      console.log('  No salesmen found in Supabase');
      return { migrated: 0, skipped: 0 };
    }

    let migrated = 0;
    let skipped = 0;

    // Prepare statements
    const insertSalesman = db.prepare(`
      INSERT OR IGNORE INTO salesmen (
        id, tenant_id, name, phone, email, is_active, 
        plant_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertUser = db.prepare(`
      INSERT OR IGNORE INTO users (
        id, tenant_id, name, phone, email, role, 
        is_active, created_at
      ) VALUES (?, ?, ?, ?, ?, 'salesman', ?, ?)
    `);

    // Begin transaction
    const migrateTransaction = db.transaction((salesmen) => {
      for (const salesman of salesmen) {
        const userId = salesman.user_id || `user_${salesman.id}`;
        
        // Insert into users table
        insertUser.run(
          userId,
          DEFAULT_TENANT_ID,
          salesman.name,
          salesman.phone,
          salesman.email || null,
          salesman.is_active ? 1 : 0,
          salesman.created_at || new Date().toISOString()
        );

        // Insert into salesmen table
        const result = insertSalesman.run(
          salesman.id,
          DEFAULT_TENANT_ID,
          salesman.name,
          salesman.phone,
          salesman.email || null,
          salesman.is_active ? 1 : 0,
          salesman.plant_id || null,
          salesman.created_at || new Date().toISOString(),
          salesman.updated_at || new Date().toISOString()
        );

        if (result.changes > 0) migrated++;
        else skipped++;
      }
    });

    migrateTransaction(supabaseSalesmen);

    console.log(`  ✅ Migrated: ${migrated}, Skipped: ${skipped}`);
    return { migrated, skipped };

  } catch (error) {
    console.error('  ❌ Error:', error.message);
    return { migrated: 0, skipped: 0, error: error.message };
  }
}

/**
 * Migrate Visits
 */
async function migrateVisits() {
  console.log('[2/3] Migrating Visits...');
  
  try {
    const { data: supabaseVisits, error } = await supabase
      .from('visits')
      .select('*');
    
    if (error) throw error;
    
    if (!supabaseVisits || supabaseVisits.length === 0) {
      console.log('  No visits found in Supabase');
      return { migrated: 0, skipped: 0 };
    }

    let migrated = 0;
    let skipped = 0;

    const insertVisit = db.prepare(`
      INSERT OR IGNORE INTO visits (
        id, tenant_id, salesman_id, customer_id, plant_id,
        customer_name, contact_person, customer_phone,
        visit_type, visit_date,
        meeting_types, products_discussed,
        potential, competitor_name, can_be_switched, remarks,
        next_action, next_action_date,
        gps_latitude, gps_longitude, location_accuracy,
        time_in, time_out, duration_minutes,
        order_id, synced, offline_id,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const migrateTransaction = db.transaction((visits) => {
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

      const ensureJsonText = (value) => {
        if (value == null) return null;
        if (Array.isArray(value) || typeof value === 'object') return JSON.stringify(value);
        const str = String(value).trim();
        if (!str) return null;
        // Keep string if already JSON; otherwise store as JSON array of one string.
        try {
          JSON.parse(str);
          return str;
        } catch {
          return JSON.stringify([str]);
        }
      };

      for (const visit of visits) {
        const timeIn = toIsoDateTime(visit.time_in || visit.timeIn || visit.check_in || visit.created_at);
        const timeOut = toIsoDateTime(visit.time_out || visit.timeOut || visit.check_out || null);
        const visitDate = toIsoDateOnly(visit.visit_date || visit.date || timeIn || visit.created_at);

        const gpsLatitude = visit.gps_latitude ?? visit.gpsLatitude ?? visit.latitude ?? visit.lat ?? null;
        const gpsLongitude = visit.gps_longitude ?? visit.gpsLongitude ?? visit.longitude ?? visit.lng ?? null;

        // Match NOT NULL constraints in migrations/008_fsm_integration.sql
        if (!visit.id || !visit.salesman_id || !visit.customer_name || !visitDate || gpsLatitude == null || gpsLongitude == null || !timeIn) {
          skipped++;
          continue;
        }

        let durationMinutes = visit.duration_minutes ?? visit.durationMinutes ?? null;
        if ((durationMinutes == null || Number.isNaN(Number(durationMinutes))) && timeIn && timeOut) {
          const minutes = Math.round((new Date(timeOut).getTime() - new Date(timeIn).getTime()) / 60000);
          if (!Number.isNaN(minutes) && minutes >= 0) durationMinutes = minutes;
        }
        if (durationMinutes != null) durationMinutes = Number(durationMinutes);

        const result = insertVisit.run(
          visit.id,
          DEFAULT_TENANT_ID,
          visit.salesman_id,
          visit.customer_id || null,
          visit.plant_id || null,
          visit.customer_name,
          visit.contact_person || null,
          visit.customer_phone || null,
          visit.visit_type || 'Regular',
          visitDate,
          ensureJsonText(visit.meeting_types),
          ensureJsonText(visit.products_discussed),
          normalizePotential(visit.potential),
          visit.competitor_name || null,
          visit.can_be_switched ? 1 : 0,
          visit.remarks || null,
          ensureJsonText(visit.next_action),
          toIsoDateTime(visit.next_action_date) || null,
          gpsLatitude,
          gpsLongitude,
          visit.location_accuracy ?? visit.locationAccuracy ?? null,
          timeIn,
          timeOut,
          durationMinutes,
          visit.order_id || null,
          visit.synced == null ? 1 : (visit.synced ? 1 : 0),
          visit.offline_id || null,
          toIsoDateTime(visit.created_at) || new Date().toISOString(),
          toIsoDateTime(visit.updated_at) || new Date().toISOString()
        );

        if (result.changes > 0) migrated++;
        else skipped++;
      }
    });

    migrateTransaction(supabaseVisits);

    console.log(`  ✅ Migrated: ${migrated}, Skipped: ${skipped}`);
    return { migrated, skipped };

  } catch (error) {
    console.error('  ❌ Error:', error.message);
    return { migrated: 0, skipped: 0, error: error.message };
  }
}

/**
 * Migrate Targets
 */
async function migrateTargets() {
  console.log('[3/3] Migrating Targets...');
  
  try {
    const { data: supabaseTargets, error } = await supabase
      .from('salesman_targets')
      .select('*');
    
    if (error) throw error;
    
    if (!supabaseTargets || supabaseTargets.length === 0) {
      console.log('  No targets found in Supabase');
      return { migrated: 0, skipped: 0 };
    }

    let migrated = 0;
    let skipped = 0;

    const insertTarget = db.prepare(`
      INSERT OR IGNORE INTO salesman_targets (
        id, tenant_id, salesman_id, period, target_visits,
        target_orders, target_revenue, target_new_customers,
        actual_visits, actual_orders, actual_revenue, actual_new_customers,
        plant_id, notes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const migrateTransaction = db.transaction((targets) => {
      for (const target of targets) {
        const result = insertTarget.run(
          target.id,
          DEFAULT_TENANT_ID,
          target.salesman_id,
          target.period,
          target.target_visits || 0,
          target.target_orders || 0,
          target.target_revenue || 0,
          target.target_new_customers || 0,
          target.actual_visits || 0,
          target.actual_orders || 0,
          target.actual_revenue || 0,
          target.actual_new_customers || 0,
          target.plant_id || null,
          target.notes || null,
          target.created_at || new Date().toISOString(),
          target.updated_at || new Date().toISOString()
        );

        if (result.changes > 0) migrated++;
        else skipped++;
      }
    });

    migrateTransaction(supabaseTargets);

    console.log(`  ✅ Migrated: ${migrated}, Skipped: ${skipped}`);
    return { migrated, skipped };

  } catch (error) {
    console.error('  ❌ Error:', error.message);
    return { migrated: 0, skipped: 0, error: error.message };
  }
}

/**
 * Migrate Customers Engaged
 */
async function migrateCustomersEngaged() {
  console.log('\n[4/5] Migrating Customers Engaged...');
  
  try {
    const { data: supabaseCustomers, error } = await supabase
      .from('customers_engaged')
      .select('*');
    
    if (error) throw error;
    
    if (!supabaseCustomers || supabaseCustomers.length === 0) {
      console.log('  No customers engaged found in Supabase');
      return { migrated: 0, skipped: 0 };
    }

    let migrated = 0;
    let skipped = 0;

    const insertCustomer = db.prepare(`
      INSERT OR IGNORE INTO customers_engaged (
        id, tenant_id, visit_id, customer_name, customer_phone,
        salesman_id, engagement_date, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const migrateTransaction = db.transaction((customers) => {
      for (const customer of customers) {
        const result = insertCustomer.run(
          customer.id,
          DEFAULT_TENANT_ID,
          customer.visit_id,
          customer.customer_name,
          customer.customer_phone || null,
          customer.salesman_id,
          customer.engagement_date || new Date().toISOString(),
          customer.created_at || new Date().toISOString()
        );

        if (result.changes > 0) migrated++;
        else skipped++;
      }
    });

    migrateTransaction(supabaseCustomers);

    console.log(`  ✅ Migrated: ${migrated}, Skipped: ${skipped}`);
    return { migrated, skipped };

  } catch (error) {
    console.error('  ❌ Error:', error.message);
    return { migrated: 0, skipped: 0, error: error.message };
  }
}

/**
 * Migrate Orders (FSM-created orders)
 */
async function migrateOrders() {
  console.log('\n[5/5] Migrating FSM Orders...');
  
  try {
    const { data: supabaseOrders, error } = await supabase
      .from('orders')
      .select('*')
      .eq('source', 'fsm');
    
    if (error) throw error;
    
    if (!supabaseOrders || supabaseOrders.length === 0) {
      console.log('  No FSM orders found in Supabase');
      return { migrated: 0, skipped: 0 };
    }

    let migrated = 0;
    let skipped = 0;

    const insertOrder = db.prepare(`
      INSERT OR IGNORE INTO orders (
        id, tenant_id, customer_name, customer_phone, customer_email,
        order_date, status, total_amount, items_json, notes,
        salesman_id, visit_id, conversation_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const migrateTransaction = db.transaction((orders) => {
      for (const order of orders) {
        const result = insertOrder.run(
          order.id,
          DEFAULT_TENANT_ID,
          order.customer_name,
          order.customer_phone || null,
          order.customer_email || null,
          order.order_date || new Date().toISOString(),
          order.status || 'pending',
          order.total_amount || 0,
          order.items_json || '[]',
          order.notes || null,
          order.salesman_id || null,
          order.visit_id || null,
          order.conversation_id || null,
          order.created_at || new Date().toISOString(),
          order.updated_at || new Date().toISOString()
        );

        if (result.changes > 0) migrated++;
        else skipped++;
      }
    });

    migrateTransaction(supabaseOrders);

    console.log(`  ✅ Migrated: ${migrated}, Skipped: ${skipped}`);
    return { migrated, skipped };

  } catch (error) {
    console.error('  ❌ Error:', error.message);
    return { migrated: 0, skipped: 0, error: error.message };
  }
}

/**
 * Verify Migration
 */
function verifyMigration() {
  console.log('\n========================================');
  console.log('  Migration Verification');
  console.log('========================================\n');

  const tables = [
    { name: 'users', filter: 'role = "salesman"' },
    { name: 'salesmen', filter: null },
    { name: 'visits', filter: null },
    { name: 'salesman_targets', filter: null },
    { name: 'customers_engaged', filter: null },
    { name: 'orders', filter: 'visit_id IS NOT NULL' }
  ];

  tables.forEach(({ name, filter }) => {
    const query = filter 
      ? `SELECT COUNT(*) as count FROM ${name} WHERE ${filter}`
      : `SELECT COUNT(*) as count FROM ${name}`;
    
    const result = db.prepare(query).get();
    console.log(`  ${name}: ${result.count} records`);
  });

  console.log('\n========================================');
}

/**
 * Main Migration Process
 */
async function main() {
  try {
    if (
      !SUPABASE_URL ||
      !SUPABASE_KEY ||
      SUPABASE_URL.includes('your-project.supabase.co') ||
      SUPABASE_KEY === 'your-supabase-key'
    ) {
      throw new Error('Missing Supabase config. Set SUPABASE_URL and SUPABASE_KEY env vars before running this script.');
    }

    const results = {
      salesmen: await migrateSalesmen(),
      visits: await migrateVisits(),
      targets: await migrateTargets()
      // Skip customersEngaged and orders - no data in Supabase
    };

    // Verify migration
    verifyMigration();

    // Summary
    console.log('\n========================================');
    console.log('  Migration Summary');
    console.log('========================================\n');

    let totalMigrated = 0;
    let totalSkipped = 0;

    Object.entries(results).forEach(([key, result]) => {
      console.log(`  ${key}:`);
      console.log(`    Migrated: ${result.migrated}`);
      console.log(`    Skipped: ${result.skipped}`);
      if (result.error) {
        console.log(`    Error: ${result.error}`);
      }
      totalMigrated += result.migrated;
      totalSkipped += result.skipped;
    });

    console.log('\n  Total:');
    console.log(`    Migrated: ${totalMigrated}`);
    console.log(`    Skipped: ${totalSkipped}`);

    console.log('\n✅ Migration Complete!\n');

  } catch (error) {
    console.error('\n❌ Migration Failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    db.close();
  }
}

// Run migration
main();
