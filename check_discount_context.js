require('dotenv').config();
const { supabase } = require('./config/database');

(async () => {
  const phone = '96567709452@c.us';
  const tenantId = 'a10aa26a-b5f9-4afe-87cc-70bfb4d1f6e6';

  console.log('Checking discount context for:', phone);

  // Get conversation
  const { data: conv } = await supabase
    .from('conversations')
    .select('*')
    .eq('end_user_phone', phone)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (!conv) {
    console.log('No conversation found');
    return;
  }

  console.log('\n=== Conversation Data ===');
  console.log('ID:', conv.id);
  console.log('State:', conv.state);
  console.log('Context Data:', JSON.stringify(conv.context_data, null, 2));
  console.log('Last Quoted Products:', conv.last_quoted_products);

  // Get cart
  const { data: cart } = await supabase
    .from('carts')
    .select('id, cart_items(*, products(*))')
    .eq('conversation_id', conv.id)
    .maybeSingle();

  if (cart) {
    console.log('\n=== Cart Data ===');
    console.log('Cart ID:', cart.id);
    console.log('Cart Items:', JSON.stringify(cart.cart_items, null, 2));
  } else {
    console.log('\n=== No Cart Found ===');
  }

  // Check customer profile and orders
  const { data: profile } = await supabase
    .from('customer_profiles')
    .select('id')
    .eq('phone_number', phone)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (profile) {
    const { count } = await supabase
      .from('orders')
      .select('*', { count: 'exact', head: true })
      .eq('customer_profile_id', profile.id)
      .in('status', ['confirmed', 'completed']);

    console.log('\n=== Customer Profile ===');
    console.log('Profile ID:', profile.id);
    console.log('Orders Count:', count);
    console.log('Is Returning Customer:', count > 0);
  }
})();
