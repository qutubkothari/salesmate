/**
 * @title Tenant Usage Statistics Service
 * @description Handles the logic for calculating and presenting bot usage statistics to tenants.
 */
const { dbClient } = require('./config');

/**
 * Fetches and aggregates usage statistics for a tenant.
 * @param {string} tenantId The ID of the tenant.
 * @returns {Promise<string>} A promise that resolves to a formatted string of usage stats.
 */
const getUsageStats = async (tenantId) => {
    try {
        // 1. Fetch all messages for the tenant, selecting only the message_type.
        const { data, error } = await dbClient
            .from('messages')
            .select('message_type')
            .not('message_type', 'is', null); // Exclude any messages that might not have a type

        if (error) throw error;

        if (!data || data.length === 0) {
            return "No usage data available yet. Your bot will start logging stats as it interacts with customers.";
        }

        // 2. Aggregate the data by message type.
        const stats = data.reduce((acc, curr) => {
            const type = curr.message_type;
            acc[type] = (acc[type] || 0) + 1;
            return acc;
        }, {});

        // 3. Format the stats into a user-friendly message.
        let statsMessage = 'ðŸ“ˆ *Your Bot Usage Statistics*\n\n';
        statsMessage += `*Customer Messages Received:* ${stats['user_input'] || 0}\n`;
        statsMessage += `*AI Responses Sent:* ${stats['ai_response'] || 0}\n`;
        statsMessage += `*Keyword Replies:* ${stats['keyword_response'] || 0}\n`;
        statsMessage += `*Quick Replies:* ${stats['quick_reply_response'] || 0}\n`;
        // Add other types as you expand the feature.

        return statsMessage;

    } catch (error) {
        console.error('Error getting usage stats:', error.message);
        return 'An error occurred while fetching your usage statistics.';
    }
};

module.exports = {
    getUsageStats,
};

