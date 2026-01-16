/**
 * @title Follow-up and Response Categorization Service
 * @description Handles AI-powered categorization of end-user responses, schedules follow-ups, and sends reminders.
 */
const { openai, dbClient } = require('./config');
const { sendMessage } = require('./whatsappService');

/**
 * Robust conversationHistory normalization utility
 * Normalizes various conversation history formats into a consistent array structure
 * @param {*} conversation - Conversation object that may contain history in various formats
 * @returns {Array} - Normalized array of conversation history items
 */
const normalizeConversationHistory = (conversation) => {
    // --- Robust conversationHistory normalization (paste before any .map usage) ---
    let rawHistory = conversation?.conversationHistory || conversation?.history || conversation?.messages || null;

    // Normalize into an array
    let conversationHistory;
    if (Array.isArray(rawHistory)) {
        conversationHistory = rawHistory;
    } else if (!rawHistory) {
        conversationHistory = [];
    } else if (typeof rawHistory === 'string') {
        try {
            const parsed = JSON.parse(rawHistory);
            conversationHistory = Array.isArray(parsed) ? parsed : [parsed];
        } catch (e) {
            // not JSON — treat as single-string entry
            conversationHistory = [rawHistory];
        }
    } else if (typeof rawHistory === 'object') {
        // single object -> wrap in array
        conversationHistory = [rawHistory];
    } else {
        conversationHistory = [];
    }

    // Small improvement: better logging & metrics for followups
    console.log('[FOLLOWUP] conversationHistory type:', typeof rawHistory, 'length:', Array.isArray(conversationHistory) ? conversationHistory.length : 0);

    return conversationHistory;
};

/**
 * Converts normalized conversation history to text format for AI analysis
 * @param {Array} conversationHistory - Normalized conversation history array
 * @returns {string} - Formatted text representation of conversation history
 */
const conversationHistoryToText = (conversationHistory) => {
    // Now safe to map
    const historyText = conversationHistory
        .map(h => (typeof h === 'string' ? h : (h.message_body || h.text || JSON.stringify(h))))
        .filter(Boolean)
        .join('\n');

    return historyText;
};

/**
 * Complete utility to normalize conversation and extract text for analysis
 * @param {*} conversation - Conversation object
 * @returns {string} - Ready-to-use text for AI analysis
 */
const getConversationTextForAnalysis = (conversation) => {
    const normalizedHistory = normalizeConversationHistory(conversation);
    return conversationHistoryToText(normalizedHistory);
};

/**
 * Uses the OpenAI API to categorize the user's message.
 * @param {string} userMessage The message from the end-user.
 * @param {Object} conversation Optional conversation object with history for better context.
 * @returns {string} The category of the response (e.g., 'INTERESTED', 'NOT_INTERESTED', 'HAS_QUESTION').
 */
const categorizeResponse = async (userMessage, conversation = null) => {
    try {
        // Get conversation context if available
        let contextText = '';
        if (conversation) {
            const conversationText = getConversationTextForAnalysis(conversation);
            if (conversationText.length > 0) {
                contextText = `\n\nConversation history:\n${conversationText.slice(-1000)}`; // Last 1000 chars for context
            }
        }

        const response = await openai.chat.completions.create({
            model: "gpt-3.5-turbo",
            messages: [{
                role: "system",
                content: `You are a sales assistant analyzing customer replies. Categorize the following message into one of these exact categories: INTERESTED, NOT_INTERESTED, HAS_QUESTION, OTHER. 

Consider the conversation history if provided for better context. Focus on the customer's intent and engagement level.

INTERESTED: Customer shows interest in products, asks about pricing, availability, or wants to proceed with purchase
NOT_INTERESTED: Customer clearly declines, says not interested, or wants to stop communication
HAS_QUESTION: Customer has specific questions about products, services, or needs clarification
OTHER: Any other response that doesn't clearly fit the above categories

Respond with only the category name.`
            }, {
                role: "user",
                content: `Current message: ${userMessage}${contextText}`
            }],
            temperature: 0,
        });
        return response.choices[0].message.content.trim();
    } catch (error) {
        console.error('Error categorizing response with OpenAI:', error);
        return 'OTHER'; // Default category on error
    }
};

/**
 * Updates the conversation in the database with the new category and schedules a follow-up if necessary.
 * @param {string} tenantId The ID of the tenant.
 * @param {string} endUserPhone The phone number of the end-user.
 * @param {string} category The category determined by the AI.
 */
const updateConversationCategory = async (tenantId, endUserPhone, category) => {
    try {
        // Calculate the follow-up time (e.g., 24 hours from now) if the lead is promising
        let followUpTime = null;
        if (category === 'INTERESTED' || category === 'HAS_QUESTION') {
            const now = new Date();
            now.setDate(now.getDate() + 1); // Add 24 hours
            followUpTime = now.toISOString();
        }

        const { error } = await dbClient
            .from('conversations_new')
            .update({
                end_user_category: category,
                updated_at: new Date().toISOString(),
                follow_up_at: followUpTime // Set the follow-up time
            })
            .eq('tenant_id', tenantId)
            .eq('end_user_phone', endUserPhone);

        if (error) {
            throw error;
        }

        if (followUpTime) {
            console.log(`Follow-up scheduled for ${endUserPhone} at ${followUpTime}`);
        }

    } catch (error) {
        console.error('Error updating conversation category in dbClient:', error.message);
    }
};

/**
 * Checks for any due follow-ups and sends a reminder message to the tenant.
 */
const sendDueFollowUpReminders = async () => {
    try {
        const now = new Date().toISOString();
        // Find conversations where the follow-up time is in the past
        const { data: dueFollowUps, error } = await dbClient
            .from('conversations_new')
            .select('id, tenant_id, end_user_phone, follow_up_at')
            .not('follow_up_at', 'is', null)
            .lte('follow_up_at', now);

        if (error) throw error;

        if (dueFollowUps && dueFollowUps.length > 0) {
            console.log(`Found ${dueFollowUps.length} due follow-up reminders to send.`);

            for (const followUp of dueFollowUps) {
                const { data: tenant } = await dbClient.from('tenants').select('phone_number').eq('id', followUp.tenant_id).single();
                if (!tenant?.phone_number) continue;
                const tenantPhoneNumber = tenant.phone_number;
                const customerPhoneNumber = followUp.end_user_phone;
                const reminderMessage = `Hi! This is a reminder to follow up with your customer at ${customerPhoneNumber}. They seemed interested!`;

                // Send the reminder message to the tenant
                await sendMessage(tenantPhoneNumber, reminderMessage);

                // Update the conversation to nullify the follow-up time so we don't send it again
                await dbClient
                    .from('conversations_new')
                    .update({ follow_up_at: null })
                    .eq('id', followUp.id);

                console.log(`Reminder sent to ${tenantPhoneNumber} for customer ${customerPhoneNumber}.`);
            }
        }
    } catch (error) {
        console.error('Error sending due follow-up reminders:', error.message);
    }
};


module.exports = {
    categorizeResponse,
    updateConversationCategory,
    sendDueFollowUpReminders,
    // Export normalization utilities for use by other services
    normalizeConversationHistory,
    conversationHistoryToText,
    getConversationTextForAnalysis
};



