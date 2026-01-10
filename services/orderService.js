/**
 * @title Order Management Service
 * @description Manages the logic for fetching and updating order statuses.
 */
const { dbClient } = require('./config');

/**
 * Fetches the status of the most recent order for an end-user.
 * @param {string} tenantId The ID of the tenant.
 * @param {string} endUserPhone The phone number of the customer.
 * @returns {Promise<string>} A formatted string with the order status.
 */
const getOrderStatus = async (tenantId, endUserPhone) => {
    try {
        const conversationId = (await dbClient.from('conversations').select('id').eq('tenant_id', tenantId).eq('end_user_phone', endUserPhone).single())?.data?.id;
        if (!conversationId) {
            return "You do not have any order history with us.";
        }

        const { data: order, error } = await dbClient
            .from('orders')
            .select('id, status, created_at')
            .eq('conversation_id', conversationId)
            .order('created_at', { ascending: false }) // Get the most recent order
            .limit(1)
            .single();

        if (error || !order) {
            return "You do not have any order history with us.";
        }

        const orderId = order.id.substring(0, 8);
        const orderDate = new Date(order.created_at).toLocaleDateString();
        const status = order.status.replace('_', ' ').toUpperCase();

        return `Your most recent order (#${orderId}) from ${orderDate} has a status of: *${status}*.`;

    } catch (error) {
        console.error('Error fetching order status:', error.message);
        return 'An error occurred while fetching your order status.';
    }
};

/**
 * Allows a tenant to update the status of an order.
 * @param {string} tenantId The ID of the tenant.
 * @param {string} endUserPhone The phone number of the customer whose order is being updated.
 * @param {string} newStatus The new status for the order.
 * @returns {Promise<string>} A confirmation or error message.
 */
const updateOrderStatus = async (tenantId, endUserPhone, newStatus) => {
    const validStatuses = ['pending_payment', 'paid', 'shipped', 'completed', 'cancelled'];
    if (!validStatuses.includes(newStatus.toLowerCase())) {
        return `Invalid status. Please use one of the following: ${validStatuses.join(', ')}.`;
    }

    try {
        const conversationId = (await dbClient.from('conversations').select('id').eq('tenant_id', tenantId).eq('end_user_phone', endUserPhone).single())?.data?.id;
        if (!conversationId) {
            return `No order history found for customer ${endUserPhone}.`;
        }

        const { data: order, error: findError } = await dbClient
            .from('orders')
            .select('id')
            .eq('conversation_id', conversationId)
            .order('created_at', { ascending: false })
            .limit(1)
            .single();

        if (findError || !order) {
            return `No order history found for customer ${endUserPhone}.`;
        }

        const { error: updateError } = await dbClient
            .from('orders')
            .update({ status: newStatus.toLowerCase() })
            .eq('id', order.id);

        if (updateError) throw updateError;

        return `The latest order for ${endUserPhone} has been updated to *${newStatus.toUpperCase()}*.`;

    } catch (error) {
        console.error('Error updating order status:', error.message);
        return 'An error occurred while updating the order status.';
    }
};

module.exports = {
    getOrderStatus,
    updateOrderStatus,
};

