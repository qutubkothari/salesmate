// routes/handlers/modules/smartResponseHandler.js
// Handles smart response router logic extracted from customerHandler.js

const { getSmartResponse } = require('../../../services/smartResponseRouter');

async function handleSmartResponse(req, res, tenant, from, userQuery, intentResult) {
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

                const { dbClient } = require('../../../services/config');

                // Get current conversation
                const { data: conversation } = await dbClient
                    .from('conversations')
                    .select('id, context_data')
                    .eq('tenant_id', tenant.id)
                    .eq('end_user_phone', from)
                    .single();

                if (conversation) {
                    // Save quoted products
                    await dbClient
                        .from('conversations')
                        .update({
                            last_quoted_products: JSON.stringify(smartResponse.quotedProducts),
                            context_data: {
                                ...(conversation.context_data || {}),
                                lastQuotedAt: new Date().toISOString()
                            }
                        })
                        .eq('id', conversation.id);

                    console.log('[SMART_HANDLER] Saved', smartResponse.quotedProducts.length, 'quoted products');
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
