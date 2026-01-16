/**
 * @title Data Maintenance Service
 * @description Manages the logic for viewing and pruning old data from the database to maintain performance.
 */
const { dbClient } = require('./config');

/**
 * Gets a summary of data that is older than a specified number of days and can be pruned.
 * @param {number} daysOld The age in days for data to be considered prunable.
 * @returns {Promise<string>} A summary of the prunable data.
 */
const getPrunableDataSummary = async (daysOld = 90) => {
    try {
        const olderThanDate = new Date(new Date().setDate(new Date().getDate() - daysOld)).toISOString();

        // 1. Count old, inactive conversations (not updated recently)
        const { count: inactiveConversations, error: convError } = await dbClient
            .from('conversations_new')
            .select('*', { count: 'exact', head: true })
            .lt('updated_at', olderThanDate);

        if (convError) throw convError;

        // 2. Count old, completed/cancelled orders
        const { count: oldOrders, error: orderError } = await dbClient
            .from('orders_new')
            .select('*', { count: 'exact', head: true })
            .in('status', ['completed', 'cancelled'])
            .lt('created_at', olderThanDate);

        if (orderError) throw orderError;
        
        // 3. Count old, sent bulk messages
        const { count: oldSchedules, error: scheduleError } = await dbClient
            .from('bulk_schedules')
            .select('*', { count: 'exact', head: true })
            .eq('is_sent', true)
            .lt('sent_at', olderThanDate);

        if (scheduleError) throw scheduleError;

        let summary = `🔍 *Data Pruning Summary (Older than ${daysOld} days)*\n\n`;
        summary += `- Inactive Conversations: *${inactiveConversations}*\n`;
        summary += `- Completed/Cancelled Orders: *${oldOrders}*\n`;
        summary += `- Sent Bulk Messages: *${oldSchedules}*\n\n`;
        summary += `To delete this data, run the command:\n\`/prune_data ${daysOld} CONFIRM\``;
        
        return summary;

    } catch (error) {
        console.error('Error getting prunable data summary:', error.message);
        return 'An error occurred while generating the data summary.';
    }
};

/**
 * Deletes old data from the database. This is a destructive action.
 * @param {number} daysOld The age in days for data to be considered prunable.
 * @returns {Promise<string>} A confirmation of the deletion.
 */
const pruneOldData = async (daysOld = 90) => {
    try {
        console.warn(`--- Starting data pruning for records older than ${daysOld} days. This is a destructive action. ---`);
        const olderThanDate = new Date(new Date().setDate(new Date().getDate() - daysOld)).toISOString();

        // Note: Thanks to CASCADE constraints in the database schema, deleting a conversation
        // will also delete its messages, cart, feedback, appointments, etc.
        const { count: deletedConversations, error: convError } = await dbClient
            .from('conversations_new')
            .delete({ count: 'exact' })
            .lt('updated_at', olderThanDate);

        if (convError) throw convError;

        const { count: deletedOrders, error: orderError } = await dbClient
            .from('orders_new')
            .delete({ count: 'exact' })
            .in('status', ['completed', 'cancelled'])
            .lt('created_at', olderThanDate);
            
        if (orderError) throw orderError;

        const { count: deletedSchedules, error: scheduleError } = await dbClient
            .from('bulk_schedules')
            .delete({ count: 'exact' })
            .eq('is_sent', true)
            .lt('sent_at', olderThanDate);

        if (scheduleError) throw scheduleError;

        let result = `✅ *Data Pruning Complete*\n\n`;
        result += `- Inactive Conversations Deleted: *${deletedConversations}*\n`;
        result += `- Old Orders Deleted: *${deletedOrders}*\n`;
        result += `- Old Bulk Messages Deleted: *${deletedSchedules}*\n`;

        console.log(result);
        return result;

    } catch (error) {
        console.error('Error during data pruning:', error.message);
        return 'A critical error occurred during data pruning. Please check the logs.';
    }
};


module.exports = {
    getPrunableDataSummary,
    pruneOldData,
};


