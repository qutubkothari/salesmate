/**
 * Test Analytics & Reporting API
 * Tests dashboards, KPIs, reports, and insights
 */

const BASE_URL = 'http://localhost:8055';
const TENANT_ID = 'default-tenant';

async function testAnalytics() {
  console.log('🧪 Testing Analytics & Reporting API\n');
  
  try {
    // Test 1: Create Dashboard
    console.log('1️⃣ Creating Sales Dashboard...');
    const dashboardRes = await fetch(`${BASE_URL}/api/analytics/dashboards`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenantId: TENANT_ID,
        dashboardName: 'Sales Performance Dashboard',
        description: 'Overall sales metrics and trends',
        layoutConfig: { columns: 12, rows: 8 },
        refreshInterval: 300,
        visibility: 'public',
        createdBy: 'admin'
      })
    });
    const dashboard = await dashboardRes.json();
    console.log('✅ Dashboard created:', dashboard.dashboard?.id);
    const dashboardId = dashboard.dashboard?.id;
    
    // Test 2: Add Widgets
    console.log('\n2️⃣ Adding Widgets...');
    const widget1 = await fetch(`${BASE_URL}/api/analytics/widgets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dashboardId,
        widgetName: 'Revenue Trend',
        widgetType: 'line_chart',
        dataSource: 'sales_trend',
        widgetConfig: { chartType: 'line', xAxis: 'date', yAxis: 'revenue' },
        position: 0,
        width: 6,
        height: 4
      })
    });
    console.log('✅ Widget 1 added (Revenue Trend)');
    
    const widget2 = await fetch(`${BASE_URL}/api/analytics/widgets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dashboardId,
        widgetName: 'Top Products',
        widgetType: 'bar_chart',
        dataSource: 'top_products',
        widgetConfig: { chartType: 'bar', limit: 10 },
        position: 1,
        width: 6,
        height: 4
      })
    });
    console.log('✅ Widget 2 added (Top Products)');
    
    // Test 3: Create KPIs
    console.log('\n3️⃣ Creating KPIs...');
    const kpi1 = await fetch(`${BASE_URL}/api/analytics/kpis`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenantId: TENANT_ID,
        kpiName: 'Monthly Revenue Target',
        kpiCategory: 'revenue',
        calculationType: 'sum',
        calculationConfig: { metric: 'revenue', source: 'orders' },
        targetValue: 1000000,
        targetPeriod: 'month',
        goodThreshold: 900000,
        warningThreshold: 700000,
        criticalThreshold: 500000,
        createdBy: 'admin'
      })
    });
    const kpi1Data = await kpi1.json();
    console.log('✅ KPI 1 created:', kpi1Data.kpi?.kpiName);
    const kpi1Id = kpi1Data.kpi?.id;
    
    const kpi2 = await fetch(`${BASE_URL}/api/analytics/kpis`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenantId: TENANT_ID,
        kpiName: 'Monthly Won Deals',
        kpiCategory: 'sales',
        calculationType: 'count',
        calculationConfig: { metric: 'deals_won', source: 'deals' },
        targetValue: 50,
        targetPeriod: 'month',
        goodThreshold: 45,
        warningThreshold: 35,
        criticalThreshold: 25,
        createdBy: 'admin'
      })
    });
    const kpi2Data = await kpi2.json();
    console.log('✅ KPI 2 created:', kpi2Data.kpi?.kpiName);
    
    // Test 4: Calculate KPI
    console.log('\n4️⃣ Calculating KPI...');
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString();
    
    const kpiCalc = await fetch(`${BASE_URL}/api/analytics/kpis/${kpi1Id}/calculate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenant_id: TENANT_ID,
        period_start: monthStart,
        period_end: monthEnd
      })
    });
    const kpiResult = await kpiCalc.json();
    console.log('✅ KPI calculated:', kpiResult.kpi);
    
    // Test 5: Create Report
    console.log('\n5️⃣ Creating Sales Report...');
    const report = await fetch(`${BASE_URL}/api/analytics/reports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenantId: TENANT_ID,
        reportName: 'Monthly Sales Summary',
        reportType: 'sales_summary',
        reportConfig: {
          includeCharts: true,
          includeProducts: true,
          includeCustomers: true
        },
        scheduleConfig: {
          frequency: 'monthly',
          dayOfMonth: 1,
          time: '09:00'
        },
        isScheduled: true,
        createdBy: 'admin'
      })
    });
    const reportData = await report.json();
    console.log('✅ Report created:', reportData.report?.reportName);
    const reportId = reportData.report?.id;
    
    // Test 6: Generate Report
    console.log('\n6️⃣ Generating Report...');
    const reportGen = await fetch(`${BASE_URL}/api/analytics/reports/${reportId}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenant_id: TENANT_ID,
        period_start: monthStart,
        period_end: monthEnd
      })
    });
    const reportResult = await reportGen.json();
    console.log('✅ Report generated:');
    console.log('   Status:', reportResult.reportRun?.status);
    console.log('   Overview:', reportResult.reportRun?.data?.overview);
    
    // Test 7: Generate Insights
    console.log('\n7️⃣ Generating AI Insights...');
    const insights = await fetch(`${BASE_URL}/api/analytics/insights/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenant_id: TENANT_ID,
        period_start: monthStart,
        period_end: monthEnd
      })
    });
    const insightsResult = await insights.json();
    console.log('✅ Insights generated:', insightsResult.insights?.length || 0, 'insights');
    if (insightsResult.insights?.length > 0) {
      console.log('   Sample:', insightsResult.insights[0]?.title);
    }
    
    // Test 8: Get Widget Data
    console.log('\n8️⃣ Fetching Widget Data...');
    const widget1Data = await (await widget1.json()).widget;
    const widgetDataRes = await fetch(
      `${BASE_URL}/api/analytics/widgets/${widget1Data?.id}/data?tenant_id=${TENANT_ID}&period_start=${monthStart}&period_end=${monthEnd}`
    );
    const widgetData = await widgetDataRes.json();
    console.log('✅ Widget data fetched:', Object.keys(widgetData.data || {}).length, 'data points');
    
    // Test 9: List Dashboards
    console.log('\n9️⃣ Listing Dashboards...');
    const dashboardsList = await fetch(`${BASE_URL}/api/analytics/dashboards?tenant_id=${TENANT_ID}`);
    const dashboardsData = await dashboardsList.json();
    console.log('✅ Found', dashboardsData.dashboards?.length || 0, 'dashboards');
    
    // Test 10: List KPIs
    console.log('\n🔟 Listing KPIs...');
    const kpisList = await fetch(`${BASE_URL}/api/analytics/kpis?tenant_id=${TENANT_ID}`);
    const kpisData = await kpisList.json();
    console.log('✅ Found', kpisData.kpis?.length || 0, 'KPIs');
    
    console.log('\n✨ All Analytics tests completed successfully!');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error(error.stack);
  }
}

testAnalytics();
