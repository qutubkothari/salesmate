/**
 * ConversationMemory - Enhanced Context Tracking
 * 
 * Provides intelligent context memory for conversations:
 * 1. Recent message history (last 5 messages)
 * 2. Key entities mentioned (products, quantities, prices)
 * 3. Conversation flow tracking
 * 4. Customer preferences
 * 
 * @module services/core/ConversationMemory
 */

const { dbClient } = require('../config');
const { toWhatsAppFormat } = require('../../utils/phoneUtils');

/**
 * Maximum messages to keep in memory
 */
const MAX_HISTORY_LENGTH = 5;

/**
 * Validate phone number
 * @private
 */
function validatePhone(phone) {
    if (!phone || typeof phone !== 'string') {
        throw new Error('Phone number is required');
    }
    return true;
}

/**
 * Validate tenant ID
 * @private
 */
function validateTenantId(tenantId) {
    if (!tenantId) {
        throw new Error('Tenant ID is required');
    }
    return true;
}

/**
 * Get conversation memory (recent context)
 * 
 * @param {string} tenantId - Tenant UUID
 * @param {string} phoneNumber - Customer phone
 * @returns {Promise<{
 *   recentMessages: Array,
 *   lastIntent: string|null,
 *   products: Array,
 *   quantities: Array,
 *   prices: Array,
 *   cartActive: boolean,
 *   hasQuote: boolean
 * }>}
 */
async function getMemory(tenantId, phoneNumber) {
    try {
        validateTenantId(tenantId);
        validatePhone(phoneNumber);
        
        const whatsappPhone = toWhatsAppFormat(phoneNumber);
        
        // Get conversation ID
        const { data: conversation } = await dbClient
            .from('conversations')
            .select('id, last_intent')
            .eq('tenant_id', tenantId)
            .eq('end_user_phone', whatsappPhone)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
        
        if (!conversation) {
            console.log('[Memory] No conversation found, returning empty memory');
            return {
                recentMessages: [],
                lastIntent: null,
                products: [],
                quantities: [],
                prices: [],
                cartActive: false,
                hasQuote: false
            };
        }
        
        // Get recent messages (last N messages)
        const { data: messages } = await dbClient
            .from('conversation_messages')
            .select('content, sender, created_at, metadata')
            .eq('conversation_id', conversation.id)
            .order('created_at', { ascending: false })
            .limit(MAX_HISTORY_LENGTH);
        
        // Check if cart is active
        const { data: cart } = await dbClient
            .from('carts')
            .select('id, cart_items(count)')
            .eq('conversation_id', conversation.id)
            .maybeSingle();
        
        const cartActive = cart && cart.cart_items && cart.cart_items[0]?.count > 0;
        
        // Extract entities from recent messages
        const entities = extractEntities(messages || []);
        
        const memory = {
            recentMessages: (messages || []).reverse().map(m => ({
                content: m.content,
                sender: m.sender,
                timestamp: m.created_at
            })),
            lastIntent: conversation.last_intent,
            products: entities.products,
            quantities: entities.quantities,
            prices: entities.prices,
            cartActive,
            hasQuote: entities.products.length > 0 && entities.prices.length > 0
        };
        
        console.log('[Memory] Retrieved:', {
            messageCount: memory.recentMessages.length,
            lastIntent: memory.lastIntent,
            productsDiscussed: memory.products.length,
            cartActive: memory.cartActive
        });
        
        return memory;
        
    } catch (error) {
        console.error('[Memory] getMemory failed:', error.message);
        // Return empty memory on error
        return {
            recentMessages: [],
            lastIntent: null,
            products: [],
            quantities: [],
            prices: [],
            cartActive: false,
            hasQuote: false
        };
    }
}

/**
 * Save message to memory
 * 
 * @param {string} tenantId - Tenant UUID
 * @param {string} phoneNumber - Customer phone
 * @param {string} content - Message content
 * @param {string} sender - 'customer' or 'bot'
 * @param {Object} metadata - Additional metadata (intent, entities, etc.)
 * @returns {Promise<boolean>}
 */
async function saveMessage(tenantId, phoneNumber, content, sender, metadata = {}) {
    try {
        validateTenantId(tenantId);
        validatePhone(phoneNumber);
        
        const whatsappPhone = toWhatsAppFormat(phoneNumber);
        
        // Get or create conversation
        const { data: conversation } = await dbClient
            .from('conversations')
            .select('id')
            .eq('tenant_id', tenantId)
            .eq('end_user_phone', whatsappPhone)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
        
        if (!conversation) {
            console.log('[Memory] No conversation found, cannot save message');
            return false;
        }
        
        // Save message
        const { error } = await dbClient
            .from('conversation_messages')
            .insert({
                conversation_id: conversation.id,
                content: content,
                sender: sender,
                metadata: metadata || {}
            });
        
        if (error) {
            console.error('[Memory] Error saving message:', error);
            return false;
        }
        
        console.log(`[Memory] Message saved: ${sender} (${content.length} chars)`);
        return true;
        
    } catch (error) {
        console.error('[Memory] saveMessage failed:', error.message);
        return false;
    }
}

/**
 * Update conversation intent
 * 
 * @param {string} tenantId - Tenant UUID
 * @param {string} phoneNumber - Customer phone
 * @param {string} intent - Detected intent
 * @returns {Promise<boolean>}
 */
