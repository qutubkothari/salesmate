/**
 * @title Intent Recognition Service
 * @description AI-powered intent recognition for customer messages
 * Uses OpenAI to intelligently classify user intent instead of regex patterns
 */

const { openai } = require('./config');

/**
 * Recognize the intent of a user message using AI
 * @param {string} message - The user's message
 * @param {object} context - Optional context (conversation state, last action, etc.)
 * @returns {Promise<object>} Intent classification with confidence
 */
async function recognizeIntent(message, context = {}) {
    try {
        const systemPrompt = `You are an intent classifier for a B2B sales WhatsApp bot. 
Analyze the user's message and classify it into ONE of these intents:

**Primary Intents:**
1. PRICE_INQUIRY - User asking for product prices, quotes, rates (e.g., "10x100 price", "how much for 8x80", "rate for 10000 pcs")
2. BRAND_INQUIRY - User asking about a brand/product line (e.g., "NFF", "Nylon Anchors", "what NFF products do you have", "show me all NFF")
3. DISCOUNT_REQUEST - User asking for discount, better price, negotiating (e.g., "discount?", "give discount", "i want more", "reduce price", "can you do less?")
4. DISCOUNT_ACCEPTANCE - User accepting a discount offer (e.g., "yes confirm discount", "ok discount", "sure discount is fine", "accept the offer")
5. COUNTER_OFFER - User proposing a specific price they want to pay (e.g., "i want 1.45/pc", "give me at 2000/carton", "can you do ₹1.50 per piece")
6. ORDER_CONFIRMATION - User confirming/placing an order AFTER receiving price quote (e.g., "confirm", "yes", "proceed", "ok go ahead", "checkout"). NOTE: If message has product code + quantity, it's ADD_PRODUCT or PRICE_INQUIRY, NOT ORDER_CONFIRMATION
7. ADD_PRODUCT - User adding product(s) to cart (e.g., "add 8x100 5ctns", "also need 10x140", "aur 8x80 10 carton", "include 8x100 too", "8x80 10 ctns 8x100 5 ctns", "I want 10x100 3 cartons", "I need to place order for 8x80 10000pcs")
8. REMOVE_PRODUCT - User removing a product from cart (e.g., "8x80 nahin chahiye", "I don't want 8x100", "remove 8x80", "delete 8x100", "cancel 8x80")
9. QUANTITY_UPDATE - User changing quantity of a product in cart (e.g., "8x100 10 ctns kar dena", "change 8x100 to 10 cartons", "update 8x100 quantity to 5", "8x100 5000 pcs kar do")
10. PRODUCT_INQUIRY - User asking about product details, availability, specifications (e.g., "do you have", "what sizes", "tell me about")
11. ORDER_STATUS - User checking order status (e.g., "where is my order", "order status", "tracking")
12. REQUEST_CATALOG - User requesting product catalog (e.g., "send catalog", "show me catalog", "do you have a catalog", "catalog bhejo")
13. REQUEST_PRICE_LIST - User requesting price list (e.g., "send price list", "latest prices", "price sheet", "rate list bhejo")
14. REQUEST_TECHNICAL_DOC - User requesting technical documentation (e.g., "technical specs for 8x80", "product specifications", "datasheet", "technical details")
15. REQUEST_PRODUCT_IMAGE - User requesting product images (e.g., "show images of 8x80", "product photos", "picture bhejo", "how does it look")
16. RETAIL_CONNECT - Customer scanning QR code from retail counter (e.g., "CONNECT_RETAIL_CUSTOMER", "RETAIL_QR", "CONNECT_BILL_12345", "RETAIL_12345")
17. GST_RESPONSE - Customer responding with GST details or "No GST" preference (e.g., "27ACQFS1175A1Z4", "no gst", "retail customer", "without gst", "don't need gst")
18. GREETING - Simple greetings (e.g., "hi", "hello", "good morning")
19. GENERAL_QUESTION - Other questions not covered above

**Context Awareness:**
${context.lastIntent ? `- Last detected intent: ${context.lastIntent}` : ''}
${context.conversationState ? `- Conversation state: ${context.conversationState}` : ''}
${context.hasQuotedProducts ? `- User has received a price quote` : ''}
${context.hasCart ? `- User has items in cart` : ''}

**Special Rules:**
- If user mentions brand names like "NFF", "Nylon Anchors", "Nylon Frame" → BRAND_INQUIRY
- If user says "all [brand]", "show me [brand]", "[brand] products" → BRAND_INQUIRY
- If user mentions SPECIFIC PRICE they want (e.g., "1.45/-", "₹2000", "2500/carton") → COUNTER_OFFER
- If user says "more", "i want more", "give me more" WITHOUT specific price → DISCOUNT_REQUEST
- **CRITICAL**: If message contains BOTH "place order"/"order" AND product code with quantity (e.g., "I need to place order for 8x80 10000pcs") → PRICE_INQUIRY or ADD_PRODUCT (NOT ORDER_CONFIRMATION, because they haven't seen price yet)
- If user says "confirm", "yes", "ok" AFTER a discount offer → ORDER_CONFIRMATION (accepting discount)
- If user says "confirm", "yes", "ok" AFTER a price quote → ORDER_CONFIRMATION (placing order)
- If user says ONLY "confirm", "place order", "checkout", "proceed" WITHOUT product details → ORDER_CONFIRMATION
- Words like "more", "better", "reduce", "lower", "less" in context of price → DISCOUNT_REQUEST
- Product codes (e.g., "8x80", "10x100") with quantity → ADD_PRODUCT (if no cart exists) or PRICE_INQUIRY
- Multiple product codes with quantities (e.g., "8x80 10 ctns 8x100 5 ctns") → ADD_PRODUCT
- Product codes with "nahin chahiye", "remove", "delete", "cancel" → REMOVE_PRODUCT
- Product codes with "kar dena", "kar do", "change to", "update to" + new quantity → QUANTITY_UPDATE
- If conversation state is "order_discussion" AND message has "add"/"also"/"aur"/"bhi" + product code + quantity → ADD_PRODUCT

Respond ONLY with JSON in this exact format:
{
  "intent": "INTENT_NAME",
  "confidence": 0.95,
  "subIntent": "optional sub-classification",
  "reasoning": "brief explanation",
  "extractedData": {
    "counterOfferPrice": "if COUNTER_OFFER, the specific price mentioned",
    "counterOfferUnit": "per piece / per carton / total",
    "productCode": "if REMOVE_PRODUCT, QUANTITY_UPDATE, REQUEST_TECHNICAL_DOC, or REQUEST_PRODUCT_IMAGE, the product code (e.g., '8x80')",
    "newQuantity": "if QUANTITY_UPDATE, the new quantity requested",
    "quantityUnit": "if QUANTITY_UPDATE, the unit (pcs, ctns, cartons)"
  }
}`;

        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: `Classify this message: "${message}"` }
            ],
            temperature: 0.1,
            max_tokens: 200,
            response_format: { type: "json_object" }
        });

        const result = JSON.parse(response.choices[0].message.content);
        
        console.log('[INTENT] Recognized:', {
            message: message.substring(0, 50),
            intent: result.intent,
            confidence: result.confidence,
            reasoning: result.reasoning
        });

        return result;

    } catch (error) {
        console.error('[INTENT] Recognition error:', error.message);
        
        // Fallback to basic pattern matching
        return fallbackIntentRecognition(message, context);
    }
}

