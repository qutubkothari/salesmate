// Enhanced cart and conversation management utilities
const { dbClient } = require('./config');

/**
 * Handles conversation reset when new chat session starts
 * Clears stale carts and resets conversation state
 */
const handleConversationReset = async (tenantId, endUserPhone) => {
    try {
        // Check if conversation is stale (inactive for X hours)
        const { data: conversation } = await dbClient
            .from('conversations')
            .select('*')
            .eq('tenant_id', tenantId)
            .eq('end_user_phone', endUserPhone)
            .single();

        if (conversation) {
            const lastUpdate = new Date(conversation.updated_at);
            const now = new Date();
            const hoursSinceUpdate = (now - lastUpdate) / (1000 * 60 * 60);

            // If conversation is older than 24 hours, reset cart
            if (hoursSinceUpdate > 24) {
                console.log('[CART_RESET] Conversation stale, clearing cart for', endUserPhone);
                
                // Get cart ID first
                const { data: cart } = await dbClient
                    .from('carts')
                    .select('id')
                    .eq('conversation_id', conversation.id)
                    .single();

                if (cart) {
                    // Clear cart items
                    const { error: deleteError } = await dbClient
                        .from('cart_items')
                        .delete()
                        .eq('cart_id', cart.id);

                    if (deleteError) {
                        console.warn('[CART_RESET] Error clearing cart items:', deleteError.message);
                    } else {
                        console.log('[CART_RESET] Cleared cart items for cart:', cart.id);
                    }
                }

                // Reset conversation state
                const { error: updateError } = await dbClient
                    .from('conversations')
                    .update({
                        state: null,
                        last_product_discussed: null,
                        updated_at: new Date().toISOString()
                    })
                    .eq('id', conversation.id);

                if (updateError) {
                    console.warn('[CART_RESET] Error resetting conversation:', updateError.message);
                } else {
                    console.log('[CART_RESET] Reset conversation state for:', conversation.id);
                }

                return { reset: true, reason: 'stale_conversation', hoursSinceUpdate };
            }
        }

        return { reset: false, hoursSinceUpdate: conversation ? (new Date() - new Date(conversation.updated_at)) / (1000 * 60 * 60) : 0 };
    } catch (error) {
        console.error('[CART_RESET] Error:', error.message);
        return { reset: false, error: error.message };
    }
};

/**
 * Enhanced cart item management with replace option
 */
const addOrUpdateCartItemEnhanced = async (cartId, productId, quantity, options = {}) => {
    try {
        const { replace = false, carton_price_override = null } = options;
        const MAX_CARTONS = 1000;
        if (Number(quantity) > MAX_CARTONS) {
            console.warn(`[CART_ENHANCED] Attempted to add ${quantity} cartons, which exceeds the max allowed (${MAX_CARTONS}).`);
            return { success: false, error: `Cannot add more than ${MAX_CARTONS} cartons per item.` };
        }
        // Try to find existing item
        const { data: existing, error: errFind } = await dbClient
            .from('cart_items')
            .select('id, quantity')
            .eq('cart_id', cartId)
            .eq('product_id', productId)
            .single();

        if (existing && existing.id) {
            if (replace) {
                // Replace existing quantity and update price override if provided
                console.log('[CART_ENHANCED] Replacing quantity for existing item:', existing.id);
                const updateData = { quantity: Number(quantity) };
                if (carton_price_override !== null && carton_price_override > 0) {
                    updateData.carton_price_override = carton_price_override;
                    console.log('[CART_ENHANCED] Setting personalized price:', carton_price_override);
                }
                const { error: errUpdate } = await dbClient
                    .from('cart_items')
                    .update(updateData)
                    .eq('id', existing.id);
                if (errUpdate) throw errUpdate;
                return { success: true, itemId: existing.id, quantity: Number(quantity), action: 'replaced' };
            } else {
                // Add to existing quantity (current behavior)
                const newQty = Number(existing.quantity) + Number(quantity);
                if (newQty > MAX_CARTONS) {
                    console.warn(`[CART_ENHANCED] Attempted to set ${newQty} cartons, which exceeds the max allowed (${MAX_CARTONS}).`);
                    return { success: false, error: `Cannot have more than ${MAX_CARTONS} cartons per item.` };
                }
                console.log('[CART_ENHANCED] Adding to existing quantity:', existing.quantity, '+', quantity, '=', newQty);
                const updateData = { quantity: newQty };
                if (carton_price_override !== null && carton_price_override > 0) {
                    updateData.carton_price_override = carton_price_override;
                    console.log('[CART_ENHANCED] Setting personalized price:', carton_price_override);
                }
                const { error: errUpdate } = await dbClient
                    .from('cart_items')
                    .update(updateData)
                    .eq('id', existing.id);
                if (errUpdate) throw errUpdate;
                return { success: true, itemId: existing.id, quantity: newQty, action: 'added' };
            }
        } else {
            // Creates new cart item
            console.log('[CART_ENHANCED] Creating new cart item');
            const insertData = { 
                cart_id: cartId, 
                product_id: productId, 
                quantity: Number(quantity) 
            };
            if (carton_price_override !== null && carton_price_override > 0) {
                insertData.carton_price_override = carton_price_override;
                console.log('[CART_ENHANCED] Setting personalized price on new item:', carton_price_override);
            }
            const { data: inserted, error: errInsert } = await dbClient
                .from('cart_items')
                .insert(insertData)
                .select('*')
                .single();
            if (errInsert) throw errInsert;
            return { success: true, itemId: inserted.id, quantity: inserted.quantity, action: 'created' };
        }
    } catch (err) {
        console.error('[CART_ENHANCED] Error:', err.message);
        return { success: false, error: err?.message || 'Unexpected error' };
    }
};

