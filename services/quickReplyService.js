/**
 * @title Quick Reply Service
 * @description Manages keyword-based quick replies for common, simple user interactions.
 */
const { dbClient } = require('./config');

/**
 * Finds if a user's message is an exact match for a tenant's quick reply trigger.
 * @param {string} tenantId The ID of the tenant.
 * @param {string} userMessage The incoming message from the end-user.
 * @returns {Promise<string|null>} The response text if a trigger is matched exactly, otherwise null.
 */
const findQuickReplyResponse = async (tenantId, userMessage) => {
    try {
        const { data, error } = await dbClient
            .from('quick_replies')
            .select('response')
            .eq('tenant_id', tenantId)
            .ilike('trigger_phrase', userMessage.trim()); // Use ilike for case-insensitive exact match

        if (error) throw error;

        // If a match is found, return its response
        if (data && data.length > 0) {
            return data[0].response;
        }

        return null;
    } catch (error) {
        console.error('Error finding quick reply response:', error.message);
        return null;
    }
};

/**
 * Adds a new quick reply for a tenant.
 * @param {string} tenantId The ID of the tenant.
 * @param {string} trigger The trigger phrase (e.g., "yes").
 * @param {string} response The response message.
 * @returns {Promise<string>} A confirmation or error message.
 */
const addQuickReply = async (tenantId, trigger, response) => {
    try {
        const { error } = await dbClient
            .from('quick_replies')
            .upsert({
                tenant_id: tenantId,
                trigger_phrase: trigger.trim(),
                response: response.trim()
            }, { onConflict: 'tenant_id, trigger_phrase' });

        if (error) throw error;

        return `Quick reply for "${trigger}" has been saved.`;
    } catch (error) {
        console.error('Error adding quick reply:', error.message);
        return `An error occurred while saving the quick reply for "${trigger}".`;
    }
};

/**
 * Deletes a quick reply for a tenant.
 * @param {string} tenantId The ID of the tenant.
 * @param {string} trigger The trigger phrase to delete.
 * @returns {Promise<string>} A confirmation or error message.
 */
const deleteQuickReply = async (tenantId, trigger) => {
    try {
        const { error } = await dbClient
            .from('quick_replies')
            .delete()
            .eq('tenant_id', tenantId)
            .eq('trigger_phrase', trigger.trim());

        if (error) throw error;

        return `Quick reply for "${trigger}" has been deleted.`;
    } catch (error) {
        console.error('Error deleting quick reply:', error.message);
        return `An error occurred while deleting the quick reply for "${trigger}".`;
    }
};

/**
 * Lists all quick replies for a tenant.
 * @param {string} tenantId The ID of the tenant.
 * @returns {Promise<string>} A formatted list of quick replies.
 */
const listQuickReplies = async (tenantId) => {
    try {
        const { data, error } = await dbClient
            .from('quick_replies')
            .select('trigger_phrase, response')
            .eq('tenant_id', tenantId);

        if (error) throw error;

        if (!data || data.length === 0) {
            return 'You have no quick replies set up. Use `/add_qr <trigger> <response>` to create one.';
        }

        let listMessage = '*Your current quick replies:*\n\n';
        data.forEach(item => {
            listMessage += `*When user says:* "${item.trigger_phrase}"\n`;
            listMessage += `*Bot replies:* "${item.response}"\n---\n`;
        });

        return listMessage;

    } catch (error) {
        console.error('Error listing quick replies:', error.message);
        return 'An error occurred while fetching your quick replies.';
    }
};

module.exports = {
    findQuickReplyResponse,
    addQuickReply,
    deleteQuickReply,
    listQuickReplies,
};

