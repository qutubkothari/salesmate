// services/orderConfirmationService.js - COMPLETE FIXED VERSION
const { dbClient } = require('./config');

/**
 * Enhanced order confirmation detection with context awareness
 */
const isOrderConfirmationEnhanced = async (userQuery, conversation, tenantId) => {
    try {
        const lowerMessage = userQuery.toLowerCase().trim();
        
        // Enhanced confirmation patterns
        const confirmationPatterns = [
            /^(yes|haan|ha|yeah|yep|ok|okay|sure|confirm|go ahead|proceed|done|thik hai)$/i,
            /^(yes|haan)\s+(go ahead|proceed|please|kar do|book)$/i,
            /order\s+(kar do|confirm|place|book)/i,
            /^(book|place)\s+(order|it)/i,
            /^(checkout|final|confirm)$/i
        ];
        
        // Check for confirmation pattern match
        const matchesPattern = confirmationPatterns.some(pattern => pattern.test(lowerMessage));
        
        if (!matchesPattern) return false;
        
        // Check if we have product context from conversation
        let hasProductContext = false;
        
        // Context check 1: Direct conversation state
        if (conversation?.state?.includes('product_inquiry') || 
            conversation?.state?.includes('order_discussion') ||
            conversation?.last_product_discussed) {
            hasProductContext = true;
        }
        
        // Context check 2: Recent message history contains pricing
        try {
            const { data: recentMessages } = await dbClient
                .from('messages')
                .select('message_body, sender')
                .eq('conversation_id', conversation.id)
                .order('created_at', { ascending: false })
                .limit(5);
            
            if (recentMessages) {
                const hasRecentPricing = recentMessages.some(msg => 
                    msg.sender === 'bot' && 
                    (msg.message_body.includes('₹') || 
                     msg.message_body.includes('price') ||
                     msg.message_body.includes('NFF') ||
                     msg.message_body.includes('Total'))
                );
                
                if (hasRecentPricing) hasProductContext = true;
            }
        } catch (error) {
            console.warn('Could not check recent messages for context:', error.message);
        }
        
        console.log('[ORDER_CONFIRM_ENHANCED]', {
            message: lowerMessage,
            matchesPattern,
            hasProductContext,
            conversationState: conversation?.state,
            lastProduct: conversation?.last_product_discussed
        });
        
        return matchesPattern && hasProductContext;
        
    } catch (error) {
        console.error('Error in enhanced order confirmation detection:', error.message);
        // Conservative fallback
        const basicPattern = /\b(yes.*go.*ahead|confirm|checkout|place.*order)\b/i.test(userQuery);
        return basicPattern;
    }
};

/**
 * FIXED: Check if cart has items before triggering checkout
 */
const checkCartBeforeCheckout = async (tenantId, endUserPhone) => {
    try {
        const { getConversationId } = require('./historyService');
        const conversationId = await getConversationId(tenantId, endUserPhone);
        
        if (!conversationId) {
            return { hasItems: false, message: 'Could not identify conversation' };
        }
        
        // Get cart with items
        const { data: cart } = await dbClient
            .from('carts')
            .select(`
                id,
                cart_items (
                    quantity,
                    product:products (id, name, price)
                )
            `)
            .eq('conversation_id', conversationId)
            .single();
        
        if (!cart || !cart.cart_items || cart.cart_items.length === 0) {
            return { 
                hasItems: false, 
                message: 'Your cart is empty. Please add products first.' 
            };
        }
        
        // Calculate cart summary
        let totalItems = 0;
        let totalValue = 0;
        
        cart.cart_items.forEach(item => {
            totalItems += item.quantity;
            totalValue += item.quantity * item.product.price;
        });
        
        return {
            hasItems: true,
            cartId: cart.id,
            itemCount: cart.cart_items.length,
            totalItems: totalItems,
            totalValue: totalValue,
            message: `Cart contains ${cart.cart_items.length} product(s), ${totalItems} total items`
        };
        
    } catch (error) {
        console.error('Error checking cart before checkout:', error.message);
        return { 
            hasItems: false, 
            message: 'Error checking cart status' 
        };
    }
};

/**
 * FIXED: Auto-add discussed product to cart when customer confirms order
 * This function is now more defensive and doesn't interfere with existing cart
 */
/**
 * Helper function to convert pieces to cartons
 */
const convertPiecesToCartons = (orderInfo, product) => {
    const { quantity, isPieces } = orderInfo;
    const unitsPerCarton = parseInt(product.units_per_carton) || 1;
    
    if (isPieces) {
        const cartons = Math.ceil(quantity / unitsPerCarton);
        return {
            finalQuantity: cartons,
            displayText: `${cartons} carton${cartons !== 1 ? 's' : ''} (${quantity} pieces)`
        };
    }
    
    return {
        finalQuantity: quantity,
        displayText: `${quantity} carton${quantity !== 1 ? 's' : ''}`
    };
};

