/**
 * Conversation Learning Service
 * Tracks successful patterns and learns from customer interactions to become smarter over time
 */

const { dbClient } = require('./config');

class ConversationLearningService {
    constructor() {
        this.learningCache = new Map();
    }

    /**
     * Track a successful conversation pattern
     * @param {Object} params - Learning parameters
     */
    async trackSuccess(params) {
        try {
            const {
                tenantId,
                conversationId,
                customerQuery,
                aiResponse,
                outcome, // 'order_placed', 'question_answered', 'lead_qualified', etc.
                contextUsed, // Which contexts were helpful (website, products, history)
                phoneNumber
            } = params;

            console.log('[LEARNING] Tracking successful pattern:', outcome);

            // Store in conversation_learning table
            const { error } = await dbClient
                .from('conversation_learning')
                .insert({
                    tenant_id: tenantId,
                    conversation_id: conversationId,
                    customer_phone: phoneNumber,
                    user_query: customerQuery,
                    ai_response: aiResponse,
                    outcome_type: outcome,
                    context_used: contextUsed,
                    was_successful: true,
                    created_at: new Date().toISOString()
                });

            if (error) {
                console.error('[LEARNING] Failed to store success:', error.message);
            } else {
                console.log('[LEARNING] ✅ Success pattern stored');
            }

            // Update in-memory cache for quick access
            const cacheKey = `${tenantId}:${outcome}`;
            if (!this.learningCache.has(cacheKey)) {
                this.learningCache.set(cacheKey, []);
            }
            this.learningCache.get(cacheKey).push({
                query: customerQuery,
                response: aiResponse,
                timestamp: Date.now()
            });

            // Keep cache under 100 entries per outcome type
            if (this.learningCache.get(cacheKey).length > 100) {
                this.learningCache.get(cacheKey).shift();
            }

        } catch (error) {
            console.error('[LEARNING] Error tracking success:', error.message);
        }
    }

    /**
     * Track a failed interaction to learn what NOT to do
     */
    async trackFailure(params) {
        try {
            const {
                tenantId,
                conversationId,
                customerQuery,
                aiResponse,
                failureReason, // 'customer_confused', 'wrong_product', 'escalated_to_human', etc.
                phoneNumber
            } = params;

            console.log('[LEARNING] Tracking failure:', failureReason);

            await dbClient
                .from('conversation_learning')
                .insert({
                    tenant_id: tenantId,
                    conversation_id: conversationId,
                    customer_phone: phoneNumber,
                    user_query: customerQuery,
                    ai_response: aiResponse,
                    outcome_type: failureReason,
                    was_successful: false,
                    created_at: new Date().toISOString()
                });

            console.log('[LEARNING] ❌ Failure pattern stored for improvement');

        } catch (error) {
            console.error('[LEARNING] Error tracking failure:', error.message);
        }
    }

    /**
     * Get successful patterns for a specific outcome type
     */
    async getSuccessfulPatterns(tenantId, outcomeType, limit = 10) {
        try {
            const { data, error } = await dbClient
                .from('conversation_learning')
                .select('user_query, ai_response, context_used, created_at')
                .eq('tenant_id', tenantId)
                .eq('outcome_type', outcomeType)
                .eq('was_successful', true)
                .order('created_at', { ascending: false })
                .limit(limit);

            if (error) throw error;

            return data || [];
        } catch (error) {
            console.error('[LEARNING] Error fetching patterns:', error.message);
            return [];
        }
    }

    /**
     * Analyze what contexts lead to best outcomes
     */
    async analyzeContextEffectiveness(tenantId) {
        try {
            const { data, error } = await dbClient
                .from('conversation_learning')
                .select('context_used, outcome_type, was_successful')
                .eq('tenant_id', tenantId)
                .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()); // Last 30 days

            if (error) throw error;

            // Analyze which contexts lead to success
            const contextStats = {
                website: { success: 0, total: 0 },
                products: { success: 0, total: 0 },
                history: { success: 0, total: 0 }
            };

            (data || []).forEach(record => {
                const contexts = record.context_used || {};
                Object.keys(contexts).forEach(ctx => {
                    if (contextStats[ctx]) {
                        contextStats[ctx].total++;
                        if (record.was_successful) {
                            contextStats[ctx].success++;
                        }
                    }
                });
            });

            // Calculate success rates
            const effectiveness = {};
            Object.keys(contextStats).forEach(ctx => {
                const stats = contextStats[ctx];
                effectiveness[ctx] = stats.total > 0 
                    ? (stats.success / stats.total * 100).toFixed(1) + '%'
                    : 'No data';
            });

            console.log('[LEARNING] Context effectiveness:', effectiveness);
            return effectiveness;

        } catch (error) {
            console.error('[LEARNING] Error analyzing effectiveness:', error.message);
            return null;
        }
    }

    /**
     * Get similar successful queries to learn from
     */
    async getSimilarSuccessfulQueries(tenantId, currentQuery, limit = 5) {
        try {
            // Get recent successful interactions
            const { data, error } = await dbClient
                .from('conversation_learning')
                .select('user_query, ai_response, context_used')
                .eq('tenant_id', tenantId)
                .eq('was_successful', true)
                .order('created_at', { ascending: false })
                .limit(50);

            if (error || !data) return [];

            // Simple similarity check (can be enhanced with embeddings)
            const queryLower = currentQuery.toLowerCase();
            const queryWords = queryLower.split(/\s+/);

            const similar = data
                .filter(record => {
                    const recordWords = record.user_query.toLowerCase().split(/\s+/);
                    const commonWords = queryWords.filter(w => recordWords.includes(w));
                    return commonWords.length >= 2; // At least 2 words in common
                })
                .slice(0, limit);

            if (similar.length > 0) {
                console.log('[LEARNING] Found', similar.length, 'similar successful queries');
            }

            return similar;

        } catch (error) {
            console.error('[LEARNING] Error finding similar queries:', error.message);
            return [];
        }
    }

    /**
     * Generate insights report for the tenant
     */
    async generateInsightsReport(tenantId) {
        try {
            const { data, error } = await dbClient
                .from('conversation_learning')
                .select('outcome_type, was_successful, created_at')
                .eq('tenant_id', tenantId)
                .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()); // Last 7 days

            if (error) throw error;

            const stats = {
                totalInteractions: data?.length || 0,
                successfulInteractions: data?.filter(r => r.was_successful).length || 0,
                failedInteractions: data?.filter(r => !r.was_successful).length || 0,
                successRate: 0,
                outcomeBreakdown: {}
            };

            stats.successRate = stats.totalInteractions > 0 
                ? (stats.successfulInteractions / stats.totalInteractions * 100).toFixed(1) 
                : 0;

            // Count outcomes
            (data || []).forEach(record => {
                const outcome = record.outcome_type || 'unknown';
                if (!stats.outcomeBreakdown[outcome]) {
                    stats.outcomeBreakdown[outcome] = { success: 0, failed: 0 };
                }
                if (record.was_successful) {
                    stats.outcomeBreakdown[outcome].success++;
                } else {
                    stats.outcomeBreakdown[outcome].failed++;
                }
            });

            console.log('[LEARNING] Insights:', stats);
            return stats;

        } catch (error) {
            console.error('[LEARNING] Error generating insights:', error.message);
            return null;
        }
    }
}

module.exports = new ConversationLearningService();

