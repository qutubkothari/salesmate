/**
 * @title Daily Summary Service
 * @description Manages the logic for generating and sending daily activity summaries to tenants.
 */
const { dbClient } = require('./config');
const { sendMessage } = require('./whatsappService');

/**
 * Generates and sends a daily activity summary to all enabled tenants.
 * This function is designed to be run once a day by a scheduler.
 */
const sendDailySummaries = async () => {
    try {
        // 1. Get all tenants who have the daily summary feature enabled.
        const { data: tenants, error: tenantsError } = await dbClient
            .from('tenants')
            .select('id, phone_number, office_hours_timezone')
            .eq('daily_summary_enabled', true);

        if (tenantsError) throw tenantsError;
        if (!tenants || tenants.length === 0) {
            console.log('No tenants have the daily summary enabled.');
            return;
        }

        console.log(`Generating daily summaries for ${tenants.length} tenant(s)...`);

        // 2. Loop through each tenant and gather their stats for the last 24 hours.
        for (const tenant of tenants) {
            const now = new Date();
            const twentyFourHoursAgo = new Date(now.getTime() - (24 * 60 * 60 * 1000)).toISOString();

            // Fetch counts for various activities in parallel
            const [
                { count: newLeads },
                { count: newOrders },
                { count: newFeedback },
                { count: humanHandovers }
            ] = await Promise.all([
                dbClient.from('conversations_new').select('*', { count: 'exact' }).eq('tenant_id', tenant.id).gt('created_at', twentyFourHoursAgo),
                dbClient.from('orders_new').select('*', { count: 'exact' }).eq('tenant_id', tenant.id).gt('created_at', twentyFourHoursAgo),
                dbClient.from('feedback_submissions').select('*', { count: 'exact' }).eq('tenant_id', tenant.id).gt('created_at', twentyFourHoursAgo),
                dbClient.from('conversations_new').select('*', { count: 'exact' }).eq('tenant_id', tenant.id).eq('requires_human_attention', true).gt('updated_at', twentyFourHoursAgo)
            ]);

            // 3. Format the summary message.
            let summaryMessage = `☀️ *Good Morning! Here is your daily summary for the last 24 hours:*\n\n`;
            summaryMessage += `- 💬 New Conversations: *${newLeads || 0}*\n`;
            summaryMessage += `- 🛍️ New Orders: *${newOrders || 0}*\n`;
            summaryMessage += `- ⭐ New Feedback Received: *${newFeedback || 0}*\n`;
            summaryMessage += `- 🙋 Human Handover Requests: *${humanHandovers || 0}*\n\n`;
            summaryMessage += `Have a great day!`;

            // 4. Send the summary to the tenant.
            await sendMessage(tenant.phone_number, summaryMessage);
            console.log(`Daily summary sent to ${tenant.phone_number}`);
        }

    } catch (error) {
        console.error('Error sending daily summaries:', error.message);
    }
};

module.exports = {
    sendDailySummaries,
};


