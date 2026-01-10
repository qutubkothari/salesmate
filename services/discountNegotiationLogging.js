// =============================================
// FILE: services/discountNegotiationLogging.js
// NEW FILE - Logs AI discount negotiations for analytics
// =============================================

const { dbClient } = require('./config');

/**
 * Log a discount negotiation attempt
 * Tracks AI analysis, offers, and outcomes
 */
async function logDiscountNegotiation(data) {
    try {
        const {
            tenantId,
            customerPhone,
            cartId,
            customerMessage,
            aiIntentResult,
            aiExtractedDetails,
            offeredDiscount,
            maxDiscount,
            discountType,
            aiResponseTone,
            shouldEscalate
        } = data;
        
        console.log('[DISCOUNT_LOG] Logging negotiation:', {
            customer: customerPhone,
            type: discountType,
            offered: offeredDiscount,
            escalate: shouldEscalate
        });
        
        const { data: negotiation, error } = await dbClient
            .from('discount_negotiations')
            .insert({
                tenant_id: tenantId,
                customer_phone: customerPhone,
                cart_id: cartId || null,
                customer_message: customerMessage,
                ai_intent_result: aiIntentResult,
                ai_extracted_details: aiExtractedDetails,
                offered_discount: offeredDiscount,
                max_discount: maxDiscount,
                discount_type: discountType,
                ai_response_tone: aiResponseTone,
                should_escalate: shouldEscalate || false
            })
            .select()
            .single();
        
        if (error) {
            console.error('[DISCOUNT_LOG] Error logging:', error.message);
            return null;
        }
        
        console.log('[DISCOUNT_LOG] Logged successfully:', negotiation.id);
        return negotiation;
        
    } catch (error) {
        console.error('[DISCOUNT_LOG] Exception:', error.message);
        return null;
    }
}

/**
 * Update negotiation outcome (accepted/rejected)
 */
async function updateNegotiationOutcome(negotiationId, accepted, finalDiscount = null) {
    try {
        console.log('[DISCOUNT_LOG] Updating outcome:', {
            id: negotiationId,
            accepted: accepted,
            finalDiscount: finalDiscount
        });
        
        const { error } = await dbClient
            .from('discount_negotiations')
            .update({
                accepted: accepted,
                final_discount: finalDiscount,
                resolved_at: new Date().toISOString()
            })
            .eq('id', negotiationId);
        
        if (error) {
            console.error('[DISCOUNT_LOG] Error updating:', error.message);
            return false;
        }
        
        console.log('[DISCOUNT_LOG] Outcome updated');
        return true;
        
    } catch (error) {
        console.error('[DISCOUNT_LOG] Exception:', error.message);
        return false;
    }
}

/**
 * Get recent escalations (for manager alerts)
 */
async function getRecentEscalations(tenantId, limit = 10) {
    try {
        const { data: escalations, error } = await dbClient
            .from('discount_negotiations')
            .select('*')
            .eq('tenant_id', tenantId)
            .eq('should_escalate', true)
            .is('resolved_at', null)  // Only unresolved
            .order('created_at', { ascending: false })
            .limit(limit);
        
        if (error) throw error;
        
        return escalations || [];
        
    } catch (error) {
        console.error('[DISCOUNT_LOG] Error getting escalations:', error.message);
        return [];
    }
}

/**
 * Get discount analytics for date range
 */
async function getDiscountAnalytics(tenantId, startDate, endDate) {
    try {
        const { data: analytics, error } = await dbClient
            .from('discount_negotiation_analytics')
            .select('*')
            .eq('tenant_id', tenantId)
            .gte('date', startDate)
            .lte('date', endDate)
            .order('date', { ascending: false });
        
        if (error) throw error;
        
        return analytics || [];
        
    } catch (error) {
        console.error('[DISCOUNT_LOG] Error getting analytics:', error.message);
        return [];
    }
}

/**
 * Get customer's negotiation history
 */
async function getCustomerNegotiationHistory(tenantId, customerPhone, limit = 5) {
    try {
        const { data: history, error } = await dbClient
            .from('discount_negotiations')
            .select('*')
            .eq('tenant_id', tenantId)
            .eq('customer_phone', customerPhone)
            .order('created_at', { ascending: false })
            .limit(limit);
        
        if (error) throw error;
        
        return history || [];
        
    } catch (error) {
        console.error('[DISCOUNT_LOG] Error getting history:', error.message);
        return [];
    }
}

module.exports = {
    logDiscountNegotiation,
    updateNegotiationOutcome,
    getRecentEscalations,
    getDiscountAnalytics,
    getCustomerNegotiationHistory
};

