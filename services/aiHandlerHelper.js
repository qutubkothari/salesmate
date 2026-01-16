// aiHandlerHelper.js
// Helper for AI integration points: processAndRoute, checkOrderAndSuggest, forceAIResponse

const aiIntegration = require('./aiIntegrationService');

module.exports = {
  /**
   * Process message and decide routing
   */
  async processAndRoute(phoneNumber, message, tenantId) {
    try {
      console.log('[AI Helper] Processing:', {
        phone: phoneNumber,
        tenant: tenantId,
        text: message && typeof message === 'string' ? message.substring(0, 50) : ''
      });
      // Use phone number as-is, don't normalize
      const result = await aiIntegration.processMessage(
        phoneNumber,  // Pass exactly as received
        message,
        tenantId
      );

      return {
        action: result.action,
        intent: result.intent || 'general_inquiry',
        confidence: result.confidence || 0.5,
        response: result.response,
        shouldUseRules: result.action === 'use_rules',
        shouldTransferHuman: result.action === 'transfer_to_human',
        aiResponse: result.action === 'ai_response' ? result.response : null,
        routing: result.routing
      };

    } catch (error) {
      console.error('Error in AI routing:', error);
      return {
        action: 'use_rules',
        intent: 'general_inquiry',
        confidence: 0.5,
        shouldUseRules: true,
        error: error.message
      };
    }
  },

  /**
   * Check order for anomalies and suggest improvements
   */
  async checkOrderAndSuggest(customerProfileId, orderItems) {
    // Placeholder: Simulate suggestion if quantity > 5
    const hasSuggestions = orderItems.some(item => item.quantity > 5);
    return {
      hasSuggestions,
      message: hasSuggestions ? 'Consider reducing quantity for better pricing.' : '',
    };
  },

  /**
   * Force AI to generate a response (for complex queries)
   */
  async forceAIResponse(phoneNumber, message, tenantId, options = {}) {
    // Placeholder: Always return an AI response
    return 'This is a forced AI response.';
  }
};

