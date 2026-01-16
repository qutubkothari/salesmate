// services/costControlService.js
// Module 1: Cost Control & AI Usage Management
// SAFE TO EXTRACT - No external dependencies on customerHandler

class CostControlService {
    constructor() {
        this.dailyAICalls = 0;
        this.dailyAICost = 0;
        this.lastResetDate = new Date().toDateString();
        
        // Configuration from environment
        this.MAX_DAILY_AI_CALLS = parseInt(process.env.MAX_DAILY_AI_CALLS) || 20;
        this.AI_COST_LIMIT = parseFloat(process.env.MAX_AI_COST_PER_DAY) || 5.00;
        this.AI_DISABLED = process.env.AI_DISABLED === 'true';
        
        console.log('[COST_CONTROL] Initialized with limits:', {
            maxCalls: this.MAX_DAILY_AI_CALLS,
            maxCost: this.AI_COST_LIMIT,
            disabled: this.AI_DISABLED
        });
    }

    /**
     * Reset daily counters if new day
     */
    resetDailyCounters() {
        const currentDate = new Date().toDateString();
        if (currentDate !== this.lastResetDate) {
            this.dailyAICalls = 0;
            this.dailyAICost = 0;
            this.lastResetDate = currentDate;
            console.log('[COST_CONTROL] Daily counters reset');
        }
    }

    /**
     * Check if AI usage is within limits
     * @param {number} estimatedCost - Estimated cost of the AI operation
     * @returns {Object} - {allowed: boolean, reason: string}
     */
    checkAILimit(estimatedCost = 0.03) {
        this.resetDailyCounters();
        
        if (this.AI_DISABLED) {
            return {
                allowed: false,
                reason: 'AI_DISABLED',
                message: 'AI is currently disabled for cost control'
            };
        }
        
        if (this.dailyAICalls >= this.MAX_DAILY_AI_CALLS) {
            return {
                allowed: false,
                reason: 'DAILY_CALLS_EXCEEDED',
                message: `Daily AI call limit reached (${this.MAX_DAILY_AI_CALLS})`
            };
        }
        
        if (this.dailyAICost + estimatedCost >= this.AI_COST_LIMIT) {
            return {
                allowed: false,
                reason: 'DAILY_COST_EXCEEDED',
                message: `Daily AI cost limit would be exceeded ($${this.AI_COST_LIMIT})`
            };
        }
        
        return {
            allowed: true,
            reason: 'WITHIN_LIMITS',
            message: 'AI usage within limits'
        };
    }

    /**
     * Track AI usage (call after successful AI operation)
     * @param {number} actualCost - Actual cost of the AI operation
     */
    trackAIUsage(actualCost = 0.03) {
        this.resetDailyCounters();
        this.dailyAICalls++;
        this.dailyAICost += actualCost;
        
        console.log(`[COST_CONTROL] AI Usage: ${this.dailyAICalls}/${this.MAX_DAILY_AI_CALLS} calls, $${this.dailyAICost.toFixed(4)}/$${this.AI_COST_LIMIT}`);
    }

    /**
     * Get current usage statistics
     * @returns {Object} - Current usage stats
     */
    getUsageStats() {
        this.resetDailyCounters();
        return {
            dailyCalls: this.dailyAICalls,
            maxCalls: this.MAX_DAILY_AI_CALLS,
            dailyCost: this.dailyAICost,
            maxCost: this.AI_COST_LIMIT,
            callsRemaining: Math.max(0, this.MAX_DAILY_AI_CALLS - this.dailyAICalls),
            costRemaining: Math.max(0, this.AI_COST_LIMIT - this.dailyAICost),
            aiDisabled: this.AI_DISABLED
        };
    }

    /**
     * Get fallback response for when AI limits are exceeded
     * @param {string} reason - Reason for fallback
     * @returns {string} - Fallback message
     */
    getFallbackResponse(reason) {
        const responses = {
            'AI_DISABLED': 'Thank you for your message. Our team will respond to you shortly.\n\nFor immediate assistance, please contact us directly.',
            'DAILY_CALLS_EXCEEDED': 'I\'m currently processing many requests. Our team will respond to you shortly.\n\nFor immediate assistance, please call us directly.',
            'DAILY_COST_EXCEEDED': 'Thank you for your message. Our team will get back to you soon.\n\nFor urgent inquiries, please contact us directly.',
            'DEFAULT': 'Sorry, I\'m having technical difficulties. Please try again or contact our team directly.'
        };
        
        return responses[reason] || responses['DEFAULT'];
    }
}

// Export singleton instance
const costControlService = new CostControlService();
module.exports = costControlService;
