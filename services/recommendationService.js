/**
 * @title AI Product Recommendation Service
 * @description Manages the logic for providing AI-powered product recommendations based on user queries.
 */
const { dbClient } = require('./config');
const { createEmbedding } = require('./aiService'); // Reuse the embedding function
const { searchProducts } = require('./productService');

/**
 * Finds and recommends the best products for a user's natural language query.
 * @param {string} tenantId The ID of the tenant.
 * @param {string} userQuery The open-ended query from the customer (e.g., "what's a good gift?").
 * @returns {Promise<string|null>} A formatted string with product recommendations, or null if none are found.
 */
const getProductRecommendations = async (tenantId, userQuery) => {
    try {
        // Prefer productService.searchProducts since it gracefully falls back in local DB mode.
        const products = await searchProducts(tenantId, userQuery, 3);

        if (!products || products.length === 0) {
            return null; // Return null to indicate no recommendations were found.
        }

        // 3. Format the recommendations into a helpful message.
        let recommendationMessage = `Based on what you're looking for, here are a few suggestions I found:\n\n`;
        products.forEach(product => {
            recommendationMessage += `*${product.name}*\n`;
            recommendationMessage += `*Price:* $${product.price}\n`;
            recommendationMessage += `*Description:* ${product.description}\n\n`;
        });
        recommendationMessage += `You can add any of these to your cart with the \`/add_to_cart <product name>\` command!`;

        return recommendationMessage;

    } catch (error) {
        console.error('Error getting product recommendations:', error.message);
        return "I'm sorry, I had trouble finding recommendations at the moment. Please try asking in a different way.";
    }
};

module.exports = {
    getProductRecommendations,
};

