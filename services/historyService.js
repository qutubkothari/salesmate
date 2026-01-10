/**
 * @title Conversation History Service
 * @description Manages logging messages and retrieving conversation transcripts.
 */
const { dbClient } = require('./config');

/**
 * Finds or creates a conversation record and returns its ID.
 * @param {string} tenantId The ID of the tenant.
 * @param {string} endUserPhone The phone number of the end-user.
 * @returns {Promise<string|null>} The UUID of the conversation.
 */
const getConversationId = async (tenantId, endUserPhone) => {
    try {
        // First, try to find an existing conversation
        let { data: conversation, error: findError } = await dbClient
            .from('conversations')
            .select('id')
            .eq('tenant_id', tenantId)
            .eq('end_user_phone', endUserPhone)
            .single();

        if (findError && findError.code !== 'PGRST116') { // Ignore 'single row not found' error
            throw findError;
        }

        // If a conversation is found, return its ID
        if (conversation) {
            return conversation.id;
        }

        // If not found, create a new one
        const { data: newConversation, error: createError } = await dbClient
            .from('conversations')
            .insert({
                tenant_id: tenantId,
                phone_number: endUserPhone,
                end_user_phone: endUserPhone
            })
            .select('id')
            .single();

        if (createError) throw createError;

        return newConversation.id;

    } catch (error) {
        console.error('Error finding or creating conversation:', error.message);
        return null;
    }
};

/**
 * Logs a message into the messages table with its type.
 * @param {string} tenantId The ID of the tenant.
 * @param {string} endUserPhone The phone number of the end-user.
 * @param {'user' | 'bot'} sender Who sent the message.
 * @param {string} messageBody The content of the message.
 * @param {string} messageType The category of the message for stats.
 */
const logMessage = async (tenantId, endUserPhone, sender, messageBody, messageType) => {
    try {
        const conversationId = await getConversationId(tenantId, endUserPhone);
        if (!conversationId) {
            throw new Error('Could not retrieve conversation ID for logging.');
        }

        const payload = {
            conversation_id: conversationId,
            sender: sender,
            message_body: messageBody,
            message_type: messageType // Save the message type
        };

        // Local SQLite analytics filters by tenant_id.
        if (process.env.USE_LOCAL_DB === 'true') {
            payload.tenant_id = tenantId;
        }

        const { error } = await dbClient
            .from('messages')
            .insert(payload);

        if (error) throw error;

    } catch (error) {
        console.error('Error logging message:', error.message);
    }
};


/**
 * Fetches the full transcript of a conversation.
 * @param {string} tenantId The ID of the tenant.
 * @param {string} endUserPhone The phone number of the customer.
 * @returns {Promise<string>} A formatted string of the conversation history.
 */
const getConversationHistory = async (tenantId, endUserPhone) => {
    try {
        const conversationId = await getConversationId(tenantId, endUserPhone);
        if (!conversationId) {
            return `No conversation history found for ${endUserPhone}.`;
        }

        const { data: messages, error } = await dbClient
            .from('messages')
            .select('sender, message_body, created_at')
            .eq('conversation_id', conversationId)
            .order('created_at', { ascending: true });

        if (error) throw error;

        if (!messages || messages.length === 0) {
            return `No messages found in the history for ${endUserPhone}.`;
        }

        let history = `*Conversation History with ${endUserPhone}*\n\n`;
        messages.forEach(msg => {
            const date = new Date(msg.created_at).toLocaleString();
            const sender = msg.sender.charAt(0).toUpperCase() + msg.sender.slice(1);
            history += `*[${date}] ${sender}:*\n${msg.message_body}\n\n`;
        });

        return history;

    } catch (error) {
        console.error('Error fetching conversation history:', error.message);
        return 'An error occurred while fetching the conversation history.';
    }
};

module.exports = {
    logMessage,
    getConversationHistory,
    getConversationId
};


