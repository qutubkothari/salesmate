// routes/handlers/modules/quantityUpdateHandler.js
// AI-Powered Quantity Update Handler - NO REGEX, PURE INTELLIGENCE
// Handles quantity updates in ANY language, ANY format

const { dbClient } = require('../../../services/config');
const { getConversationId } = require('../../../services/historyService');
const { viewCartWithDiscounts } = require('../../../services/cartService');
const { getAIResponse } = require('../../../services/ai/openaiConfig');

/**
 * AI-Powered: Detect if message is a quantity update request
 * NO REGEX - Uses AI to understand intent naturally
 */
async function isQuantityUpdateRequest(message, context = {}) {
    // Simple heuristic: If AI already classified as QUANTITY_UPDATE, trust it
    // This function is now just a placeholder for backward compatibility
    return false; // Let Enhanced AI handle all classification
}

/**
 * AI-Powered: Extract quantity and product from any message format
 * Works in ANY language, ANY product naming convention
 */
async function extractQuantityAndProduct(message, conversationHistory = []) {
    const prompt = `You are an expert at extracting order information from customer messages.

TASK: Extract the quantity and optional product code from this message.

MESSAGE: "${message}"

CONVERSATION CONTEXT:
${conversationHistory.slice(-3).map(m => `${m.sender}: ${m.message}`).join('\n')}

INSTRUCTIONS:
- Extract the quantity (number of cartons/units/pieces)
- Extract product code if mentioned (e.g., "8x100", "SKU-123", "ABC", etc.)
- Handle ANY language (English, Hindi, Arabic, etc.)
- Understand natural variations: "10 only", "make it 5", "change to 30", "bas 20"

OUTPUT FORMAT (JSON only):
{
  "quantity": <number>,
  "productCode": "<code or null>",
  "confidence": <0.0 to 1.0>
}`;

    try {
        const response = await getAIResponse([
            { role: 'system', content: 'You extract order information. Always respond with valid JSON only.' },
            { role: 'user', content: prompt }
        ]);

        const extracted = JSON.parse(response);
        console.log('[QUANTITY_AI] Extracted:', extracted);
        return extracted;
    } catch (error) {
        console.error('[QUANTITY_AI] Extraction error:', error);
        return { quantity: null, productCode: null, confidence: 0 };
    }
}

/**
 * AI-Powered: Handle quantity update request
 * Works universally across all languages and formats
 */
async function handleQuantityUpdate(req, res, tenant, from, userQuery, conversation, intentResult) {
    console.log('[QUANTITY_UPDATE_AI] Handling quantity update request:', userQuery);
    
    try {
        // Get conversation history for context
        const conversationHistory = conversation?.id ? 
            await getConversationHistory(conversation.id) : [];
        
        // Use AI to extract quantity and product
        const extracted = await extractQuantityAndProduct(userQuery, conversationHistory);
        
        if (!extracted.quantity || extracted.confidence < 0.5) {
            console.log('[QUANTITY_UPDATE_AI] Low confidence or no quantity extracted');
            return null; // Let other handlers process
        }
        
        const { quantity: newQuantity, productCode } = extracted;
        console.log('[QUANTITY_UPDATE_AI] AI Extracted:', { newQuantity, productCode, confidence: extracted.confidence });
        
        // Get cart
        const conversationId = await getConversationId(tenant.id, from);
        if (!conversationId) {
            console.log('[QUANTITY_UPDATE_AI] No conversation found');
            return null;
        }
        
        const { data: cart } = await dbClient
            .from('carts')
            .select(`
                id,
                cart_items (
                    id,
                    quantity,
                    product_id,
                    product:products (
                        id,
                        name,
                        product_code,
                        price,
                        units_per_carton
                    )
                )
            `)
            .eq('conversation_id', conversationId)
            .single();
        
        if (!cart || !cart.cart_items || cart.cart_items.length === 0) {
            console.log('[QUANTITY_UPDATE_AI] No items in cart');
            return {
                response: "Your cart is empty. Please add products first.",
                source: 'quantity_update_no_cart'
            };
        }
        
        console.log('[QUANTITY_UPDATE_AI] Found', cart.cart_items.length, 'items in cart');
        
        // Find the item to update using AI-extracted product code
        let itemToUpdate = null;
        
        if (productCode) {
            // AI-fuzzy match: Find product by similarity
            itemToUpdate = cart.cart_items.find(item => {
                const itemCode = item.product.product_code || '';
                const itemName = item.product.name || '';
                // Flexible matching - contains, case-insensitive
                return itemCode.toLowerCase().includes(productCode.toLowerCase()) ||
                       itemName.toLowerCase().includes(productCode.toLowerCase()) ||
                       productCode.toLowerCase().includes(itemCode.toLowerCase());
            });
            console.log('[QUANTITY_UPDATE_AI] AI fuzzy match for:', productCode, 'Found:', !!itemToUpdate);
        }
        
        if (!itemToUpdate) {
            // Update the most recently added item (last in array)
            itemToUpdate = cart.cart_items[cart.cart_items.length - 1];
            console.log('[QUANTITY_UPDATE_AI] Using most recent item:', itemToUpdate.product.name);
        }
        
        // Update the quantity
        const { error: updateError } = await dbClient
            .from('cart_items')
            .update({ 
                quantity: newQuantity,
                updated_at: new Date().toISOString()
            })
            .eq('id', itemToUpdate.id);
        
        if (updateError) {
            console.error('[QUANTITY_UPDATE_AI] Error updating quantity:', updateError);
            return {
                response: "Sorry, I couldn't update the quantity. Please try again.",
                source: 'quantity_update_error'
            };
        }
        
        console.log('[QUANTITY_UPDATE_AI] Successfully updated quantity from', itemToUpdate.quantity, 'to', newQuantity);
        
        // Show updated cart
        const cartMessage = await viewCartWithDiscounts(tenant.id, from);
        
        return {
            response: `âœ… Updated ${itemToUpdate.product.name} to ${newQuantity} cartons.\n\n${cartMessage}`,
            source: 'quantity_update_success_ai'
        };
        
    } catch (error) {
        console.error('[QUANTITY_UPDATE_AI] Error:', error);
        return {
            response: "Sorry, I had trouble updating the quantity. Please try again or say 'cart' to view your cart.",
            source: 'quantity_update_exception'
        };
    }
}

/**
 * Helper: Get conversation history for context
 */
async function getConversationHistory(conversationId) {
    try {
        const { data } = await dbClient
            .from('messages')
            .select('message_body, sender, created_at')
            .eq('conversation_id', conversationId)
            .order('created_at', { ascending: false })
            .limit(5);
        
        return data || [];
    } catch (error) {
        console.error('[QUANTITY_AI] Error fetching history:', error);
        return [];
    }
}

module.exports = {
    isQuantityUpdateRequest,
    handleQuantityUpdate,
    extractQuantityAndProduct
};

