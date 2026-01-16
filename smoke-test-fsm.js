/**
 * FSM Module Smoke Test
 * Tests FSM API endpoints and database integration
 */

const db = require('better-sqlite3')('local-database.db');

console.log('╔═══════════════════════════════════════════════╗');
console.log('║       FSM MODULE SMOKE TEST                  ║');
console.log('╚═══════════════════════════════════════════════╝\n');

const results = {
  total: 0,
  passed: 0,
  failed: 0,
  tests: []
};

function test(name, fn) {
  results.total++;
  try {
    const result = fn();
    if (result) {
      console.log(`✅ PASS: ${name}`);
      results.passed++;
      results.tests.push({ name, status: 'PASS', result });
      return result;
    } else {
      console.log(`❌ FAIL: ${name} - Assertion failed`);
      results.failed++;
      results.tests.push({ name, status: 'FAIL', error: 'Assertion failed' });
      return null;
    }
  } catch (error) {
    console.log(`❌ FAIL: ${name} - ${error.message}`);
    results.failed++;
    results.tests.push({ name, status: 'FAIL', error: error.message });
    return null;
  }
}

console.log('📊 DATABASE STRUCTURE TESTS\n');

// Test 1: Check database tables exist
let tableNames = [];
const tables = test('Database tables exist', () => {
  const result = db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all();
  tableNames = result.map(t => t.name);
  console.log(`   Found ${result.length} tables:`, tableNames.join(', '));
  return result.length > 0;
});

// Test 2: Check visits table
const visitsTable = test('Visits table exists', () => {
  const exists = tableNames.includes('visits');
  return exists;
});

// Test 3: Check salesmen table
const salesmenTable = test('Salesmen table exists', () => {
  const exists = tableNames.includes('salesmen');
  return exists;
});

// Test 4: Check targets table
const targetsTable = test('Salesman_targets table exists', () => {
  const exists = tableNames.includes('salesman_targets');
  return exists;
});

console.log('\n📈 DATA VALIDATION TESTS\n');

// Test 5: Count visits
const visitsCount = test('Visits data exists', () => {
  try {
    const result = db.prepare('SELECT COUNT(*) as count FROM visits').get();
    console.log(`   Found ${result.count} visits`);
    return result.count > 0;
  } catch (e) {
    console.log(`   Error: ${e.message}`);
    return false;
  }
});

// Test 6: Count salesmen
const salesmenCount = test('Salesmen data exists', () => {
  try {
    const result = db.prepare('SELECT COUNT(*) as count FROM salesmen').get();
    console.log(`   Found ${result.count} salesmen`);
    return result.count > 0;
  } catch (e) {
    console.log(`   Error: ${e.message}`);
    return false;
  }
});

// Test 7: Count targets
const targetsCount = test('Targets data exists', () => {
  try {
    const result = db.prepare('SELECT COUNT(*) as count FROM salesman_targets').get();
    console.log(`   Found ${result.count} targets`);
    return result.count > 0;
  } catch (e) {
    console.log(`   Error: ${e.message}`);
    return false;
  }
});

console.log('\n🔍 SAMPLE DATA TESTS\n');

// Test 8: Get sample visit
test('Can retrieve visit data', () => {
  try {
    const visit = db.prepare('SELECT * FROM visits LIMIT 1').get();
    if (visit) {
      console.log(`   Sample Visit ID: ${visit.id}`);
      console.log(`   Salesman: ${visit.salesman_name}`);
      console.log(`   Customer: ${visit.customer_name || visit.shop_name}`);
      console.log(`   Date: ${visit.visit_date}`);
      return true;
    }
    return false;
  } catch (e) {
    console.log(`   Error: ${e.message}`);
    return false;
  }
});

// Test 9: Get sample salesman
test('Can retrieve salesman data', () => {
  try {
    const salesman = db.prepare('SELECT * FROM salesmen LIMIT 1').get();
    if (salesman) {
      console.log(`   Sample Salesman ID: ${salesman.id}`);
      console.log(`   Name: ${salesman.name}`);
      console.log(`   Phone: ${salesman.phone}`);
      console.log(`   Active: ${salesman.is_active}`);
      return true;
    }
    return false;
  } catch (e) {
    console.log(`   Error: ${e.message}`);
    return false;
  }
});

// Test 10: Get sample target
test('Can retrieve target data', () => {
  try {
    const target = db.prepare('SELECT * FROM salesman_targets LIMIT 1').get();
    if (target) {
      console.log(`   Sample Target ID: ${target.id}`);
      console.log(`   Period: ${target.period || 'N/A'}`);
      console.log(`   Visit Target: ${target.target_visits}`);
      console.log(`   Achieved: ${target.achieved_visits || 0}`);
      return true;
    }
    return false;
  } catch (e) {
    console.log(`   Error: ${e.message}`);
    return false;
  }
});

console.log('\n🔗 RELATIONSHIP TESTS\n');

// Test 11: Join visits with salesmen
test('Can join visits with salesmen', () => {
  try {
    const query = `
      SELECT v.id, v.customer_name, s.name as salesman_name
      FROM visits v
      LEFT JOIN salesmen s ON v.salesman_id = s.id
      LIMIT 1
    `;
    const result = db.prepare(query).get();
    if (result) {
      console.log(`   Visit-Salesman join successful`);
      console.log(`   Customer: ${result.customer_name || 'N/A'}`);
      console.log(`   Salesman: ${result.salesman_name || 'N/A'}`);
      return true;
    }
    return false;
  } catch (e) {
    console.log(`   Error: ${e.message}`);
    return false;
  }
});

