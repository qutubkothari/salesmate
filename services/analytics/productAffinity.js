const { dbClient } = require('../../config/database');

/**
 * Analyzes product purchasing patterns for a customer
 * Uses: customer_profiles.zoho_customer_id â†’ orders.zoho_customer_id â†’ order_items.order_id â†’ products.name
 */
async function analyzeProductAffinity(customerProfileId) {
  try {
    console.log('[AFFINITY] Analyzing for customer:', customerProfileId);

    // STEP 1: Get customer's zoho_customer_id
    const { data: customer, error: customerError } = await dbClient
      .from('customer_profiles')
      .select('zoho_customer_id, first_name')
      .eq('id', customerProfileId)
      .single();

    if (customerError || !customer || !customer.zoho_customer_id) {
      console.log('[AFFINITY] Customer not found or no zoho_customer_id');
      return { regularProducts: [], occasionalProducts: [], affinityPairs: [] };
    }

    console.log('[AFFINITY] Found customer:', customer.first_name, 'Zoho ID:', customer.zoho_customer_id);

    // STEP 2: Get all order items for this customer via zoho_customer_id
    // Join with products table to get product names
    // Include delivered and pending_payment orders
    const { data: orderItems, error } = await dbClient
      .from('order_items')
      .select(`
        order_id,
        quantity,
        price_at_time_of_purchase,
        products:product_id (
          name,
          sku
        ),
        orders!inner(zoho_customer_id, status)
      `)
      .eq('orders.zoho_customer_id', customer.zoho_customer_id)
      .in('orders.status', ['delivered', 'pending_payment']);

    if (error) {
      console.error('[AFFINITY] Error:', error);
      return { regularProducts: [], occasionalProducts: [], affinityPairs: [] };
    }

    console.log('[AFFINITY] Found', orderItems?.length || 0, 'order items');

    if (!orderItems || orderItems.length === 0) {
      return { regularProducts: [], occasionalProducts: [], affinityPairs: [] };
    }

    // STEP 3: Analyze product frequency
    const productFrequency = {};
    const productOrders = {};

    orderItems.forEach(item => {
      // Get product name from the joined products table
      const productName = item.products?.name || 'Unknown Product';
      
      if (!productFrequency[productName]) {
        productFrequency[productName] = 0;
        productOrders[productName] = new Set();
      }
      
      productFrequency[productName] += item.quantity;
      productOrders[productName].add(item.order_id);
    });

    // STEP 4: Calculate statistics
    const totalOrders = new Set(orderItems.map(item => item.order_id)).size;
    const regularThreshold = Math.max(2, Math.ceil(totalOrders * 0.4));

    const regularProducts = [];
    const occasionalProducts = [];

    Object.entries(productFrequency).forEach(([productName, totalQuantity]) => {
      const timesOrdered = productOrders[productName].size;
      const purchaseFrequency = (timesOrdered / totalOrders) * 100;

      const productData = {
        name: productName,
        timesOrdered,
        purchaseFrequency: Math.round(purchaseFrequency),
        totalQuantity
      };

      if (timesOrdered >= regularThreshold) {
        regularProducts.push(productData);
      } else {
        occasionalProducts.push(productData);
      }
    });

    // STEP 5: Find product affinities (products bought together)
    const affinityPairs = [];
    const orderProductMap = {};

    orderItems.forEach(item => {
      const orderId = item.order_id;
      const productName = item.products?.name || 'Unknown Product';
      
      if (!orderProductMap[orderId]) {
        orderProductMap[orderId] = [];
      }
      orderProductMap[orderId].push(productName);
    });

    Object.values(orderProductMap).forEach(products => {
      // Remove duplicates in same order
      const uniqueProducts = [...new Set(products)];
      
      for (let i = 0; i < uniqueProducts.length; i++) {
        for (let j = i + 1; j < uniqueProducts.length; j++) {
          const pair = [uniqueProducts[i], uniqueProducts[j]].sort().join(' + ');
          const existing = affinityPairs.find(p => p.pair === pair);
          
          if (existing) {
            existing.frequency++;
          } else {
            affinityPairs.push({ pair, frequency: 1 });
          }
        }
      }
    });

    console.log('[AFFINITY] Regular products:', regularProducts.length);
    console.log('[AFFINITY] Occasional products:', occasionalProducts.length);
    console.log('[AFFINITY] Affinity pairs:', affinityPairs.length);

    return {
      regularProducts: regularProducts.sort((a, b) => b.timesOrdered - a.timesOrdered),
      occasionalProducts: occasionalProducts.sort((a, b) => b.timesOrdered - a.timesOrdered),
      affinityPairs: affinityPairs.sort((a, b) => b.frequency - a.frequency)
    };

  } catch (error) {
    console.error('[AFFINITY] Fatal error:', error);
    return { regularProducts: [], occasionalProducts: [], affinityPairs: [] };
  }
}

module.exports = { analyzeProductAffinity };