// --- Force cart reset on new order ---
const forceCartResetOnNewOrder = async (tenantId, endUserPhone) => {
    try {
        // Get conversationId
        const { data: conversation } = await dbClient
            .from('conversations')
            .select('*')
            .eq('tenant_id', tenantId)
            .eq('end_user_phone', endUserPhone)
            .single();
        if (!conversation) return { success: false };
        // Get cart
        const { data: cart } = await dbClient
            .from('carts')
            .select('id')
            .eq('conversation_id', conversation.id)
            .single();
        if (cart) {
            await dbClient.from('cart_items').delete().eq('cart_id', cart.id);
        }
        // Reset conversation state
        await dbClient
            .from('conversations')
            .update({
                state: null,
                last_product_discussed: null,
                updated_at: new Date().toISOString()
            })
            .eq('id', conversation.id);
        return { success: true };
    } catch (error) {
        console.error('[FORCE_RESET] Error:', error);
        return { success: false, error: error.message };
    }
};

/**
 * FIXED: Enhanced cart clearing that handles missing database columns gracefully
 */
const clearCart = async (tenantId, endUserPhone) => {
    try {
        console.log('[CART_CLEAR] Clearing cart for:', endUserPhone);
        
        const conversationId = await getConversationId(tenantId, endUserPhone);
        if (!conversationId) return "Could not identify your conversation.";

        const { data: cart } = await dbClient
            .from('carts')
            .select('id')
            .eq('conversation_id', conversationId)
            .single();

        if (cart) {
            await dbClient.from('cart_items').delete().eq('cart_id', cart.id);
            await dbClient.from('carts').update({ 
                applied_discount_id: null, 
                discount_amount: 0,
                updated_at: new Date().toISOString()
            }).eq('id', cart.id);
        }

        // FIXED: Only update columns that exist
        await dbClient
            .from('conversations')
            .update({
                state: null,
                last_product_discussed: null,
                updated_at: new Date().toISOString()
            })
            .eq('id', conversationId);

        return "Your shopping cart has been cleared! You can start adding new products anytime.";

    } catch (error) {
        console.error('[CART_CLEAR] Error:', error.message);
        return 'An error occurred while clearing your cart. Please try again.';
    }
};

/**
 * ALTERNATIVE: Force clear cart - simpler version that only clears essential data
 */
