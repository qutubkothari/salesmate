const { openai, dbClient } = require('./config');

/**
 * AI-Powered Conversation Context Analyzer
 * Uses OpenAI to understand conversation flow and user intent in context
 * Self-trains based on outcomes
 */

/**
 * Analyze user message in conversation context using AI
 * @param {string} currentMessage - The current user message
 * @param {Object} conversationHistory - Recent conversation context
 * @param {Object} conversationState - Current conversation state
 * @param {string} tenantId - Tenant ID (optional, for cart context)
 * @param {string} customerPhone - Customer phone (optional, for cart context)
 * @returns {Object} AI analysis with intent, action, and confidence
 */
async function analyzeConversationContext(currentMessage, conversationHistory, conversationState, tenantId = null, customerPhone = null) {
    try {
        console.log('[AI_CONTEXT] Analyzing message in context:', currentMessage);

        // Build context for AI (now async to fetch cart items)
        const contextPrompt = await buildContextPrompt(currentMessage, conversationHistory, conversationState, tenantId, customerPhone);
        
        const systemPrompt = `You are an AI assistant that analyzes customer messages in the context of an ongoing B2B sales conversation.

Your job is to determine the TRUE INTENT of the customer's message based on:
1. What they just said
2. What the bot just offered
3. The current conversation state
4. The conversation history

You must output ONLY valid JSON with this exact structure:
{
    "intent": "QUANTITY_UPDATE | DISCOUNT_REQUEST | ORDER_CONFIRMATION | PRICE_INQUIRY | GENERAL_QUERY",
    "action": "RECALCULATE_DISCOUNT | PROCEED_TO_CHECKOUT | SHOW_PRICE | PROVIDE_INFO | ASK_CLARIFICATION",
    "reasoning": "Brief explanation of why you chose this intent",
    "confidence": 0.95,
    "extractedData": {
        "quantity": 100,
        "unit": "cartons",
        "products": ["8x80"]
    }
}

CRITICAL RULES:
1. "i need 100 cartons" after bot offers discount = QUANTITY_UPDATE (not ORDER_CONFIRMATION)
2. "yes" or "go ahead" after bot offers discount = ORDER_CONFIRMATION
3. "best price?" without quantity mentioned = DISCOUNT_REQUEST
4. Customer changing quantity mid-negotiation = QUANTITY_UPDATE
5. If bot just asked a question, customer's response answers that question

Examples:
- Bot: "0% for 1 carton. Ready?" â†’ User: "i need 100 cartons" = QUANTITY_UPDATE
- Bot: "3% discount okay?" â†’ User: "yes go ahead" = ORDER_CONFIRMATION
- Bot: "Price â‚¹1.67/pc" â†’ User: "best price?" = DISCOUNT_REQUEST
- Bot: "3% discount: â‚¹1.62/pc. Okay?" â†’ User: "give me more" = DISCOUNT_REQUEST`;

        const response = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: contextPrompt }
            ],
            temperature: 0.3, // Low temperature for consistency
            max_tokens: 300
        });

        let analysis;
        try {
            analysis = JSON.parse(response.choices[0].message.content);
        } catch (parseError) {
            console.error('[AI_CONTEXT] JSON parse error:', parseError.message);
            console.error('[AI_CONTEXT] Raw response:', response.choices[0].message.content);
            // Fallback to regex-based detection
            return fallbackContextAnalysis(currentMessage, conversationState);
        }

        console.log('[AI_CONTEXT] Analysis result:', {
            intent: analysis.intent,
            action: analysis.action,
            confidence: analysis.confidence
        });

        // Store this analysis for learning
        await storeAnalysisForLearning(currentMessage, conversationState, analysis);

        return analysis;

    } catch (error) {
        console.error('[AI_CONTEXT] Error analyzing context:', error.message);
        
        // Fallback to regex-based detection for critical safety
        return fallbackContextAnalysis(currentMessage, conversationState);
    }
}

/**
 * Build prompt with conversation context for AI analysis
 */
