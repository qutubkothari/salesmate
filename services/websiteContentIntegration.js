/**
 * Website Content Integration for Customer Queries
 * This module extends the AI assistant to search website content for product info
 */

const { searchWebsiteContent, findProductInfo } = require('./websiteSearchService');

/**
 * Search website content and enhance AI response
 * @param {string} query - Customer's query
 * @param {string} tenantId - Tenant ID
 * @param {string} productCode - Optional product code if known
 * @returns {Promise<Object>} Search results and formatted context
 */
async function searchWebsiteForQuery(query, tenantId, productCode = null) {
    console.log('[WebsiteContentIntegration] searchWebsiteForQuery called for:', query);
    try {
        let results = [];

        // If product code is known, search for that specific product
        if (productCode) {
            console.log('[WebsiteContentIntegration] Searching for product code:', productCode);
            results = await findProductInfo(productCode, tenantId);
        } else {
            // General semantic search - ALWAYS search, not just for product queries
            // Falls back to lexical search if embeddings unavailable
            console.log('[WebsiteContentIntegration] Performing semantic search for:', query);
            results = await searchWebsiteContent(query, tenantId, {
                limit: 8,  // Increased to get more potential results
                minSimilarity: 0.05  // Very low threshold to catch results from lexical fallback
            });
            console.log('[WebsiteContentIntegration] Found', results ? results.length : 0, 'results');
        }

        if (!results || results.length === 0) {
            console.log('[WebsiteContentIntegration] No results found');
            return null;
        }

        console.log('[WebsiteContentIntegration] Found', results.length, 'results');
        console.log('[WebsiteContentIntegration] First result keys:', Object.keys(results[0]));

        // Format results for AI context
        const context = results.map((result, idx) => 
            `[Source ${idx + 1}: ${result.pageTitle || result.page_title}]\n${result.content || result.chunk_text}`
        ).join('\n\n---\n\n');

        const sources = results.map(result => ({
            title: result.pageTitle || result.page_title,
            url: result.url,
            relevance: result.relevanceScore || Math.round(result.similarity * 100)
        }));

        return {
            found: true,
            context,
            sources,
            count: results.length
        };

    } catch (error) {
        console.error('[WebsiteContentIntegration] Search error:', error);
        return null;
    }
}

/**
 * Enhance AI system prompt with website content
 * @param {string} basePrompt - Base system prompt
 * @param {Object} websiteContext - Website search results
 * @returns {string} Enhanced prompt
 */
function enhancePromptWithWebsiteContent(basePrompt, websiteContext) {
    if (!websiteContext || !websiteContext.found) {
        return basePrompt;
    }

    const websiteSection = `

## Additional Information from Website

I found relevant information from our website that may help answer the customer's question:

${websiteContext.context}

Please use this information to provide accurate and detailed answers about our products, specifications, and pricing. Always prioritize this official website information when available.

Sources: ${websiteContext.sources.map(s => `${s.title} (${s.relevance}% relevant)`).join(', ')}
`;

    return basePrompt + websiteSection;
}

/**
 * Check if query should get website context enrichment
 * Broadened to include ANY business-related query since we want to reference docs
 * @param {string} query - Customer query
 * @returns {boolean}
 */
function isProductInfoQuery(query) {
    // Broadly match ANY query that might benefit from website/docs context
    const infoKeywords = [
        'spec', 'specification', 'technical', 'details', 'feature',
        'price', 'cost', 'rate', 'pricing',
        'about', 'information', 'tell me', 'what is', 'how',
        'how much', 'available', 'describe', 'learn', 'explain',
        'develop', 'build', 'create', 'bot', 'feature', 'can',
        'help', 'assistant', 'system', 'platform', 'service'
    ];

    const queryLower = query.toLowerCase();
    return infoKeywords.some(keyword => queryLower.includes(keyword));
}

/**
 * Extract product code from query if present
 * @param {string} query - Customer query
 * @returns {string|null} Product code if found
 */
function extractProductCodeFromQuery(query) {
    // Pattern for common product codes (customize for your products)
    const patterns = [
        /\b[A-Z]{2,4}[-\s]?\d{1,4}[-\s]?[A-Z0-9]{0,4}\b/gi, // e.g., NFF-640, ABC 123
        /\b\d{4,6}\b/g, // Simple numeric codes
    ];

    for (const pattern of patterns) {
        const matches = query.match(pattern);
        if (matches && matches.length > 0) {
            return matches[0].trim();
        }
    }

    return null;
}

module.exports = {
    searchWebsiteForQuery,
    enhancePromptWithWebsiteContent,
    isProductInfoQuery,
    extractProductCodeFromQuery
};