/**
 * Robust auto-add: reads quotedProducts (conversation or fallback message),
 * converts pieces->cartons when needed, and adds all quoted products to cart.
 */
const autoAddDiscussedProductToCart = async (tenantId, endUserPhone, conversation) => {
    try {
        console.log('[AUTO_ADD] Checking if auto-add is needed for', endUserPhone);

        // 1) If cart already has items, skip auto-add
        const cartCheck = await checkCartBeforeCheckout(tenantId, endUserPhone);
        if (cartCheck.hasItems) {
            console.log('[AUTO_ADD] Cart already has items, skipping auto-add.');
            return { success: true, message: 'Using existing cart items', skipAutoAdd: true };
        }

        // 2) Prioritize last_quoted_products from price inquiries
        let quoted = null;
        if (conversation && conversation.last_quoted_products) {
            try {
                quoted = typeof conversation.last_quoted_products === 'string'
                    ? JSON.parse(conversation.last_quoted_products)
                    : conversation.last_quoted_products;
                console.log('[AUTO_ADD] Found quotedProducts from conversation.last_quoted_products, count=', quoted?.length || 0);
            } catch (e) {
                console.warn('[AUTO_ADD] Could not parse last_quoted_products JSON:', e?.message || e);
                quoted = null;
            }
        }

        // 3) Fallback to last_product_discussed if no quoted products
        if ((!quoted || !Array.isArray(quoted) || quoted.length === 0) && conversation && conversation.last_product_discussed) {
            const codes = conversation.last_product_discussed.split(',').map(s => s.trim()).filter(Boolean);
            if (codes.length > 0) {
                quoted = codes.map(code => ({
                    productCode: code,
                    productName: code,
                    quantity: 1,
                    unit: 'cartons',
                    isPieces: false
                }));
                console.log('[AUTO_ADD] Using last_product_discussed fallback:', quoted?.length || 0, 'products');
            }
        }

        if (!quoted || quoted.length === 0) {
            console.log('[AUTO_ADD] No discussed/quoted products found in conversation context.');
            return { success: false, message: 'Please specify which products you want to order' };
        }

        // 4) Add ALL quoted products to cart
        const { getConversationId } = require('./historyService');
        const conversationId = await getConversationId(tenantId, endUserPhone);
        if (!conversationId) return { success: false, message: 'Could not identify conversation' };

        // Get or create cart
        let { data: cart } = await dbClient
            .from('carts')
            .select('*')
            .eq('conversation_id', conversationId)
            .single();

        if (!cart) {
            const { data: newCart } = await dbClient
                .from('carts')
                .insert({ conversation_id: conversationId })
                .select('*')
                .single();
            cart = newCart;
        }

        // CRITICAL FIX: Use correct function name
        const { findProductByNameOrCode } = require('./smartOrderExtractionService');
        const { addOrUpdateCartItem } = require('./orderProcessingService');
        const { addOrUpdateCartItemEnhanced } = require('./cartResetService');

        const added = [];

        console.log('[AUTO_ADD] Processing', quoted.length, 'quoted products for cart addition');
        
        for (const order of quoted) {
            const code = (order.productCode || order.productName || '').toString().trim();
            const qty = Number(order.quantity) || 1;
            const isPieces = !!order.isPieces || (order.unit && order.unit.toLowerCase() === 'pieces');

            console.log('[AUTO_ADD] Processing product:', { code, qty, isPieces, order });

            if (!code) {
                console.warn('[AUTO_ADD] Skipping - no product code');
                continue;
            }

            // FIXED: Use the correct function name
            const product = await findProductByNameOrCode(tenantId, code);
            if (!product) {
                console.warn('[AUTO_ADD] Product not found for code:', code);
                continue;
            }
            
            console.log('[AUTO_ADD] Found product in database:', product.name, 'ID:', product.id);

            // Convert pieces -> cartons using shared utility
            const conv = convertPiecesToCartons({ quantity: qty, isPieces }, product);
            const finalQty = conv && conv.finalQuantity ? conv.finalQuantity : Math.ceil(qty);

            // Extract personalized price from quoted product (if available)
            const personalizedPrice = order.unitPrice || order.price || null;
            console.log(`[AUTO_ADD] Product: ${product.name}, List price: ${product.price}, Personalized price: ${personalizedPrice || 'N/A'}`);

            // Add or update cart item with enhanced functionality
            try {
                // Check if this is a fresh order (replace) or addition
                const isReplacement = conversation?.state !== 'order_discussion';
                const addRes = await addOrUpdateCartItemEnhanced(cart.id, product.id, finalQty, { 
                    replace: isReplacement,
                    carton_price_override: personalizedPrice  // Pass personalized price if available
                });
                
                if (addRes && addRes.success) {
                    added.push({ 
                        productId: product.id, 
                        name: product.name, 
                        addedCartons: finalQty, 
                        display: conv.displayText || `${finalQty} cartons`,
                        originalQuantity: qty,
                        action: addRes.action
                    });
                    console.log(`[AUTO_ADD] ${addRes.action} product to cart:`, product.name, finalQty, 'cartons');
                } else {
                    console.warn('[AUTO_ADD] Failed to add product to cart:', addRes.error);
                }
            } catch (ae) {
                console.error('[AUTO_ADD] Failed adding product to cart:', ae?.message || ae);
            }
        }

        // Update conversation state if we added items
        if (added.length > 0) {
            try {
                await dbClient
                    .from('conversations_new')
                    .update({
                        state: 'order_discussion',
                        last_product_discussed: added.map(a => a.name).join(', ')
                    })
                    .eq('id', conversation.id);
            } catch (uerr) {
                console.warn('[AUTO_ADD] Could not update conversation state:', uerr?.message || uerr);
            }

            // Refresh cart timestamp
            await dbClient.from('carts').update({ updated_at: new Date().toISOString() }).eq('id', cart.id);

            // ✅ CRITICAL: Apply any approved discounts to the newly added cart items
            try {
                const { applyApprovedDiscountToCart } = require('./cartService');
                await applyApprovedDiscountToCart(tenantId, endUserPhone);
                console.log('[AUTO_ADD] Applied approved discounts to cart after auto-add');
            } catch (discountError) {
                console.warn('[AUTO_ADD] Could not apply approved discounts:', discountError?.message || discountError);
            }

            return { 
                success: true, 
                message: `Added ${added.length} product(s) to cart: ${added.map(a => `${a.name} (${a.addedCartons} cartons)`).join(', ')}`, 
                productsAdded: added, 
                cartId: cart.id 
            };
        } else {
            return { success: false, message: 'Could not add any quoted products to cart. Please specify product names.' };
        }

    } catch (error) {
        console.error('[AUTO_ADD] Error in autoAddDiscussedProductToCart:', error?.message || error);
        return { success: false, message: 'Error adding products to cart automatically.' };
    }
};

