/**
 * @title AI Conversation Tagging Service
 * @description Manages the logic for automatically analyzing and tagging conversations using AI.
 */
const { dbClient, openai } = require('./config');
const { getConversationId } = require('./historyService');
const { normalizeConversationHistory, conversationHistoryToText, getConversationTextForAnalysis } = require('./followUpService');

/**
 * Gets or creates tag records for a tenant.
 * @param {string} tenantId The ID of the tenant.
 * @param {string[]} tagNames An array of tag names to get or create.
 * @returns {Promise<object[]>} An array of tag objects with their IDs.
 */
const getOrCreateTags = async (tenantId, tagNames) => {
    // Upsert the tags. This will create any tags that don't exist and do nothing for those that do.
    // The `onConflict` option ensures we don't create duplicate tags for the same tenant.
    const { data, error } = await dbClient
        .from('tags')
        .upsert(
            tagNames.map(name => ({ tenant_id: tenantId, tag_name: name.toLowerCase() })),
            { onConflict: 'tenant_id, tag_name', ignoreDuplicates: false }
        )
        .select('id, tag_name');

    if (error) throw error;
    return data;
};

/**
 * Analyzes a conversation and applies relevant tags.
 * @param {string} tenantId The ID of the tenant.
 * @param {string} endUserPhone The phone number of the customer.
 */
const analyzeAndTagConversation = async (tenantId, endUserPhone) => {
    try {
        const conversationId = await getConversationId(tenantId, endUserPhone);
        if (!conversationId) return;

        const { data: messages, error: messagesError } = await dbClient
            .from('messages')
            .select('sender, message_body')
            .eq('conversation_id', conversationId)
            .order('created_at', { ascending: false })
            .limit(20); // Get a good amount of recent context

        if (messagesError) throw messagesError;
        if (!messages || messages.length < 2) return; // Not enough context

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

        const response = await openai.chat.completions.create({
            model: "gpt-4-turbo",
            messages: [{
                role: "system",
                content: "You are a data analyst. Analyze the following conversation and identify key topics. Respond with a comma-separated list of 2-4 relevant tags. Examples: pricing_inquiry, shipping_question, product_feedback, interested_in_shoes, complaint, technical_issue."
            }, {
                role: "user",
                content: conversationText
            }],
            temperature: 0.2,
        });

        const tagsString = response.choices[0].message.content.trim();
        if (!tagsString) return;

        const tagNames = tagsString.split(',').map(tag => tag.trim().toLowerCase().replace(/\s+/g, '_'));
        if (tagNames.length === 0) return;

        // 1. Get or create the tag records
        const tags = await getOrCreateTags(tenantId, tagNames);
        if (!tags || tags.length === 0) return;

        // 2. Prepare the links between the conversation and the tags
        const conversationTags = tags.map(tag => ({
            conversation_id: conversationId,
            tag_id: tag.id
        }));

        // 3. Insert the links, ignoring any duplicates
        await dbClient.from('conversation_tags').upsert(conversationTags, { onConflict: 'conversation_id, tag_id' });

        console.log(`Applied tags to conversation with ${endUserPhone}: ${tagNames.join(', ')}`);

    } catch (error) {
        console.error('Error analyzing and tagging conversation:', error.message);
    }
};

/**
 * Lists all tags applied to a specific conversation.
 * @param {string} tenantId The ID of the tenant.
 * @param {string} endUserPhone The phone number of the customer.
 * @returns {Promise<string>} A formatted list of tags.
 */
const listConversationTags = async (tenantId, endUserPhone) => {
    try {
        const conversationId = await getConversationId(tenantId, endUserPhone);
        if (!conversationId) return `No conversation found for ${endUserPhone}.`;

        const { data, error } = await dbClient
            .from('conversation_tags')
            .select(`
                tag:tags (tag_name)
            `)
            .eq('conversation_id', conversationId);

        if (error) throw error;
        if (!data || data.length === 0) {
            return `No tags have been applied to the conversation with ${endUserPhone} yet.`;
        }

        const tagNames = data.map(item => `#${item.tag.tag_name}`);
        return `*Tags for conversation with ${endUserPhone}:*\n${tagNames.join(', ')}`;

    } catch (error) {
        console.error('Error listing conversation tags:', error.message);
        return 'An error occurred while fetching tags.';
    }
};

module.exports = {
    analyzeAndTagConversation,
    listConversationTags,
};


