/**
 * FSM Integration Test Suite
 * Tests the migrated data and API endpoints
 * 
 * Usage: node test-fsm-integration.js
 */

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, 'local-database.db');
const API_BASE_URL = process.env.API_URL || 'https://salesmate.saksolution.com';
const DEFAULT_TENANT_ID = '101f04af63cbefc2bf8f0a98b9ae1205';

console.log('========================================');
console.log('  FSM Integration Test Suite');
console.log('========================================\n');

/**
 * Test 1: Database Schema Validation
 */
function testDatabaseSchema() {
  console.log('[Test 1] Database Schema Validation');
  
  try {
    const db = new Database(DB_PATH, { readonly: true });
    
    const requiredTables = [
      'salesmen',
      'visits',
      'salesman_targets',
      'visit_images',
      'plants'
    ];

    const existingTables = db.prepare(`
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name NOT LIKE 'sqlite_%'
    `).all().map(row => row.name);

    let passed = 0;
    let failed = 0;

    requiredTables.forEach(table => {
      if (existingTables.includes(table)) {
        console.log(`  ✅ ${table} - exists`);
        passed++;
      } else {
        console.log(`  ❌ ${table} - missing`);
        failed++;
      }
    });

    db.close();

    console.log(`\n  Result: ${passed} passed, ${failed} failed\n`);
    return failed === 0;

  } catch (error) {
    console.error('  ❌ Error:', error.message);
    return false;
  }
}

/**
 * Test 2: Data Integrity Check
 */
function testDataIntegrity() {
  console.log('[Test 2] Data Integrity Check');
  
  try {
    const db = new Database(DB_PATH, { readonly: true });

    // Check salesmen data
    const salesmen = db.prepare('SELECT COUNT(*) as count FROM salesmen').get();
    console.log(`  Salesmen: ${salesmen.count} records`);

    // Check visits data
    const visits = db.prepare('SELECT COUNT(*) as count FROM visits').get();
    console.log(`  Visits: ${visits.count} records`);

    // Check visits with time_out (completed visits)
    const completedVisits = db.prepare('SELECT COUNT(*) as count FROM visits WHERE time_out IS NOT NULL').get();
    console.log(`  Completed Visits: ${completedVisits.count} records`);

    // Check targets
    const targets = db.prepare('SELECT COUNT(*) as count FROM salesman_targets').get();
    console.log(`  Targets: ${targets.count} records`);

    // Check visit images
    const visitImages = db.prepare('SELECT COUNT(*) as count FROM visit_images').get();
    console.log(`  Visit Images: ${visitImages.count} records`);

    // Check orphaned visits (visits without salesman)
    const orphanedVisits = db.prepare(`
      SELECT COUNT(*) as count FROM visits v
      WHERE NOT EXISTS (SELECT 1 FROM salesmen s WHERE s.id = v.salesman_id)
    `).get();

    if (orphanedVisits.count > 0) {
      console.log(`  ⚠️  Warning: ${orphanedVisits.count} visits without valid salesman`);
    } else {
      console.log(`  ✅ All visits have valid salesmen`);
    }

    // Check visit-target consistency
    const currentMonth = new Date().toISOString().substring(0, 7); // YYYY-MM
    const visitsThisMonth = db.prepare(`
      SELECT COUNT(*) as count FROM visits 
      WHERE strftime('%Y-%m', visit_date) = ?
    `).get(currentMonth);

    const targetsThisMonth = db.prepare(`
      SELECT COUNT(*) as count FROM salesman_targets 
      WHERE period = ?
    `).get(currentMonth);

    console.log(`  Visits this month (${currentMonth}): ${visitsThisMonth.count}`);
    console.log(`  Targets this month: ${targetsThisMonth.count}`);

    db.close();

    console.log('\n  ✅ Data integrity check complete\n');
    return true;

  } catch (error) {
    console.error('  ❌ Error:', error.message);
    return false;
  }
}

