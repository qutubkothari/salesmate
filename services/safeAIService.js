// services/safeAIService.js
// Module 3: Cost-Controlled AI Operations
// SAFE TO EXTRACT - Wraps existing AI services with cost controls

const { getAIResponse, getAIResponseV2 } = require('./aiService');
const costControlService = require('./costControlService');
const templateResponseService = require('./templateResponseService');

class SafeAIService {
    constructor() {
        console.log('[SAFE_AI] Service initialized');
    }

    /**
     * Estimate AI cost based on prompt characteristics
     * @param {string} prompt - AI prompt
     * @param {Object} options - AI options
     * @returns {number} - Estimated cost in USD
     */
    estimateCost(prompt, options = {}) {
        const promptLength = prompt?.length || 0;
        const model = options.mode || 'fast';
        
        // Cost estimates based on model and prompt length
        if (model === 'fast' || model.includes('3.5')) {
            // GPT-3.5-turbo pricing
            return Math.max(0.001, promptLength * 0.000001);
        } else {
            // GPT-4 pricing
            return Math.max(0.01, promptLength * 0.00001);
        }
    }

    /**
     * Safe AI call with cost controls
     * @param {string} tenantId - Tenant ID
     * @param {string} prompt - AI prompt
     * @param {Object} options - AI options
     * @returns {Promise<string>} - AI response or fallback
     */
    async safeAICall(tenantId, prompt, options = {}) {
        try {
            // Estimate cost
            const estimatedCost = this.estimateCost(prompt, options);
            
            // Check if AI usage is allowed
            const limitCheck = costControlService.checkAILimit(estimatedCost);
            
            if (!limitCheck.allowed) {
                console.log('[SAFE_AI] AI usage blocked:', limitCheck.reason);
                return costControlService.getFallbackResponse(limitCheck.reason);
            }

            // Use cheaper model for simple queries
            const enhancedOptions = {
                mode: prompt.length < 200 ? 'fast' : (options.mode || 'fast'),
                temperature: options.temperature || 0.7,
                max_tokens: Math.min(options.max_tokens || 150, 300) // Limit tokens to reduce cost
            };

            let aiResponse;
            let actualCost = estimatedCost;

            // Try V2 first (faster, cheaper)
            try {
                console.log('[SAFE_AI] Attempting AI V2 call...');
                aiResponse = await getAIResponseV2(tenantId, prompt, enhancedOptions);
                actualCost = this.estimateCost(prompt, enhancedOptions);
            } catch (v2Error) {
                console.warn('[SAFE_AI] V2 failed, trying fallback:', v2Error.message);
                aiResponse = await getAIResponse(tenantId, prompt);
                actualCost = estimatedCost * 1.5; // V1 is typically more expensive
            }

            // Track successful usage
            costControlService.trackAIUsage(actualCost);
            
            console.log('[SAFE_AI] Success - Cost:', actualCost.toFixed(4));
            return aiResponse;

        } catch (error) {
            console.error('[SAFE_AI] Error:', error.message);
            
            // Return appropriate fallback based on error
            if (error.message.includes('limit') || error.message.includes('quota')) {
                return costControlService.getFallbackResponse('DAILY_CALLS_EXCEEDED');
            }
            
            return costControlService.getFallbackResponse('DEFAULT');
        }
    }

    /**
     * Check if query should use AI or template response
     * @param {string} userQuery - User's message
     * @param {string} tenantId - Tenant ID
     * @param {string} phone - Customer phone number
     * @returns {Promise<Object>} - {useAI: boolean, templateResponse?: string, type?: string}
     */
    async shouldUseAI(userQuery, tenantId, phone) {
        // First try template responses
        const templateResult = await templateResponseService.handleTemplateResponse(userQuery, tenantId, phone);
        
        if (templateResult.handled) {
            return {
                useAI: false,
                templateResponse: templateResult.response,
                type: templateResult.type
            };
        }

        // Check if AI is available
        const limitCheck = costControlService.checkAILimit();
        
        if (!limitCheck.allowed) {
            return {
                useAI: false,
                templateResponse: costControlService.getFallbackResponse(limitCheck.reason),
                type: limitCheck.reason.toLowerCase()
            };
        }

        return { useAI: true };
    }

    /**
     * Main method to handle AI or template responses
     * @param {string} userQuery - User's message
     * @param {string} tenantId - Tenant ID
     * @param {string} phone - Customer phone number
     * @param {string} prompt - Full AI prompt (if AI is needed)
     * @param {Object} options - AI options
     * @returns {Promise<Object>} - {response: string, type: string, cost: number}
     */
    async getResponse(userQuery, tenantId, phone, prompt = null, options = {}) {
        console.log('[SAFE_AI] Processing query for AI/template decision');
        
        // Check if we should use AI or template
        const aiDecision = await this.shouldUseAI(userQuery, tenantId, phone);
        
        if (!aiDecision.useAI) {
            console.log('[SAFE_AI] Using template response:', aiDecision.type);
            return {
                response: aiDecision.templateResponse,
                type: aiDecision.type,
                cost: 0.0001, // Minimal database cost
                source: 'template'
            };
        }

        // Use AI
        console.log('[SAFE_AI] Using AI response');
        const estimatedCost = this.estimateCost(prompt || userQuery, options);
        const aiResponse = await this.safeAICall(tenantId, prompt || userQuery, options);
        
        return {
            response: aiResponse,
            type: 'ai_response',
            cost: estimatedCost,
            source: 'ai'
        };
    }

    /**
     * Get usage statistics
     * @returns {Object} - Usage stats
     */
    getUsageStats() {
        return costControlService.getUsageStats();
    }
}

// Export singleton instance
const safeAIService = new SafeAIService();
module.exports = safeAIService;
