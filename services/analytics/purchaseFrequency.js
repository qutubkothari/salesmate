const { dbClient } = require('../../config/database');

/**
 * Analyzes customer's purchase frequency and patterns
 * Uses zoho_customer_id to link customer_profiles â†’ orders
 */
async function analyzePurchaseFrequency(customerProfileId) {
  try {
    console.log('[FREQUENCY] Analyzing for customer:', customerProfileId);

    // STEP 1: Get customer's zoho_customer_id
    const { data: customer, error: customerError } = await dbClient
      .from('customer_profiles')
      .select('zoho_customer_id, first_name')
      .eq('id', customerProfileId)
      .single();

    if (customerError || !customer || !customer.zoho_customer_id) {
      console.log('[FREQUENCY] Customer not found or no zoho_customer_id');
      return null;
    }

    console.log('[FREQUENCY] Found customer:', customer.first_name, 'Zoho ID:', customer.zoho_customer_id);

    // STEP 2: Get orders via zoho_customer_id
    const { data: orders, error } = await dbClient
      .from('orders')
      .select('id, created_at, total_amount, status')
      .eq('zoho_customer_id', customer.zoho_customer_id)
      .in('status', ['delivered', 'pending_payment'])
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[FREQUENCY] Error:', error);
      return null;
    }

    console.log('[FREQUENCY] Found', orders?.length || 0, 'orders');

    if (!orders || orders.length < 2) {
      console.log('[FREQUENCY] Not enough orders for frequency analysis');
      return null;
    }

    // STEP 3: Calculate time between orders
    const orderDates = orders.map(o => new Date(o.created_at)).sort((a, b) => a - b);
    const intervals = [];

    for (let i = 1; i < orderDates.length; i++) {
      const daysDiff = Math.floor((orderDates[i] - orderDates[i - 1]) / (1000 * 60 * 60 * 24));
      intervals.push(daysDiff);
    }

    // STEP 4: Calculate statistics
    const avgInterval = intervals.reduce((sum, val) => sum + val, 0) / intervals.length;
    const totalSpent = orders.reduce((sum, order) => sum + parseFloat(order.total_amount || 0), 0);
    const avgOrderValue = totalSpent / orders.length;

    // STEP 5: Predict next order
    const lastOrderDate = new Date(orders[0].created_at);
    const daysSinceLastOrder = Math.floor((new Date() - lastOrderDate) / (1000 * 60 * 60 * 24));
    const daysUntilNextOrder = Math.max(0, Math.round(avgInterval - daysSinceLastOrder));

    console.log('[FREQUENCY] Avg interval:', Math.round(avgInterval), 'days');
    console.log('[FREQUENCY] Days since last order:', daysSinceLastOrder);
    console.log('[FREQUENCY] Days until next order:', daysUntilNextOrder);

    return {
      totalOrders: orders.length,
      averageInterval: Math.round(avgInterval),
      lastOrderDate: lastOrderDate.toISOString(),
      daysSinceLastOrder,
      nextOrderPrediction: {
        daysUntilDue: daysUntilNextOrder,
        isDue: daysSinceLastOrder >= avgInterval * 0.9
      },
      spending: {
        totalSpent: Math.round(totalSpent),
        averageOrderValue: Math.round(avgOrderValue)
      }
    };

  } catch (error) {
    console.error('[FREQUENCY] Fatal error:', error);
    return null;
  }
}

module.exports = { analyzePurchaseFrequency };
