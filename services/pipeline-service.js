/**
 * Pipeline Management Service
 * Handles sales pipeline, deals, forecasting, and analytics
 */

const { db } = require('./config');

class PipelineService {
  /**
   * Get pipeline with stages
   */
  static getPipeline(pipelineId) {
    const pipeline = db.prepare('SELECT * FROM pipelines WHERE id = ?').get(pipelineId);
    
    if (!pipeline) return null;

    const stages = db.prepare(`
      SELECT * FROM pipeline_stages 
      WHERE pipeline_id = ? AND is_active = 1
      ORDER BY stage_order
    `).all(pipelineId);

    return { ...pipeline, stages };
  }

  /**
   * Get default pipeline for tenant
   */
  static getDefaultPipeline(tenantId) {
    const pipeline = db.prepare(`
      SELECT * FROM pipelines 
      WHERE tenant_id = ? AND is_default = 1 AND is_active = 1
      LIMIT 1
    `).get(tenantId);

    if (!pipeline) return null;

    return this.getPipeline(pipeline.id);
  }

  /**
   * Create new deal
   */
  static createDeal(dealData) {
    const {
      tenantId, dealName, customerId, contactPerson, pipelineId, stageId,
      ownerId, dealValue, currency, expectedCloseDate, description, source, priority
    } = dealData;

    const id = require('crypto').randomBytes(16).toString('hex');

    // Get stage probability for revenue calculation
    const stage = db.prepare('SELECT probability FROM pipeline_stages WHERE id = ?').get(stageId);
    const expectedRevenue = dealValue * ((stage?.probability || 50) / 100);

    db.prepare(`
      INSERT INTO deals (
        id, tenant_id, deal_name, customer_id, contact_person, pipeline_id, stage_id,
        owner_id, deal_value, currency, expected_revenue, expected_close_date,
        description, source, priority
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, tenantId, dealName, customerId || null, contactPerson || null, pipelineId, stageId,
      ownerId, dealValue, currency || 'INR', expectedRevenue, expectedCloseDate,
      description || null, source || null, priority || 'medium'
    );

    // Log initial stage
    this.logStageChange(id, null, stageId, ownerId, 'Deal created');

    return { success: true, dealId: id };
  }

  /**
   * Move deal to different stage
   */
  static moveDealToStage(dealId, newStageId, userId, notes = null) {
    const deal = db.prepare('SELECT stage_id FROM deals WHERE id = ?').get(dealId);
    
    if (!deal) {
      throw new Error('Deal not found');
    }

    const oldStageId = deal.stage_id;

    // Update deal stage
    db.prepare(`
      UPDATE deals 
      SET stage_id = ?, updated_at = ?
      WHERE id = ?
    `).run(newStageId, new Date().toISOString(), dealId);

    // Recalculate expected revenue based on new stage probability
    const stage = db.prepare('SELECT probability FROM pipeline_stages WHERE id = ?').get(newStageId);
    const dealValue = db.prepare('SELECT deal_value FROM deals WHERE id = ?').get(dealId);
    const expectedRevenue = dealValue.deal_value * ((stage?.probability || 50) / 100);

    db.prepare('UPDATE deals SET expected_revenue = ? WHERE id = ?').run(expectedRevenue, dealId);

    // Log stage change
    this.logStageChange(dealId, oldStageId, newStageId, userId, notes);

    return { success: true };
  }

  /**
   * Log stage change history
   */
  static logStageChange(dealId, fromStageId, toStageId, userId, notes) {
    const id = require('crypto').randomBytes(16).toString('hex');

    // Calculate duration in previous stage
    let durationDays = null;
    if (fromStageId) {
      const lastChange = db.prepare(`
        SELECT changed_at FROM deal_stage_history
        WHERE deal_id = ? AND to_stage_id = ?
        ORDER BY changed_at DESC
        LIMIT 1
      `).get(dealId, fromStageId);

      if (lastChange) {
        const then = new Date(lastChange.changed_at);
        const now = new Date();
        durationDays = Math.floor((now - then) / (1000 * 60 * 60 * 24));
      }
    }

    db.prepare(`
      INSERT INTO deal_stage_history (id, deal_id, from_stage_id, to_stage_id, changed_by, duration_days, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, dealId, fromStageId, toStageId, userId, durationDays, notes);
  }

  /**
   * Add activity to deal
   */
  static addActivity(dealId, activityData) {
    const { activityType, subject, description, performedBy, durationMinutes, outcome, nextAction } = activityData;
    const id = require('crypto').randomBytes(16).toString('hex');

    db.prepare(`
      INSERT INTO deal_activities (
        id, deal_id, activity_type, subject, description, performed_by,
        duration_minutes, outcome, next_action
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, dealId, activityType, subject, description || null, performedBy,
      durationMinutes || null, outcome || null, nextAction || null
    );

    // Update last activity date on deal
    db.prepare('UPDATE deals SET last_activity_date = ? WHERE id = ?')
      .run(new Date().toISOString(), dealId);

    return { success: true, activityId: id };
  }

  /**
   * Add products to deal
   */
  static addDealProducts(dealId, products) {
    let totalValue = 0;

    products.forEach(product => {
      const id = require('crypto').randomBytes(16).toString('hex');
      const total = (product.unitPrice * product.quantity) - (product.discount || 0);
      totalValue += total;

      db.prepare(`
        INSERT INTO deal_products (id, deal_id, product_id, quantity, unit_price, discount, total_price, description)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id, dealId, product.productId, product.quantity, product.unitPrice,
        product.discount || 0, total, product.description || null
      );
    });

