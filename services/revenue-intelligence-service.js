/**
 * Revenue Intelligence Service
 * 
 * Provides comprehensive revenue analytics including:
 * - Customer Acquisition Cost (CAC) tracking
 * - Lifetime Value (LTV) calculation
 * - Cohort analysis and retention metrics
 * - Revenue forecasting
 * - Product profitability analysis
 */

const Database = require('better-sqlite3');

class RevenueIntelligenceService {
  /**
   * Calculate Customer Acquisition Cost (CAC)
   * @param {string} tenantId - Tenant ID
   * @param {Object} options - Period and filters
   * @returns {Object} CAC metrics
   */
  static calculateCAC(tenantId, options = {}) {
    const db = new Database(process.env.DB_PATH || 'local-database.db');

    try {
      const { startDate, endDate, campaignId, source } = options;
      
      // Get total marketing spend for period
      let spendQuery = `
        SELECT SUM(actual_spend) as total_spend,
               COUNT(DISTINCT id) as campaign_count
        FROM marketing_campaigns
        WHERE tenant_id = ?
      `;
      const spendParams = [tenantId];

      if (startDate) {
        spendQuery += ` AND start_date >= ?`;
        spendParams.push(startDate);
      }
      if (endDate) {
        spendQuery += ` AND start_date <= ?`;
        spendParams.push(endDate);
      }
      if (campaignId) {
        spendQuery += ` AND id = ?`;
        spendParams.push(campaignId);
      }

      const spendData = db.prepare(spendQuery).get(...spendParams);

      // Get customers acquired in period
      let customerQuery = `
        SELECT COUNT(DISTINCT customer_id) as customers_acquired,
               acquisition_source,
               SUM(acquisition_cost) as direct_acquisition_cost
        FROM customer_acquisition_sources
        WHERE tenant_id = ?
      `;
      const customerParams = [tenantId];

      if (startDate) {
        customerQuery += ` AND acquisition_date >= ?`;
        customerParams.push(startDate);
      }
      if (endDate) {
        customerQuery += ` AND acquisition_date <= ?`;
        customerParams.push(endDate);
      }
      if (campaignId) {
        customerQuery += ` AND campaign_id = ?`;
        customerParams.push(campaignId);
      }
      if (source) {
        customerQuery += ` AND acquisition_source = ?`;
        customerParams.push(source);
      }

      customerQuery += ` GROUP BY acquisition_source`;

      const customerData = db.prepare(customerQuery).all(...customerParams);

      const totalCustomers = customerData.reduce((sum, row) => sum + row.customers_acquired, 0);
      const totalSpend = (spendData.total_spend || 0) + customerData.reduce((sum, row) => sum + (row.direct_acquisition_cost || 0), 0);

      const averageCAC = totalCustomers > 0 ? totalSpend / totalCustomers : 0;

      // Calculate CAC by source
      const cacBySource = {};
      for (const row of customerData) {
        const sourceSpend = db.prepare(`
          SELECT SUM(mc.actual_spend) as spend
          FROM marketing_campaigns mc
          JOIN customer_acquisition_sources cas ON cas.campaign_id = mc.id
          WHERE cas.acquisition_source = ?
            AND cas.tenant_id = ?
        `).get(row.acquisition_source, tenantId);

        const sourceCustomers = row.customers_acquired;
        const sourceTotalSpend = (sourceSpend?.spend || 0) + (row.direct_acquisition_cost || 0);

        cacBySource[row.acquisition_source] = {
          customersAcquired: sourceCustomers,
          totalSpend: sourceTotalSpend,
          averageCAC: sourceCustomers > 0 ? sourceTotalSpend / sourceCustomers : 0
        };
      }

      return {
        period: { startDate, endDate },
        totalMarketingSpend: spendData.total_spend || 0,
        totalCustomersAcquired: totalCustomers,
        averageCAC,
        cacBySource,
        campaignCount: spendData.campaign_count || 0
      };

    } finally {
      db.close();
    }
  }

  /**
   * Calculate Customer Lifetime Value (LTV)
   * @param {string} tenantId - Tenant ID
   * @param {string} customerId - Customer ID (optional, calculates for all if omitted)
   * @returns {Object} LTV metrics
   */
  static calculateLTV(tenantId, customerId = null) {
    const db = new Database(process.env.DB_PATH || 'local-database.db');

    try {
      if (customerId) {
        return this._calculateSingleCustomerLTV(db, tenantId, customerId);
      } else {
        return this._calculateAverageLTV(db, tenantId);
      }
    } finally {
      db.close();
    }
  }

