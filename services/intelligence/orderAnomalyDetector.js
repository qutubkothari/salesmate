const { dbClient } = require('../config');
const { analyzeProductAffinity } = require('../analytics/productAffinity');

/**
 * Detect anomalies in current order compared to customer's usual patterns
 */
async function detectOrderAnomalies(customerProfileId, orderDetails, tenantId, userLanguage = 'en') {
  try {
    console.log('[ANOMALY] Analyzing order for customer:', customerProfileId);
    
    // Get what they usually buy
    const affinity = await analyzeProductAffinity(customerProfileId);
    
    // Get regular products (bought 3+ times)
    const regularProducts = affinity.regularProducts || [];
    
    if (!regularProducts || regularProducts.length === 0) {
      console.log('[ANOMALY] No purchase history - new customer');
      return {
        hasAnomalies: false,
        isNewCustomer: true
      };
    }

    if (regularProducts.length === 0) {
      console.log('[ANOMALY] Not enough history for pattern detection');
      return { hasAnomalies: false };
    }
    
    // Get current order product IDs
    let currentProductIds = [];
    if (orderDetails.orders && Array.isArray(orderDetails.orders)) {
      // Multi-product order
      for (const order of orderDetails.orders) {
        const productCode = order.productCode || order.productName;
        const { data: product } = await dbClient
          .from('products')
          .select('id')
          .eq('tenant_id', tenantId)
          .ilike('name', `%${productCode}%`)
          .single();
        if (product) {
          currentProductIds.push(product.id);
        }
      }
    } else {
      // Single product order
      const productCode = orderDetails.productCode || orderDetails.productName;
      const { data: product } = await dbClient
        .from('products')
        .select('id')
        .eq('tenant_id', tenantId)
        .ilike('name', `%${productCode}%`)
        .single();
      if (product) {
        currentProductIds.push(product.id);
      }
    }
    
    // Find missing regular products
    const missingRegularProductIds = regularProducts
      .filter(p => !currentProductIds.includes(p.product_id))
      .map(p => p.product_id);
    
    if (missingRegularProductIds.length === 0) {
      console.log('[ANOMALY] All regular products included');
      return { hasAnomalies: false };
    }
    
    // Get product details
    const { data: missingProducts } = await dbClient
      .from('products')
      .select('id, name, price')
      .in('id', missingRegularProductIds)
      .eq('tenant_id', tenantId);
    
    if (!missingProducts || missingProducts.length === 0) {
      return { hasAnomalies: false };
    }
    
    // Build natural suggestion based on language
    const productList = missingProducts.map(p => p.name).join(', ');
    const orderingProduct = orderDetails.productName || orderDetails.productCode;
    let suggestion;
    
    if (userLanguage === 'hinglish' || userLanguage === 'hi') {
      // Natural Hinglish suggestions
      if (missingProducts.length === 1) {
        suggestion = `Aap ${orderingProduct} order kar rahe hain. Usually aap ${productList} bhi lete hain. Wo bhi add karu?`;
      } else {
        suggestion = `Aap ${orderingProduct} order kar rahe hain. Usually aap ${productList} bhi lete hain. Wo sab bhi add karu?`;
      }
    } else {
      // English suggestions
      if (missingProducts.length === 1) {
        suggestion = `I see you're ordering ${orderingProduct}. You usually also get ${productList}. Want to add that too?`;
      } else {
        suggestion = `I see you're ordering ${orderingProduct}. You usually also get ${productList}. Want to add those too?`;
      }
    }
    
    console.log('[ANOMALY] Found missing regular products:', productList);
    
    return {
      hasAnomalies: true,
      missingUsualProducts: missingProducts,
      suggestion,
      shouldPrompt: true
    };
  } catch (error) {
    console.error('[ANOMALY] Error detecting anomalies:', error);
    return { hasAnomalies: false };
  }
}

/**
 * Detect unusual quantity (much higher or lower than usual)
 */
async function detectQuantityAnomaly(customerProfileId, productId, requestedQuantity) {
  try {
    const { data: pastOrders } = await dbClient
      .from('order_items')
      .select('quantity, orders(customer_profile_id)')
      .eq('orders.customer_profile_id', customerProfileId)
      .eq('product_id', productId)
      .limit(10);
    
    if (!pastOrders || pastOrders.length < 2) {
      return { hasAnomaly: false }; // Not enough history
    }
    
    const quantities = pastOrders.map(o => o.quantity);
    const avgQuantity = quantities.reduce((a, b) => a + b, 0) / quantities.length;
    
    // Check if requested is significantly different (more than 50% deviation)
    const deviation = Math.abs(requestedQuantity - avgQuantity) / avgQuantity;
    
    if (deviation > 0.5) {
      const isHigher = requestedQuantity > avgQuantity;
      const message = isHigher
        ? `Just confirming - you usually order around ${Math.round(avgQuantity)} cartons, but you're ordering ${requestedQuantity} this time. Is that correct?`
        : `I notice you usually order around ${Math.round(avgQuantity)} cartons. You're ordering ${requestedQuantity} this time. Is this what you need?`;
      
      return {
        hasAnomaly: true,
        usualQuantity: Math.round(avgQuantity),
        requestedQuantity,
        message
      };
    }
    
    return { hasAnomaly: false };
  } catch (error) {
    console.error('[ANOMALY] Error detecting quantity anomaly:', error);
    return { hasAnomaly: false };
  }
}

module.exports = {
  detectOrderAnomalies,
  detectQuantityAnomaly,
  detectCustomerAnomalies: detectOrderAnomalies
};
