require('dotenv').config();
const { supabase } = require('./config/database');

(async () => {
  const phone = '96567709452@c.us';
  const tenantId = 'a10aa26a-b5f9-4afe-87cc-70bfb4d1f6e6';

  console.log('Testing discount handler logic...\n');

  // Get conversation
  const { data: conversation } = await supabase
    .from('conversations')
    .select('*')
    .eq('end_user_phone', phone)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (!conversation) {
    console.log('No conversation found');
    return;
  }

  console.log('Conversation ID:', conversation.id);
  console.log('Last Quoted Products:', conversation.last_quoted_products);

  // Simulate discount handler logic
  let quotedProducts = [];
  let totalCartons = 0;
  let cartTotal = 0;

  // PRIORITY 1: Check last_quoted_products
  if (conversation.last_quoted_products) {
    try {
      quotedProducts = typeof conversation.last_quoted_products === 'string'
        ? JSON.parse(conversation.last_quoted_products)
        : conversation.last_quoted_products;
      console.log('\n✅ Using last_quoted_products:', quotedProducts);
    } catch (e) {
      console.warn('Failed to parse last_quoted_products:', e.message);
    }
  }

  // PRIORITY 2: Check cart
  if (quotedProducts.length === 0) {
    console.log('\n⚠️ No last_quoted_products, checking cart...');

    const { data: cart } = await supabase
      .from('carts')
      .select('id, cart_items(*, products(*))')
      .eq('conversation_id', conversation.id)
      .maybeSingle();

    if (cart && cart.cart_items && cart.cart_items.length > 0) {
      console.log('✅ Found', cart.cart_items.length, 'items in cart');

      // NEW LOGIC: Extract product code from name
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

      console.log('\n✅ Cart-based context:');
      console.log('  - Total Cartons:', totalCartons);
      console.log('  - Cart Total: ₹' + cartTotal);
      console.log('  - Quoted Products:');
      quotedProducts.forEach(p => {
        console.log(`    • ${p.productCode} (${p.productName}): ${p.quantity} cartons @ ₹${p.price}/carton`);
      });
    } else {
      console.log('❌ No cart items found');
    }
  }

  // Build context like the discount handler does
  if (quotedProducts.length > 0) {
    const conversationContext = {
      totalCartons: totalCartons || 10,
      cartTotal: cartTotal,
      isReturningCustomer: false,
      averagePrice: cartTotal > 0 ? cartTotal / totalCartons : 2400,
      averageUnitsPerCarton: 1500,
      products: quotedProducts.map(qp => ({
        productCode: qp.productCode,
        productName: qp.productName,
        price: qp.price,
        unitsPerCarton: qp.unitsPerCarton || 1500,
        quantity: qp.quantity || 10
      })),
      quotedProducts: quotedProducts
    };

    console.log('\n✅ Context built successfully!');
    console.log('Products in context:', conversationContext.products.map(p => p.productCode));
  }
})();
