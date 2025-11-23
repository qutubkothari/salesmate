require('dotenv').config();
const { supabase } = require('./config/database');

(async () => {
  const phone = '96567709452@c.us';
  const tenantId = 'a10aa26a-b5f9-4afe-87cc-70bfb4d1f6e6';

  console.log('=== EXACT DISCOUNT HANDLER FLOW ===\n');

  // Step 1: Re-fetch conversation (line 22-27)
  console.log('[DISCOUNT_HANDLER] Fetching fresh conversation...');
  const { data: freshConv, error: convError } = await supabase
    .from('conversations')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('end_user_phone', phone)
    .single();

  if (convError) {
    console.error('[DISCOUNT_HANDLER] Error fetching conversation:', convError.message);
    return;
  }

  if (!freshConv) {
    console.log('[DISCOUNT_HANDLER] No conversation found');
    return;
  }

  console.log('✅ Conversation found:', freshConv.id);
  const conversation = freshConv;

  // Step 2: Check if returning customer (line 43-67)
  let isReturningCustomer = false;
  const customerProfileId = conversation.customer_profile_id;

  if (!customerProfileId) {
    console.log('[DISCOUNT_HANDLER] No customer_profile_id, assuming NEW');
  } else {
    const { count, error: ordersError } = await supabase
      .from('orders')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('customer_profile_id', customerProfileId)
      .in('status', ['confirmed', 'completed']);

    if (ordersError) {
      console.error('[DISCOUNT_HANDLER] Error querying orders:', ordersError.message);
    } else {
      isReturningCustomer = count > 0;
      console.log('[DISCOUNT_HANDLER] Customer type:', isReturningCustomer ? 'RETURNING' : 'NEW', '- Orders:', count);
    }
  }

  if (isReturningCustomer) {
    console.log('\n⚠️ RETURNING customer - would route to human agent');
    return;
  }

  console.log('\n✅ NEW customer - continuing with discount logic\n');

  // Step 3: Build context (line 95-155)
  let totalCartons = 0;
  let cartTotal = 0;
  let quotedProducts = [];

  // PRIORITY 1: Get quoted products from conversation
  console.log('[DISCOUNT_HANDLER] Checking last_quoted_products:', conversation.last_quoted_products);
  if (conversation.last_quoted_products) {
    try {
      quotedProducts = typeof conversation.last_quoted_products === 'string'
        ? JSON.parse(conversation.last_quoted_products)
        : conversation.last_quoted_products;

      if (quotedProducts && quotedProducts.length > 0) {
        totalCartons = quotedProducts.reduce((sum, p) => sum + (parseInt(p.quantity) || 0), 0);
        cartTotal = quotedProducts.reduce((sum, p) => sum + ((parseFloat(p.price) || 0) * (parseInt(p.quantity) || 1)), 0);
        console.log('[DISCOUNT_HANDLER] Using quoted products:', quotedProducts.length, 'items');
      }
    } catch (e) {
      console.warn('[DISCOUNT_HANDLER] Error parsing quoted products:', e.message);
    }
  }

  // PRIORITY 2: If no quoted products, check cart
  if (quotedProducts.length === 0) {
    console.log('[DISCOUNT_HANDLER] No quoted products, checking cart...');
    console.log('[DISCOUNT_HANDLER] Querying cart for conversation_id:', conversation.id);

    const { data: cart, error: cartError } = await supabase
      .from('carts')
      .select('id, cart_items(*, products(*))')
      .eq('conversation_id', conversation.id)
      .single();

    console.log('[DISCOUNT_HANDLER] Cart query result:');
    console.log('   - Error:', cartError ? cartError.message : 'None');
    console.log('   - Cart found:', cart ? 'Yes' : 'No');
    console.log('   - Cart ID:', cart?.id);
    console.log('   - Cart items:', cart?.cart_items?.length || 0);

    if (cart && cart.cart_items && cart.cart_items.length > 0) {
      console.log('✅ [DISCOUNT_HANDLER] Found', cart.cart_items.length, 'items in cart');

      // Convert cart items to quoted products format
      quotedProducts = cart.cart_items.map(item => ({
        productId: item.product_id,
        productCode: item.products?.name?.match(/\d+[x*]\d+/)?.[0] || item.products?.name || 'UNKNOWN',
        productName: item.products?.name || 'Product',
        price: item.products?.price || item.unit_price,
        quantity: item.quantity,
        unitsPerCarton: item.products?.units_per_carton || 1500
      }));

      totalCartons = cart.cart_items.reduce((sum, item) => sum + item.quantity, 0);
      cartTotal = cart.cart_items.reduce((sum, item) =>
        sum + ((item.products?.price || item.unit_price) * item.quantity), 0
      );

      console.log('✅ [DISCOUNT_HANDLER] Cart-based context:', { totalCartons, cartTotal });
      console.log('✅ Quoted products:', quotedProducts);
    } else {
      console.log('❌ [DISCOUNT_HANDLER] No cart items found - customer needs to add products first');
      console.log('\n❌ WOULD RETURN: "I\'d be happy to discuss discounts! However..."');
      return;
    }
  }

  console.log('\n✅✅✅ SUCCESS: Would proceed to call handleDiscountNegotiation with context');
  console.log('Context:', {
    totalCartons,
    cartTotal,
    quotedProductsCount: quotedProducts.length
  });
})();