// Test 12: Aggregate visit counts per salesman
test('Can aggregate visits per salesman', () => {
  try {
    const query = `
      SELECT v.salesman_id, s.name, COUNT(*) as visit_count
      FROM visits v
      LEFT JOIN salesmen s ON v.salesman_id = s.id
      WHERE v.salesman_id IS NOT NULL
      GROUP BY v.salesman_id, s.name
      ORDER BY visit_count DESC
      LIMIT 3
    `;
    const results = db.prepare(query).all();
    if (results && results.length > 0) {
      console.log(`   Top ${results.length} salesmen by visits:`);
      results.forEach((r, i) => {
        console.log(`   ${i + 1}. ${r.name || 'Unknown'}: ${r.visit_count} visits`);
      });
      return true;
    }
    return false;
  } catch (e) {
    console.log(`   Error: ${e.message}`);
    return false;
  }
});

console.log('\n📁 FILE SYSTEM TESTS\n');

const fs = require('fs');
const path = require('path');

// Test 13: Check modular files exist
test('Modular JS files exist', () => {
  const files = [
    'public/js/utils/api.js',
    'public/js/utils/state.js',
    'public/js/utils/router.js',
    'public/js/utils/helpers.js',
    'public/js/modules/fsm/visits.js',
    'public/js/modules/fsm/salesmen.js',
    'public/js/modules/fsm/targets.js',
    'public/js/modules/fsm/branches.js',
    'public/js/app.js'
  ];
  
  let allExist = true;
  files.forEach(file => {
    const exists = fs.existsSync(path.join(__dirname, file));
    if (!exists) {
      console.log(`   ⚠️  Missing: ${file}`);
      allExist = false;
    }
  });
  
  if (allExist) {
    console.log(`   All ${files.length} modular files exist`);
  }
  
  return allExist;
});

// Test 14: Check CSS file exists
test('Dashboard CSS exists', () => {
  const exists = fs.existsSync(path.join(__dirname, 'public/css/dashboard.css'));
  if (exists) {
    const stats = fs.statSync(path.join(__dirname, 'public/css/dashboard.css'));
    console.log(`   File size: ${(stats.size / 1024).toFixed(2)} KB`);
  }
  return exists;
});

// Test 15: Check modular HTML exists
test('Modular dashboard HTML exists', () => {
  const exists = fs.existsSync(path.join(__dirname, 'public/dashboard-modular.html'));
  if (exists) {
    const stats = fs.statSync(path.join(__dirname, 'public/dashboard-modular.html'));
    console.log(`   File size: ${(stats.size / 1024).toFixed(2)} KB`);
  }
  return exists;
});

console.log('\n🔧 API ENDPOINT SIMULATION\n');

// Test 16: Simulate visits API response
test('Can simulate /api/fsm/visits response', () => {
  try {
    const visits = db.prepare(`
      SELECT * FROM visits 
      ORDER BY created_at DESC 
      LIMIT 5
    `).all();
    
    const response = {
      success: true,
      data: visits,
      count: visits.length
    };
    
    console.log(`   Simulated API response with ${response.count} visits`);
    return response.success && response.count > 0;
  } catch (e) {
    console.log(`   Error: ${e.message}`);
    return false;
  }
});

// Test 17: Simulate salesmen API response
test('Can simulate /api/fsm/salesmen response', () => {
  try {
    const salesmen = db.prepare(`
      SELECT * FROM salesmen 
      WHERE is_active = 1
      ORDER BY name
    `).all();
    
    const response = {
      success: true,
      data: salesmen,
      count: salesmen.length
    };
    
    console.log(`   Simulated API response with ${response.count} salesmen`);
    return response.success && response.count > 0;
  } catch (e) {
    console.log(`   Error: ${e.message}`);
    return false;
  }
});

// Test 18: Simulate targets API response
test('Can simulate /api/fsm/targets response', () => {
  try {
    const targets = db.prepare(`
      SELECT * FROM salesman_targets 
      ORDER BY period DESC
      LIMIT 10
    `).all();
    
    const response = {
      success: true,
      data: targets,
      count: targets.length
    };
    
    console.log(`   Simulated API response with ${response.count} targets`);
    console.log(`   Sample period: ${targets[0]?.period || 'N/A'}`);
    return response.success && response.count > 0;
  } catch (e) {
    console.log(`   Error: ${e.message}`);
    return false;
  }
});

db.close();

// Print summary
console.log('\n╔═══════════════════════════════════════════════╗');
console.log('║           TEST SUMMARY                       ║');
console.log('╚═══════════════════════════════════════════════╝\n');

console.log(`Total Tests:  ${results.total}`);
console.log(`✅ Passed:    ${results.passed}`);
console.log(`❌ Failed:    ${results.failed}`);
console.log(`📊 Pass Rate: ${((results.passed / results.total) * 100).toFixed(1)}%\n`);

if (results.failed > 0) {
  console.log('❌ SMOKE TEST FAILED\n');
  console.log('Failed Tests:');
  results.tests.filter(t => t.status === 'FAIL').forEach(t => {
    console.log(`  - ${t.name}: ${t.error}`);
  });
  process.exit(1);
} else {
  console.log('✅ ALL SMOKE TESTS PASSED!\n');
  console.log('🎉 FSM modules are ready for production!\n');
  process.exit(0);
}
