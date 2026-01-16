// services/intelligentFollowUpService.js
/**
 * Intelligent Follow-up Service
 * Automatically schedules follow-ups based on customer behavior, lead scoring, and conversation patterns
 */

const { dbClient } = require('./config');
const { scheduleFollowUp } = require('./followUpSchedulerService');

// Follow-up intervals based on lead temperature (in hours)
const FOLLOWUP_INTERVALS = {
  'Hot': 24,   // Hot leads: follow up in 24 hours
  'Warm': 48,  // Warm leads: follow up in 48 hours
  'Cold': 72   // Cold leads: follow up in 72 hours
};

// Minimum time since last interaction before creating follow-up (in hours)
const MIN_INACTIVITY_HOURS = 2;

/**
 * Check all conversations and create intelligent follow-ups
 */
async function processIntelligentFollowUps() {
    console.log('[IntelligentFollowUp] Starting intelligent follow-up processing...');
    
    try {
        // Get all tenants
        const { data: tenants, error: tenantsError } = await dbClient
            .from('tenants')
            .select('id');
        
        if (tenantsError) throw tenantsError;
        
        for (const tenant of tenants || []) {
            await processTenantsFollowUps(tenant.id);
        }
        
        console.log('[IntelligentFollowUp] Intelligent follow-up processing completed');
    } catch (error) {
        console.error('[IntelligentFollowUp] Error processing follow-ups:', error);
    }
}

/**
 * Process follow-ups for a specific tenant
 */
async function processTenantsFollowUps(tenantId) {
    try {
        // Get conversations that need follow-up
        const candidates = await getFollowUpCandidates(tenantId);
        
        console.log(`[IntelligentFollowUp] Found ${candidates.length} follow-up candidates for tenant ${tenantId}`);
        
        for (const candidate of candidates) {
            await createIntelligentFollowUp(tenantId, candidate);
        }
    } catch (error) {
        console.error(`[IntelligentFollowUp] Error processing tenant ${tenantId}:`, error);
    }
}

/**
 * Get conversations that are candidates for follow-up
 */
