/**
 * @title Customer Snapshot Service
 * @description Manages the logic for generating a comprehensive summary of a single customer for a tenant.
 */
const { dbClient } = require('./config');
const { getConversationId } = require('./historyService');

/**
 * Gathers all key information about a customer and formats it into a snapshot report.
 * @param {string} tenantId The ID of the tenant.
 * @param {string} endUserPhone The phone number of the customer to look up.
 * @returns {Promise<string>} A formatted string containing the customer snapshot.
 */
const getCustomerSnapshot = async (tenantId, endUserPhone) => {
    try {
        const conversationId = await getConversationId(tenantId, endUserPhone);
        if (!conversationId) {
            return `No data found for customer with phone number ${endUserPhone}.`;
        }

        // 1. Run all data queries in parallel for efficiency
        const [
            { data: conversationDetails, error: convError },
            { data: lastOrder, error: orderError },
            { data: tags, error: tagsError },
            { data: segments, error: segError }
        ] = await Promise.all([
            dbClient.from('conversations_new').select('lead_score, requires_human_attention').eq('id', conversationId).single(),
            dbClient.from('orders_new').select('id, status, total_amount, created_at').eq('conversation_id', conversationId).order('created_at', { ascending: false }).limit(1).single(),
            dbClient.from('conversation_tags').select('tag:tags (tag_name)').eq('conversation_id', conversationId),
            dbClient.from('conversation_segments').select('segment:customer_segments (segment_name)').eq('conversation_id', conversationId)
        ]);

        if (convError && convError.code !== 'PGRST116') throw convError;
        if (orderError && orderError.code !== 'PGRST116') throw orderError;
        if (tagsError) throw tagsError;
        if (segError) throw segError;

        // 2. Format the report
        let report = `👤 *Customer Snapshot for ${endUserPhone}*\n\n`;

        // Lead & Handover Status
        report += `*Lead Status:*\n`;
        report += `- Temperature: *${conversationDetails?.lead_score || 'Not Scored'}*\n`;
        report += `- Needs Human Attention: *${conversationDetails?.requires_human_attention ? 'Yes' : 'No'}*\n\n`;

        // Last Order
        report += `*Last Order:*\n`;
        if (lastOrder) {
            const orderId = lastOrder.id.substring(0, 8);
            const orderDate = new Date(lastOrder.created_at).toLocaleDateString();
            report += `- Order #${orderId} on ${orderDate}\n`;
            report += `- Amount: $${lastOrder.total_amount}\n`;
            report += `- Status: ${lastOrder.status.replace('_', ' ').toUpperCase()}\n\n`;
        } else {
            report += `- No orders found.\n\n`;
        }

        // Tags
        report += `*AI-Generated Tags:*\n`;
        if (tags && tags.length > 0) {
            report += `- ${tags.map(t => `#${t.tag.tag_name}`).join(', ')}\n\n`;
        } else {
            report += `- No tags assigned yet.\n\n`;
        }

        // Segments
        report += `*Customer Segments:*\n`;
        if (segments && segments.length > 0) {
            report += `- ${segments.map(s => s.segment.segment_name).join(', ')}\n`;
        } else {
            report += `- Not assigned to any segments yet.\n`;
        }

        return report;

    } catch (error) {
        console.error('Error generating customer snapshot:', error.message);
        return 'An error occurred while generating the customer snapshot.';
    }
};

module.exports = {
    getCustomerSnapshot,
};