async function buildContextPrompt(currentMessage, conversationHistory, conversationState, tenantId, customerPhone) {
    let prompt = `Analyze this customer message in context:\n\n`;

    // Add conversation state
    if (conversationState) {
        prompt += `Current State: ${conversationState.state || 'none'}\n`;
        if (conversationState.last_quoted_products) {
            try {
                const products = typeof conversationState.last_quoted_products === 'string'
                    ? JSON.parse(conversationState.last_quoted_products)
                    : conversationState.last_quoted_products;
                prompt += `Last Quoted Products: ${products.map(p => `${p.productCode} (${p.quantity} cartons)`).join(', ')}\n`;
            } catch (e) {
                // Ignore parse errors
            }
        }
        if (conversationState.context_data) {
            try {
                const context = typeof conversationState.context_data === 'string'
                    ? JSON.parse(conversationState.context_data)
                    : conversationState.context_data;
                if (context.offeredDiscount) {
                    prompt += `Bot Just Offered: ${context.offeredDiscount}% discount\n`;
                }
                if (context.approvedDiscount) {
                    prompt += `Discount Already Approved: ${context.approvedDiscount}%\n`;
                }
            } catch (e) {
                // Ignore parse errors
            }
        }
    }

    // CRITICAL: Add cart items to context
    if (tenantId && customerPhone && conversationState?.id) {
        try {
            const { data: cart } = await dbClient
                .from('carts')
                .select(`
                    id,
                    cart_items (
                        quantity,
                        product:products (id, name, price, units_per_carton)
                    )
                `)
                .eq('conversation_id', conversationState.id)
                .maybeSingle();

            if (cart && cart.cart_items && cart.cart_items.length > 0) {
                prompt += `\nCurrent Cart Items:\n`;
                cart.cart_items.forEach(item => {
                    if (item.product) {
                        const pieces = item.quantity * (item.product.units_per_carton || 1500);
                        prompt += `- ${item.product.name}: ${item.quantity} carton(s) (${pieces} pieces) @ â‚¹${item.product.price}/pc\n`;
                    }
                });
            }
        } catch (error) {
            console.warn('[AI_CONTEXT] Could not fetch cart items:', error.message);
        }
    }
    
    // Normalize conversationHistory to array
    let history = [];
    if (Array.isArray(conversationHistory)) {
        history = conversationHistory;
    } else if (typeof conversationHistory === 'string') {
        try {
            const parsed = JSON.parse(conversationHistory);
            if (Array.isArray(parsed)) history = parsed;
        } catch(e) {}
    }
    if (history.length > 0) {
        prompt += `\nRecent Conversation:\n`;
        history.slice(-6).forEach(msg => {
            prompt += `- ${msg.role}: ${msg.content}\n`;
        });
    }

    prompt += `\nCustomer's Current Message: "${currentMessage}"\n\n`;
    prompt += `What is the TRUE INTENT and what ACTION should the system take?`;

    return prompt;
}

/**
 * Store analysis for self-learning
 */
async function storeAnalysisForLearning(message, conversationState, analysis) {
    try {
        await dbClient
            .from('ai_context_analysis_log')
            .insert({
                message,
                conversation_state: conversationState?.state,
                quoted_products: conversationState?.last_quoted_products,
                context_data: conversationState?.context_data,
                ai_intent: analysis.intent,
                ai_action: analysis.action,
                ai_confidence: analysis.confidence,
                ai_reasoning: analysis.reasoning,
                extracted_data: JSON.stringify(analysis.extractedData),
                created_at: new Date().toISOString()
            });
        
        console.log('[AI_CONTEXT] Analysis logged for learning');
    } catch (error) {
        // Don't fail if logging fails
        console.warn('[AI_CONTEXT] Could not log analysis:', error.message);
    }
}

/**
 * Mark an analysis as successful (led to correct outcome)
 */
async function markAnalysisAsCorrect(messageId, outcome) {
    try {
        await dbClient
            .from('ai_context_analysis_log')
            .update({
                outcome_correct: true,
                actual_outcome: outcome,
                updated_at: new Date().toISOString()
            })
            .eq('id', messageId);
    } catch (error) {
        console.warn('[AI_CONTEXT] Could not update analysis outcome:', error.message);
    }
}

/**
 * Mark an analysis as incorrect (led to wrong outcome)
 */
