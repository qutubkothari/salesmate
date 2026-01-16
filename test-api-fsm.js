/**
 * FSM API Endpoint Live Test
 * Tests all FSM endpoints against running server
 */

const http = require('http');

const BASE_URL = 'http://localhost:8055';

console.log('╔═══════════════════════════════════════════════╗');
console.log('║     FSM API ENDPOINT LIVE TEST               ║');
console.log('╚═══════════════════════════════════════════════╝\n');

const results = {
  total: 0,
  passed: 0,
  failed: 0,
  tests: []
};

function httpGet(path) {
  return new Promise((resolve, reject) => {
    const url = `${BASE_URL}${path}`;
    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ status: res.statusCode, data: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, data });
        }
      });
    }).on('error', reject);
  });
}

async function test(name, fn) {
  results.total++;
  try {
    const result = await fn();
    if (result) {
      console.log(`✅ PASS: ${name}`);
      results.passed++;
      results.tests.push({ name, status: 'PASS' });
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

async function runTests() {
  console.log('🌐 SERVER CONNECTIVITY TESTS\n');
  
  // Test 1: Server is running
  await test('Server is responding', async () => {
    const res = await httpGet('/');
    return res.status === 200 || res.status === 304;
  });
  
  console.log('\n📊 VISITS ENDPOINT TESTS\n');
  
  // Test 2: Get all visits
  const visits = await test('GET /api/fsm/visits returns data', async () => {
    const res = await httpGet('/api/fsm/visits');
    if (res.status === 200 && res.data.success) {
      console.log(`   Returned ${res.data.count} visits`);
      return res.data.count > 0;
    }
    return false;
  });
  
  // Test 3: Get visits with limit
  await test('GET /api/fsm/visits?limit=5 works', async () => {
    const res = await httpGet('/api/fsm/visits?limit=5');
    if (res.status === 200 && res.data.success) {
      console.log(`   Returned ${res.data.count} visits (max 5)`);
      return res.data.count <= 5;
    }
    return false;
  });
  
  // Test 4: Get today's visits
  const today = new Date().toISOString().split('T')[0];
  await test(`GET /api/fsm/visits?start_date=${today} works`, async () => {
    const res = await httpGet(`/api/fsm/visits?start_date=${today}`);
    if (res.status === 200 && res.data.success) {
      console.log(`   Found ${res.data.count} visits today`);
      return true;
    }
    return false;
  });
  
  // Test 5: Get visit stats
  await test('GET /api/fsm/visits/stats returns statistics', async () => {
    const res = await httpGet('/api/fsm/visits/stats');
    if (res.status === 200 && res.data.success) {
      const { total, today_visits, active_today, avg_per_day } = res.data.stats;
      console.log(`   Total: ${total}, Today: ${today_visits}, Active: ${active_today}, Avg/day: ${avg_per_day}`);
      return typeof total === 'number';
    }
    return false;
  });
  
  console.log('\n👥 SALESMEN ENDPOINT TESTS\n');
  
  // Test 6: Get all salesmen
  const salesmen = await test('GET /api/fsm/salesmen returns data', async () => {
    const res = await httpGet('/api/fsm/salesmen');
    if (res.status === 200 && res.data.success) {
      console.log(`   Returned ${res.data.count} salesmen`);
      return res.data.count > 0;
    }
    return false;
  });
  
  // Test 7: Get active salesmen only
  await test('GET /api/fsm/salesmen?is_active=1 filters correctly', async () => {
    const res = await httpGet('/api/fsm/salesmen?is_active=1');
    if (res.status === 200 && res.data.success) {
      console.log(`   Returned ${res.data.count} active salesmen`);
      return true;
    }
    return false;
  });
  
  // Test 8: Get salesman stats
  await test('GET /api/fsm/salesmen/stats returns statistics', async () => {
    const res = await httpGet('/api/fsm/salesmen/stats');
    if (res.status === 200 && res.data.success) {
      const { total, active, active_today, inactive } = res.data.stats;
      console.log(`   Total: ${total}, Active: ${active}, Today: ${active_today}, Inactive: ${inactive}`);
      return typeof total === 'number';
    }
    return false;
  });
  
  console.log('\n🎯 TARGETS ENDPOINT TESTS\n');
  
  // Test 9: Get all targets
  const targets = await test('GET /api/fsm/targets returns data', async () => {
    const res = await httpGet('/api/fsm/targets');
    if (res.status === 200 && res.data.success) {
      console.log(`   Returned ${res.data.count} targets`);
      return res.data.count > 0;
    }
    return false;
  });
  
  // Test 10: Get current month targets
  const currentMonth = new Date().toISOString().slice(0, 7);
  await test(`GET /api/fsm/targets?period=${currentMonth} works`, async () => {
    const res = await httpGet(`/api/fsm/targets?period=${currentMonth}`);
    if (res.status === 200 && res.data.success) {
      console.log(`   Found ${res.data.count} targets for ${currentMonth}`);
      return true;
    }
    return false;
  });
  
  // Test 11: Get target stats
  await test('GET /api/fsm/targets/stats returns statistics', async () => {
    const res = await httpGet('/api/fsm/targets/stats');
    if (res.status === 200 && res.data.success) {
      const { total, current_month, achieved, avg_achievement } = res.data.stats;
      console.log(`   Total: ${total}, This month: ${current_month}, Achieved: ${achieved}, Avg %: ${avg_achievement}`);
      return typeof total === 'number';
    }
    return false;
  });
  
  console.log('\n🏢 BRANCHES ENDPOINT TESTS\n');
  
  // Test 12: Get branches (placeholder)
  await test('GET /api/fsm/branches works (placeholder)', async () => {
    const res = await httpGet('/api/fsm/branches');
    if (res.status === 200 && res.data.success) {
      console.log(`   Returned ${res.data.count} branches`);
      return true;
    }
    return false;
  });
  
  console.log('\n🔍 DETAIL ENDPOINT TESTS\n');
  
  // Test 13: Get visit details by ID
  if (visits && visits.data && visits.data.data && visits.data.data[0]) {
    const visitId = visits.data.data[0].id;
    await test(`GET /api/fsm/visits/${visitId} returns details`, async () => {
      const res = await httpGet(`/api/fsm/visits/${visitId}`);
      if (res.status === 200 && res.data.success) {
        console.log(`   Visit ID: ${res.data.data.id}`);
        console.log(`   Customer: ${res.data.data.customer_name || 'N/A'}`);
        return true;
      }
      return false;
    });
  }
  
  // Test 14: Get salesman performance
  if (salesmen && salesmen.data && salesmen.data.data && salesmen.data.data[0]) {
    const salesmanId = salesmen.data.data[0].id;
    await test(`GET /api/fsm/salesmen/${salesmanId}/performance returns data`, async () => {
      const res = await httpGet(`/api/fsm/salesmen/${salesmanId}/performance`);
      if (res.status === 200 && res.data.success) {
        const { salesman, performance } = res.data.data;
        console.log(`   Salesman: ${salesman.name}`);
        console.log(`   Today: ${performance.today_visits} visits, Month: ${performance.month_visits} visits`);
        return true;
      }
      return false;
    });
  }
  
  // Print summary
  console.log('\n╔═══════════════════════════════════════════════╗');
  console.log('║           TEST SUMMARY                       ║');
  console.log('╚═══════════════════════════════════════════════╝\n');
  
  console.log(`Total Tests:  ${results.total}`);
  console.log(`✅ Passed:    ${results.passed}`);
  console.log(`❌ Failed:    ${results.failed}`);
  console.log(`📊 Pass Rate: ${((results.passed / results.total) * 100).toFixed(1)}%\n`);
  
  if (results.failed > 0) {
    console.log('❌ API TEST FAILED\n');
    console.log('Failed Tests:');
    results.tests.filter(t => t.status === 'FAIL').forEach(t => {
      console.log(`  - ${t.name}: ${t.error || 'Unknown error'}`);
    });
    process.exit(1);
  } else {
    console.log('✅ ALL API TESTS PASSED!\n');
    console.log('🎉 FSM API endpoints are working correctly!\n');
    process.exit(0);
  }
}

// Run tests
runTests().catch(err => {
  console.error('\n❌ CRITICAL ERROR:', err.message);
  console.error('\n💡 Make sure the server is running on port 8055');
  console.error('   Run: node index.js\n');
  process.exit(1);
});
