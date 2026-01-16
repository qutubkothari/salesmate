/**
 * @title AI Lead Scoring Service
 * @description Manages the logic for analyzing conversation history and assigning a lead score.
 */
const { dbClient, openai } = require('./config');
const { getConversationId } = require('./historyService');
const { normalizeConversationHistory, conversationHistoryToText, getConversationTextForAnalysis } = require('./followUpService');
const { upsertTriageForConversation } = require('./triageService');

function heuristicLeadScore(conversationText) {
    const text = String(conversationText || '').toLowerCase();

    const hotSignals = [
        'buy', 'order', 'place order', 'confirm', 'final',
        'payment', 'pay', 'upi', 'payment link', 'checkout',
        'deliver', 'delivery', 'ship', 'dispatch',
        'today', 'now'
    ];

    const warmSignals = [
        'price', 'rate', 'cost', 'quotation', 'quote',
        'available', 'availability', 'stock',
        'details', 'spec', 'specification',
        'catalog', 'brochure'
    ];

    if (hotSignals.some((k) => text.includes(k))) return 'Hot';
    if (warmSignals.some((k) => text.includes(k))) return 'Warm';
    return 'Cold';
}

/**
 * Analyzes a conversation and updates it with a lead score (Hot, Warm, Cold).
 * This is typically called after an interaction to re-evaluate the lead's temperature.
 * @param {string} tenantId The ID of the tenant.
 * @param {string} endUserPhone The phone number of the customer.
 */
const scoreLead = async (tenantId, endUserPhone) => {
    try {
        const conversationId = await getConversationId(tenantId, endUserPhone);
        if (!conversationId) return;

        // 1. Fetch the last 10 messages from the conversation for context.
        const { data: messages, error: messagesError } = await dbClient
            .from('messages')
            .select('sender, message_body')
            .eq('conversation_id', conversationId)
            .order('created_at', { ascending: false })
            .limit(10);

        if (messagesError) throw messagesError;
        if (!messages || messages.length === 0) return;

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

        // 2. Score the lead.
        // In local/dev we often run without OpenAI; fall back to a conservative heuristic.
        let score = null;
        if (openai && openai.chat && openai.chat.completions) {
            const response = await openai.chat.completions.create({
                model: "gpt-3.5-turbo",
                messages: [{
                    role: "system",
                    content: `You are a sales analyst. Analyze the following conversation and classify the user's purchase intent.
- If the user shows strong intent to buy, is asking for payment links, or is ready to purchase now, respond with only the word "Hot".
- If the user is asking questions about product details, pricing, or availability, respond with only the word "Warm".
- If the user is not interested, has just started the conversation, or is unresponsive, respond with only the word "Cold".
Respond with a single word only.`
                }, {
                    role: "user",
                    content: conversationText
                }],
                temperature: 0,
                max_tokens: 5,
            });

            score = response.choices[0].message.content.trim();
        } else {
            score = heuristicLeadScore(conversationText);
        }
        const validScores = ['Hot', 'Warm', 'Cold'];

        if (validScores.includes(score)) {
            // 3. Update the conversation with the new score.
            await dbClient
                .from('conversations_new')
                .update({ lead_score: score })
                .eq('id', conversationId);

            console.log(`Lead score for ${endUserPhone} updated to: ${score}`);
            
            // 4. Auto-create intelligent follow-up based on lead score
            try {
                const { createManualIntelligentFollowUp } = require('./intelligentFollowUpService');
                await createManualIntelligentFollowUp(tenantId, endUserPhone, score);
                console.log(`Intelligent follow-up scheduled for ${endUserPhone} (${score} lead)`);
            } catch (followUpError) {
                console.error('Error creating intelligent follow-up:', followUpError);
                // Don't fail the whole operation if follow-up creation fails
            }

            // 5. Auto-create triage for HOT leads
            if (String(score).toUpperCase() === 'HOT') {
                try {
                    await upsertTriageForConversation(dbClient, {
                        tenantId,
                        conversationId,
                        endUserPhone,
                        type: 'LEAD',
                        messagePreview: `Auto-triage: HOT lead scored`,
                        metadata: { source: 'leadScoringService', lead_score: score }
                    });
                } catch (_) {
                    // Best-effort: triage should never break lead scoring.
                }
            }
        } else {
            console.warn(`Invalid lead score received from AI: ${score}`);
        }

    } catch (error) {
        console.error('Error scoring lead:', error.message);
    }
};

module.exports = {
    scoreLead,
};