async function markAnalysisAsIncorrect(messageId, actualIntent, actualAction) {
    try {
        await dbClient
            .from('ai_context_analysis_log')
            .update({
                outcome_correct: false,
                actual_intent: actualIntent,
                actual_action: actualAction,
                updated_at: new Date().toISOString()
            })
            .eq('id', messageId);
    } catch (error) {
        console.warn('[AI_CONTEXT] Could not update analysis outcome:', error.message);
    }
}

/**
 * Get learning insights - analyze patterns where AI was wrong
 */
async function getLearningInsights() {
    try {
        const { data: incorrectAnalyses } = await dbClient
            .from('ai_context_analysis_log')
            .select('*')
            .eq('outcome_correct', false)
            .order('created_at', { ascending: false })
            .limit(100);
        
        if (!incorrectAnalyses || incorrectAnalyses.length === 0) {
            return { insights: 'No incorrect analyses found - system performing well!' };
        }
        
        // Analyze patterns
        const patterns = {};
        incorrectAnalyses.forEach(analysis => {
            const key = `${analysis.ai_intent} â†’ ${analysis.actual_intent}`;
            patterns[key] = (patterns[key] || 0) + 1;
        });
        
        return {
            totalIncorrect: incorrectAnalyses.length,
            commonMistakes: patterns,
            recommendations: generateRecommendations(patterns)
        };
    } catch (error) {
        console.error('[AI_CONTEXT] Error getting learning insights:', error.message);
        return { error: error.message };
    }
}

/**
 * Generate recommendations based on error patterns
 */
function generateRecommendations(patterns) {
    const recommendations = [];
    
    Object.entries(patterns).forEach(([pattern, count]) => {
        if (count > 5) {
            recommendations.push({
                pattern,
                frequency: count,
                suggestion: `AI frequently confuses these intents. Consider adding explicit context rules or examples.`
            });
        }
    });
    
    return recommendations;
}

/**
 * Fallback to simple logic if AI fails
 */
function fallbackContextAnalysis(message, conversationState) {
    let safeMessage = '';
    if (typeof message === 'string') {
        safeMessage = message;
    } else if (message && message.text && typeof message.text.body === 'string') {
        safeMessage = message.text.body;
    } else {
        safeMessage = '';
    }
    const lowerMsg = safeMessage.toLowerCase().trim();
    
    // Quantity specification pattern
    const safeMsg = typeof message === 'string' ? message : '';
    const hasQuantity = /(?:i\s*)?(?:need|want|require|give\s*me)\s+(\d+)\s*(?:cartons?|ctns?|pcs?|pieces?)/i.test(safeMsg);
    
    // If in discount state and message has quantity = QUANTITY_UPDATE
    if (hasQuantity && (conversationState?.state === 'discount_offered' || conversationState?.state === 'discount_approved')) {
        const quantityMatch = message.match(/(\d+)\s*(?:cartons?|ctns?)/i);
        return {
            intent: 'QUANTITY_UPDATE',
            action: 'RECALCULATE_DISCOUNT',
            reasoning: 'Fallback: Detected quantity specification in discount context',
            confidence: 0.8,
            extractedData: {
                quantity: quantityMatch ? parseInt(quantityMatch[1]) : null
            }
        };
    }
    
    // Simple confirmation
    if (/^(yes|okay|ok|sure|go ahead|proceed|confirm)$/i.test(lowerMsg)) {
        return {
            intent: 'ORDER_CONFIRMATION',
            action: 'PROCEED_TO_CHECKOUT',
            reasoning: 'Fallback: Simple confirmation word',
            confidence: 0.9,
            extractedData: {}
        };
    }
    
    // Default to unclear
    return {
        intent: 'GENERAL_QUERY',
        action: 'ASK_CLARIFICATION',
        reasoning: 'Fallback: Could not determine intent',
        confidence: 0.5,
        extractedData: {}
    };
}


module.exports = {
    analyzeConversationContext: analyzeConversationContext,
    storeAnalysisForLearning: storeAnalysisForLearning,
    markAnalysisAsCorrect: markAnalysisAsCorrect,
    markAnalysisAsIncorrect: markAnalysisAsIncorrect,
    getLearningInsights: getLearningInsights,
    generateRecommendations: generateRecommendations,
    fallbackContextAnalysis: fallbackContextAnalysis
};

