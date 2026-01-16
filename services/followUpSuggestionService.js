/**
 * @title AI Follow-up Suggestion Service
 * @description Manages the logic for generating and retrieving AI-powered follow-up suggestions for tenants.
 */
const { dbClient, openai } = require('./config');
const { getConversationId } = require('./historyService');
const { normalizeConversationHistory, conversationHistoryToText, getConversationTextForAnalysis } = require('./followUpService');

/**
 * Generates a follow-up suggestion for a conversation and saves it to the database.
 * This is called when a conversation is identified as needing a follow-up (e.g., lead score is 'Warm').
 * @param {string} tenantId The ID of the tenant.
 * @param {string} endUserPhone The phone number of the customer.
 */
const generateFollowUpSuggestion = async (tenantId, endUserPhone) => {
    try {
        const conversationId = await getConversationId(tenantId, endUserPhone);
        if (!conversationId) return;

        // 1. Fetch the last 10 messages to provide context for the suggestion.
        const { data: messages, error: messagesError } = await dbClient
            .from('messages')
            .select('sender, message_body')
            .eq('conversation_id', conversationId)
            .order('created_at', { ascending: false })
            .limit(10);

        if (messagesError) throw messagesError;
        if (!messages || messages.length < 2) { // Need at least a bit of conversation
            console.log(`Not enough messages to generate a follow-up for ${endUserPhone}.`);
            return;
        }

        // --- Robust conversationHistory normalization (paste before any .map usage) ---
        // Normalize messages array to handle various formats
        let normalizedMessages;
        if (Array.isArray(messages)) {
            normalizedMessages = messages;
        } else if (!messages) {
            normalizedMessages = [];
        } else if (typeof messages === 'string') {
            try {
                const parsed = JSON.parse(messages);
                normalizedMessages = Array.isArray(parsed) ? parsed : [parsed];
            } catch (e) {
                normalizedMessages = [{ message_body: messages, sender: 'unknown' }];
            }
        } else if (typeof messages === 'object') {
            normalizedMessages = [messages];
        } else {
            normalizedMessages = [];
        }

        // Safe conversation text generation with enhanced error handling
        const conversationText = normalizedMessages
            .reverse()
            .map(m => {
                const sender = m.sender || 'unknown';
                const body = m.message_body || m.text || m.content || '';
                return `${sender}: ${body}`;
            })
            .filter(Boolean)
            .join('\n');

        // 2. Call the AI with a prompt to generate a sales-focused follow-up message.
        const response = await openai.chat.completions.create({
            model: "gpt-4-turbo", // Using a more advanced model for higher quality suggestions
            messages: [{
                role: "system",
                content: `You are an expert sales coach. Based on the following conversation, write a concise and effective follow-up message that the business owner (the 'bot' sender in the history) could send to the customer (the 'user' sender). The goal is to re-engage the customer and move them towards a sale. The message should be friendly and professional. Respond with only the suggested message text.`
            }, {
                role: "user",
                content: conversationText
            }],
            temperature: 0.7,
        });

        const suggestion = response.choices[0].message.content.trim();

        if (suggestion) {
            // 3. Save the new suggestion, replacing any old one for this conversation.
            await dbClient
                .from('follow_up_suggestions')
                .upsert({
                    conversation_id: conversationId,
                    suggestion_text: suggestion,
                    generated_at: new Date().toISOString(),
                    is_viewed: false
                }, { onConflict: 'conversation_id' });

            console.log(`Generated new follow-up suggestion for ${endUserPhone}.`);
        }

    } catch (error) {
        console.error('Error generating follow-up suggestion:', error.message);
    }
};

/**
 * Retrieves the latest follow-up suggestion for a specific conversation.
 * @param {string} tenantId The ID of the tenant.
 * @param {string} endUserPhone The phone number of the customer.
 * @returns {Promise<string>} The suggestion message or a status message.
 */
const getFollowUpSuggestion = async (tenantId, endUserPhone) => {
    try {
        const conversationId = await getConversationId(tenantId, endUserPhone);
        if (!conversationId) return `No conversation history found for ${endUserPhone}.`;

        const { data, error } = await dbClient
            .from('follow_up_suggestions')
            .select('suggestion_text')
            .eq('conversation_id', conversationId)
            .single();

        if (error || !data) {
            return `No follow-up suggestion has been generated for ${endUserPhone} yet. Suggestions are created after a conversation develops.`;
        }

        // Mark the suggestion as viewed after retrieving it.
        await dbClient
            .from('follow_up_suggestions')
            .update({ is_viewed: true })
            .eq('conversation_id', conversationId);

        let response = `💡 *AI Follow-up Suggestion for ${endUserPhone}*\n\n`;
        response += `You could send this message to re-engage them:\n\n`;
        response += `_"${data.suggestion_text}"_`;

        return response;

    } catch (error) {
        console.error('Error getting follow-up suggestion:', error.message);
        return 'An error occurred while fetching the suggestion.';
    }
};

module.exports = {
    generateFollowUpSuggestion,
    getFollowUpSuggestion,
};



