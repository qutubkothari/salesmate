/**
 * @title Web Dashboard Service
 * @description Manages the logic for fetching data to be displayed on the tenant's web dashboard.
 */
const { dbClient } = require('./config');

/**
 * Gathers key performance indicators for a specific tenant to display on their dashboard.
 * @param {string} tenantId The ID of the authenticated tenant.
 * @returns {Promise<object>} An object containing various stats for the dashboard.
 */
const getTenantDashboardData = async (tenantId) => {
    try {
        const thirtyDaysAgo = new Date(new Date().setDate(new Date().getDate() - 30)).toISOString();

        // 1. Run all data queries for the specific tenant in parallel
        const [
            { count: newLeads, error: leadsError },
            { data: orders, error: ordersError },
            { count: feedbackCount, error: feedbackError },
            { count: handoverRequests, error: handoverError }
        ] = await Promise.all([
            dbClient.from('conversations_new').select('*', { count: 'exact', head: true }).eq('tenant_id', tenantId).gt('created_at', thirtyDaysAgo),
            dbClient.from('orders_new').select('total_amount').eq('tenant_id', tenantId).gt('created_at', thirtyDaysAgo),
            dbClient.from('feedback_submissions').select('*', { count: 'exact', head: true }).eq('tenant_id', tenantId).gt('created_at', thirtyDaysAgo),
            dbClient.from('conversations_new').select('*', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('requires_human_attention', true).gt('updated_at', thirtyDaysAgo)
        ]);

        if (leadsError || ordersError || feedbackError || handoverError) {
            throw leadsError || ordersError || feedbackError || handoverError;
        }

        // 2. Process the results
        const totalRevenue = orders.reduce((sum, order) => sum + (order.total_amount || 0), 0);
        const totalOrders = orders.length;

        // 3. Return a structured data object for the frontend
        return {
            stats: {
                newLeads: newLeads || 0,
                totalOrders: totalOrders || 0,
                totalRevenue: totalRevenue.toFixed(2),
                feedbackCount: feedbackCount || 0,
                handoverRequests: handoverRequests || 0,
            },
            period: "Last 30 Days",
        };

    } catch (error) {
        console.error('Error generating tenant dashboard data:', error.message);
        // Return a default error object that the frontend can handle
        return { error: 'Failed to load dashboard data.' };
    }
};

module.exports = {
    getTenantDashboardData,
};


