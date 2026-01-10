// =============================================
// FILE: services/aiDiscountUnderstanding.js
// NEW FILE - AI-powered discount detection (NO REGEX)
// =============================================


const { openai, dbClient } = require('./config');

/**
 * AI-powered discount intent detection
 * Replaces all regex patterns with intelligent understanding
 */
async function detectDiscountIntent(userMessage, conversationContext = {}) {
    try {
        console.log('[AI_DISCOUNT] Analyzing message:', userMessage);
        
        const prompt = `Analyze this customer message and determine if they're requesting a discount or negotiating price.

Customer Message: "${userMessage}"

Context:
- Has quoted products: ${conversationContext.hasQuotedProducts ? 'Yes' : 'No'}
- In cart discussion: ${conversationContext.inCartDiscussion ? 'Yes' : 'No'}
- Previous discount offered: ${conversationContext.previousDiscountOffered || 'None'}

Respond with JSON only:
{
  "isDiscountRequest": true/false,
  "confidence": 0.0-1.0,
  "discountType": "initial_request|counter_offer|asking_for_more|best_price|accepting_offer|none",
  "extractedInfo": {
    "productCode": "extracted product code like 8x80, 10x100, etc. or null",
    "quantity": number or null,
    "requestedDiscount": "percentage like 5% or null",
    "requestedPrice": "specific price like 2.50 or null"
  },
  "reasoning": "brief explanation"
}

Examples:
- "give me discount for 8x80 100 ctns" â†’ isDiscountRequest: true, discountType: "initial_request"
- "price for 8x80" â†’ isDiscountRequest: false (pure price inquiry)
- "thoda aur kam karo" â†’ isDiscountRequest: true, discountType: "asking_for_more"
- "yes go ahead" â†’ isDiscountRequest: false (order confirmation)
- "2.50 per piece chalega" â†’ isDiscountRequest: true, discountType: "counter_offer"`;

        const response = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
                { role: 'system', content: 'You are an expert at understanding customer intent in sales conversations. Always respond with valid JSON only.' },
                { role: 'user', content: prompt }
            ],
            temperature: 0.3,
            max_tokens: 300
        });

        const aiResponse = response.choices[0].message.content.trim();
        console.log('[AI_DISCOUNT] Raw AI response:', aiResponse);
        
        // Parse JSON response
        const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            console.warn('[AI_DISCOUNT] No JSON found in response');
            return {
                isDiscountRequest: false,
                confidence: 0,
                discountType: 'none',
                extractedInfo: {},
                reasoning: 'Failed to parse AI response'
            };
        }

        try {
            const result = JSON.parse(jsonMatch[0]);
            console.log('[AI_DISCOUNT] Parsed result:', result);
            return result;
        } catch (parseError) {
            console.error('[AI_DISCOUNT] JSON parse error:', parseError.message);
            console.error('[AI_DISCOUNT] Failed JSON string:', jsonMatch[0]);
            return {
                isDiscountRequest: false,
                confidence: 0,
                discountType: 'none',
                extractedInfo: {},
                reasoning: 'Invalid JSON from AI response'
            };
        }
        
    } catch (error) {
        console.error('[AI_DISCOUNT] Error:', error.message);

        // Fallback: Basic keyword check (minimal regex)
        const explicitDiscountPatterns = [
            /give\s*(?:me|us)?\s*(?:some|a)?\s*discount/i,
            /can\s*(?:you|i)\s*get\s*(?:a|some)?\s*discount/i,
            /discount\s*(?:do|mile?ga|chahiye|please|for)/i,
            /best\s+price/i,
            /kam\s+kar/i,
            /thoda\s+(?:aur\s+)?kam/i
        ];
        const hasDiscountKeyword = explicitDiscountPatterns.some(p => p.test(userMessage));

        // If an explicit discount pattern is present, return high confidence so the flow treats it as a discount
        return {
            isDiscountRequest: hasDiscountKeyword,
            confidence: hasDiscountKeyword ? 0.9 : 0,
            discountType: 'initial_request',
            extractedInfo: {},
            reasoning: 'Fallback detection due to AI error'
        };
    }
}

/**
 * AI-powered extraction of order details from discount request
 * Replaces regex-based product/quantity extraction
 */