  /**
   * Calculate LTV for a single customer
   */
  static _calculateSingleCustomerLTV(db, tenantId, customerId) {
    // Get customer's order history
    const orders = db.prepare(`
      SELECT 
        order_date,
        total_amount,
        status
      FROM orders
      WHERE tenant_id = ? AND customer_id = ?
        AND status IN ('completed', 'delivered')
      ORDER BY order_date ASC
    `).all(tenantId, customerId);

    if (orders.length === 0) {
      return {
        customerId,
        totalRevenue: 0,
        totalOrders: 0,
        averageOrderValue: 0,
        purchaseFrequency: 0,
        customerAgeDays: 0,
        predictedLTV: 0,
        valueTier: 'bronze'
      };
    }

    const totalRevenue = orders.reduce((sum, order) => sum + order.total_amount, 0);
    const totalOrders = orders.length;
    const averageOrderValue = totalRevenue / totalOrders;

    const firstOrderDate = new Date(orders[0].order_date);
    const lastOrderDate = new Date(orders[orders.length - 1].order_date);
    const customerAgeDays = Math.floor((lastOrderDate - firstOrderDate) / (1000 * 60 * 60 * 24)) || 1;
    const customerAgeMonths = customerAgeDays / 30.44;

    // Purchase frequency (orders per month)
    const purchaseFrequency = customerAgeMonths > 0 ? totalOrders / customerAgeMonths : 0;

    // Predicted LTV using simple model: AOV × Purchase Frequency × Expected Lifetime
    const expectedLifetimeMonths = 24; // Assume 2-year customer lifetime
    const predictedLTV = averageOrderValue * purchaseFrequency * expectedLifetimeMonths;

    // Calculate churn risk based on recency
    const daysSinceLastOrder = Math.floor((new Date() - lastOrderDate) / (1000 * 60 * 60 * 24));
    const expectedDaysBetweenOrders = purchaseFrequency > 0 ? 30.44 / purchaseFrequency : 90;
    const churnRiskScore = Math.min(100, (daysSinceLastOrder / expectedDaysBetweenOrders) * 100);

    // Determine value tier
    let valueTier = 'bronze';
    if (totalRevenue > 100000 && purchaseFrequency > 1) valueTier = 'platinum';
    else if (totalRevenue > 50000 && purchaseFrequency > 0.5) valueTier = 'gold';
    else if (totalRevenue > 20000) valueTier = 'silver';
    else if (churnRiskScore > 70) valueTier = 'at_risk';

    // Get acquisition cost
    const acquisitionData = db.prepare(`
      SELECT acquisition_cost, acquisition_date, acquisition_source
      FROM customer_acquisition_sources
      WHERE tenant_id = ? AND customer_id = ?
    `).get(tenantId, customerId);

    const acquisitionCost = acquisitionData?.acquisition_cost || 0;
    const grossProfit = totalRevenue - acquisitionCost;
    const profitMargin = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0;

    // Save/update LTV record
    db.prepare(`
      INSERT OR REPLACE INTO customer_lifetime_value (
        tenant_id, customer_id,
        total_revenue, total_orders, average_order_value,
        first_order_date, last_order_date, customer_age_days,
        purchase_frequency, predicted_ltv,
        total_costs, gross_profit, profit_margin_percentage,
        churn_risk_score, value_tier,
        last_calculated_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).run(
      tenantId, customerId,
      totalRevenue, totalOrders, averageOrderValue,
      orders[0].order_date, orders[orders.length - 1].order_date, customerAgeDays,
      purchaseFrequency, predictedLTV,
      acquisitionCost, grossProfit, profitMargin,
      churnRiskScore, valueTier
    );

    return {
      customerId,
      totalRevenue,
      totalOrders,
      averageOrderValue,
      purchaseFrequency,
      customerAgeDays,
      firstOrderDate: orders[0].order_date,
      lastOrderDate: orders[orders.length - 1].order_date,
      predictedLTV,
      acquisitionCost,
      grossProfit,
      profitMargin,
      churnRiskScore,
      valueTier,
      ltvToCacRatio: acquisitionCost > 0 ? predictedLTV / acquisitionCost : 0
    };
  }

  /**
   * Calculate average LTV across all customers
   */
  static _calculateAverageLTV(db, tenantId) {
    const stats = db.prepare(`
      SELECT 
        COUNT(DISTINCT customer_id) as total_customers,
        AVG(total_revenue) as avg_revenue,
        AVG(predicted_ltv) as avg_ltv,
        AVG(purchase_frequency) as avg_frequency,
        AVG(churn_risk_score) as avg_churn_risk
      FROM customer_lifetime_value
      WHERE tenant_id = ?
    `).get(tenantId);

    const tierDistribution = db.prepare(`
      SELECT value_tier, COUNT(*) as count
      FROM customer_lifetime_value
      WHERE tenant_id = ?
      GROUP BY value_tier
    `).all(tenantId);

    return {
      totalCustomers: stats.total_customers || 0,
      averageRevenue: stats.avg_revenue || 0,
      averageLTV: stats.avg_ltv || 0,
      averagePurchaseFrequency: stats.avg_frequency || 0,
      averageChurnRisk: stats.avg_churn_risk || 0,
      tierDistribution: tierDistribution.reduce((acc, row) => {
        acc[row.value_tier] = row.count;
        return acc;
      }, {})
    };
  }

  /**
   * Perform cohort analysis
   * @param {string} tenantId - Tenant ID
   * @param {Object} options - Cohort analysis options
   */
  static analyzeCohorts(tenantId, options = {}) {
    const db = new Database(process.env.DB_PATH || 'local-database.db');

    try {
      const { period = 'month', startDate, endDate } = options;

      // Get customers grouped by acquisition month
      let cohortQuery = `
        SELECT 
          DATE(acquisition_date, 'start of month') as cohort_month,
          COUNT(DISTINCT customer_id) as initial_customers,
          acquisition_source
        FROM customer_acquisition_sources
        WHERE tenant_id = ?
      `;
      const params = [tenantId];

      if (startDate) {
        cohortQuery += ` AND acquisition_date >= ?`;
        params.push(startDate);
      }
      if (endDate) {
        cohortQuery += ` AND acquisition_date <= ?`;
        params.push(endDate);
      }

      cohortQuery += ` GROUP BY cohort_month, acquisition_source ORDER BY cohort_month DESC`;

      const cohorts = db.prepare(cohortQuery).all(...params);

      const cohortAnalysis = [];

      for (const cohort of cohorts) {
        // Get customers in this cohort
        const cohortCustomers = db.prepare(`
          SELECT customer_id
          FROM customer_acquisition_sources
          WHERE tenant_id = ?
            AND DATE(acquisition_date, 'start of month') = ?
        `).all(tenantId, cohort.cohort_month);

        const customerIds = cohortCustomers.map(c => c.customer_id);

        if (customerIds.length === 0) continue;

        // Calculate retention rates
        const retentionRates = {};
        const months = [1, 3, 6, 12, 24];

        for (const monthOffset of months) {
          const checkDate = new Date(cohort.cohort_month);
          checkDate.setMonth(checkDate.getMonth() + monthOffset);

          const activeCustomers = db.prepare(`
            SELECT COUNT(DISTINCT customer_id) as active
            FROM orders
            WHERE tenant_id = ?
              AND customer_id IN (${customerIds.map(() => '?').join(',')})
              AND order_date >= ?
              AND order_date < DATE(?, '+1 month')
              AND status IN ('completed', 'delivered')
          `).get(tenantId, ...customerIds, checkDate.toISOString().split('T')[0], checkDate.toISOString().split('T')[0]);

          retentionRates[`month_${monthOffset}`] = cohort.initial_customers > 0 
            ? (activeCustomers.active / cohort.initial_customers) * 100 
            : 0;
        }

        // Calculate cohort revenue
        const cohortRevenue = db.prepare(`
          SELECT SUM(total_amount) as revenue
          FROM orders
          WHERE tenant_id = ?
            AND customer_id IN (${customerIds.map(() => '?').join(',')})
            AND status IN ('completed', 'delivered')
        `).get(tenantId, ...customerIds);

        cohortAnalysis.push({
          cohortMonth: cohort.cohort_month,
          initialCustomers: cohort.initial_customers,
          acquisitionSource: cohort.acquisition_source,
          retentionRates,
          totalRevenue: cohortRevenue.revenue || 0,
          averageRevenuePerCustomer: cohort.initial_customers > 0 
            ? (cohortRevenue.revenue || 0) / cohort.initial_customers 
            : 0
        });
      }

      return {
        period,
        totalCohorts: cohortAnalysis.length,
        cohorts: cohortAnalysis
      };

    } finally {
      db.close();
    }
  }

  /**
   * Forecast revenue for future periods
   * @param {string} tenantId - Tenant ID
   * @param {number} monthsAhead - Number of months to forecast
   * @param {string} method - Forecasting method (moving_average, linear_regression)
   */
  static forecastRevenue(tenantId, monthsAhead = 3, method = 'moving_average') {
    const db = new Database(process.env.DB_PATH || 'local-database.db');

    try {
      // Get historical revenue data (last 12 months)
      const historicalData = db.prepare(`
        SELECT 
          DATE(order_date, 'start of month') as month,
          SUM(total_amount) as revenue,
          COUNT(DISTINCT customer_id) as customers,
          COUNT(*) as orders,
          AVG(total_amount) as avg_order_value
        FROM orders
        WHERE tenant_id = ?
          AND status IN ('completed', 'delivered')
          AND order_date >= DATE('now', '-12 months')
        GROUP BY month
        ORDER BY month ASC
      `).all(tenantId);

      if (historicalData.length < 3) {
        throw new Error('Insufficient historical data for forecasting (minimum 3 months required)');
      }

      const forecasts = [];

      if (method === 'moving_average') {
        // Simple moving average (last 3 months)
        const windowSize = 3;
        const recentRevenues = historicalData.slice(-windowSize).map(d => d.revenue);
        const avgRevenue = recentRevenues.reduce((a, b) => a + b, 0) / windowSize;

        const recentCustomers = historicalData.slice(-windowSize).map(d => d.customers);
        const avgCustomers = Math.round(recentCustomers.reduce((a, b) => a + b, 0) / windowSize);

        const recentOrders = historicalData.slice(-windowSize).map(d => d.orders);
        const avgOrders = Math.round(recentOrders.reduce((a, b) => a + b, 0) / windowSize);

        const avgOrderValue = avgOrders > 0 ? avgRevenue / avgOrders : 0;

        // Generate forecasts
        const lastMonth = new Date(historicalData[historicalData.length - 1].month);
        
        for (let i = 1; i <= monthsAhead; i++) {
          const forecastMonth = new Date(lastMonth);
          forecastMonth.setMonth(forecastMonth.getMonth() + i);

          // Add slight growth trend (5% per month - configurable)
          const growthFactor = Math.pow(1.05, i);
          
          forecasts.push({
            forecastPeriod: forecastMonth.toISOString().split('T')[0],
            forecastedRevenue: avgRevenue * growthFactor,
            forecastedCustomers: Math.round(avgCustomers * growthFactor),
            forecastedOrders: Math.round(avgOrders * growthFactor),
            forecastedAOV: avgOrderValue,
            confidenceLevel: 0.80,
            lowerBound: avgRevenue * growthFactor * 0.85,
            upperBound: avgRevenue * growthFactor * 1.15,
            method: 'moving_average_with_growth'
          });
        }
      } else if (method === 'linear_regression') {
        // Simple linear regression
        const n = historicalData.length;
        const xValues = Array.from({ length: n }, (_, i) => i + 1);
        const yValues = historicalData.map(d => d.revenue);

        const sumX = xValues.reduce((a, b) => a + b, 0);
        const sumY = yValues.reduce((a, b) => a + b, 0);
        const sumXY = xValues.reduce((sum, x, i) => sum + x * yValues[i], 0);
        const sumXX = xValues.reduce((sum, x) => sum + x * x, 0);

        const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
        const intercept = (sumY - slope * sumX) / n;

        const lastMonth = new Date(historicalData[historicalData.length - 1].month);

        for (let i = 1; i <= monthsAhead; i++) {
          const forecastMonth = new Date(lastMonth);
          forecastMonth.setMonth(forecastMonth.getMonth() + i);

          const x = n + i;
          const forecastedRevenue = slope * x + intercept;

          forecasts.push({
            forecastPeriod: forecastMonth.toISOString().split('T')[0],
            forecastedRevenue: Math.max(0, forecastedRevenue),
            confidenceLevel: 0.75,
            lowerBound: Math.max(0, forecastedRevenue * 0.80),
            upperBound: forecastedRevenue * 1.20,
            method: 'linear_regression'
          });
        }
      }

      // Save forecasts to database
      for (const forecast of forecasts) {
        db.prepare(`
          INSERT OR REPLACE INTO revenue_forecasts (
            tenant_id, forecast_period, forecast_type,
            forecasted_revenue, forecasted_customers, forecasted_orders, forecasted_aov,
            confidence_level, lower_bound, upper_bound,
            forecasting_model
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          tenantId,
          forecast.forecastPeriod,
          'monthly',
          forecast.forecastedRevenue,
          forecast.forecastedCustomers || null,
          forecast.forecastedOrders || null,
          forecast.forecastedAOV || null,
          forecast.confidenceLevel,
          forecast.lowerBound,
          forecast.upperBound,
          forecast.method
        );
      }

      return {
        method,
        monthsAhead,
        historicalDataPoints: historicalData.length,
        forecasts
      };

    } finally {
      db.close();
    }
  }

  /**
   * Get comprehensive revenue intelligence dashboard
   */
  static getRevenueDashboard(tenantId, period = 'month') {
    const db = new Database(process.env.DB_PATH || 'local-database.db');

    try {
      const cacData = this.calculateCAC(tenantId, {
        startDate: this._getPeriodStart(period)
      });

      const ltvData = this.calculateLTV(tenantId);

      const ltvToCacRatio = cacData.averageCAC > 0 ? ltvData.averageLTV / cacData.averageCAC : 0;

      // Get current period revenue
      const revenueData = db.prepare(`
        SELECT 
          SUM(total_amount) as total_revenue,
          COUNT(*) as total_orders,
          COUNT(DISTINCT customer_id) as active_customers,
          AVG(total_amount) as avg_order_value
        FROM orders
        WHERE tenant_id = ?
          AND order_date >= ?
          AND status IN ('completed', 'delivered')
      `).get(tenantId, this._getPeriodStart(period));

      return {
        period,
        cac: {
          averageCAC: cacData.averageCAC,
          totalSpend: cacData.totalMarketingSpend,
          customersAcquired: cacData.totalCustomersAcquired
        },
        ltv: {
          averageLTV: ltvData.averageLTV,
          averageRevenue: ltvData.averageRevenue,
          tierDistribution: ltvData.tierDistribution
        },
        metrics: {
          ltvToCacRatio,
          totalRevenue: revenueData.total_revenue || 0,
          totalOrders: revenueData.total_orders || 0,
          activeCustomers: revenueData.active_customers || 0,
          averageOrderValue: revenueData.avg_order_value || 0
        },
        health: this._assessRevenueHealth(ltvToCacRatio, ltvData.averageChurnRisk)
      };

    } finally {
      db.close();
    }
  }

  // Helper methods
  static _getPeriodStart(period) {
    const now = new Date();
    if (period === 'week') {
      now.setDate(now.getDate() - 7);
    } else if (period === 'month') {
      now.setMonth(now.getMonth() - 1);
    } else if (period === 'quarter') {
      now.setMonth(now.getMonth() - 3);
    } else if (period === 'year') {
      now.setFullYear(now.getFullYear() - 1);
    }
    return now.toISOString().split('T')[0];
  }

  static _assessRevenueHealth(ltvToCacRatio, avgChurnRisk) {
    const assessments = [];

    if (ltvToCacRatio >= 3) {
      assessments.push({ status: 'excellent', message: 'LTV:CAC ratio is healthy (≥3:1)' });
    } else if (ltvToCacRatio >= 1) {
      assessments.push({ status: 'good', message: 'LTV:CAC ratio is positive but could improve' });
    } else {
      assessments.push({ status: 'critical', message: 'LTV:CAC ratio is below 1:1 - unprofitable acquisition' });
    }

    if (avgChurnRisk < 30) {
      assessments.push({ status: 'excellent', message: 'Low churn risk across customer base' });
    } else if (avgChurnRisk < 60) {
      assessments.push({ status: 'warning', message: 'Moderate churn risk - implement retention campaigns' });
    } else {
      assessments.push({ status: 'critical', message: 'High churn risk - urgent retention needed' });
    }

    return assessments;
  }
}

module.exports = RevenueIntelligenceService;
