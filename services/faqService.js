/**
 * @title Smart FAQ Service
 * @description Manages the logic for adding, deleting, and searching for tenant FAQs using vector similarity.
 */
const { dbClient } = require('./config');
const { createEmbedding } = require('./aiService'); // We'll reuse the embedding function

/**
 * Common product FAQs for all tenants
 */
const commonProductFAQs = [
    {
        question: "carton mein kitne pieces",
        patterns: [/carton.*pieces/i, /pieces.*carton/i, /kitne pieces/i, /how many.*pieces/i],
        answer: "Standard carton sizes:\n• 6x40, 6x60: 3000-2000 pieces\n• 8x60, 8x80: 1500 pieces\n• 8x100, 8x120: 1200-1100 pieces\n• 10x80: 1000 pieces\n• 10x100+: 700-500 pieces"
    },
    {
        question: "bulk discount",
        patterns: [/bulk.*discount/i, /wholesale.*price/i, /quantity.*discount/i, /bulk.*rate/i, /wholesale.*rate/i],
        answer: "Bulk discounts available:\n• 10+ cartons: 5% off\n• 50+ cartons: 10% off\n• 100+ cartons: 15% off\nContact us for custom rates on larger quantities."
    },
    {
        question: "payment methods",
        patterns: [/payment.*method/i, /how.*pay/i, /payment.*option/i, /cash.*card/i],
        answer: "We accept:\n• UPI (PhonePe, GPay, Paytm)\n• Bank Transfer (NEFT/IMPS)\n• Cash on Delivery\n• Credit/Debit Cards\n• Net Banking"
    },
    {
        question: "delivery time",
        patterns: [/delivery.*time/i, /when.*deliver/i, /shipping.*time/i, /kitne din/i],
        answer: "Delivery timeframes:\n• Local: 1-2 days\n• Metro cities: 2-3 days\n• Other locations: 3-5 days\n• Bulk orders: 5-7 days"
    }
];

/**
 * Adds a new FAQ for a tenant, including generating its vector embedding.
 * @param {string} tenantId The ID of the tenant.
 * @param {string} question The FAQ question.
 * @param {string} answer The FAQ answer.
 * @returns {Promise<string>} A confirmation or error message.
 */
const addFaq = async (tenantId, question, answer) => {
    try {
        // 1. Generate an embedding for the question.
        const embedding = await createEmbedding(question);

        // 2. Insert the FAQ into the database.
        const { error } = await dbClient
            .from('faqs')
            .insert({
                tenant_id: tenantId,
                question: question,
                answer: answer,
                embedding: embedding,
            });

        if (error) throw error;

        return `FAQ for the question "${question}" has been added successfully.`;
    } catch (error) {
        console.error('Error adding FAQ:', error.message);
        return 'An error occurred while adding the FAQ.';
    }
};

/**
 * Deletes an FAQ for a tenant based on its exact question.
 * @param {string} tenantId The ID of the tenant.
 * @param {string} question The exact question of the FAQ to delete.
 * @returns {Promise<string>} A confirmation or error message.
 */
const deleteFaq = async (tenantId, question) => {
    try {
        const { error } = await dbClient
            .from('faqs')
            .delete()
            .eq('tenant_id', tenantId)
            .eq('question', question);

        if (error) throw error;

        return `FAQ for the question "${question}" has been deleted.`;
    } catch (error) {
        console.error('Error deleting FAQ:', error.message);
        return 'An error occurred while deleting the FAQ.';
    }
};

/**
 * Lists all FAQs for a tenant.
 * @param {string} tenantId The ID of the tenant.
 * @returns {Promise<string>} A formatted list of all FAQs.
 */
const listFaqs = async (tenantId) => {
    try {
        const { data, error } = await dbClient
            .from('faqs')
            .select('question')
            .eq('tenant_id', tenantId);

        if (error) throw error;

        if (!data || data.length === 0) {
            return 'You have not added any FAQs yet. Use `/add_faq "<question>" "<answer>"` to create one.';
        }

        let listMessage = '*Your current FAQs (Questions only):*\n\n';
        data.forEach((faq, index) => {
            listMessage += `${index + 1}. ${faq.question}\n`;
        });

        return listMessage;
    } catch (error) {
        console.error('Error listing FAQs:', error.message);
        return 'An error occurred while fetching your FAQs.';
    }
};

/**
 * Finds the best FAQ match for a user's query using vector similarity search.
 * First checks common product FAQs, then tenant-specific FAQs.
 * @param {string} tenantId The ID of the tenant.
 * @param {string} userQuery The user's question.
 * @returns {Promise<string|null>} The answer to the best matching FAQ, or null if no good match is found.
 */
const findFaqResponse = async (tenantId, userQuery) => {
    try {
        console.log('[FAQ_SERVICE] Searching for FAQ response for query:', userQuery);

        // 1. First check common product FAQs (faster, pattern-based)
        const commonFaqResponse = await checkCommonFAQs(userQuery);
        if (commonFaqResponse) {
            console.log('[FAQ_SERVICE] Found common FAQ match');
            return commonFaqResponse;
        }

        // 2. If no common FAQ matches, check tenant-specific FAQs using vector similarity
        const queryEmbedding = await createEmbedding(userQuery);

        let data = null;
        try {
            const { data: rpcData, error } = await dbClient.rpc('match_faqs', {
                tenant_id_param: tenantId,
                query_embedding: queryEmbedding,
                match_threshold: 0.8,
                match_count: 1
            });
            if (error) throw error;
            data = rpcData;
        } catch (rpcErr) {
            // Local SQLite mode: fall back to basic text matching.
            const needle = String(userQuery || '').trim().slice(0, 120);
            const { data: rows, error: qErr } = await dbClient
                .from('tenant_faqs')
                .select('question, answer')
                .eq('tenant_id', tenantId)
                .or(`question.ilike.%${needle}%,answer.ilike.%${needle}%`)
                .limit(1);
            if (qErr) throw qErr;
            data = rows;
        }

        // 3. If a good match is found, return its answer.
        if (data && data.length > 0) {
            console.log(`[FAQ_SERVICE] Tenant FAQ matched with similarity: ${data[0].similarity}`);
            return data[0].answer;
        }

        console.log('[FAQ_SERVICE] No FAQ match found');
        return null; // No sufficiently similar FAQ was found.
    } catch (error) {
        console.error('[FAQ_SERVICE] Error finding FAQ response:', error.message);
        return null;
    }
};

/**
 * Check if user query matches any common product FAQs
 * @param {string} userQuery The user's question
 * @returns {string|null} The answer if a pattern matches, null otherwise
 */
const checkCommonFAQs = async (userQuery) => {
    try {
        const lowerQuery = userQuery.toLowerCase();
        
        for (const faq of commonProductFAQs) {
            // Check if any pattern matches the user query
            for (const pattern of faq.patterns) {
                if (pattern.test(lowerQuery)) {
                    console.log(`[FAQ_SERVICE] Common FAQ matched: "${faq.question}" with pattern: ${pattern}`);
                    return faq.answer;
                }
            }
        }
        
        return null; // No common FAQ pattern matched
    } catch (error) {
        console.error('[FAQ_SERVICE] Error checking common FAQs:', error.message);
        return null;
    }
};

module.exports = {
    addFaq,
    deleteFaq,
    listFaqs,
    findFaqResponse,
    checkCommonFAQs,
    commonProductFAQs
};


