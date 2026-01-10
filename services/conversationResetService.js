// services/conversationResetService.js - Handle conversation lifecycle
const { dbClient } = require('./config');

/**
 * Handle conversation reset when session is stale
 */
const handleConversationReset = async (tenantId, endUserPhone) => {
    try {
        // Check if conversation is stale (inactive for X hours)
        const { data: conversation } = await dbClient
            .from('conversations')
            .select('*')
            .eq('tenant_id', tenantId)
            .eq('end_user_phone', endUserPhone)
            .single();

        if (conversation) {
            const lastUpdate = new Date(conversation.updated_at);
            const now = new Date();
            const hoursSinceUpdate = (now - lastUpdate) / (1000 * 60 * 60);

            // If conversation is older than 24 hours, reset cart
            if (hoursSinceUpdate > 24) {
                console.log('[CART_RESET] Conversation stale, clearing cart');
                
                // Clear cart items
                await dbClient
                    .from('cart_items')
                    .delete()
                    .eq('cart_id', conversation.cart_id);

                // Reset conversation state
                await dbClient
                    .from('conversations')
                    .update({
                        state: null,
                        last_product_discussed: null,
                        last_quoted_products: null,
                        updated_at: new Date().toISOString()
                    })
                    .eq('id', conversation.id);

                return { reset: true, reason: 'stale_conversation' };
            }
        }

        return { reset: false };
    } catch (error) {
        console.error('[CART_RESET] Error:', error.message);
        return { reset: false, error: error.message };
    }
};

/**
 * Debug follow-up creation
 */
const debugFollowUpCreation = async (tenantId, endUserPhone, minutes) => {
    try {
        const scheduledTime = new Date(Date.now() + minutes * 60 * 1000);
        
        console.log('[FOLLOWUP_DEBUG] Creating follow-up:', {
            tenantId,
            endUserPhone,
            scheduledTime: scheduledTime.toISOString(),
            minutesFromNow: minutes
        });

        const { data: followUp, error } = await dbClient
            .from('follow_ups')
            .insert({
                tenant_id: tenantId,
                end_user_phone: endUserPhone,
                scheduled_time: scheduledTime.toISOString(),
                message: `Follow-up message after ${minutes} minutes`,
                status: 'pending'
            })
            .select('*')
            .single();

        if (error) {
            console.error('[FOLLOWUP_DEBUG] Creation failed:', error);
            return { success: false, error };
        }

        console.log('[FOLLOWUP_DEBUG] Follow-up created:', followUp);
        return { success: true, followUp };

    } catch (error) {
        console.error('[FOLLOWUP_DEBUG] Exception:', error);
        return { success: false, error: error.message };
    }
};

/**
 * Debug follow-up processing
 */
const debugFollowUpProcessing = async () => {
    try {
        const now = new Date();
        console.log('[FOLLOWUP_DEBUG] Current time:', now.toISOString());

        // Check pending follow-ups
        const { data: pending } = await dbClient
            .from('follow_ups')
            .select('*')
            .eq('status', 'pending')
            .lt('scheduled_time', now.toISOString())
            .order('scheduled_time', { ascending: true });

        console.log('[FOLLOWUP_DEBUG] Pending follow-ups due:', pending?.length || 0);
        
        if (pending && pending.length > 0) {
            console.log('[FOLLOWUP_DEBUG] Follow-ups details:', pending.map(f => ({
                id: f.id,
                phone: f.end_user_phone,
                scheduledTime: f.scheduled_time,
                minutesOverdue: (now - new Date(f.scheduled_time)) / (1000 * 60)
            })));
        }

        return { pending: pending || [] };

    } catch (error) {
        console.error('[FOLLOWUP_DEBUG] Processing check failed:', error);
        return { pending: [], error: error.message };
    }
};

/**
 * Enhanced follow-up scheduler with better error handling
 */
const enhancedFollowUpScheduler = async () => {
    try {
        console.log('[FOLLOWUP_CRON] Starting enhanced follow-up check...');
        
        const now = new Date();
        const { data: followUps, error } = await dbClient
            .from('follow_ups')
            .select('*')
            .eq('status', 'pending')
            .lt('scheduled_time', now.toISOString())
            .limit(10);

        if (error) {
            console.error('[FOLLOWUP_CRON] Database error:', error);
            return;
        }

        console.log('[FOLLOWUP_CRON] Found', followUps?.length || 0, 'follow-ups to process');

        for (const followUp of followUps || []) {
            try {
                console.log('[FOLLOWUP_CRON] Processing follow-up:', followUp.id);

                // Send WhatsApp message
                const { sendMessage } = require('./whatsappService');
                await sendMessage(followUp.end_user_phone, followUp.message);

                // Mark as sent
                await dbClient
                    .from('follow_ups')
                    .update({ 
                        status: 'sent', 
                        sent_at: now.toISOString() 
                    })
                    .eq('id', followUp.id);

                console.log('[FOLLOWUP_CRON] Follow-up sent successfully:', followUp.id);

            } catch (sendError) {
                console.error('[FOLLOWUP_CRON] Failed to send follow-up:', followUp.id, sendError);

                // Mark as failed
                await dbClient
                    .from('follow_ups')
                    .update({ 
                        status: 'failed', 
                        error_message: sendError.message 
                    })
                    .eq('id', followUp.id);
            }
        }

        console.log('[FOLLOWUP_CRON] Enhanced follow-up check completed');

    } catch (error) {
        console.error('[FOLLOWUP_CRON] Enhanced scheduler error:', error);
    }
};

module.exports = {
    handleConversationReset,
    debugFollowUpCreation,
    debugFollowUpProcessing,
    enhancedFollowUpScheduler
};

