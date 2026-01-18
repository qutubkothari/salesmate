/**
 * Initialize Default Sales Pipeline
 * Creates standard B2B sales pipeline with stages
 */

const { db } = require('./services/config');
const crypto = require('crypto');

console.log('🚀 Creating default sales pipeline...');

const tenantId = '101f04af63cbefc2bf8f0a98b9ae1205'; // Default tenant

try {
  // Create default pipeline
  const pipelineId = crypto.randomBytes(16).toString('hex');
  
  db.prepare(`
    INSERT INTO pipelines (id, tenant_id, pipeline_name, description, is_default)
    VALUES (?, ?, ?, ?, 1)
  `).run(
    pipelineId,
    tenantId,
    'B2B Sales Pipeline',
    'Standard B2B sales process for enterprise deals'
  );

  console.log(`✅ Created pipeline: ${pipelineId}`);

  // Create stages
  const stages = [
    { name: 'Lead', order: 1, type: 'open', probability: 10, color: '#9CA3AF' },
    { name: 'Qualified', order: 2, type: 'open', probability: 25, color: '#3B82F6' },
    { name: 'Meeting Scheduled', order: 3, type: 'open', probability: 40, color: '#8B5CF6' },
    { name: 'Proposal Sent', order: 4, type: 'open', probability: 60, color: '#F59E0B' },
    { name: 'Negotiation', order: 5, type: 'open', probability: 80, color: '#EF4444' },
    { name: 'Won', order: 6, type: 'won', probability: 100, color: '#10B981' },
    { name: 'Lost', order: 7, type: 'lost', probability: 0, color: '#6B7280' }
  ];

  const stageIds = {};
  stages.forEach(stage => {
    const stageId = crypto.randomBytes(16).toString('hex');
    stageIds[stage.name] = stageId;
    
    db.prepare(`
      INSERT INTO pipeline_stages (id, pipeline_id, stage_name, stage_order, stage_type, probability, color_code)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(stageId, pipelineId, stage.name, stage.order, stage.type, stage.probability, stage.color);
    
    console.log(`   ✅ Created stage: ${stage.name} (${stage.probability}%)`);
  });

  // Create sample deals
  const sampleUserId = 'b8a48b98-8bba-4382-b024-6c1a35038f39'; // Test salesman

  const deals = [
    {
      name: 'ABC Corp - ERP Integration',
      customer: 'Sample Customer 1',
      value: 250000,
      stage: 'Proposal Sent',
      priority: 'high',
      temp: 'hot',
      closeDate: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    },
    {
      name: 'XYZ Ltd - CRM Implementation',
      customer: 'Sample Customer 2',
      value: 180000,
      stage: 'Negotiation',
      priority: 'critical',
      temp: 'hot',
      closeDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    },
    {
      name: 'TechStart Inc - Software License',
      customer: 'Sample Customer 3',
      value: 95000,
      stage: 'Meeting Scheduled',
      priority: 'medium',
      temp: 'warm',
      closeDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    },
    {
      name: 'GlobalTrade - Cloud Migration',
      customer: 'Sample Customer 4',
      value: 420000,
      stage: 'Qualified',
      priority: 'high',
      temp: 'warm',
      closeDate: new Date(Date.now() + 45 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    },
    {
      name: 'RetailChain - POS System',
      customer: 'Sample Customer 5',
      value: 75000,
      stage: 'Lead',
      priority: 'low',
      temp: 'cold',
      closeDate: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    }
  ];

  console.log('\n📋 Creating sample deals...');
  
  deals.forEach((deal, index) => {
    const dealId = crypto.randomBytes(16).toString('hex');
    const stageId = stageIds[deal.stage];
    const stage = stages.find(s => s.name === deal.stage);
    const expectedRevenue = deal.value * (stage.probability / 100);

    db.prepare(`
      INSERT INTO deals (
        id, tenant_id, pipeline_id, stage_id, owner_id,
        deal_name, contact_person, deal_value, expected_revenue, expected_close_date,
        priority, temperature, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      dealId, tenantId, pipelineId, stageId, sampleUserId,
      deal.name, deal.customer, deal.value, expectedRevenue, deal.closeDate,
      deal.priority, deal.temp, 'open',
      new Date().toISOString(), new Date().toISOString()
    );

    // Add initial activity
    const activityId = crypto.randomBytes(16).toString('hex');
    db.prepare(`
      INSERT INTO deal_activities (id, deal_id, activity_type, subject, description, performed_by, performed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      activityId, dealId, 'note',
      'Initial Contact',
      `Initial contact established. Customer interested in ${deal.name.split(' - ')[1]}.`,
      sampleUserId, new Date().toISOString()
    );

    console.log(`   ✅ Deal ${index + 1}: ${deal.name} - ₹${deal.value.toLocaleString()} (${deal.stage})`);
  });

  // Summary
  console.log('\n📊 Pipeline Summary:');
  const stats = db.prepare(`
    SELECT 
      ps.stage_name,
      COUNT(d.id) as deal_count,
      SUM(d.deal_value) as total_value,
      SUM(d.expected_revenue) as weighted_value
    FROM pipeline_stages ps
    LEFT JOIN deals d ON ps.id = d.stage_id AND d.status = 'open'
    WHERE ps.pipeline_id = ?
    GROUP BY ps.id, ps.stage_name
    ORDER BY ps.stage_order
  `).all(pipelineId);

  stats.forEach(stat => {
    const value = stat.total_value || 0;
    const weighted = stat.weighted_value || 0;
    console.log(`   ${stat.stage_name}: ${stat.deal_count} deals | ₹${value.toLocaleString()} (₹${weighted.toLocaleString()} weighted)`);
  });

  const totalValue = stats.reduce((sum, s) => sum + (s.total_value || 0), 0);
  const totalWeighted = stats.reduce((sum, s) => sum + (s.weighted_value || 0), 0);
  
  console.log(`\n   💰 Total Pipeline Value: ₹${totalValue.toLocaleString()}`);
  console.log(`   📈 Weighted Forecast: ₹${totalWeighted.toLocaleString()}`);

  console.log('\n✅ Default pipeline initialized successfully!');

} catch (error) {
  console.error('❌ Initialization failed:', error);
  process.exit(1);
}
