/**
 * Machine Learning Service
 * Sales forecasting, churn prediction, product recommendations
 */

// const brain = require('brain.js'); // Disabled for production - requires GPU.js
const regression = require('regression');
const stats = require('simple-statistics');
const { db } = require('./config');

class MLService {
  constructor() {
    // Neural networks disabled for production (require GPU.js)
    // Use statistical models instead
    this.salesForecastNetwork = null;
    this.churnPredictionNetwork = null;
    this.productRecommendationNetwork = null;
    
    this.isTrainedForecast = false;
    this.isTrainedChurn = false;
    this.isTrainedRecommendation = false;
  }

  /**
   * Sales Forecasting - Predict future sales based on historical data
   */
  async trainSalesForecasting(tenantId) {
    try {
      // Get historical sales data (daily sales for last 90 days)
      const query = `
        SELECT DATE(created_at) as date, 
               COUNT(*) as order_count,
               SUM(total_amount) as revenue
        FROM orders
        WHERE tenant_id = ? 
          AND created_at >= date('now', '-90 days')
        GROUP BY DATE(created_at)
        ORDER BY date ASC
      `;
      
      const salesData = await db.all(query, [tenantId]);
      
      if (salesData.length < 14) {
        return { success: false, message: 'Need at least 14 days of data' };
      }

      // Normalize data for training
      const revenues = salesData.map(d => parseFloat(d.revenue) || 0);
      const maxRevenue = Math.max(...revenues);
      const normalizedData = revenues.map(r => r / maxRevenue);

      // Use statistical model instead of neural network
      this.forecastModel = regression.linear(
        salesData.map((d, i) => [i, parseFloat(d.revenue) || 0])
      );
      
      this.isTrainedForecast = true;
      this.maxRevenue = maxRevenue;
      
      return { 
        success: true, 
        daysOfData: salesData.length,
        avgRevenue: stats.mean(revenues),
        trend: this.detectTrend(revenues)
      };
    } catch (error) {
      console.error('Sales forecasting training error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Predict next 7 days of sales
   */
  async forecastSales(tenantId, days = 7) {
    if (!this.isTrainedForecast) {
      await this.trainSalesForecasting(tenantId);
    }

    try {
      const predictions = [];
      const lastIndex = this.forecastModel ? this.forecastModel.points.length : 30;
      
      for (let i = 1; i <= days; i++) {
        const predicted = this.forecastModel ? 
          this.forecastModel.predict(lastIndex + i)[1] :
          this.maxRevenue || 1000;
        
        predictions.push({
          day: i,
          predictedRevenue: Math.round(Math.max(0, predicted) * 100) / 100
        });
      }
      
      return { success: true, forecast: predictions };
    } catch (error) {
      console.error('Sales forecast error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Customer Churn Prediction - Identify at-risk customers
   */
  async trainChurnPrediction(tenantId) {
    try {
      // Get customer activity data
      const query = `
        SELECT 
          c.id,
          COUNT(DISTINCT o.id) as order_count,
          AVG(o.total_amount) as avg_order_value,
          JULIANDAY('now') - JULIANDAY(MAX(o.created_at)) as days_since_last_order,
          JULIANDAY('now') - JULIANDAY(c.created_at) as customer_age_days,
          (SELECT COUNT(*) FROM visits WHERE customer_id = c.id) as visit_count
        FROM customers c
        LEFT JOIN orders o ON c.id = o.customer_id
        WHERE c.tenant_id = ?
        GROUP BY c.id
        HAVING order_count > 0
      `;
      
      const customers = await db.all(query, [tenantId]);
      
      if (customers.length < 10) {
        return { success: false, message: 'Need at least 10 customers with orders' };
      }

      // Prepare training data
      const trainingData = customers.map(c => {
        const isChurned = (c.days_since_last_order || 365) > 90 ? 1 : 0;
        
        return {
          orderCount: c.order_count,
          avgOrderValue: c.avg_order_value || 0,
          daysSinceLastOrder: c.days_since_last_order || 365,
          customerAge: c.customer_age_days || 1,
          visitCount: c.visit_count || 0,
          isChurned
        };
      });

      // Store training data for statistical predictions
      this.churnTrainingData = trainingData;
      
      this.isTrainedChurn = true;
      
      return { 
        success: true, 
        customersAnalyzed: customers.length,
        churnRate: trainingData.filter(d => d.isChurned === 1).length / customers.length
      };
    } catch (error) {
      console.error('Churn prediction training error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Predict churn probability for a customer
   */
  async predictChurn(customerId) {
    if (!this.isTrainedChurn) {
      const customer = await db.get('SELECT tenant_id FROM customers WHERE id = ?', [customerId]);
      if (customer) {
        await this.trainChurnPrediction(customer.tenant_id);
      }
    }

    try {
      const query = `
        SELECT 
          c.id,
          c.tenant_id,
          COUNT(DISTINCT o.id) as order_count,
          AVG(o.total_amount) as avg_order_value,
          JULIANDAY('now') - JULIANDAY(MAX(o.created_at)) as days_since_last_order,
          JULIANDAY('now') - JULIANDAY(c.created_at) as customer_age_days,
          (SELECT COUNT(*) FROM visits WHERE customer_id = c.id) as visit_count
        FROM customers c
        LEFT JOIN orders o ON c.id = o.customer_id
        WHERE c.id = ?
        GROUP BY c.id
      `;
      
      const customer = await db.get(query, [customerId]);
      
      if (!customer) {
        return { success: false, message: 'Customer not found' };
      }

      // Simple statistical churn prediction
      const daysSince = customer.days_since_last_order || 365;
      const orderCount = customer.order_count || 0;
      
      // Churn probability based on rules
      let churnProbability = 0;
      if (daysSince > 180) churnProbability += 0.5;
      else if (daysSince > 90) churnProbability += 0.3;
      else if (daysSince > 60) churnProbability += 0.1;
      
      if (orderCount < 2) churnProbability += 0.3;
      else if (orderCount < 5) churnProbability += 0.1;
      
      churnProbability = Math.min(1, churnProbability);
      
      return { 
        success: true,
        customerId,
        churnProbability: Math.round(churnProbability * 100),
        riskLevel: churnProbability > 0.7 ? 'HIGH' : churnProbability > 0.4 ? 'MEDIUM' : 'LOW',
        metrics: {
          orderCount: customer.order_count,
          daysSinceLastOrder: Math.round(customer.days_since_last_order || 0),
          avgOrderValue: customer.avg_order_value
        }
      };
    } catch (error) {
      console.error('Churn prediction error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Product Recommendation Engine
   */
  async recommendProducts(customerId, limit = 5) {
    try {
      // Get customer's purchase history
      const purchaseHistory = await db.all(`
        SELECT DISTINCT oi.product_id, p.category_id, p.price
        FROM order_items oi
        JOIN orders o ON oi.order_id = o.id
        JOIN products p ON oi.product_id = p.id
        WHERE o.customer_id = ?
        ORDER BY o.created_at DESC
        LIMIT 20
      `, [customerId]);

      if (purchaseHistory.length === 0) {
        // Return popular products for new customers
        return await this.getPopularProducts(limit);
      }

      // Get frequently bought together products
      const recommendations = await db.all(`
        SELECT 
          p.id,
          p.name,
          p.category_id,
          p.price,
          COUNT(*) as frequency
        FROM products p
        JOIN order_items oi ON p.id = oi.product_id
        JOIN orders o ON oi.order_id = o.id
        WHERE o.customer_id IN (
          SELECT DISTINCT customer_id 
          FROM orders 
          WHERE id IN (
            SELECT order_id 
            FROM order_items 
            WHERE product_id IN (${purchaseHistory.map(() => '?').join(',')})
          )
        )
        AND p.id NOT IN (${purchaseHistory.map(() => '?').join(',')})
        AND p.is_active = 1
        GROUP BY p.id
        ORDER BY frequency DESC, p.price DESC
        LIMIT ?
      `, [...purchaseHistory.map(p => p.product_id), ...purchaseHistory.map(p => p.product_id), limit]);

      return {
        success: true,
        recommendations,
        basis: 'collaborative_filtering'
      };
    } catch (error) {
      console.error('Product recommendation error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get popular products
   */
  async getPopularProducts(limit = 5) {
    try {
      const products = await db.all(`
        SELECT 
          p.id,
          p.name,
          p.category_id,
          p.price,
          COUNT(oi.id) as order_count
        FROM products p
        JOIN order_items oi ON p.id = oi.product_id
        WHERE p.is_active = 1
        GROUP BY p.id
        ORDER BY order_count DESC
        LIMIT ?
      `, [limit]);

      return {
        success: true,
        recommendations: products,
        basis: 'popularity'
      };
    } catch (error) {
      console.error('Popular products error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Detect trend in time series data
   */
  detectTrend(data) {
    if (data.length < 2) return 'insufficient_data';
    
    const indices = data.map((_, i) => i);
    const regressionData = indices.map((x, i) => [x, data[i]]);
    const result = regression.linear(regressionData);
    
    const slope = result.equation[0];
    
    if (slope > 0.1) return 'increasing';
    if (slope < -0.1) return 'decreasing';
    return 'stable';
  }

  /**
   * Get ML model status
   */
  getStatus() {
    return {
      salesForecast: this.isTrainedForecast ? 'trained' : 'not_trained',
      churnPrediction: this.isTrainedChurn ? 'trained' : 'not_trained',
      productRecommendation: 'ready'
    };
  }
}

module.exports = new MLService();