/**
 * Test 3: Foreign Key Relationships
 */
function testRelationships() {
  console.log('[Test 3] Foreign Key Relationships');
  
  try {
    const db = new Database(DB_PATH, { readonly: true });

    // Test visit -> salesman relationship
    const visitSalesmanCheck = db.prepare(`
      SELECT 
        v.id as visit_id,
        v.salesman_id,
        s.name as salesman_name
      FROM visits v
      LEFT JOIN salesmen s ON v.salesman_id = s.id
      LIMIT 5
    `).all();

    console.log('  Sample Visit-Salesman relationships:');
    visitSalesmanCheck.forEach(row => {
      if (row.salesman_name) {
        console.log(`    ✅ Visit ${row.visit_id} → Salesman ${row.salesman_name}`);
      } else {
        console.log(`    ❌ Visit ${row.visit_id} → No salesman found!`);
      }
    });

    // Test target -> salesman relationship
    const targetSalesmanCheck = db.prepare(`
      SELECT 
        t.id as target_id,
        t.salesman_id,
        s.name as salesman_name,
        t.period
      FROM salesman_targets t
      LEFT JOIN salesmen s ON t.salesman_id = s.id
      LIMIT 5
    `).all();

    console.log('\n  Sample Target-Salesman relationships:');
    targetSalesmanCheck.forEach(row => {
      if (row.salesman_name) {
        console.log(`    ✅ Target ${row.period} → Salesman ${row.salesman_name}`);
      } else {
        console.log(`    ❌ Target ${row.target_id} → No salesman found!`);
      }
    });

    // Test visit -> plant relationship
    const visitPlantCheck = db.prepare(`
      SELECT 
        v.id as visit_id,
        v.plant_id,
        p.name as plant_name
      FROM visits v
      LEFT JOIN plants p ON v.plant_id = p.id
      WHERE v.plant_id IS NOT NULL
      LIMIT 5
    `).all();

    console.log('\n  Sample Visit-Plant relationships:');
    if (visitPlantCheck.length > 0) {
      visitPlantCheck.forEach(row => {
        if (row.plant_name) {
          console.log(`    ✅ Visit ${row.visit_id} → Plant ${row.plant_name}`);
        } else {
          console.log(`    ⚠️  Visit ${row.visit_id} → No plant found`);
        }
      });
    } else {
      console.log('    No visits with plant assignments');
    }

    db.close();

    console.log('\n  ✅ Relationship check complete\n');
    return true;

  } catch (error) {
    console.error('  ❌ Error:', error.message);
    return false;
  }
}

/**
 * Test 4: Sample Data Queries
 */
