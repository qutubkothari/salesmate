// services/analytics/customerInsights.js
const { dbClient } = require('../config');
const { analyzePurchaseFrequency } = require('./purchaseFrequency');
const { analyzeProductAffinity } = require('./productAffinity');

/**
 * Analyze customer order and suggest missing usual products
 */
async function analyzeOrderAndSuggest(customerProfileId, currentOrderItems, tenantId) {
  try {
    console.log('[INSIGHTS] Analyzing order for customer:', customerProfileId);
    
    // Get product affinity (what they usually buy)
    const affinity = await analyzeProductAffinity(customerProfileId);
    
    if (!affinity || affinity.length === 0) {
      console.log('[INSIGHTS] No purchase history for suggestions');
      return { hasSuggestions: false };
    }
    
    // Find regular products (bought 3+ times)
    const regularProducts = affinity.filter(p => p.is_regular_product);
    
    if (regularProducts.length === 0) {
      console.log('[INSIGHTS] No regular products found');
      return { hasSuggestions: false };
    }
    
    // Get product IDs from current order
    const currentProductIds = currentOrderItems.map(item => item.product_id);
    
    // Find missing regular products
    const missingProductIds = regularProducts
      .filter(p => !currentProductIds.includes(p.product_id))
      .map(p => p.product_id);
    
    if (missingProductIds.length === 0) {
      console.log('[INSIGHTS] All regular products included in order');
      return { hasSuggestions: false };
    }
    
    // Get product details
    const { data: products } = await dbClient
      .from('products')
      .select('id, name, price')
      .in('id', missingProductIds)
      .eq('tenant_id', tenantId);
    
    if (!products || products.length === 0) {
      return { hasSuggestions: false };
    }
    
    // Build suggestion message
    const productNames = products.map(p => p.name).join(', ');
    
    console.log('[INSIGHTS] Suggesting missing products:', productNames);
    
    return {
      hasSuggestions: true,
      missingProducts: products,
      suggestion: `By the way, I noticed you usually also order ${productNames}. Would you like to add ${products.length === 1 ? 'it' : 'them'} to your next order?`
    };
    
  } catch (error) {
    console.error('[INSIGHTS] Error analyzing order:', error);
    return { hasSuggestions: false };
  }
}

/**
 * Check if customer is due for reorder based on purchase frequency
 */
async function checkReorderDue(customerProfileId) {
  try {
    const frequency = await analyzePurchaseFrequency(customerProfileId);
    
    if (!frequency) {
      return { isDue: false };
    }
    
    const daysSinceLastOrder = Math.floor(
      (Date.now() - new Date(frequency.last_order_date)) / (1000 * 60 * 60 * 24)
    );
    
    // Check if within 5 days of expected reorder
    const daysUntilExpected = Math.floor(
      (new Date(frequency.expected_next_order) - Date.now()) / (1000 * 60 * 60 * 24)
    );
    
    const isDue = daysUntilExpected <= 5 && daysUntilExpected >= -2;
    
    return {
      isDue,
      daysSinceLastOrder,
      avgDaysBetweenOrders: frequency.avg_days_between_orders,
      expectedNextOrder: frequency.expected_next_order
    };
    
  } catch (error) {
    console.error('[INSIGHTS] Error checking reorder due:', error);
    return { isDue: false };
  }
}

module.exports = {
  analyzeOrderAndSuggest,
  checkReorderDue
};