async function updateIntent(tenantId, phoneNumber, intent) {
    try {
        validateTenantId(tenantId);
        validatePhone(phoneNumber);
        
        const whatsappPhone = toWhatsAppFormat(phoneNumber);
        
        const { error } = await dbClient
            .from('conversations')
            .update({
                last_intent: intent,
                updated_at: new Date().toISOString()
            })
            .eq('tenant_id', tenantId)
            .eq('end_user_phone', whatsappPhone);
        
        if (error) {
            console.error('[Memory] Error updating intent:', error);
            return false;
        }
        
        console.log(`[Memory] Intent updated: ${intent}`);
        return true;
        
    } catch (error) {
        console.error('[Memory] updateIntent failed:', error.message);
        return false;
    }
}

/**
 * Extract entities from messages
 * @private
 */
function extractEntities(messages) {
    const products = new Set();
    const quantities = new Set();
    const prices = new Set();
    
    messages.forEach(msg => {
        if (!msg.content) return;
        
        const content = msg.content;
        
        // Extract product codes (e.g., 10x140, 8x80, NFF 8x100)
        const productPattern = /\b([A-Z]{2,}\s+)?\d+[x*Ã—]\d+\b/gi;
        const productMatches = content.match(productPattern);
        if (productMatches) {
            productMatches.forEach(p => products.add(p.trim().toUpperCase()));
        }
        
        // Extract quantities (e.g., 5 cartons, 10 ctns, 1000 pieces)
        const quantityPattern = /\b(\d+(?:,\d{3})*(?:\.\d+)?)\s*(?:ctns?|cartons?|pcs?|pieces?|lac|lakh|units?)\b/gi;
        const quantityMatches = content.match(quantityPattern);
        if (quantityMatches) {
            quantityMatches.forEach(q => quantities.add(q.trim().toLowerCase()));
        }
        
        // Extract prices (e.g., â‚¹1.50, 2000/carton, 1.45/pc)
        const pricePattern = /(?:â‚¹|rs\.?|inr)?\s*\d+(?:,\d{3})*(?:\.\d+)?\s*(?:\/(?:pc|piece|carton|ctn))?/gi;
        const priceMatches = content.match(pricePattern);
        if (priceMatches) {
            priceMatches.forEach(p => prices.add(p.trim()));
        }
    });
    
    return {
        products: Array.from(products),
        quantities: Array.from(quantities),
        prices: Array.from(prices)
    };
}

/**
 * Build context string for AI from memory
 * 
 * @param {Object} memory - Memory object from getMemory()
 * @returns {string} Human-readable context
 */
function buildContextString(memory) {
    const parts = [];
    
    if (memory.lastIntent) {
        parts.push(`Last intent: ${memory.lastIntent}`);
    }
    
    if (memory.products.length > 0) {
        parts.push(`Products discussed: ${memory.products.slice(0, 3).join(', ')}`);
    }
    
    if (memory.cartActive) {
        parts.push('Cart is active');
    }
    
    if (memory.hasQuote) {
        parts.push('Customer has received price quotes');
    }
    
    if (memory.recentMessages.length > 0) {
        const lastCustomerMsg = memory.recentMessages
            .filter(m => m.sender === 'customer')
            .pop();
        
        if (lastCustomerMsg) {
            parts.push(`Last message: "${lastCustomerMsg.content.substring(0, 50)}..."`);
        }
    }
    
    return parts.join(' | ');
}

/**
 * Get conversation summary for AI context
 * 
 * @param {string} tenantId - Tenant UUID
 * @param {string} phoneNumber - Customer phone
 * @returns {Promise<string>} Summary string
 */
async function getConversationSummary(tenantId, phoneNumber) {
    try {
        const memory = await getMemory(tenantId, phoneNumber);
        return buildContextString(memory);
    } catch (error) {
        console.error('[Memory] getConversationSummary failed:', error.message);
        return '';
    }
}

/**
 * Clear old messages (keep only recent N messages)
 * 
 * @param {string} tenantId - Tenant UUID
 * @param {string} phoneNumber - Customer phone
 * @returns {Promise<number>} Number of messages deleted
 */
async function pruneOldMessages(tenantId, phoneNumber) {
    try {
        validateTenantId(tenantId);
        validatePhone(phoneNumber);
        
        const whatsappPhone = toWhatsAppFormat(phoneNumber);
        
        // Get conversation ID
        const { data: conversation } = await dbClient
            .from('conversations')
            .select('id')
            .eq('tenant_id', tenantId)
            .eq('end_user_phone', whatsappPhone)
            .maybeSingle();
        
        if (!conversation) return 0;
        
        // Get IDs of messages to keep
        const { data: keepMessages } = await dbClient
            .from('conversation_messages')
            .select('id')
            .eq('conversation_id', conversation.id)
            .order('created_at', { ascending: false })
            .limit(MAX_HISTORY_LENGTH * 2); // Keep 2x for safety
        
        if (!keepMessages || keepMessages.length === 0) return 0;
        
        const keepIds = keepMessages.map(m => m.id);
        
        // Delete old messages
        const { data: deleted } = await dbClient
            .from('conversation_messages')
            .delete()
            .eq('conversation_id', conversation.id)
            .not('id', 'in', `(${keepIds.join(',')})`)
            .select('id');
        
        const deletedCount = deleted ? deleted.length : 0;
        console.log(`[Memory] Pruned ${deletedCount} old messages`);
        
        return deletedCount;
        
    } catch (error) {
        console.error('[Memory] pruneOldMessages failed:', error.message);
        return 0;
    }
}

module.exports = {
    getMemory,
    saveMessage,
    updateIntent,
    buildContextString,
    getConversationSummary,
    pruneOldMessages
};

