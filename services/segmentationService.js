/**
 * @title AI Customer Segmentation Service
 * @description Manages the logic for creating custom segments and automatically assigning them to customers.
 */
const { dbClient, openai } = require('./config');
const { getConversationId } = require('./historyService');
const { normalizeConversationHistory, conversationHistoryToText, getConversationTextForAnalysis } = require('./followUpService');

/**
 * Creates a new customer segment for a tenant.
 * @param {string} tenantId The ID of the tenant.
 * @param {string} segmentName The name of the segment (e.g., "High-Value Customers").
 * @returns {Promise<string>} A confirmation or error message.
 */
const createSegment = async (tenantId, segmentName) => {
    try {
        await dbClient.from('customer_segments').insert({ tenant_id: tenantId, segment_name: segmentName });
        return `Segment "${segmentName}" created successfully.`;
    } catch (error) {
        if (error.code === '23505') return `A segment named "${segmentName}" already exists.`;
        console.error('Error creating segment:', error.message);
        return 'An error occurred while creating the segment.';
    }
};

/**
 * Deletes a customer segment for a tenant.
 * @param {string} tenantId The ID of the tenant.
 * @param {string} segmentName The name of the segment to delete.
 * @returns {Promise<string>} A confirmation or error message.
 */
const deleteSegment = async (tenantId, segmentName) => {
    try {
        // Must delete by ID, so fetch it first. Cascade delete will handle conversation_segments.
        const { data: segment, error: findError } = await dbClient
            .from('customer_segments')
            .select('id')
            .eq('tenant_id', tenantId)
            .eq('segment_name', segmentName)
            .single();

        if (findError || !segment) return `Segment "${segmentName}" not found.`;

        await dbClient.from('customer_segments').delete().eq('id', segment.id);
        return `Segment "${segmentName}" has been deleted.`;
    } catch (error) {
        console.error('Error deleting segment:', error.message);
        return 'An error occurred while deleting the segment.';
    }
};

/**
 * Lists all customer segments for a tenant.
 * @param {string} tenantId The ID of the tenant.
 * @returns {Promise<string>} A formatted list of segments.
 */
const listSegments = async (tenantId) => {
    try {
        const { data, error } = await dbClient
            .from('customer_segments')
            .select('segment_name')
            .eq('tenant_id', tenantId);
        if (error) throw error;
        if (!data || data.length === 0) return 'You have not created any customer segments yet. Use `/add_segment` to start.';
        return `*Your Customer Segments:*\n- ${data.map(s => s.segment_name).join('\n- ')}`;
    } catch (error) {
        console.error('Error listing segments:', error.message);
        return 'An error occurred while fetching your segments.';
    }
};

/**
 * Analyzes a conversation and assigns it to the most relevant custom segments.
 * @param {string} tenantId The ID of the tenant.
 * @param {string} endUserPhone The phone number of the customer.
 */
const segmentConversation = async (tenantId, endUserPhone) => {
    try {
        const conversationId = await getConversationId(tenantId, endUserPhone);
        if (!conversationId) return;

        const { data: segments, error: segError } = await dbClient
            .from('customer_segments')
            .select('id, segment_name')
            .eq('tenant_id', tenantId);

        if (segError || !segments || segments.length === 0) {
            console.log(`Tenant ${tenantId} has no segments defined. Skipping segmentation.`);
            return;
        }

        const { data: messages, error: msgError } = await dbClient
            .from('messages')
            .select('sender, message_body')
            .eq('conversation_id', conversationId)
            .order('created_at', { ascending: false })
            .limit(30);

        if (msgError || messages.length < 3) return;

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
        const segmentList = segments.map(s => s.segment_name).join(', ');

        const response = await openai.chat.completions.create({
            model: "gpt-4-turbo",
            messages: [{
                role: "system",
                content: `You are a customer data platform analyst. Based on the following conversation and the provided list of segments, identify the MOST relevant segment for this customer. Respond with only the name of the single best-fit segment from the list. If none are a good fit, respond with "None".\n\nAvailable Segments: [${segmentList}]`
            }, {
                role: "user",
                content: conversationText
            }],
            temperature: 0,
        });

        const bestFitSegmentName = response.choices[0].message.content.trim();
        const matchedSegment = segments.find(s => s.segment_name.toLowerCase() === bestFitSegmentName.toLowerCase());

        if (matchedSegment) {
            await dbClient.from('conversation_segments').upsert({
                conversation_id: conversationId,
                segment_id: matchedSegment.id
            }, { onConflict: 'conversation_id, segment_id' });
            console.log(`Assigned conversation with ${endUserPhone} to segment: ${matchedSegment.segment_name}`);
        }

    } catch (error) {
        console.error('Error during conversation segmentation:', error.message);
    }
};

/**
 * Lists all segments a specific conversation belongs to.
 * @param {string} tenantId The ID of the tenant.
 * @param {string} endUserPhone The phone number of the customer.
 * @returns {Promise<string>} A formatted list of segments for the conversation.
 */
const listConversationSegments = async (tenantId, endUserPhone) => {
    try {
        const conversationId = await getConversationId(tenantId, endUserPhone);
        if (!conversationId) return `No conversation found for ${endUserPhone}.`;

        const { data, error } = await dbClient
            .from('conversation_segments')
            .select('segment:customer_segments (segment_name)')
            .eq('conversation_id', conversationId);

        if (error) throw error;
        if (!data || data.length === 0) return `The conversation with ${endUserPhone} has not been assigned to any segments yet.`;

        const segmentNames = data.map(item => `*${item.segment.segment_name}*`);
        return `*Segments for ${endUserPhone}:*\n- ${segmentNames.join('\n- ')}`;

    } catch (error) {
        console.error('Error listing conversation segments:', error.message);
        return 'An error occurred while fetching segments.';
    }
};

module.exports = {
    createSegment,
    deleteSegment,
    listSegments,
    segmentConversation,
    listConversationSegments,
};