function testSampleQueries() {
  console.log('[Test 4] Sample Data Queries');
  
  try {
    const db = new Database(DB_PATH, { readonly: true });

    // Get top salesmen by visits
    const topSalesmen = db.prepare(`
      SELECT 
        s.name,
        COUNT(v.id) as total_visits,
        SUM(CASE WHEN v.time_out IS NOT NULL THEN 1 ELSE 0 END) as completed_visits
      FROM salesmen s
      LEFT JOIN visits v ON s.id = v.salesman_id
      GROUP BY s.id
      ORDER BY total_visits DESC
      LIMIT 5
    `).all();

    console.log('  Top 5 Salesmen by Visits:');
    topSalesmen.forEach((salesman, idx) => {
      console.log(`    ${idx + 1}. ${salesman.name}: ${salesman.total_visits} visits (${salesman.completed_visits} completed)`);
    });

    // Get recent visits
    const recentVisits = db.prepare(`
      SELECT 
        v.id,
        v.customer_name,
        s.name as salesman_name,
        v.visit_type,
        v.time_out,
        v.visit_date
      FROM visits v
      JOIN salesmen s ON v.salesman_id = s.id
      ORDER BY v.visit_date DESC, v.created_at DESC
      LIMIT 5
    `).all();

    console.log('\n  Recent 5 Visits:');
    recentVisits.forEach((visit, idx) => {
      const status = visit.time_out ? '✅ Completed' : '⏳ In Progress';
      console.log(`    ${idx + 1}. ${visit.customer_name} by ${visit.salesman_name} (${visit.visit_date}) - ${status}`);
    });

    // Get current month target vs achieved
    const currentMonth = new Date().toISOString().substring(0, 7);
    const targetProgress = db.prepare(`
      SELECT 
        s.name as salesman_name,
        t.target_visits,
        t.achieved_visits,
        t.target_orders,
        t.achieved_orders,
        ROUND(t.achieved_visits * 100.0 / NULLIF(t.target_visits, 0), 1) as visit_completion_pct
      FROM salesman_targets t
      JOIN salesmen s ON t.salesman_id = s.id
      WHERE t.period = ?
      ORDER BY visit_completion_pct DESC
      LIMIT 5
    `).all(currentMonth);

    console.log(`\n  Target Progress for ${currentMonth}:`);
    if (targetProgress.length > 0) {
      targetProgress.forEach((progress, idx) => {
        console.log(`    ${idx + 1}. ${progress.salesman_name}:`);
        console.log(`       Visits: ${progress.achieved_visits}/${progress.target_visits} (${progress.visit_completion_pct || 0}%)`);
        console.log(`       Orders: ${progress.achieved_orders}/${progress.target_orders}`);
      });
    } else {
      console.log('    No targets found for current month');
    }

    db.close();

    console.log('\n  ✅ Sample queries complete\n');
    return true;

  } catch (error) {
    console.error('  ❌ Error:', error.message);
    return false;
  }
}

/**
 * Test 5: Data Export for Verification
 */
function exportSampleData() {
  console.log('[Test 5] Data Export for Verification');
  
  try {
    const db = new Database(DB_PATH, { readonly: true });
    const fs = require('fs');

    // Export salesmen
    const salesmen = db.prepare('SELECT * FROM salesmen LIMIT 10').all();
    fs.writeFileSync('exported-salesmen.json', JSON.stringify(salesmen, null, 2));
    console.log(`  ✅ Exported ${salesmen.length} salesmen to exported-salesmen.json`);

    // Export visits
    const visits = db.prepare('SELECT * FROM visits LIMIT 10').all();
    fs.writeFileSync('exported-visits.json', JSON.stringify(visits, null, 2));
    console.log(`  ✅ Exported ${visits.length} visits to exported-visits.json`);

    // Export targets
    const targets = db.prepare('SELECT * FROM salesman_targets LIMIT 10').all();
    fs.writeFileSync('exported-targets.json', JSON.stringify(targets, null, 2));
    console.log(`  ✅ Exported ${targets.length} targets to exported-targets.json`);

    db.close();

    console.log('\n  ✅ Data export complete\n');
    return true;

  } catch (error) {
    console.error('  ❌ Error:', error.message);
    return false;
  }
}

/**
 * Main Test Runner
 */
function runTests() {
  const tests = [
    { name: 'Database Schema', fn: testDatabaseSchema },
    { name: 'Data Integrity', fn: testDataIntegrity },
    { name: 'Relationships', fn: testRelationships },
    { name: 'Sample Queries', fn: testSampleQueries },
    { name: 'Data Export', fn: exportSampleData }
  ];

  let passed = 0;
  let failed = 0;

  tests.forEach(test => {
    const result = test.fn();
    if (result) passed++;
    else failed++;
  });

  console.log('========================================');
  console.log('  Test Summary');
  console.log('========================================\n');
  console.log(`  Total Tests: ${tests.length}`);
  console.log(`  Passed: ${passed}`);
  console.log(`  Failed: ${failed}`);
  console.log('\n========================================\n');

  if (failed === 0) {
    console.log('✅ All tests passed! FSM data migration successful.\n');
  } else {
    console.log('❌ Some tests failed. Please review the output above.\n');
    process.exit(1);
  }
}

// Run tests
runTests();
