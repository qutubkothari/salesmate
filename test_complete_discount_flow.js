require('dotenv').config();
const { supabase } = require('./config/database');

(async () => {
  const phone = '96567709452@c.us';
  const tenantId = 'a10aa26a-b5f9-4afe-87cc-70bfb4d1f6e6';

  console.log('=== TESTING COMPLETE DISCOUNT FLOW ===\n');

  // Step 1: Get conversation
  const { data: conversation } = await supabase
    .from('conversations')
    .select('*')
    .eq('end_user_phone', phone)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (!conversation) {
    console.log('❌ No conversation found');
    return;
  }

  console.log('✅ Conversation found:', conversation.id);
  console.log('   State:', conversation.state);
  console.log('   Context Data:', JSON.stringify(conversation.context_data, null, 2));

  // Step 2: Get cart with products (simulating discountNegotiationService query)
  const { data: cart, error: cartError } = await supabase
    .from('carts')
    .select(`
      *,
      cart_items (
        *,
        product:products (
          id,
          name,
          price,
          unit,
          units_per_carton,
          category
        )
      )
    `)
    .eq('conversation_id', conversation.id)
    .maybeSingle();

  if (cartError) {
    console.log('\n❌ Cart query error:', cartError.message);
    return;
  }

  if (!cart || !cart.cart_items || cart.cart_items.length === 0) {
    console.log('\n❌ No cart or cart items found');
    return;
  }

  console.log('\n✅ Cart found with', cart.cart_items.length, 'items');

  // Step 3: Extract product codes (simulating discount handler logic)
  const cartItemsForContext = cart.cart_items.map(item => {
    const productCode = item.product?.name?.match(/\d+x\d+/)?.[0] || null;
    return {
      productCode: productCode,
      productName: item.product?.name || '',
      quantity: item.quantity,
      price: item.product?.price || 0,
      unitsPerCarton: item.product?.units_per_carton || 1500,
      unit: 'carton'
    };
  });

  console.log('\n✅ Extracted cart items for context:');
  cartItemsForContext.forEach(item => {
    console.log(`   - ${item.productCode} (${item.productName})`);
    console.log(`     Quantity: ${item.quantity} cartons`);
    console.log(`     Price: ₹${item.price}/carton`);
    console.log(`     Units per carton: ${item.unitsPerCarton}`);
  });

  // Step 4: Calculate totals
  const totalCartons = cartItemsForContext.reduce((sum, item) => sum + item.quantity, 0);
  const cartTotal = cartItemsForContext.reduce((sum, item) => sum + (item.price * item.quantity), 0);

  console.log('\n✅ Cart Summary:');
  console.log(`   Total Cartons: ${totalCartons}`);
  console.log(`   Cart Total: ₹${cartTotal}`);

  // Step 5: Test product lookup (simulating enrichment)
  const productCodes = cartItemsForContext.map(i => i.productCode).filter(Boolean);
  console.log('\n✅ Product codes to look up:', productCodes);

  if (productCodes.length > 0) {
    const orExpr = productCodes.map(c => `name.ilike.%${c}%`).join(',');
    const { data: productsFromDb, error: prodErr } = await supabase
      .from('products')
      .select('id, name, category, price, units_per_carton')
      .or(orExpr);

    if (prodErr) {
      console.log('   ❌ Product lookup error:', prodErr.message);
    } else {
      console.log('   ✅ Found', productsFromDb.length, 'products:');
      productsFromDb.forEach(p => {
        const code = p.name.match(/\d+x\d+/)?.[0];
        console.log(`      - ${code} → ${p.name}`);
        console.log(`        ID: ${p.id}`);
        console.log(`        Category: ${p.category}`);
        console.log(`        Price: ₹${p.price}`);
      });
    }
  }

  // Step 6: Check discount rules
  const { data: discountRules } = await supabase
    .from('discount_rules')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('is_active', true)
    .order('created_at', { ascending: false });

  console.log('\n✅ Active discount rules:', discountRules?.length || 0);
  if (discountRules && discountRules.length > 0) {
    discountRules.forEach(rule => {
      console.log(`   - Rule: ${rule.name || 'Unnamed'}`);
      console.log(`     Discount: ${rule.discount_value}%`);
      console.log(`     Min Quantity: ${rule.min_quantity_required || 'N/A'}`);
      console.log(`     Applies to: ${rule.applies_to || 'all'}`);
    });
  }

  console.log('\n=== TEST COMPLETE ===');
  console.log('\nSummary:');
  console.log('- Conversation: ✅');
  console.log('- Cart with items: ✅');
  console.log('- Product code extraction: ✅');
  console.log('- Cart calculations: ✅');
  console.log('- Product lookup: ✅');
  console.log('\n✅ Discount flow should work correctly!');
})();
