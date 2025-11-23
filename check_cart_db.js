require('dotenv').config();
const { supabase } = require('./config/database');

(async () => {
  const phone = '96567709452@c.us';
  const tenantId = 'a10aa26a-b5f9-4afe-87cc-70bfb4d1f6e6';
  
  console.log('Checking conversation and cart for:', phone);
  
  // First check if ANY conversations exist for this tenant
  const { data: allConvs } = await supabase
    .from('conversations')
    .select('id, end_user_phone')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(5);
  
  console.log('\nRecent conversations for tenant:', allConvs);
  
  const { data: conv, error: convError } = await supabase
    .from('conversations')
    .select('id, end_user_phone')
    .eq('end_user_phone', phone)
    .eq('tenant_id', tenantId)
    .maybeSingle();
  
  if (convError) {
    console.log('Conversation error:', convError);
    return;
  }
  
  if (convError) {
    console.log('Conversation error:', convError);
    return;
  }
  
  console.log('\nConversation:', conv);
  
  if (conv) {
    // Get cart first
    const { data: cart } = await supabase
      .from('carts')
      .select('id')
      .eq('conversation_id', conv.id)
      .maybeSingle();
    
    console.log('\nCart:', cart);
    
    if (cart) {
      const { data: items } = await supabase
        .from('cart_items')
        .select('id, product_id, quantity, carton_price_override')
        .eq('cart_id', cart.id);
      
      console.log('\nCart items:', JSON.stringify(items, null, 2));
    }
    
    // Check orders count
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
      
      console.log('\nOrders count:', count);
    }
  }
})();
