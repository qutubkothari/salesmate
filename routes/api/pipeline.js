/**
 * Pipeline Management API
 * Endpoints for sales pipeline, deals, and forecasting
 */

const express = require('express');
const router = express.Router();
const { db } = require('../../services/config');
const PipelineService = require('../../services/pipeline-service');

// ===== PIPELINES =====

// Get all pipelines for tenant
router.get('/pipelines/:tenantId', (req, res) => {
  try {
    const { tenantId } = req.params;
    
    const pipelines = db.prepare(`
      SELECT p.*, COUNT(DISTINCT d.id) as deal_count
      FROM pipelines p
      LEFT JOIN deals d ON p.id = d.pipeline_id AND d.status = 'open'
      WHERE p.tenant_id = ?
      GROUP BY p.id
      ORDER BY p.is_default DESC, p.created_at DESC
    `).all(tenantId);

    res.json({ pipelines });
  } catch (error) {
    console.error('Get pipelines error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get pipeline with stages
router.get('/pipelines/:tenantId/:pipelineId', (req, res) => {
  try {
    const { pipelineId } = req.params;
    const pipeline = PipelineService.getPipeline(pipelineId);

    if (!pipeline) {
      return res.status(404).json({ error: 'Pipeline not found' });
    }

    res.json({ pipeline });
  } catch (error) {
    console.error('Get pipeline error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Create pipeline
router.post('/pipelines', (req, res) => {
  try {
    const { tenantId, pipelineName, description, stages } = req.body;
    const id = require('crypto').randomBytes(16).toString('hex');

    // Create pipeline
    db.prepare(`
      INSERT INTO pipelines (id, tenant_id, pipeline_name, description)
      VALUES (?, ?, ?, ?)
    `).run(id, tenantId, pipelineName, description || null);

    // Create stages
    if (stages && Array.isArray(stages)) {
      stages.forEach((stage, index) => {
        const stageId = require('crypto').randomBytes(16).toString('hex');
        db.prepare(`
          INSERT INTO pipeline_stages (id, pipeline_id, stage_name, stage_order, stage_type, probability, color_code)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
          stageId, id, stage.stageName, index + 1,
          stage.stageType || 'open', stage.probability || 50, stage.colorCode || null
        );
      });
    }

    res.json({ success: true, pipelineId: id });
  } catch (error) {
    console.error('Create pipeline error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ===== DEALS =====

// Get deals
router.get('/deals/:tenantId', (req, res) => {
  try {
    const { tenantId } = req.params;
    const { ownerId, status, stageId, limit } = req.query;

    let query = `
      SELECT d.*, 
             c.business_name as customer_name,
             u.phone as owner_phone,
             ps.stage_name,
             p.pipeline_name
      FROM deals d
      LEFT JOIN customer_profiles_new c ON d.customer_id = c.id
      LEFT JOIN users u ON d.owner_id = u.id
      LEFT JOIN pipeline_stages ps ON d.stage_id = ps.id
      LEFT JOIN pipelines p ON d.pipeline_id = p.id
      WHERE d.tenant_id = ?
    `;
    const params = [tenantId];

    if (ownerId) {
      query += ' AND d.owner_id = ?';
      params.push(ownerId);
    }

    if (status) {
      query += ' AND d.status = ?';
      params.push(status);
    }

    if (stageId) {
      query += ' AND d.stage_id = ?';
      params.push(stageId);
    }

    query += ' ORDER BY d.created_at DESC';

    if (limit) {
      query += ' LIMIT ?';
      params.push(parseInt(limit));
    }

    const deals = db.prepare(query).all(...params);

    res.json({ deals });
  } catch (error) {
    console.error('Get deals error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get single deal with details
router.get('/deals/:tenantId/:dealId', (req, res) => {
  try {
    const { dealId } = req.params;

    const deal = db.prepare(`
      SELECT d.*, 
             c.business_name as customer_name, c.email as customer_email,
             u.phone as owner_phone,
             ps.stage_name, ps.probability,
             p.pipeline_name
      FROM deals d
      LEFT JOIN customer_profiles_new c ON d.customer_id = c.id
      LEFT JOIN users u ON d.owner_id = u.id
      LEFT JOIN pipeline_stages ps ON d.stage_id = ps.id
      LEFT JOIN pipelines p ON d.pipeline_id = p.id
      WHERE d.id = ?
    `).get(dealId);

    if (!deal) {
      return res.status(404).json({ error: 'Deal not found' });
    }

    // Get products
    const products = db.prepare(`
      SELECT dp.*, pr.name as product_name
      FROM deal_products dp
      LEFT JOIN products pr ON dp.product_id = pr.id
      WHERE dp.deal_id = ?
    `).all(dealId);

    // Get activities
    const activities = db.prepare(`
      SELECT da.*, u.phone as performed_by_phone
      FROM deal_activities da
      LEFT JOIN users u ON da.performed_by = u.id
      WHERE da.deal_id = ?
      ORDER BY da.performed_at DESC
      LIMIT 20
    `).all(dealId);

    // Get stage history
    const history = db.prepare(`
      SELECT dsh.*, 
             fs.stage_name as from_stage,
             ts.stage_name as to_stage,
             u.phone as changed_by_phone
      FROM deal_stage_history dsh
      LEFT JOIN pipeline_stages fs ON dsh.from_stage_id = fs.id
      LEFT JOIN pipeline_stages ts ON dsh.to_stage_id = ts.id
      LEFT JOIN users u ON dsh.changed_by = u.id
      WHERE dsh.deal_id = ?
      ORDER BY dsh.changed_at DESC
    `).all(dealId);

    res.json({ deal, products, activities, history });
  } catch (error) {
    console.error('Get deal details error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Create deal
router.post('/deals', (req, res) => {
  try {
    const result = PipelineService.createDeal(req.body);
    res.json(result);
  } catch (error) {
    console.error('Create deal error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update deal
router.put('/deals/:dealId', (req, res) => {
  try {
    const { dealId } = req.params;
    const updates = [];
    const values = [];

    const allowedFields = [
      'deal_name', 'contact_person', 'deal_value', 'expected_close_date',
      'description', 'priority', 'temperature', 'tags'
    ];

    allowedFields.forEach(field => {
      if (req.body[field] !== undefined) {
        updates.push(`${field} = ?`);
        values.push(req.body[field]);
      }
    });

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    updates.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(dealId);

    db.prepare(`UPDATE deals SET ${updates.join(', ')} WHERE id = ?`).run(...values);

    res.json({ success: true });
  } catch (error) {
    console.error('Update deal error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Move deal to stage
router.post('/deals/:dealId/move', (req, res) => {
  try {
    const { dealId } = req.params;
    const { stageId, userId, notes } = req.body;

    const result = PipelineService.moveDealToStage(dealId, stageId, userId, notes);
    res.json(result);
  } catch (error) {
    console.error('Move deal error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Add activity
router.post('/deals/:dealId/activities', (req, res) => {
  try {
    const { dealId } = req.params;
    const result = PipelineService.addActivity(dealId, req.body);
    res.json(result);
  } catch (error) {
    console.error('Add activity error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Add products to deal
router.post('/deals/:dealId/products', (req, res) => {
  try {
    const { dealId } = req.params;
    const { products } = req.body;

    const result = PipelineService.addDealProducts(dealId, products);
    res.json(result);
  } catch (error) {
    console.error('Add deal products error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Close deal as won
router.post('/deals/:dealId/won', (req, res) => {
  try {
    const { dealId } = req.params;
    const { userId, winReason, wonDetails } = req.body;

    const result = PipelineService.closeDealAsWon(dealId, userId, winReason, wonDetails);
    res.json(result);
  } catch (error) {
    console.error('Close deal as won error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Close deal as lost
router.post('/deals/:dealId/lost', (req, res) => {
  try {
    const { dealId } = req.params;
    const { userId, lossReason, competitorName, feedback } = req.body;

    const result = PipelineService.closeDealAsLost(dealId, userId, lossReason, competitorName, feedback);
    res.json(result);
  } catch (error) {
    console.error('Close deal as lost error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ===== ANALYTICS =====

// Get pipeline analytics
router.get('/analytics/:tenantId/pipeline', (req, res) => {
  try {
    const { tenantId } = req.params;
    const { pipelineId, ownerId } = req.query;

    const analytics = PipelineService.getPipelineAnalytics(tenantId, pipelineId, ownerId);
    res.json(analytics);
  } catch (error) {
    console.error('Pipeline analytics error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get forecast
router.get('/analytics/:tenantId/forecast', (req, res) => {
  try {
    const { tenantId } = req.params;
    const { periodStart, periodEnd } = req.query;

    if (!periodStart || !periodEnd) {
      return res.status(400).json({ error: 'periodStart and periodEnd required' });
    }

    const forecast = PipelineService.getForecast(tenantId, periodStart, periodEnd);
    res.json(forecast);
  } catch (error) {
    console.error('Forecast error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Calculate deal score
router.post('/deals/:dealId/score', (req, res) => {
  try {
    const { dealId } = req.params;
    const score = PipelineService.calculateDealScore(dealId);

    res.json({ success: true, score });
  } catch (error) {
    console.error('Calculate score error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Win/Loss analysis
router.get('/analytics/:tenantId/win-loss', (req, res) => {
  try {
    const { tenantId } = req.params;
    const { period } = req.query; // 'month', 'quarter', 'year'

    let dateFilter = '';
    if (period === 'month') {
      dateFilter = "AND d.actual_close_date >= date('now', '-30 days')";
    } else if (period === 'quarter') {
      dateFilter = "AND d.actual_close_date >= date('now', '-90 days')";
    } else if (period === 'year') {
      dateFilter = "AND d.actual_close_date >= date('now', '-365 days')";
    }

    const outcomes = db.prepare(`
      SELECT 
        do.outcome,
        do.win_reason,
        do.loss_reason,
        COUNT(*) as count,
        SUM(d.deal_value) as total_value
      FROM deal_outcomes do
      JOIN deals d ON do.deal_id = d.id
      WHERE d.tenant_id = ? ${dateFilter}
      GROUP BY do.outcome, do.win_reason, do.loss_reason
    `).all(tenantId);

    const wonCount = outcomes.filter(o => o.outcome === 'won').reduce((sum, o) => sum + o.count, 0);
    const lostCount = outcomes.filter(o => o.outcome === 'lost').reduce((sum, o) => sum + o.count, 0);
    const total = wonCount + lostCount;

    res.json({
      outcomes,
      summary: {
        wonCount,
        lostCount,
        totalDeals: total,
        winRate: total > 0 ? ((wonCount / total) * 100).toFixed(2) + '%' : '0%'
      }
    });
  } catch (error) {
    console.error('Win/Loss analysis error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
