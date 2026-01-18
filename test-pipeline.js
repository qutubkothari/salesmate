/**
 * Test Pipeline Management API
 * Tests deals, analytics, and forecasting endpoints
 */

const axios = require('axios');

const BASE_URL = 'http://localhost:8055';
const TENANT_ID = '101f04af63cbefc2bf8f0a98b9ae1205';
const USER_ID = 'b8a48b98-8bba-4382-b024-6c1a35038f39';

async function testPipelineAPI() {
  console.log('🧪 Testing Pipeline Management API\n');

  try {
    // Test 1: Get Pipelines
    console.log('1️⃣ GET /api/pipeline/pipelines/:tenantId');
    const pipelinesRes = await axios.get(`${BASE_URL}/api/pipeline/pipelines/${TENANT_ID}`);
    console.log(`✅ Found ${pipelinesRes.data.pipelines.length} pipeline(s)`);
    const pipeline = pipelinesRes.data.pipelines[0];
    console.log(`   Pipeline: ${pipeline.pipeline_name} (${pipeline.deal_count} deals)\n`);

    // Test 2: Get Pipeline Details
    console.log('2️⃣ GET /api/pipeline/pipelines/:tenantId/:pipelineId');
    const pipelineRes = await axios.get(`${BASE_URL}/api/pipeline/pipelines/${TENANT_ID}/${pipeline.id}`);
    console.log(`✅ Pipeline: ${pipelineRes.data.pipeline.pipeline_name}`);
    console.log(`   Stages: ${pipelineRes.data.pipeline.stages.length}`);
    pipelineRes.data.pipeline.stages.forEach(s => {
      console.log(`   - ${s.stage_name} (${s.probability}%)`);
    });
    console.log('');

    // Test 3: Get All Deals
    console.log('3️⃣ GET /api/pipeline/deals/:tenantId');
    const dealsRes = await axios.get(`${BASE_URL}/api/pipeline/deals/${TENANT_ID}`);
    console.log(`✅ Found ${dealsRes.data.deals.length} deal(s)`);
    dealsRes.data.deals.slice(0, 3).forEach(d => {
      console.log(`   - ${d.deal_name}: ₹${d.deal_value.toLocaleString()} [${d.stage_name}]`);
    });
    console.log('');

    // Test 4: Get Deal Details
    const dealId = dealsRes.data.deals[0].id;
    console.log('4️⃣ GET /api/pipeline/deals/:tenantId/:dealId');
    const dealRes = await axios.get(`${BASE_URL}/api/pipeline/deals/${TENANT_ID}/${dealId}`);
    console.log(`✅ Deal: ${dealRes.data.deal.deal_name}`);
    console.log(`   Value: ₹${dealRes.data.deal.deal_value.toLocaleString()}`);
    console.log(`   Expected Revenue: ₹${dealRes.data.deal.expected_revenue.toLocaleString()}`);
    console.log(`   Activities: ${dealRes.data.activities.length}`);
    console.log(`   Products: ${dealRes.data.products.length}\n`);

    // Test 5: Create New Deal
    console.log('5️⃣ POST /api/pipeline/deals');
    const newDeal = await axios.post(`${BASE_URL}/api/pipeline/deals`, {
      tenantId: TENANT_ID,
      pipelineId: pipeline.id,
      stageId: pipelineRes.data.pipeline.stages[1].id, // Qualified
      ownerId: USER_ID,
      dealName: 'Test Corp - API Integration',
      dealValue: 150000,
      contactPerson: 'John Doe',
      expectedCloseDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      priority: 'high',
      temperature: 'hot',
      description: 'Testing deal creation via API'
    });
    console.log(`✅ Created deal: ${newDeal.data.dealId}`);
    console.log(`   Expected revenue: ₹${newDeal.data.expectedRevenue.toLocaleString()}\n`);

    // Test 6: Add Activity
    console.log('6️⃣ POST /api/pipeline/deals/:dealId/activities');
    const activity = await axios.post(`${BASE_URL}/api/pipeline/deals/${newDeal.data.dealId}/activities`, {
      activityType: 'call',
      subject: 'Discovery Call',
      description: 'Discussed requirements and budget',
      performedBy: USER_ID,
      duration: 45
    });
    console.log(`✅ Activity logged: ${activity.data.activityId}\n`);

    // Test 7: Move Deal to Next Stage
    const proposalStage = pipelineRes.data.pipeline.stages.find(s => s.stage_name === 'Proposal Sent');
    console.log('7️⃣ POST /api/pipeline/deals/:dealId/move');
    const move = await axios.post(`${BASE_URL}/api/pipeline/deals/${newDeal.data.dealId}/move`, {
      stageId: proposalStage.id,
      userId: USER_ID,
      notes: 'Proposal sent via email'
    });
    console.log(`✅ Deal moved to: Proposal Sent`);
    console.log(`   New expected revenue: ₹${move.data.expectedRevenue.toLocaleString()}\n`);

    // Test 8: Pipeline Analytics
    console.log('8️⃣ GET /api/pipeline/analytics/:tenantId/pipeline');
    const analytics = await axios.get(`${BASE_URL}/api/pipeline/analytics/${TENANT_ID}/pipeline`, {
      params: { pipelineId: pipeline.id }
    });
    console.log(`✅ Pipeline Analytics:`);
    console.log(`   Total Deals: ${analytics.data.totalDeals}`);
    console.log(`   Total Value: ₹${analytics.data.totalValue.toLocaleString()}`);
    console.log(`   Weighted Forecast: ₹${analytics.data.weightedForecast.toLocaleString()}`);
    console.log('   By Stage:');
    analytics.data.stageBreakdown.forEach(s => {
      console.log(`   - ${s.stage_name}: ${s.deal_count} deals, ₹${s.total_value.toLocaleString()} (₹${s.weighted_value.toLocaleString()} weighted)`);
    });
    console.log('');

    // Test 9: Forecast
    const startDate = new Date().toISOString().split('T')[0];
    const endDate = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    console.log('9️⃣ GET /api/pipeline/analytics/:tenantId/forecast');
    const forecast = await axios.get(`${BASE_URL}/api/pipeline/analytics/${TENANT_ID}/forecast`, {
      params: { periodStart: startDate, periodEnd: endDate }
    });
    console.log(`✅ Revenue Forecast (${startDate} to ${endDate}):`);
    console.log(`   Total Deals: ${forecast.data.totalDeals}`);
    console.log(`   Total Value: ₹${forecast.data.totalValue.toLocaleString()}`);
    console.log(`   Weighted Forecast: ₹${forecast.data.weightedForecast.toLocaleString()}\n`);

    // Test 10: Deal Scoring
    console.log('🔟 POST /api/pipeline/deals/:dealId/score');
    const score = await axios.post(`${BASE_URL}/api/pipeline/deals/${newDeal.data.dealId}/score`);
    console.log(`✅ Deal Score: ${score.data.score}/100\n`);

    // Test 11: Close Deal as Won
    console.log('1️⃣1️⃣ POST /api/pipeline/deals/:dealId/won');
    const won = await axios.post(`${BASE_URL}/api/pipeline/deals/${newDeal.data.dealId}/won`, {
      userId: USER_ID,
      winReason: 'best_price',
      wonDetails: 'Customer chose us for competitive pricing and strong feature set'
    });
    console.log(`✅ Deal closed as won!`);
    console.log(`   Outcome ID: ${won.data.outcomeId}\n`);

    console.log('✅ All tests passed!\n');

    // Summary
    console.log('📊 Summary:');
    console.log('   - Pipeline management: ✅');
    console.log('   - Deal creation: ✅');
    console.log('   - Activity tracking: ✅');
    console.log('   - Stage progression: ✅');
    console.log('   - Analytics & forecasting: ✅');
    console.log('   - Deal scoring: ✅');
    console.log('   - Win/Loss tracking: ✅');

  } catch (error) {
    console.error('❌ Test failed:', error.response?.data || error.message);
    process.exit(1);
  }
}

testPipelineAPI();
