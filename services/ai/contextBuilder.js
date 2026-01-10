
const { dbClient } = require('../../config/database');

/**
 * Build comprehensive context for AI responses
const pool = require('../../config/database');

/**
 * Build comprehensive context for AI responses
 * Gathers customer profile, history, patterns, and anomalies
 */
class ContextBuilder {
  /**
   * Build complete context for a customer conversation
   */
  async buildContext(tenantId, customerProfileId, conversationId) {
    try {
      const context = {
        customer: await this.getCustomerProfile(customerProfileId),
        conversation: await this.getConversationHistory(conversationId),
        patterns: await this.getPurchasePatterns(customerProfileId),
        affinity: await this.getProductAffinity(customerProfileId),
        recentOrders: await this.getRecentOrders(customerProfileId),
        anomalies: await this.getCurrentAnomalies(customerProfileId),
        timestamp: new Date().toISOString()
      };
      return context;
    } catch (error) {
      console.error('Error building context:', error);
      throw error;
    }
  }

  /**
   * Get customer profile with tier classification
   */
  async getCustomerProfile(customerProfileId) {
    // Fetch customer profile
    const { data: customer, error: customerError } = await dbClient
      .from('customer_profiles')
      .select('id, first_name, business_type, customer_tier, created_at')
      .eq('id', customerProfileId)
      .single();
    if (customerError) throw customerError;

    // Fetch orders for aggregation
    // First, get the email from the customer profile
    const email = customer?.customer_email || customerProfileId;
    const { data: orders, error: ordersError } = await dbClient
      .from('orders')
      .select('total_amount, created_at')
      .eq('customer_email', email);
    if (ordersError) throw ordersError;

    // Aggregate values
    const lifetime_value = orders.reduce((sum, o) => sum + (o.total_amount || 0), 0);
    const total_orders = orders.length;
    const last_order_date = orders.length > 0 ? orders.reduce((max, o) => o.created_at > max ? o.created_at : max, orders[0].created_at) : null;
    let customer_tier = 'New';
    if (lifetime_value >= 100000) customer_tier = 'VIP';
    else if (lifetime_value >= 50000) customer_tier = 'Premium';
    else if (lifetime_value >= 20000) customer_tier = 'Regular';

    return {
      ...customer,
      lifetime_value,
      total_orders,
      last_order_date,
      customer_tier
    };
  }

  /**
   * Get last N messages from conversation
   */
  async getConversationHistory(conversationId, limit = 10) {
    const { data: memories, error } = await dbClient
      .from('conversation_memories')
      .select('memory_type, content, created_at')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    // Map memory_type to role
    return (memories || []).reverse().map(m => ({
      role: m.memory_type,
      content: m.content,
      created_at: m.created_at
    }));
  }

  /**
   * Get customer purchase patterns
   */
  async getPurchasePatterns(customerProfileId) {
    const { data: patterns, error } = await dbClient
      .from('customer_purchase_patterns')
      .select('avg_days_between_orders, last_order_date, confidence_score, days_overdue')
      .eq('customer_profile_id', customerProfileId)
      .maybeSingle();
    if (error) throw error;
    return patterns || null;
  }

  /**
   * Get customer product affinity (regular products)
   */
  async getProductAffinity(customerProfileId) {
    const { data: affinity, error } = await dbClient
      .from('customer_product_affinity')
      .select('product_id, purchase_frequency, avg_quantity_per_order, last_purchase_date, days_since_last_purchase, is_regular_product')
      .eq('customer_profile_id', customerProfileId)
      .eq('is_regular_product', true)
      .order('days_since_last_purchase', { ascending: false });
    if (error) throw error;
    // Fetch product details for each affinity row
    const results = [];
    for (const a of affinity || []) {
      let name = null, code = null;
      if (a.product_id) {
        const { data: product, error: prodError } = await dbClient
          .from('products')
          .select('name, code')
          .eq('id', a.product_id)
          .single();
        if (!prodError && product) {
          name = product.name;
          code = product.code;
        }
      }
      results.push({
        ...a,
        name,
        code
      });
    }
    return results;
  }

  /**
   * Get recent orders (last 3)
   */
  async getRecentOrders(customerProfileId) {
    const { data: orders, error } = await dbClient
      .from('orders')
      .select('id, created_at, total_amount, status, order_items(quantity, price_at_time_of_purchase, unit_price_before_tax, product_id)')
      .eq('customer_email', customerProfileId)
      .order('created_at', { ascending: false })
      .limit(3);
    if (error) throw error;
    // For each order item, fetch product name/code
    return (orders || []).map(o => ({
      ...o,
      items: (o.order_items || []).map(async i => {
        let name = null, code = null;
        if (i.product_id) {
          const { data: product, error: prodError } = await dbClient
            .from('products')
            .select('name, code')
            .eq('id', i.product_id)
            .single();
          if (!prodError && product) {
            name = product.name;
            code = product.code;
          }
        }
        return {
          product_name: name,
          product_code: code,
          quantity: i.quantity,
          price_at_time_of_purchase: i.price_at_time_of_purchase,
          unit_price_before_tax: i.unit_price_before_tax
        };
      })
    }));
  }

  /**
   * Get current anomalies for customer
   */
  async getCurrentAnomalies(customerProfileId) {
    // This will call your anomalyDetector
    const anomalyDetector = require('../intelligence/orderAnomalyDetector');
    try {
      // Pass dummy orderDetails and tenantId for context-only anomaly detection
      const anomalies = await anomalyDetector.detectOrderAnomalies(customerProfileId, {}, null, 'en');
      return anomalies || [];
    } catch (error) {
      console.error('Error detecting anomalies:', error);
      return [];
    }
  }

  /**
   * Build lightweight context (for quick responses)
   */
  async buildLightweightContext(customerProfileId) {
    return {
      customer: await this.getCustomerProfile(customerProfileId),
      patterns: await this.getPurchasePatterns(customerProfileId),
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Format context for AI consumption
   */
  formatForAI(context) {
    let formatted = `Customer Profile:\n`;
    formatted += `- Name: ${context.customer.name}\n`;
    formatted += `- Tier: ${context.customer.customer_tier}\n`;
    formatted += `- Lifetime Value: â‚¹${context.customer.lifetime_value}\n`;
    formatted += `- Total Orders: ${context.customer.total_orders}\n`;
    if (context.patterns) {
      formatted += `\nPurchase Pattern:\n`;
      formatted += `- Orders every ${context.patterns.avg_days_between_orders} days\n`;
      formatted += `- Last order: ${context.patterns.last_order_date}\n`;
      if (context.patterns.days_overdue > 0) {
        formatted += `- âš ï¸ Overdue by ${context.patterns.days_overdue} days\n`;
      }
    }
    if (context.affinity && context.affinity.length > 0) {
      formatted += `\nRegular Products:\n`;
      context.affinity.forEach(product => {
        formatted += `- ${product.name} (${product.code}): ${product.avg_quantity} units, last bought ${product.days_since_last_purchase} days ago\n`;
      });
    }
    if (context.anomalies && context.anomalies.length > 0) {
      formatted += `\nCurrent Anomalies:\n`;
      context.anomalies.forEach(anomaly => {
        formatted += `- ${anomaly.type}: ${anomaly.description}\n`;
      });
    }
    return formatted;
  }
}

module.exports = new ContextBuilder();