/**
 * Fallback intent recognition using simple patterns (when AI fails)
 */
function fallbackIntentRecognition(message, context = {}) {
    const lowerMsg = message.toLowerCase().trim();
    
    // Quantity update patterns
    if (/kar dena|change to|update to|badal do|kar do|set to|update quantity|change quantity|edit quantity|edit to|replace with|update\s+\d+[x*]\d+/i.test(lowerMsg)) {
        // Try to extract product code and quantity
        const codeMatch = lowerMsg.match(/(\d+[x*]\d+)/);
        const qtyMatch = lowerMsg.match(/(\d+)\s*(ctns?|cartons?)/);
        return {
            intent: 'QUANTITY_UPDATE',
            confidence: 0.95,
            reasoning: 'User wants to update quantity of a product in cart',
            extractedData: {
                productCode: codeMatch ? codeMatch[1] : null,
                newQuantity: qtyMatch ? parseInt(qtyMatch[1]) : null
            }
        };
    }
    
    // Remove product patterns
    if (/nahin chahiye|i don'?t want|remove|delete|mat chahiye|nahi chahiye|remove\s+\d+[x*]\d+|delete\s+\d+[x*]\d+/i.test(lowerMsg)) {
        // Try to extract product code
        const codeMatch = lowerMsg.match(/(\d+[x*]\d+)/);
        return {
            intent: 'REMOVE_PRODUCT',
            confidence: 0.95,
            reasoning: 'User wants to remove a product from cart',
            extractedData: {
                productCode: codeMatch ? codeMatch[1] : null
            }
        };
    }
    
    // Multiple products with quantities (add to cart)
    const productCodeMatches = lowerMsg.match(/(\d+[x*]\d+)/g);
    const quantityMatches = lowerMsg.match(/(\d+)\s*(ctns?|cartons?|pcs?|pieces?)/gi);
    if (productCodeMatches && productCodeMatches.length > 1 && quantityMatches && quantityMatches.length >= productCodeMatches.length) {
        return {
            intent: 'ADD_PRODUCT',
            confidence: 0.9,
            reasoning: 'User is listing multiple products with quantities to add to cart',
            extractedData: {
                multipleProducts: true,
                productCodes: productCodeMatches
            }
        };
    }
    
    // Price inquiry patterns
    if (/\d+x\d+|\bprice|\brate|\bquote|\bcost/i.test(message)) {
        return { intent: 'PRICE_INQUIRY', confidence: 0.8, reasoning: 'Contains product code or price keywords' };
    }
    // Discount acceptance patterns (e.g., "yes confirm discount", "ok discount accepted")
    // MUST BE BEFORE generic confirmation patterns to avoid false positives
    if (/^(yes|ok|okay|confirm|sure|haan|theek).*(discount|offer)/i.test(lowerMsg)) {
        return { intent: 'DISCOUNT_ACCEPTANCE', confidence: 0.95, reasoning: 'Accepting discount offer' };
    }
    // Discount patterns
    if (/discount|more|reduce|lower|less|better price|kam karo/i.test(lowerMsg)) {
        return { intent: 'DISCOUNT_REQUEST', confidence: 0.8, reasoning: 'Contains discount keywords' };
    }
    // Confirmation patterns
    if (/^(yes|ok|okay|confirm|proceed|sure|haan|theek)$/i.test(lowerMsg)) {
        // Context-aware: check if there's a pending offer
        if (context.conversationState === 'discount_offered') {
            return { intent: 'ORDER_CONFIRMATION', confidence: 0.9, reasoning: 'Confirming discount offer', subIntent: 'ACCEPT_DISCOUNT' };
        }
        if (context.hasQuotedProducts || context.hasCart) {
            return { intent: 'ORDER_CONFIRMATION', confidence: 0.9, reasoning: 'Confirming order' };
        }
        return { intent: 'ORDER_CONFIRMATION', confidence: 0.7, reasoning: 'Generic confirmation' };
    }
    // Greeting patterns
    if (/^(hi|hello|hey|good morning|good evening|namaste)$/i.test(lowerMsg)) {
        return { intent: 'GREETING', confidence: 0.95, reasoning: 'Greeting message' };
    }
    // Order status patterns
    if (/order.*status|where.*order|track|delivery/i.test(lowerMsg)) {
        return { intent: 'ORDER_STATUS', confidence: 0.85, reasoning: 'Order tracking query' };
    }
    // Default
    return { intent: 'GENERAL_QUESTION', confidence: 0.5, reasoning: 'No clear pattern matched' };
}

/**
 * Check if message matches a specific intent
 * @param {string} message - User message
 * @param {string} intentToCheck - Intent to check against
 * @param {object} context - Conversation context
 * @returns {Promise<boolean>}
 */
async function isIntent(message, intentToCheck, context = {}) {
    const result = await recognizeIntent(message, context);
    return result.intent === intentToCheck && result.confidence > 0.6;
}

/**
 * Batch intent recognition for multiple messages
 */
async function recognizeIntentBatch(messages, context = {}) {
    const results = await Promise.all(
        messages.map(msg => recognizeIntent(msg, context))
    );
    return results;
}

module.exports = {
    recognizeIntent,
    isIntent,
    fallbackIntentRecognition,
    recognizeIntentBatch
};

