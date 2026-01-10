// services/responseAnalytics.js
const { dbClient } = require('./config');

/**
 * Track response sources and costs
 */
const trackResponse = async (tenantId, userQuery, responseSource, cost = 0) => {
    try {
        await dbClient
            .from('response_analytics')
            .insert({
                tenant_id: tenantId,
                query: userQuery,
                response_source: responseSource, // 'database', 'faq', 'cache', 'ai'
                estimated_cost: cost,
                created_at: new Date().toISOString()
            });
    } catch (error) {
        console.error('Error tracking response:', error.message);
    }
};

module.exports = { trackResponse };