/**
 * FIXED: Process order confirmation and trigger checkout ONLY when cart has items
 */
const processOrderConfirmation = async (tenant, endUserPhone, conversation) => {
    try {
        console.log('[ORDER_CONFIRM] Processing order confirmation');
        
        // Check cart status first
        const cartCheck = await checkCartBeforeCheckout(tenant.id, endUserPhone);
        
        if (!cartCheck.hasItems) {
            // Try auto-add if cart is empty
            const autoAddResult = await autoAddDiscussedProductToCart(tenant.id, endUserPhone, conversation);
            
            if (!autoAddResult.success) {
                return {
                    success: false,
                    message: autoAddResult.message
                };
            }
            
            // Re-check cart after auto-add
            const recheckCart = await checkCartBeforeCheckout(tenant.id, endUserPhone);
            if (!recheckCart.hasItems) {
                return {
                    success: false,
                    message: 'No items in cart to checkout. Please add products first.'
                };
            }
        }
        
        console.log('[ORDER_CONFIRM] Cart has items, proceeding with checkout');
        
        // Import checkout function
        const { checkoutWithDiscounts } = require('./cartService');
        
        // Process checkout
        const checkoutResult = await checkoutWithDiscounts(tenant, endUserPhone);
        
        return {
            success: true,
            message: checkoutResult,
            cartItems: cartCheck.itemCount || 0,
            totalValue: cartCheck.totalValue || 0
        };
        
    } catch (error) {
        console.error('[ORDER_CONFIRM] Error processing confirmation:', error.message);
        return {
            success: false,
            message: 'Error processing your order confirmation. Please try again.'
        };
    }
};

/**
 * Get cart summary for debugging
 */
