/**
 * @title Campaign Analytics Service
 * @description Handles fetching and processing data to provide tenants with campaign performance analytics.
 */
const { dbClient } = require('./config');

/**
 * Fetches and aggregates analytics for all campaigns belonging to a tenant.
 * @param {string} tenantId The ID of the tenant.
 * @returns {Promise<string>} A promise that resolves to a formatted string containing the campaign analytics.
 */
const getCampaignAnalytics = async (tenantId) => {
    try {
        // 1. Fetch all sent messages for the tenant, including campaign info.
        const { data, error } = await dbClient
            .from('bulk_schedules')
            .select('campaign_id, campaign_name, delivery_status')
            .eq('tenant_id', tenantId)
            .eq('is_sent', true);

        if (error) throw error;

        if (!data || data.length === 0) {
            return 'You have not sent any campaigns yet. Use the /schedule or /schedule_image command to start one.';
        }

        // 2. Aggregate the data by campaign.
        const campaigns = data.reduce((acc, curr) => {
            const id = curr.campaign_id;
            if (!acc[id]) {
                acc[id] = {
                    name: curr.campaign_name,
                    total: 0,
                    statuses: {},
                };
            }
            acc[id].total++;
            const status = curr.delivery_status || 'pending';
            acc[id].statuses[status] = (acc[id].statuses[status] || 0) + 1;
            return acc;
        }, {});

        // 3. Format the aggregated data into a user-friendly message.
        let analyticsMessage = 'ðŸ“Š *Campaign Analytics Report*\n\n';
        if (Object.keys(campaigns).length === 0) {
            return 'No campaign data is available yet. Statuses will update as they are received.';
        }

        for (const id in campaigns) {
            const campaign = campaigns[id];
            analyticsMessage += `*Campaign:* ${campaign.name}\n`;
            analyticsMessage += `  - *Total Messages:* ${campaign.total}\n`;
            for (const status in campaign.statuses) {
                analyticsMessage += `  - *${status.charAt(0).toUpperCase() + status.slice(1)}:* ${campaign.statuses[status]}\n`;
            }
            analyticsMessage += '\n';
        }

        return analyticsMessage;

    } catch (error) {
        console.error('Error getting campaign analytics:', error.message);
        return 'An error occurred while fetching your campaign analytics.';
    }
};

module.exports = {
    getCampaignAnalytics,
};

