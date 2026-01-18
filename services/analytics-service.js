/**
 * Analytics & Reporting Service
 * KPI calculation, report generation, data aggregation
 */

const { db } = require('./config');
const crypto = require('crypto');

class AnalyticsService {
  
  // ===== KPI CALCULATION =====
  
  /**
   * Calculate KPI value for a specific period
   */
  static calculateKPI(kpiId, tenantId, periodStart, periodEnd) {
    const kpi = db.prepare('SELECT * FROM analytics_kpis WHERE id = ? AND tenant_id = ?').get(kpiId, tenantId);
    if (!kpi) return null;
    
    const config = kpi.calculation_config ? JSON.parse(kpi.calculation_config) : {};
    let value = 0;
    
    // Calculate based on KPI type
    switch (kpi.kpi_category) {
      case 'sales':
        value = this._calculateSalesKPI(kpi, tenantId, periodStart, periodEnd, config);
        break;
      case 'revenue':
        value = this._calculateRevenueKPI(kpi, tenantId, periodStart, periodEnd, config);
        break;
      case 'conversion':
        value = this._calculateConversionKPI(kpi, tenantId, periodStart, periodEnd, config);
        break;
      case 'customer':
        value = this._calculateCustomerKPI(kpi, tenantId, periodStart, periodEnd, config);
        break;
      case 'pipeline':
        value = this._calculatePipelineKPI(kpi, tenantId, periodStart, periodEnd, config);
        break;
      default:
        value = 0;
    }
    
    // Calculate achievement
    const targetValue = kpi.target_value || 0;
    const achievementPercentage = targetValue > 0 ? (value / targetValue) * 100 : 0;
    
    // Determine status
    let status = 'on_track';
    if (kpi.critical_threshold && value < kpi.critical_threshold) {
      status = 'critical';
    } else if (kpi.warning_threshold && value < kpi.warning_threshold) {
      status = 'warning';
    } else if (kpi.good_threshold && value >= kpi.good_threshold) {
      status = 'exceeding';
    }
    
    // Save value
    const id = crypto.randomBytes(16).toString('hex');
    db.prepare(`
      INSERT INTO analytics_kpi_values (
        id, kpi_id, tenant_id, calculated_value, target_value,
        achievement_percentage, status, period_type, period_start, period_end
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, kpiId, tenantId, value, targetValue,
      achievementPercentage, status, kpi.target_period, periodStart, periodEnd
    );
    
    return {
      kpiId,
      kpiName: kpi.kpi_name,
      value,
      targetValue,
      achievementPercentage: Math.round(achievementPercentage),
      status,
      periodStart,
      periodEnd
    };
  }
  
  static _calculateSalesKPI(kpi, tenantId, periodStart, periodEnd, config) {
    if (kpi.kpi_name.includes('Won Deals')) {
      const result = db.prepare(`
        SELECT COUNT(*) as count FROM deals
        WHERE tenant_id = ? AND status = 'won'
        AND actual_close_date BETWEEN ? AND ?
      `).get(tenantId, periodStart, periodEnd);
      return result?.count || 0;
    }
    
    if (kpi.kpi_name.includes('Total Orders')) {
      const result = db.prepare(`
        SELECT COUNT(*) as count FROM orders_new
        WHERE tenant_id = ? AND created_at BETWEEN ? AND ?
      `).get(tenantId, periodStart, periodEnd);
      return result?.count || 0;
    }
    
    return 0;
  }
  
  static _calculateRevenueKPI(kpi, tenantId, periodStart, periodEnd, config) {
    if (kpi.kpi_name.includes('Total Revenue') || kpi.kpi_name.includes('Revenue')) {
      const result = db.prepare(`
        SELECT SUM(total_amount) as total FROM orders_new
        WHERE tenant_id = ? AND created_at BETWEEN ? AND ?
      `).get(tenantId, periodStart, periodEnd);
      return result?.total || 0;
    }
    
    if (kpi.kpi_name.includes('Deal Value')) {
      const result = db.prepare(`
        SELECT SUM(deal_value) as total FROM deals
        WHERE tenant_id = ? AND status = 'won'
        AND actual_close_date BETWEEN ? AND ?
      `).get(tenantId, periodStart, periodEnd);
      return result?.total || 0;
    }
    
    return 0;
  }
  
  static _calculateConversionKPI(kpi, tenantId, periodStart, periodEnd, config) {
    if (kpi.kpi_name.includes('Win Rate')) {
      const won = db.prepare(`
        SELECT COUNT(*) as count FROM deals
        WHERE tenant_id = ? AND status = 'won'
        AND actual_close_date BETWEEN ? AND ?
      `).get(tenantId, periodStart, periodEnd);
      
      const total = db.prepare(`
        SELECT COUNT(*) as count FROM deals
        WHERE tenant_id = ? AND status IN ('won', 'lost')
        AND actual_close_date BETWEEN ? AND ?
      `).get(tenantId, periodStart, periodEnd);
      
      return (total?.count || 0) > 0 ? ((won?.count || 0) / total.count) * 100 : 0;
    }
    
    return 0;
  }
  
  static _calculateCustomerKPI(kpi, tenantId, periodStart, periodEnd, config) {
    if (kpi.kpi_name.includes('New Customers')) {
      const result = db.prepare(`
        SELECT COUNT(*) as count FROM customer_profiles_new
        WHERE tenant_id = ? AND created_at BETWEEN ? AND ?
      `).get(tenantId, periodStart, periodEnd);
      return result?.count || 0;
    }
    
    if (kpi.kpi_name.includes('Active Customers')) {
      const result = db.prepare(`
        SELECT COUNT(DISTINCT customer_id) as count FROM orders_new
        WHERE tenant_id = ? AND created_at BETWEEN ? AND ?
      `).get(tenantId, periodStart, periodEnd);
      return result?.count || 0;
    }
    
    return 0;
  }
  
  static _calculatePipelineKPI(kpi, tenantId, periodStart, periodEnd, config) {
    if (kpi.kpi_name.includes('Pipeline Value')) {
      const result = db.prepare(`
        SELECT SUM(deal_value) as total FROM deals
        WHERE tenant_id = ? AND status = 'open'
      `).get(tenantId);
      return result?.total || 0;
    }
    
    if (kpi.kpi_name.includes('Open Deals')) {
      const result = db.prepare(`
        SELECT COUNT(*) as count FROM deals
        WHERE tenant_id = ? AND status = 'open'
      `).get(tenantId);
      return result?.count || 0;
    }
    
    return 0;
  }
  
  // ===== DASHBOARD DATA =====
  
  /**
   * Get sales overview data
   */
  static getSalesOverview(tenantId, periodStart, periodEnd) {
    // Total revenue
    const revenue = db.prepare(`
      SELECT SUM(total_amount) as total FROM orders_new
      WHERE tenant_id = ? AND created_at BETWEEN ? AND ?
    `).get(tenantId, periodStart, periodEnd);
    
    // Total orders
    const orders = db.prepare(`
      SELECT COUNT(*) as count FROM orders_new
      WHERE tenant_id = ? AND created_at BETWEEN ? AND ?
    `).get(tenantId, periodStart, periodEnd);
    
    // Won deals
    const wonDeals = db.prepare(`
      SELECT COUNT(*) as count, SUM(deal_value) as total FROM deals
      WHERE tenant_id = ? AND status = 'won'
      AND actual_close_date BETWEEN ? AND ?
    `).get(tenantId, periodStart, periodEnd);
    
    // Pipeline value
    const pipeline = db.prepare(`
      SELECT COUNT(*) as count, SUM(deal_value) as total FROM deals
      WHERE tenant_id = ? AND status = 'open'
    `).get(tenantId);
    
    // Average deal size
    const avgDeal = wonDeals?.count > 0 ? (wonDeals.total / wonDeals.count) : 0;
    
    return {
      revenue: revenue?.total || 0,
      orders: orders?.count || 0,
      wonDeals: wonDeals?.count || 0,
      wonDealsValue: wonDeals?.total || 0,
      pipelineDeals: pipeline?.count || 0,
      pipelineValue: pipeline?.total || 0,
      averageDealSize: Math.round(avgDeal)
    };
  }
  
  /**
   * Get sales by period (for charts)
   */
  static getSalesByPeriod(tenantId, periodStart, periodEnd, groupBy = 'day') {
    let dateFormat;
    switch (groupBy) {
      case 'hour':
        dateFormat = '%Y-%m-%d %H:00:00';
        break;
      case 'day':
        dateFormat = '%Y-%m-%d';
        break;
      case 'week':
        dateFormat = '%Y-W%W';
        break;
      case 'month':
        dateFormat = '%Y-%m';
        break;
      default:
        dateFormat = '%Y-%m-%d';
    }
    
    const sales = db.prepare(`
      SELECT 
        strftime(?, created_at) as period,
        COUNT(*) as order_count,
        SUM(total_amount) as revenue
      FROM orders_new
      WHERE tenant_id = ? AND created_at BETWEEN ? AND ?
      GROUP BY period
      ORDER BY period ASC
    `).all(dateFormat, tenantId, periodStart, periodEnd);
    
    return sales;
  }
  
  /**
   * Get top products
   */
  static getTopProducts(tenantId, periodStart, periodEnd, limit = 10) {
    const products = db.prepare(`
      SELECT 
        oi.product_id,
        p.name as product_name,
        SUM(oi.quantity) as total_quantity,
        SUM(oi.subtotal) as total_revenue,
        COUNT(DISTINCT oi.order_id) as order_count
      FROM order_items_new oi
      LEFT JOIN products p ON oi.product_id = p.id
      LEFT JOIN orders_new o ON oi.order_id = o.id
      WHERE o.tenant_id = ? AND o.created_at BETWEEN ? AND ?
      GROUP BY oi.product_id, p.name
      ORDER BY total_revenue DESC
      LIMIT ?
    `).all(tenantId, periodStart, periodEnd, limit);
    
    return products;
  }
  
  /**
   * Get customer insights
   */
  static getCustomerInsights(tenantId, periodStart, periodEnd) {
    // New customers
    const newCustomers = db.prepare(`
      SELECT COUNT(*) as count FROM customer_profiles_new
      WHERE tenant_id = ? AND created_at BETWEEN ? AND ?
    `).get(tenantId, periodStart, periodEnd);
    
    // Active customers (made a purchase)
    const activeCustomers = db.prepare(`
      SELECT COUNT(DISTINCT customer_id) as count FROM orders_new
      WHERE tenant_id = ? AND created_at BETWEEN ? AND ?
    `).get(tenantId, periodStart, periodEnd);
    
    // Total customers
    const totalCustomers = db.prepare(`
      SELECT COUNT(*) as count FROM customer_profiles_new
      WHERE tenant_id = ?
    `).get(tenantId);
    
    // Average order value
    const avgOrderValue = db.prepare(`
      SELECT AVG(total_amount) as avg FROM orders_new
      WHERE tenant_id = ? AND created_at BETWEEN ? AND ?
    `).get(tenantId, periodStart, periodEnd);
    
    // Customer lifetime value (top 10)
    const topCustomers = db.prepare(`
      SELECT 
        c.id,
        c.business_name,
        COUNT(o.id) as order_count,
        SUM(o.total_amount) as lifetime_value
      FROM customer_profiles_new c
      LEFT JOIN orders_new o ON c.id = o.customer_id
      WHERE c.tenant_id = ? AND o.created_at BETWEEN ? AND ?
      GROUP BY c.id, c.business_name
      ORDER BY lifetime_value DESC
      LIMIT 10
    `).all(tenantId, periodStart, periodEnd);
    
    return {
      newCustomers: newCustomers?.count || 0,
      activeCustomers: activeCustomers?.count || 0,
      totalCustomers: totalCustomers?.count || 0,
      averageOrderValue: Math.round(avgOrderValue?.avg || 0),
      topCustomers
    };
  }
  
  /**
   * Get pipeline funnel data
   */
  static getPipelineFunnel(tenantId, pipelineId) {
    const stages = db.prepare(`
      SELECT 
        ps.id,
        ps.stage_name,
        ps.stage_order,
        ps.probability,
        COUNT(d.id) as deal_count,
        SUM(d.deal_value) as total_value,
        SUM(d.expected_revenue) as weighted_value
      FROM pipeline_stages ps
      LEFT JOIN deals d ON ps.id = d.stage_id AND d.status = 'open'
      WHERE ps.pipeline_id = ? AND ps.stage_type = 'open'
      GROUP BY ps.id, ps.stage_name, ps.stage_order, ps.probability
      ORDER BY ps.stage_order ASC
    `).all(pipelineId);
    
    return stages;
  }
  
  /**
   * Get performance by user/salesperson
   */
  static getUserPerformance(tenantId, periodStart, periodEnd) {
    const performance = db.prepare(`
      SELECT 
        u.id as user_id,
        u.phone as user_phone,
        u.role,
        COUNT(DISTINCT o.id) as order_count,
        SUM(o.total_amount) as revenue,
        COUNT(DISTINCT d.id) as deals_won,
        SUM(d.deal_value) as deal_value
      FROM users u
      LEFT JOIN orders_new o ON u.id = o.created_by 
        AND o.created_at BETWEEN ? AND ?
      LEFT JOIN deals d ON u.id = d.owner_id 
        AND d.status = 'won'
        AND d.actual_close_date BETWEEN ? AND ?
      WHERE u.tenant_id = ? AND u.is_active = 1
      GROUP BY u.id, u.phone, u.role
      ORDER BY revenue DESC
    `).all(periodStart, periodEnd, periodStart, periodEnd, tenantId);
    
    return performance;
  }
  
  // ===== REPORT GENERATION =====
  
  /**
   * Generate sales summary report
   */
  static generateSalesSummary(tenantId, periodStart, periodEnd) {
    const overview = this.getSalesOverview(tenantId, periodStart, periodEnd);
    const salesByDay = this.getSalesByPeriod(tenantId, periodStart, periodEnd, 'day');
    const topProducts = this.getTopProducts(tenantId, periodStart, periodEnd, 10);
    const customerInsights = this.getCustomerInsights(tenantId, periodStart, periodEnd);
    
    return {
      reportType: 'sales_summary',
      period: { start: periodStart, end: periodEnd },
      overview,
      salesTrend: salesByDay,
      topProducts,
      customerInsights,
      generatedAt: new Date().toISOString()
    };
  }
  
  /**
   * Generate pipeline analysis report
   */
  static generatePipelineAnalysis(tenantId, pipelineId) {
    const pipeline = db.prepare('SELECT * FROM pipelines WHERE id = ?').get(pipelineId);
    if (!pipeline) return null;
    
    const funnel = this.getPipelineFunnel(tenantId, pipelineId);
    
    // Win/loss analysis
    const outcomes = db.prepare(`
      SELECT 
        outcome,
        COUNT(*) as count,
        SUM(d.deal_value) as total_value
      FROM deal_outcomes do
      JOIN deals d ON do.deal_id = d.id
      WHERE d.tenant_id = ? AND d.pipeline_id = ?
      GROUP BY outcome
    `).all(tenantId, pipelineId);
    
    // Average time in pipeline
    const avgTime = db.prepare(`
      SELECT 
        AVG(julianday(actual_close_date) - julianday(created_date)) as avg_days
      FROM deals
      WHERE tenant_id = ? AND pipeline_id = ? AND status IN ('won', 'lost')
    `).get(tenantId, pipelineId);
    
    return {
      reportType: 'pipeline_analysis',
      pipeline: {
        id: pipeline.id,
        name: pipeline.pipeline_name
      },
      funnel,
      outcomes,
      averageCycleDays: Math.round(avgTime?.avg_days || 0),
      generatedAt: new Date().toISOString()
    };
  }
  
  // ===== INSIGHTS GENERATION =====
  
  /**
   * Generate AI insights from data
   */
  static generateInsights(tenantId, periodStart, periodEnd) {
    const insights = [];
    
    // Compare with previous period
    const periodDays = Math.floor((new Date(periodEnd) - new Date(periodStart)) / (1000 * 60 * 60 * 24));
    const prevStart = new Date(new Date(periodStart) - periodDays * 24 * 60 * 60 * 1000).toISOString();
    const prevEnd = periodStart;
    
    // Revenue trend
    const currentRevenue = db.prepare(`
      SELECT SUM(total_amount) as total FROM orders_new
      WHERE tenant_id = ? AND created_at BETWEEN ? AND ?
    `).get(tenantId, periodStart, periodEnd);
    
    const previousRevenue = db.prepare(`
      SELECT SUM(total_amount) as total FROM orders_new
      WHERE tenant_id = ? AND created_at BETWEEN ? AND ?
    `).get(tenantId, prevStart, prevEnd);
    
    const currentRev = currentRevenue?.total || 0;
    const previousRev = previousRevenue?.total || 0;
    
    if (previousRev > 0) {
      const changePercent = ((currentRev - previousRev) / previousRev) * 100;
      
      if (Math.abs(changePercent) > 10) {
        insights.push({
          type: changePercent > 0 ? 'achievement' : 'risk',
          title: `Revenue ${changePercent > 0 ? 'Increased' : 'Decreased'} by ${Math.abs(changePercent).toFixed(1)}%`,
          description: `Current period revenue: ₹${currentRev.toLocaleString()}, Previous period: ₹${previousRev.toLocaleString()}`,
          metricName: 'Revenue',
          metricValue: currentRev,
          comparisonValue: previousRev,
          changePercentage: changePercent,
          severity: Math.abs(changePercent) > 20 ? 'high' : 'medium',
          confidenceScore: 0.95
        });
      }
    }
    
    // Save insights
    insights.forEach(insight => {
      const id = crypto.randomBytes(16).toString('hex');
      db.prepare(`
        INSERT INTO analytics_insights (
          id, tenant_id, insight_type, insight_title, insight_description,
          metric_name, metric_value, comparison_value, change_percentage,
          severity, confidence_score, period_start, period_end
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id, tenantId, insight.type, insight.title, insight.description,
        insight.metricName, insight.metricValue, insight.comparisonValue,
        insight.changePercentage, insight.severity, insight.confidenceScore,
        periodStart, periodEnd
      );
    });
    
    return insights;
  }
}

module.exports = AnalyticsService;
