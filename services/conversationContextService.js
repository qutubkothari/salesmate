// services/conversationContextService.js - FIXED for schema compatibility
const { supabase } = require('./config');

/**
 * FIXED: Track conversation context for human-like responses
 * Only updates columns that exist in the database schema
 */
const saveConversationContext = async (tenantId, phoneNumber, context) => {
    try {
        // FIXED: Only update columns that exist in your schema
        await supabase
            .from('conversations')
            .upsert({
                tenant_id: tenantId,
                phone_number: phoneNumber,
                end_user_phone: phoneNumber,
                // REMOVED: conversation_context field (doesn't exist in schema)
                last_product_discussed: context.lastProduct, // Use existing column name
                updated_at: new Date().toISOString()
            }, {
                onConflict: 'tenant_id,end_user_phone'
            });
        
        console.log('[CONTEXT] Saved context for', phoneNumber, ':', context);
    } catch (error) {
        console.error('[CONTEXT] Save failed:', error.message);
    }
};

/**
 * Handle follow-up questions with context awareness
 */
const handleContextualPriceQuery = async (userQuery, conversation, tenantId) => {
    const query = userQuery.toLowerCase();
    
    // Price-related patterns
    const pricePatterns = [
        /per\s+(pc|piece|pcs|pieces?)\s+price/i,
        /price\s+per\s+(pc|piece|pcs|pieces?)/i,
        /each\s+piece\s+cost/i,
        /individual\s+price/i,
        /unit\s+price/i,
        /ek\s+piece\s+ka\s+rate/i,
        /per\s+piece\s+kya/i
    ];
    
    // Check if asking about per-piece pricing
    const isPriceQuery = pricePatterns.some(pattern => pattern.test(query));
    
    // FIXED: Use correct column name
    if (isPriceQuery && conversation?.last_product_discussed) {
        const productName = conversation.last_product_discussed;
        
        try {
            // Get the specific product they just discussed
            const { data: product } = await supabase
                .from('products')
                .select('*')
                .eq('tenant_id', tenantId)
                .eq('is_active', true)
                .ilike('name', `%${productName}%`)
                .single();
                
            if (product) {
                const unitsPerCarton = product.units_per_carton || 
                                     (product.units_per_packet * product.packets_per_carton) || 
                                     1;
                const pricePerPiece = (Number(product.price) || 0).toFixed(2);
                
                // Human-like response
                const responses = [
                    `${product.name} is ₹${pricePerPiece} per piece. How many pieces do you need?`,
                    `Per piece rate for ${product.name} is ₹${pricePerPiece}. What quantity are you looking at?`,
                    `₹${pricePerPiece} per piece for ${product.name}. Shall I calculate for your required quantity?`,
                    `${product.name} comes at ₹${pricePerPiece} per piece. Tell me your quantity and I'll give you the total.`
                ];
                
                // Pick random response for naturalness
                const response = responses[Math.floor(Math.random() * responses.length)];
                
                return {
                    handled: true,
                    response,
                    product,
                    context: 'pricing_discussion'
                };
            }
        } catch (error) {
            console.error('[CONTEXTUAL_PRICE] Error:', error.message);
        }
    }
    
    return { handled: false };
};

/**
 * Handle quantity-related follow-ups
 */
const handleQuantityQueries = async (userQuery, conversation, tenantId) => {
    const query = userQuery.toLowerCase();
    
    // Extract numbers from query
    const numberMatch = query.match(/(\d+)\s*(pcs?|pieces?|cartons?|ctns?)?/i);
    
    // FIXED: Use correct column name
    if (numberMatch && conversation?.last_product_discussed) {
        const quantity = parseInt(numberMatch[1]);
        const unit = numberMatch[2] || 'pieces';
        const productName = conversation.last_product_discussed;
        
        try {
            const { data: product } = await supabase
                .from('products')
                .select('*')
                .eq('tenant_id', tenantId)
                .eq('is_active', true)
                .ilike('name', `%${productName}%`)
                .single();
                
            if (product && quantity > 0) {
                const unitsPerCarton = product.units_per_carton || 
                                     (product.units_per_packet * product.packets_per_carton) || 
                                     1;
                
                let totalPrice, description;
                
                if (unit.toLowerCase().includes('carton') || unit.toLowerCase().includes('ctn')) {
                    // Customer asked for cartons
                    const cartonPrice = (Number(product.price) || 0) * unitsPerCarton;
                    totalPrice = (cartonPrice * quantity).toFixed(2);
                    const totalPieces = quantity * unitsPerCarton;
                    description = `${quantity} cartons = ${totalPieces} pieces`;
                } else {
                    // Customer asked for pieces
                    const cartonsNeeded = Math.ceil(quantity / unitsPerCarton);
                    const pricePerPiece = Number(product.price) || 0;
                    totalPrice = (pricePerPiece * quantity).toFixed(2);
                    
                    if (quantity < unitsPerCarton) {
                        description = `${quantity} pieces (minimum 1 carton = ${unitsPerCarton} pieces)`;
                        const cartonPrice = pricePerPiece * unitsPerCarton;
                        totalPrice = cartonPrice.toFixed(2);
                    } else {
                        description = `${quantity} pieces`;
                    }
                }
                
                // Human-like calculation responses
                const responses = [
                    `${description} of ${product.name} will cost ₹${totalPrice}. Should I add this to your order?`,
                    `For ${quantity} ${unit}, ${product.name} total comes to ₹${totalPrice}. Want to proceed?`,
                    `${product.name} - ${description} = ₹${totalPrice}. Shall I prepare the quote?`,
                    `Total for ${quantity} ${unit} of ${product.name}: ₹${totalPrice}. Ready to place order?`
                ];
                
                const response = responses[Math.floor(Math.random() * responses.length)];
                
                return {
                    handled: true,
                    response,
                    calculation: { quantity, unit, totalPrice, product },
                    context: 'order_discussion'
                };
            }
        } catch (error) {
            console.error('[QUANTITY_CALC] Error:', error.message);
        }
    }
    
    return { handled: false };
};

module.exports = {
    saveConversationContext,
    handleContextualPriceQuery,
    handleQuantityQueries
};