async function extractDiscountRequestDetails(userMessage, recentProducts = [], cartItems = []) {
    try {
        console.log('[AI_EXTRACT] Extracting details from:', userMessage);
        console.log('[AI_EXTRACT] Cart items:', cartItems);

        let productContext = '';
        if (cartItems.length > 0) {
            productContext = `Current Cart Items:\n${cartItems.map(item =>
                `- ${item.productCode || item.productName}: ${item.quantity} ${item.unit || 'carton'}(s)`
            ).join('\n')}`;
        }
        if (recentProducts.length > 0) {
            productContext += (productContext ? '\n' : '') +
                `Recently discussed: ${recentProducts.map(p => p.productCode || p.productName).join(', ')}`;
        }
        if (!productContext) {
            productContext = 'No products in cart or recently discussed';
        }

        const prompt = `Extract order details from this discount request message.

Customer Message: "${userMessage}"

Context:
${productContext}

CRITICAL: If the customer mentions a price (like "1.55 per pc" or "2.50") without mentioning a product name/code, assume they are referring to the product(s) currently in their cart.

Extract:
1. Product codes (like 8x80, 10x100, NFF 8x80, etc.)
2. Quantities with units (cartons, ctns, pieces, pcs)
3. Any specific discount or price mentioned

Respond with JSON only:
{
  "products": [
    {
      "productCode": "8x80",
      "quantity": 100,
      "unit": "cartons"
    }
  ],
  "discountRequest": {
    "type": "percentage|specific_price|amount_off|more|none",
    "value": number or null
  },
  "confidence": 0.0-1.0
}

Examples:
- "give me discount for 8x80 100 ctns" â†’ products: [{productCode: "8x80", quantity: 100, unit: "cartons"}]
- "8x80 aur 10x100 ka price with discount" â†’ products: [{productCode: "8x80", ...}, {productCode: "10x100", ...}]
- "thoda aur kam karo" â†’ products: [], discountRequest: {type: "more", value: null}
- "5% discount dena" â†’ discountRequest: {type: "percentage", value: 5}`;

        const response = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
                { role: 'system', content: 'You are an expert at extracting structured data from customer messages. Always respond with valid JSON only.' },
                { role: 'user', content: prompt }
            ],
            temperature: 0.2,
            max_tokens: 400
        });

        const aiResponse = response.choices[0].message.content.trim();
        const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
        
        if (!jsonMatch) {
            console.warn('[AI_EXTRACT] No JSON found in response');
            return {
                products: [],
                discountRequest: { type: 'none', value: null },
                confidence: 0
            };
        }
        
        const result = JSON.parse(jsonMatch[0]);
        console.log('[AI_EXTRACT] Extracted:', result);
        
        // Fallback for null quantity/unit
        if (result.products && Array.isArray(result.products)) {
            result.products = result.products.map((p, idx) => {
                let fallbackQuantity = 1;
                // Use recentProducts quantity if available and AI extraction is missing
                if ((p.quantity == null || p.quantity === 1) && recentProducts[idx] && recentProducts[idx].quantity) {
                    fallbackQuantity = recentProducts[idx].quantity;
                }
                return {
                    ...p,
                    quantity: p.quantity == null ? fallbackQuantity : p.quantity,
                    unit: p.unit == null ? 'cartons' : p.unit
                };
            });
        }
        return result;
        
    } catch (error) {
        console.error('[AI_EXTRACT] Error:', error.message);
        return {
            products: [],
            discountRequest: { type: 'none', value: null },
            confidence: 0
        };
    }
}

/**
 * AI-powered discount negotiation response generator
 * Replaces hardcoded response templates with contextual AI
 */
async function generateDiscountResponse(context) {
    try {
        const {
            customerMessage,
            isReturningCustomer,
            totalCartons,
            products,
            offeredDiscount,
            maxDiscount,
            requestedDiscount,
            conversationHistory
        } = context;
        
        const prompt = `You are a friendly sales negotiator. Generate a natural discount response.

Customer said: "${customerMessage}"

Context:
- Customer type: ${isReturningCustomer ? 'Returning customer (already has special pricing)' : 'New customer'}
- Order size: ${totalCartons} cartons
- Products: ${products.map(p => `${p.productCode || p.productName} (${p.quantity} ctns @ â‚¹${p.discountedPrice || p.price}/carton = â‚¹${p.pricePerPiece}/piece)`).join(', ')}
- Max discount you can offer: ${maxDiscount}%
- Already offered: ${offeredDiscount}%
${requestedDiscount ? `- Customer wants: ${requestedDiscount}%` : ''}

Generate response that:
1. Is friendly and conversational (not robotic)
2. Uses emojis naturally (ðŸ’°, ðŸ˜Š, âœ…, ðŸ‘)
3. Matches customer's tone (formal/casual)
4. Can use Hindi/Hinglish if customer used it
5. IMPORTANT: Use the ACTUAL prices provided above - DO NOT use placeholders like [price_per_piece]
6. Show specific prices: "â‚¹${products[0]?.pricePerPiece}/piece" or "â‚¹${products[0]?.discountedPrice}/carton"
7. Asks for confirmation naturally

Rules:
- If customer wants MORE than max: Offer max discount and explain it's genuinely your limit
- If customer is reasonable: Accept enthusiastically
- For returning customers: Emphasize they already have special pricing
- Always end with a question to confirm
- NEVER use template variables like [price], always use actual numbers

Respond with JSON:
{
  "message": "your natural response here with ACTUAL prices",
  "tone": "enthusiastic|apologetic|firm|friendly",
  "shouldEscalate": true/false
}`;

        const response = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
                { role: 'system', content: 'You are a skilled sales negotiator who speaks naturally and builds rapport with customers.' },
                { role: 'user', content: prompt }
            ],
            temperature: 0.7,
            max_tokens: 300
        });

        const aiResponse = response.choices[0].message.content.trim();
        const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
        
        if (!jsonMatch) {
            // Fallback response
            return {
                message: `I can offer ${offeredDiscount || maxDiscount}% discount for ${totalCartons} cartons. Does that work for you? ðŸ˜Š`,
                tone: 'friendly',
                shouldEscalate: false
            };
        }

        try {
            const result = JSON.parse(jsonMatch[0]);
            console.log('[AI_RESPONSE] Generated:', result.message);
            return result;
        } catch (parseError) {
            console.error('[AI_RESPONSE] JSON parse error:', parseError.message);
            return {
                message: `I can offer ${offeredDiscount || maxDiscount}% discount for ${totalCartons} cartons. Does that work for you? ðŸ˜Š`,
                tone: 'friendly',
                shouldEscalate: false
            };
        }
        
    } catch (error) {
        console.error('[AI_RESPONSE] Error:', error.message);
        return {
            message: `I can help with a discount! Let me check what I can offer for your order. ðŸ˜Š`,
            tone: 'friendly',
            shouldEscalate: false
        };
    }
}

module.exports = {
    detectDiscountIntent,
    extractDiscountRequestDetails,
    generateDiscountResponse
};