    // Update deal value
    db.prepare('UPDATE deals SET deal_value = ? WHERE id = ?').run(totalValue, dealId);

    return { success: true, totalValue };
  }

  /**
   * Close deal as won
   */
  static closeDealAsWon(dealId, userId, winReason, wonDetails) {
    // Get pipeline's "won" stage
    const deal = db.prepare('SELECT pipeline_id FROM deals WHERE id = ?').get(dealId);
    const wonStage = db.prepare(`
      SELECT id FROM pipeline_stages 
      WHERE pipeline_id = ? AND stage_type = 'won'
      LIMIT 1
    `).get(deal.pipeline_id);

    if (!wonStage) {
      throw new Error('No "won" stage found in pipeline');
    }

    // Update deal
    db.prepare(`
      UPDATE deals 
      SET status = 'won', stage_id = ?, actual_close_date = ?, won_details = ?, updated_at = ?
      WHERE id = ?
    `).run(wonStage.id, new Date().toISOString(), wonDetails, new Date().toISOString(), dealId);

    // Log outcome
    const outcomeId = require('crypto').randomBytes(16).toString('hex');
    db.prepare(`
      INSERT INTO deal_outcomes (id, deal_id, outcome, win_reason, recorded_by)
      VALUES (?, ?, 'won', ?, ?)
    `).run(outcomeId, dealId, winReason, userId);

    // Log stage change
    this.logStageChange(dealId, deal.stage_id, wonStage.id, userId, 'Deal won');

    return { success: true };
  }

  /**
   * Close deal as lost
   */
  static closeDealAsLost(dealId, userId, lossReason, competitorName, feedback) {
    const deal = db.prepare('SELECT pipeline_id, stage_id FROM deals WHERE id = ?').get(dealId);
    const lostStage = db.prepare(`
      SELECT id FROM pipeline_stages 
      WHERE pipeline_id = ? AND stage_type = 'lost'
      LIMIT 1
    `).get(deal.pipeline_id);

    if (!lostStage) {
      throw new Error('No "lost" stage found in pipeline');
    }

    db.prepare(`
      UPDATE deals 
      SET status = 'lost', stage_id = ?, actual_close_date = ?, lost_reason = ?, updated_at = ?
      WHERE id = ?
    `).run(lostStage.id, new Date().toISOString(), lossReason, new Date().toISOString(), dealId);

    const outcomeId = require('crypto').randomBytes(16).toString('hex');
    db.prepare(`
      INSERT INTO deal_outcomes (id, deal_id, outcome, loss_reason, competitor_name, feedback, recorded_by)
      VALUES (?, ?, 'lost', ?, ?, ?, ?)
    `).run(outcomeId, dealId, lossReason, competitorName || null, feedback || null, userId);

    this.logStageChange(dealId, deal.stage_id, lostStage.id, userId, `Deal lost: ${lossReason}`);

    return { success: true };
  }

  /**
   * Get pipeline analytics
   */
  static getPipelineAnalytics(tenantId, pipelineId = null, ownerId = null) {
    let query = 'SELECT * FROM deals WHERE tenant_id = ? AND status = ?';
    const params = [tenantId, 'open'];

    if (pipelineId) {
      query += ' AND pipeline_id = ?';
      params.push(pipelineId);
    }

    if (ownerId) {
      query += ' AND owner_id = ?';
      params.push(ownerId);
    }

    const deals = db.prepare(query).all(...params);

    // Group by stage
    const byStage = {};
    let totalValue = 0;
    let weightedValue = 0;

    deals.forEach(deal => {
      if (!byStage[deal.stage_id]) {
        const stage = db.prepare('SELECT stage_name, probability FROM pipeline_stages WHERE id = ?').get(deal.stage_id);
        byStage[deal.stage_id] = {
          stageName: stage?.stage_name || 'Unknown',
          probability: stage?.probability || 50,
          count: 0,
          value: 0,
          weightedValue: 0
        };
      }

      byStage[deal.stage_id].count++;
      byStage[deal.stage_id].value += deal.deal_value;
      byStage[deal.stage_id].weightedValue += deal.expected_revenue;

      totalValue += deal.deal_value;
      weightedValue += deal.expected_revenue;
    });

    return {
      totalDeals: deals.length,
      totalValue,
      weightedValue,
      byStage,
      averageDealSize: deals.length > 0 ? totalValue / deals.length : 0
    };
  }

  /**
   * Get forecast for period
   */
  static getForecast(tenantId, periodStart, periodEnd) {
    const deals = db.prepare(`
      SELECT * FROM deals
      WHERE tenant_id = ?
        AND status = 'open'
        AND expected_close_date BETWEEN ? AND ?
      ORDER BY expected_close_date
    `).all(tenantId, periodStart, periodEnd);

    let totalPipelineValue = 0;
    let weightedValue = 0;
    const byMonth = {};

    deals.forEach(deal => {
      const month = deal.expected_close_date.substring(0, 7); // YYYY-MM
      
      if (!byMonth[month]) {
        byMonth[month] = { count: 0, value: 0, weightedValue: 0 };
      }

      byMonth[month].count++;
      byMonth[month].value += deal.deal_value;
      byMonth[month].weightedValue += deal.expected_revenue;

      totalPipelineValue += deal.deal_value;
      weightedValue += deal.expected_revenue;
    });

    return {
      periodStart,
      periodEnd,
      totalDeals: deals.length,
      totalPipelineValue,
      weightedValue,
      byMonth
    };
  }

  /**
   * Calculate deal score (0-100)
   */
  static calculateDealScore(dealId) {
    const deal = db.prepare('SELECT * FROM deals WHERE id = ?').get(dealId);
    if (!deal) return 0;

    let score = 50; // Base score

    // Budget fit (deal value)
    if (deal.deal_value > 100000) score += 15;
    else if (deal.deal_value > 50000) score += 10;
    else if (deal.deal_value > 10000) score += 5;

    // Recent activity
    if (deal.last_activity_date) {
      const daysSince = Math.floor((new Date() - new Date(deal.last_activity_date)) / (1000 * 60 * 60 * 24));
      if (daysSince < 7) score += 10;
      else if (daysSince < 14) score += 5;
      else if (daysSince > 30) score -= 10;
    } else {
      score -= 15; // No activity is bad
    }

    // Stage probability
    const stage = db.prepare('SELECT probability FROM pipeline_stages WHERE id = ?').get(deal.stage_id);
    score += (stage?.probability || 50) * 0.2;

    // Priority
    if (deal.priority === 'critical') score += 15;
    else if (deal.priority === 'high') score += 10;
    else if (deal.priority === 'low') score -= 5;

    // Temperature
    if (deal.temperature === 'hot') score += 10;
    else if (deal.temperature === 'cold') score -= 10;

    // Close date proximity
    if (deal.expected_close_date) {
      const daysUntilClose = Math.floor((new Date(deal.expected_close_date) - new Date()) / (1000 * 60 * 60 * 24));
      if (daysUntilClose < 7) score += 10;
      else if (daysUntilClose < 30) score += 5;
    }

    // Cap between 0-100
    score = Math.max(0, Math.min(100, Math.round(score)));

    // Update deal score
    db.prepare('UPDATE deals SET score = ? WHERE id = ?').run(score, dealId);

    return score;
  }
}

module.exports = PipelineService;
