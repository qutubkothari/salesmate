/**
 * @title Human Handover Service
 * @description Handles detecting user requests for human assistance and notifying tenants.
 */
const { openai, dbClient } = require('./config');
const { sendMessage } = require('./whatsappService');
const { getConversationId } = require('./historyService');
const { upsertTriageForConversation } = require('./triageService');

/**
 * Uses the OpenAI API to determine if a user's message is a request for human intervention.
 * @param {string} userMessage The message from the end-user.
 * @returns {Promise<boolean>} True if the message is a request for a human, false otherwise.
 */
const isHandoverRequest = async (userMessage) => {
    // Simple keyword check for efficiency before calling the AI
    const keywords = ['human', 'agent', 'person', 'speak to someone', 'real person'];
    if (keywords.some(keyword => userMessage.toLowerCase().includes(keyword))) {
        return true;
    }

    try {
        const response = await openai.chat.completions.create({
            model: "gpt-3.5-turbo",
            messages: [{
                role: "system",
                content: `Analyze the user's message. Does it express a desire to speak with a human, agent, or real person? Respond with only "YES" or "NO".`
            }, {
                role: "user",
                content: userMessage
            }],
            temperature: 0,
            max_tokens: 2,
        });
        const result = response.choices[0].message.content.trim().toUpperCase();
        return result === 'YES';
    } catch (error) {
        console.error('Error checking for handover request with OpenAI:', error);
        return false; // Default to not a handover request on error
    }
};

/**
 * Flags a conversation as requiring human attention and notifies the tenant.
 * @param {object} tenant The full tenant object.
 * @param {string} endUserPhone The phone number of the customer.
 * @returns {Promise<void>}
 */
const flagAndNotifyForHandover = async (tenant, endUserPhone) => {
    try {
        // 1. Update the conversation in the database
        const { error } = await dbClient
            .from('conversations')
            .update({ requires_human_attention: true })
            .eq('tenant_id', tenant.id)
            .eq('end_user_phone', endUserPhone);

        if (error) throw error;

        // 2. Send a notification to the tenant
        const notificationMessage = `ðŸ”” *Attention Required!* ðŸ””\n\nThe customer at ${endUserPhone} has requested to speak with a human. Please review the conversation and respond to them directly.`;
        await sendMessage(tenant.phone_number, notificationMessage);

        // 3. Auto-create triage item
        try {
            const conversationId = await getConversationId(tenant.id, endUserPhone);
            if (conversationId) {
                await upsertTriageForConversation(dbClient, {
                    tenantId: tenant.id,
                    conversationId,
                    endUserPhone,
                    type: 'HUMAN_ATTENTION',
                    messagePreview: 'Auto-triage: customer requested human',
                    metadata: { source: 'handoverService' }
                });
            }
        } catch (_) {
            // Best-effort only
        }

        console.log(`Notified tenant ${tenant.phone_number} about handover request from ${endUserPhone}.`);

    } catch (error) {
        console.error('Error flagging conversation for handover:', error.message);
    }
};

module.exports = {
    isHandoverRequest,
    flagAndNotifyForHandover,
};

