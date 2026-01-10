// scripts/checkCustomerOrders.js
require('dotenv').config();
const { dbClient } = require('../services/config');

const TENANT_ID = 'a10aa26a-b5f9-4afe-87cc-70bfb4d1f6e6';
const PHONE = '96567709452@c.us';

async function checkOrders() {
    console.log('[Order Check] Checking orders for:', PHONE);
    
    // Get customer profile
    const { data: conversation, error: convError } = await dbClient
        .from('conversations')
        .select('id, customer_profile_id, end_user_phone')
        .eq('tenant_id', TENANT_ID)
        .eq('end_user_phone', PHONE)
        .single();
    
    if (convError) {
        console.error('[Order Check] Error fetching conversation:', convError.message);
        return;
    }
    
    console.log('[Order Check] Conversation:', JSON.stringify(conversation, null, 2));
    
    if (!conversation?.customer_profile_id) {
        console.error('[Order Check] No customer_profile_id in conversation!');
        return;
    }
    
    // Get customer profile details
    const { data: profile, error: profileError } = await dbClient
        .from('customer_profiles')
        .select('id, phone, email, created_at')
        .eq('id', conversation.customer_profile_id)
        .single();
    
    if (profileError) {
        console.error('[Order Check] Error fetching profile:', profileError.message);
    } else {
        console.log('[Order Check] Profile:', JSON.stringify(profile, null, 2));
    }
    
    // Count orders
    const { count, error: countError, data: orders } = await dbClient
        .from('orders')
        .select('id, status, total_amount, created_at')
        .eq('tenant_id', TENANT_ID)
        .eq('customer_profile_id', conversation.customer_profile_id);
    
    if (countError) {
        console.error('[Order Check] Error counting orders:', countError.message);
        return;
    }
    
    console.log('[Order Check] Total orders (all statuses):', orders?.length || 0);
    console.log('[Order Check] Orders:', JSON.stringify(orders, null, 2));
    
    // Count confirmed/completed orders
    const { count: confirmedCount } = await dbClient
        .from('orders')
        .select('*', { count: 'exact', head: true })
        .eq('tenant_id', TENANT_ID)
        .eq('customer_profile_id', conversation.customer_profile_id)
        .in('status', ['confirmed', 'completed']);
    
    console.log('[Order Check] Confirmed/Completed orders:', confirmedCount);
    console.log('[Order Check] Customer type:', confirmedCount > 0 ? 'RETURNING' : 'NEW');
}

checkOrders().catch(console.error);