async function getFollowUpCandidates(tenantId) {
    try {
        const minInactivityTime = new Date(Date.now() - MIN_INACTIVITY_HOURS * 60 * 60 * 1000);
        
        // Get conversations with:
        // 1. Recent activity (within last 7 days)
        // 2. Some inactivity (at least MIN_INACTIVITY_HOURS since last message)
        // 3. Lead score assigned
        // 4. No pending follow-up already scheduled
        const { data: conversations, error } = await dbClient
            .from('conversations_new')
            .select(`
                id,
                end_user_phone,
                lead_score,
                updated_at,
                created_at
            `)
            .eq('tenant_id', tenantId)
            .not('lead_score', 'is', null)
            .lt('updated_at', minInactivityTime.toISOString())
            .gte('updated_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());
        
        if (error) throw error;
        
        // Filter out conversations that already have pending follow-ups
        const candidates = [];
        for (const conv of conversations || []) {
            const hasExistingFollowUp = await checkExistingFollowUp(tenantId, conv.end_user_phone);
            
            if (!hasExistingFollowUp) {
                // Check if customer has abandoned cart
                const hasAbandonedCart = await checkAbandonedCart(conv.id);
                
                // Check if customer inquired about prices but didn't order
                const hasPriceInquiry = await checkPriceInquiryNoOrder(conv.id);
                
                candidates.push({
                    ...conv,
                    hasAbandonedCart,
                    hasPriceInquiry
                });
            }
        }
        
        return candidates;
    } catch (error) {
        console.error('[IntelligentFollowUp] Error getting candidates:', error);
        return [];
    }
}

/**
 * Check if there's already a pending follow-up for this customer
 */
async function checkExistingFollowUp(tenantId, phone) {
    try {
        const { data, error } = await dbClient
            .from('scheduled_followups')
            .select('id')
            .eq('tenant_id', tenantId)
            .eq('end_user_phone', phone)
            .eq('status', 'scheduled')
            .gte('scheduled_time', new Date().toISOString())
            .limit(1);
        
        if (error) throw error;
        return (data && data.length > 0);
    } catch (error) {
        console.error('[IntelligentFollowUp] Error checking existing follow-up:', error);
        return false;
    }
}

/**
 * Check if customer has items in cart but no recent order
 */
async function checkAbandonedCart(conversationId) {
    try {
        // Check if cart has items
        const { data: cart, error: cartError } = await dbClient
            .from('carts')
            .select('items')
            .eq('conversation_id', conversationId)
            .single();
        
        if (cartError || !cart || !cart.items || cart.items.length === 0) {
            return false;
        }
        
        // Check if there's a recent order
        const { data: orders, error: orderError } = await dbClient
            .from('orders_new')
            .select('id')
            .eq('conversation_id', conversationId)
            .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
            .limit(1);
        
        if (orderError) return false;
        
        // Has abandoned cart if cart has items but no recent order
        return !orders || orders.length === 0;
    } catch (error) {
        console.error('[IntelligentFollowUp] Error checking abandoned cart:', error);
        return false;
    }
}

/**
 * Check if customer asked about prices but didn't place order
 */
async function checkPriceInquiryNoOrder(conversationId) {
    try {
        // Get recent messages
        const { data: messages, error: msgError } = await dbClient
            .from('messages')
            .select('message_body, sender')
            .eq('conversation_id', conversationId)
            .order('created_at', { ascending: false })
            .limit(10);
        
        if (msgError || !messages) return false;
        
        // Check if customer asked about price
        const priceKeywords = ['price', 'cost', 'kitna', 'rate', 'amount', 'quote'];
        const hasPriceInquiry = messages.some(msg => 
            msg.sender === 'user' && 
            priceKeywords.some(keyword => 
                msg.message_body.toLowerCase().includes(keyword)
            )
        );
        
        if (!hasPriceInquiry) return false;
        
        // Check if there's a recent order
        const { data: orders, error: orderError } = await dbClient
            .from('orders_new')
            .select('id')
            .eq('conversation_id', conversationId)
            .gte('created_at', new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString())
            .limit(1);
        
        if (orderError) return false;
        
        // Price inquiry without order
        return !orders || orders.length === 0;
    } catch (error) {
        console.error('[IntelligentFollowUp] Error checking price inquiry:', error);
        return false;
    }
}

/**
 * Create an intelligent follow-up based on conversation analysis
 */
async function createIntelligentFollowUp(tenantId, candidate) {
    try {
        const { end_user_phone, lead_score, hasAbandonedCart, hasPriceInquiry } = candidate;
        
        // Determine follow-up time based on lead score
        const hoursUntilFollowUp = FOLLOWUP_INTERVALS[lead_score] || FOLLOWUP_INTERVALS['Cold'];
        const scheduledTime = new Date(Date.now() + hoursUntilFollowUp * 60 * 60 * 1000);
        
        // Generate personalized description
        let description = `Intelligent follow-up (${lead_score} lead)`;
        if (hasAbandonedCart) {
            description = `Abandoned cart follow-up (${lead_score} lead)`;
        } else if (hasPriceInquiry) {
            description = `Price inquiry follow-up (${lead_score} lead)`;
        }
        
        // Get conversation context
        const context = await getConversationContext(candidate.id);
        
        // Schedule the follow-up using existing scheduler
        await scheduleFollowUp(
            tenantId,
            end_user_phone,
            {
                scheduledTime,
                description,
                originalRequest: 'Auto-generated by intelligent system'
            },
            {
                ...context,
                lead_score,
                hasAbandonedCart,
                hasPriceInquiry,
                created_from: 'intelligent_system',
                followup_interval_hours: hoursUntilFollowUp
            }
        );
        
        console.log(`[IntelligentFollowUp] Created follow-up for ${end_user_phone} (${lead_score}) at ${scheduledTime.toISOString()}`);
        
    } catch (error) {
        console.error('[IntelligentFollowUp] Error creating follow-up:', error);
    }
}

/**
 * Get conversation context for personalized follow-up
 */
async function getConversationContext(conversationId) {
    try {
        // Get recent messages
        const { data: messages } = await dbClient
            .from('messages')
            .select('message_body, sender')
            .eq('conversation_id', conversationId)
            .order('created_at', { ascending: false })
            .limit(5);
        
        // Get quoted products
        const { data: quotedProducts } = await dbClient
            .from('messages')
            .select('metadata')
            .eq('conversation_id', conversationId)
            .not('metadata->quoted_products', 'is', null)
            .order('created_at', { ascending: false })
            .limit(1);
        
        // Get cart items
        const { data: cart } = await dbClient
            .from('carts')
            .select('items')
            .eq('conversation_id', conversationId)
            .single();
        
        return {
            recent_messages: messages || [],
            quoted_products: quotedProducts?.[0]?.metadata?.quoted_products || [],
            cart_items: cart?.items || [],
            conversation_state: 'follow_up_pending'
        };
    } catch (error) {
        console.error('[IntelligentFollowUp] Error getting context:', error);
        return {};
    }
}

/**
 * Manually trigger intelligent follow-up creation for a specific customer
 */
async function createManualIntelligentFollowUp(tenantId, phone, leadScore) {
    try {
        // Get conversation
        const { data: conversation } = await dbClient
            .from('conversations_new')
            .select('id, end_user_phone, lead_score')
            .eq('tenant_id', tenantId)
            .eq('end_user_phone', phone)
            .single();
        
        if (!conversation) {
            throw new Error('Conversation not found');
        }
        
        // Check for abandoned cart and price inquiries
        const hasAbandonedCart = await checkAbandonedCart(conversation.id);
        const hasPriceInquiry = await checkPriceInquiryNoOrder(conversation.id);
        
        const candidate = {
            ...conversation,
            lead_score: leadScore || conversation.lead_score || 'Warm',
            hasAbandonedCart,
            hasPriceInquiry
        };
        
        await createIntelligentFollowUp(tenantId, candidate);
        
        return {
            success: true,
            message: 'Intelligent follow-up created successfully'
        };
    } catch (error) {
        console.error('[IntelligentFollowUp] Error creating manual follow-up:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

module.exports = {
    processIntelligentFollowUps,
    createManualIntelligentFollowUp,
    checkAbandonedCart,
    checkPriceInquiryNoOrder
};