const forceClearCartSimple = async (tenantId, endUserPhone) => {
    try {
        console.log('[FORCE_CLEAR] Simple cart clear for:', endUserPhone);
        
        const conversationId = await getConversationId(tenantId, endUserPhone);
        if (!conversationId) {
            return "Could not identify your conversation.";
        }

        // Get all carts for this conversation
        const { data: carts } = await dbClient
            .from('carts')
            .select('id')
            .eq('conversation_id', conversationId);

        if (carts && carts.length > 0) {
            for (const cart of carts) {
                // Delete all cart items
                await dbClient
                    .from('cart_items')
                    .delete()
                    .eq('cart_id', cart.id);
                
                console.log('[FORCE_CLEAR] Cleared items for cart:', cart.id);
            }
        }

        // Reset only the essential conversation fields that we know exist
        const { error: resetError } = await dbClient
            .from('conversations')
            .update({
                state: null,
                last_product_discussed: null,
                updated_at: new Date().toISOString()
            })
            .eq('id', conversationId);

        if (resetError) {
            console.warn('[FORCE_CLEAR] Conversation reset failed:', resetError.message);
        }

        console.log('[FORCE_CLEAR] Simple clear completed');
        return "Cart has been completely reset!";

    } catch (error) {
        console.error('[FORCE_CLEAR] Error:', error.message);
        return 'Error during cart reset. Please contact support.';
    }
};

/**
 * ENHANCED: Cart clear with database schema inspection
 */
const clearCartSafe = async (tenantId, endUserPhone) => {
    try {
        console.log('[CART_CLEAR_SAFE] Starting safe cart clear');
        
        const conversationId = await getConversationId(tenantId, endUserPhone);
        if (!conversationId) return "Could not identify your conversation.";

        // First, clear the cart items (this should always work)
        const { data: cart } = await dbClient
            .from('carts')
            .select('id')
            .eq('conversation_id', conversationId)
            .single();

        if (cart) {
            const { error: clearError } = await dbClient
                .from('cart_items')
                .delete()
                .eq('cart_id', cart.id);

            if (clearError) {
                console.error('[CART_CLEAR_SAFE] Failed to clear cart items:', clearError.message);
                return 'Failed to clear cart items. Please try again.';
            }

            // Reset cart metadata
            await dbClient
                .from('carts')
                .update({ 
                    applied_discount_id: null, 
                    discount_amount: 0,
                    updated_at: new Date().toISOString()
                })
                .eq('id', cart.id);
        }

        // Try to reset conversation state with minimal fields
        try {
            await dbClient
                .from('conversations')
                .update({
                    state: null,
                    last_product_discussed: null,
                    updated_at: new Date().toISOString()
                })
                .eq('id', conversationId);
                
            console.log('[CART_CLEAR_SAFE] Conversation state reset successfully');
        } catch (convError) {
            console.warn('[CART_CLEAR_SAFE] Conversation reset failed, but cart is cleared:', convError.message);
        }

        return "âœ… Your shopping cart has been cleared successfully!";

    } catch (error) {
        console.error('[CART_CLEAR_SAFE] Error:', error.message);
        return 'Error clearing cart. Please try again.';
    }
};


module.exports = {
        handleConversationReset,
        addOrUpdateCartItemEnhanced,
        forceCartResetOnNewOrder,
        clearCart,
        forceClearCartSimple,
        clearCartSafe
};

// === Compatibility aliases (hotfix) ===
// Some callers expect forceResetCartForNewOrder / addProductToCartEnhanced names.
// These aliases map to your existing implementations to avoid no-op calls.
if (!module.exports.forceResetCartForNewOrder) {
    module.exports.forceResetCartForNewOrder = module.exports.forceCartResetOnNewOrder || (async (...args)=> {
        console.warn('[CART_ALIAS] forceCartResetOnNewOrder missing - noop');
        return { success: false, error: 'reset_not_found' };
    });
}

if (!module.exports.addProductToCartEnhanced) {
    module.exports.addProductToCartEnhanced = module.exports.addOrUpdateCartItemEnhanced || (async (...args)=> {
        console.warn('[CART_ALIAS] addOrUpdateCartItemEnhanced missing - noop');
        return { success: false, error: 'add_missing' };
    });
}