const getCartSummary = async (tenantId, endUserPhone) => {
    try {
        const { getConversationId } = require('./historyService');
        const conversationId = await getConversationId(tenantId, endUserPhone);
        
        if (!conversationId) {
            return { success: false, message: 'No conversation found' };
        }
        
        const { data: cart } = await dbClient
            .from('carts')
            .select(`
                id,
                created_at,
                updated_at,
                cart_items (
                    id,
                    quantity,
                    created_at,
                    product:products (id, name, price)
                )
            `)
            .eq('conversation_id', conversationId)
            .single();
        
        if (!cart) {
            return { success: false, message: 'No cart found' };
        }
        
        return {
            success: true,
            cart: {
                id: cart.id,
                itemCount: cart.cart_items?.length || 0,
                items: cart.cart_items || [],
                totalValue: cart.cart_items?.reduce((sum, item) => 
                    sum + (item.quantity * item.product.price), 0) || 0
            }
        };
        
    } catch (error) {
        console.error('Error getting cart summary:', error.message);
        return { success: false, message: 'Error retrieving cart summary' };
    }
};

/**
 * Clear conversation state after successful order
 */
const clearOrderState = async (tenantId, endUserPhone) => {
    try {
        const { getConversationId } = require('./historyService');
        const conversationId = await getConversationId(tenantId, endUserPhone);
        
        if (conversationId) {
            await dbClient
                .from('conversations_new')
                .update({
                    state: null,
                    last_product_discussed: null,
                    order_context: null,
                    updated_at: new Date().toISOString()
                })
                .eq('id', conversationId);
                
            console.log('[ORDER_STATE] Cleared order state for conversation:', conversationId);
        }
        
    } catch (error) {
        console.error('Error clearing order state:', error.message);
    }
};

/**
 * Handle multi-product order confirmation specifically
 */
const handleMultiProductConfirmation = async (tenant, endUserPhone, conversation) => {
    try {
        console.log('[MULTI_CONFIRM] Processing multi-product order confirmation');
        
        // Check if this is a multi-product order state
        if (!conversation?.state?.includes('multi_product')) {
            return { success: false, message: 'Not a multi-product order' };
        }
        
        // Get cart contents
        const cartCheck = await checkCartBeforeCheckout(tenant.id, endUserPhone);
        
        if (!cartCheck.hasItems) {
            return {
                success: false,
                message: 'Cart is empty. Please add your products again.'
            };
        }
        
        // Process checkout for multi-product order.
        const { checkoutWithDiscounts } = require('./cartService');
        const checkoutResult = await checkoutWithDiscounts(tenant, endUserPhone);
        
        // Clear multi-product state
        await clearOrderState(tenant.id, endUserPhone);
        
        return {
            success: true,
            message: checkoutResult,
            isMultiProduct: true,
            cartItems: cartCheck.itemCount
        };
        
    } catch (error) {
        console.error('[MULTI_CONFIRM] Error processing multi-product confirmation:', error.message);
        return {
            success: false,
            message: 'Error processing your multi-product order. Please try again.'
        };
    }
};

/**
 * CONFIRM ORDER: Check inventory and create sales order in Zoho if in stock
 */
const confirmOrder = async (orderId) => {
    try {
        // Get order with items
        const { data: order } = await dbClient
            .from('orders_new')
            .select('*, items:order_items(*)')
            .eq('id', orderId)
            .single();
        
        if (!order || !order.items || order.items.length === 0) {
            return { success: false, message: 'Order not found or empty' };
        }
        
        // Check inventory in Zoho
        const zoho = require('./zohoIntegrationService');
        const itemIds = order.items.map(i => i.zoho_item_id);
        const inventory = await zoho.checkInventory(itemIds);
        
        // Verify stock
        const outOfStock = inventory.filter(i => !i.available);
        if (outOfStock.length > 0) {
            return {
                success: false,
                message: `Out of stock: ${outOfStock.map(i => i.name).join(', ')}`
            };
        }
        
        // Create Sales Order in Zoho
        const salesOrder = await zoho.createSalesOrder({
            customer_id: order.zoho_customer_id,
            order_number: order.order_number,
            date: new Date().toISOString().split('T')[0],
            line_items: order.items.map(item => ({
                item_id: item.zoho_item_id,
                name: item.product_name,
                rate: item.unit_price,
                quantity: item.quantity
            }))
        });
        
        // Save Zoho sales order ID
        await dbClient
            .from('orders_new')
            .update({ 
                zoho_sales_order_id: salesOrder.salesOrderId,
                status: 'sales_order_created'
            })
            .eq('id', orderId);
        
        return {
            success: true,
            salesOrderId: salesOrder.salesOrderId,
            salesOrderNumber: salesOrder.salesOrderNumber
        };
        
    } catch (error) {
        console.error('Error confirming order:', error.message);
        return { success: false, message: 'Error confirming order' };
    }
};

module.exports = {
    isOrderConfirmationEnhanced,
    autoAddDiscussedProductToCart,
    checkCartBeforeCheckout,
    processOrderConfirmation,
    getCartSummary,
    clearOrderState,
    handleMultiProductConfirmation,
    confirmOrder
};

