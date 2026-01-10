
// middleware/zohoSyncMiddleware.js
/**
 * Middleware to handle Zoho customer matching on first message
 */
const zohoMatching = require('../services/zohoCustomerMatchingService');

const zohoSyncMiddleware = async (req, res, next) => {
    try {
        const { message, tenant } = req;
        const from = message.from;

        // Skip for non-customer messages or if Zoho not configured
        if (!tenant.id || !process.env.ZOHO_CLIENT_ID) {
            return next();
        }

        // Check if this is customer's first interaction today
        const { dbClient } = require('../services/config');
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const { data: recentMessage } = await dbClient
            .from('message_history')
            .select('id')
            .eq('tenant_id', tenant.id)
            .eq('phone_number', from)
            .eq('sender_type', 'user')
            .gte('created_at', today.toISOString())
            .limit(1)
            .single();

        // If no recent messages, try to match with Zoho (async)
        if (!recentMessage) {
            console.log('[ZOHO_MIDDLEWARE] First message today, attempting customer match');
            
            // Don't await - let it run in background
            zohoMatching.matchAndSyncCustomer(tenant.id, from)
                .then(result => {
                    console.log('[ZOHO_MIDDLEWARE] Match result:', result.action || 'failed');
                })
                .catch(error => {
                    console.error('[ZOHO_MIDDLEWARE] Match error:', error.message);
                });
        }

        next();
    } catch (error) {
        console.error('[ZOHO_MIDDLEWARE] Error:', error);
        // Don't block the request
        next();
    }
};

module.exports = zohoSyncMiddleware;
