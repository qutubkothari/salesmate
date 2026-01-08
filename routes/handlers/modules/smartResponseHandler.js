// routes/handlers/modules/smartResponseHandler.js
// Handles smart response router logic extracted from customerHandler.js

const { getSmartResponse } = require('../../../services/smartResponseRouter');

async function handleSmartResponse(req, res, tenant, from, userQuery, intentResult, conversation) {
    console.log('[SMART_HANDLER] Processing with Smart Response Router');

    // Since discount requests are handled first, we don't need to skip here anymore
    console.log('[SMART_HANDLER] Query being sent to getSmartResponse:', userQuery);

    try {
        const smartResponse = await getSmartResponse(userQuery, tenant.id, from);
        console.log('[SMART_HANDLER] Smart Response Result:', smartResponse ? 'FOUND' : 'NOT_FOUND');

        if (smartResponse) {
            console.log('[SMART_HANDLER] Smart Router returned response');

            // Handle quoted products saving
            if (smartResponse.quotedProducts && smartResponse.quotedProducts.length > 0) {
                console.log('[SMART_HANDLER] Saving quoted products to conversation');

                const { supabase } = require('../../../services/config');

                // Prefer the already-loaded conversation to avoid brittle lookups in local SQLite mode.
                let conversationId = conversation?.id || null;
                if (!conversationId) {
                    const { data: convoRow } = await supabase
                        .from('conversations')
                        .select('id')
                        .eq('tenant_id', tenant.id)
                        .eq('end_user_phone', from)
                        .maybeSingle();
                    conversationId = convoRow?.id || null;
                }

                if (conversationId) {
                    await supabase
                        .from('conversations')
                        .update({
                            last_quoted_products: JSON.stringify(smartResponse.quotedProducts),
                            state: 'awaiting_order_confirmation',
                            updated_at: new Date().toISOString()
                        })
                        .eq('id', conversationId);

                    console.log('[SMART_HANDLER] Saved', smartResponse.quotedProducts.length, 'quoted products');
                } else {
                    console.warn('[SMART_HANDLER] No conversation found; cannot persist quoted products');
                }
            }

            return smartResponse;
        }

    } catch (error) {
        console.error('[SMART_HANDLER] Error in smart response:', error);
    }

    return null;
}

module.exports = {
    handleSmartResponse
};