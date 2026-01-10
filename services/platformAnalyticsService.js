/**
 * @title Platform Analytics Service
 * @description Manages the logic for generating a high-level analytics dashboard for the platform administrator.
 */
const { dbClient } = require('./config');

/**
 * Gathers and formats key performance indicators from across the entire platform.
 * @returns {Promise<string>} A formatted string containing the platform dashboard report.
 */
const getPlatformDashboard = async () => {
    try {
        console.log('Generating platform analytics dashboard...');

        const sevenDaysAgo = new Date(new Date().setDate(new Date().getDate() - 7)).toISOString();

        // Run all data queries in parallel for efficiency
        const [
            { count: totalTenants },
            { count: activeSubscriptions },
            { count: newTenantsLast7Days },
            { data: totalOrdersData },
            { count: openSupportTickets }
        ] = await Promise.all([
            dbClient.from('tenants').select('*', { count: 'exact', head: true }),
            dbClient.from('tenants').select('*', { count: 'exact', head: true }).eq('subscription_status', 'active'),
            dbClient.from('tenants').select('*', { count: 'exact', head: true }).gt('created_at', sevenDaysAgo),
            dbClient.from('orders').select('total_amount'),
            dbClient.from('support_tickets').select('*', { count: 'exact', head: true }).eq('status', 'open')
        ]);

        // Calculate total revenue from orders
        const totalRevenue = totalOrdersData.reduce((sum, order) => sum + (order.total_amount || 0), 0);
        const totalOrders = totalOrdersData.length;

        // Format the report
        let report = `ðŸš€ *Platform Analytics Dashboard*\n\n`;
        report += `*--- Tenants ---*\n`;
        report += `- Total Registered Tenants: *${totalTenants}*\n`;
        report += `- Active Subscriptions: *${activeSubscriptions}*\n`;
        report += `- New Signups (Last 7 Days): *${newTenantsLast7Days}*\n\n`;

        report += `*--- E-commerce ---*\n`;
        report += `- Total Orders Processed: *${totalOrders}*\n`;
        report += `- Total Revenue: *$${totalRevenue.toFixed(2)}*\n\n`;

        report += `*--- Support ---*\n`;
        report += `- Open Support Tickets: *${openSupportTickets}*\n`;

        return report;

    } catch (error) {
        console.error('Error generating platform dashboard:', error.message);
        return 'An error occurred while generating the platform dashboard.';
    }
};

module.exports = {
    getPlatformDashboard,
};

