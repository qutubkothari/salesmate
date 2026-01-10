const { calculateDiscount } = require('./volumeDiscountService');

/**
 * Safely parse context_data (handles both string and object)
 */
function safeParseContextData(contextData) {
    if (!contextData) return {};
    
    // Already an object
    if (typeof contextData === 'object' && contextData !== null) {
        return contextData;
    }
    
    // String - needs parsing
    if (typeof contextData === 'string') {
        try {
            return JSON.parse(contextData);
        } catch (e) {
            console.error('[CONTEXT_PARSE] Invalid JSON:', e.message);
            return {};
        }
    }
    
    // Unknown type
    return {};
}
/**
 * FIXED: Apply approved discount to EACH cart item individually
 */
const applyApprovedDiscountToCart = async (tenantId, endUserPhone) => {
    const conversationId = await getConversationId(tenantId, endUserPhone);
    if (!conversationId) return;

    // Get conversation with quoted products
    const { data: conversation } = await dbClient
        .from('conversations')
        .select('id, context_data, last_quoted_products')
        .eq('id', conversationId)
        .single();

    if (!conversation || !conversation.context_data) return;

    let approvedDiscount = null;
    try {
        const contextData = safeParseContextData(conversation.context_data);
        // Check for both offeredDiscount (during negotiation) and approvedDiscount (after confirmation)
        if (contextData.offeredDiscount && contextData.offeredDiscount > 0) {
            approvedDiscount = contextData.offeredDiscount;
        } else if (contextData.approvedDiscount && contextData.approvedDiscount > 0) {
            approvedDiscount = contextData.approvedDiscount;
        }
    } catch (e) { return; }

    if (!approvedDiscount) return;

    console.log('[DISCOUNT_PER_ITEM] Applying', approvedDiscount, '% discount to each cart item');

    // Parse quoted products to get personalized prices
    let quotedProductsMap = new Map();
    if (conversation.last_quoted_products) {
        try {
            const quotedProducts = typeof conversation.last_quoted_products === 'string'
                ? JSON.parse(conversation.last_quoted_products)
                : conversation.last_quoted_products;
            
            // Build a map of productId -> personalized price
            for (const qp of quotedProducts) {
                if (qp.productId && qp.price) {
                    quotedProductsMap.set(qp.productId, qp.price);
                    console.log('[DISCOUNT_PER_ITEM] Found personalized price for', qp.productName, ':', qp.price);
                }
            }
        } catch (e) {
            console.warn('[DISCOUNT_PER_ITEM] Error parsing quoted products:', e.message);
        }
    }

    // Get cart
    const { data: cart } = await dbClient
        .from('carts')
        .select('id')
        .eq('conversation_id', conversationId)
        .single();

    if (!cart) return;

    // Get all cart items INCLUDING any existing carton_price_override (personalized prices)
    const { data: cartItems } = await dbClient
        .from('cart_items')
        .select(`
            id,
            quantity,
            carton_price_override,
            product:products(id, name, price)
        `)
        .eq('cart_id', cart.id);

    if (!cartItems || cartItems.length === 0) return;

    // Ã¢Å“â€¦ Apply discount to EACH item individually
    for (const item of cartItems) {
        // Priority for base price:
        // 1. Personalized price from quotedProductsMap (from price quote)
        // 2. Catalog price from product
        // NOTE: We IGNORE carton_price_override to avoid double discounting!
        const basePrice = quotedProductsMap.get(item.product.id) || item.product.price;
        const discountedPrice = basePrice * (1 - approvedDiscount / 100);
        const discountAmountPerCarton = basePrice - discountedPrice;

        const priceSource = quotedProductsMap.has(item.product.id) ? 'quoted products' : 'catalog';
        console.log(`[DISCOUNT_PER_ITEM] ${item.product.name}: Ã¢â€šÂ¹${basePrice} Ã¢â€ â€™ Ã¢â€šÂ¹${discountedPrice.toFixed(2)} (${approvedDiscount}% off, source: ${priceSource})`);

        // Update cart_item with discounted price
        await dbClient
            .from('cart_items')
            .update({
                carton_price_override: discountedPrice,
                carton_discount_amount: discountAmountPerCarton * item.quantity
            })
            .eq('id', item.id);
    }

    // Reset cart-level discount (since we're using per-item discounts now)
    await dbClient
        .from('carts')
        .update({
            discount_amount: 0,
            updated_at: new Date().toISOString()
        })
        .eq('id', cart.id);

    console.log('[DISCOUNT_PER_ITEM] Successfully applied discount to', cartItems.length, 'items');
};
/**
 * ENHANCED: Checkout with Zoho sales order creation and PDF delivery
 */
const checkoutWithZohoIntegration = async (tenant, endUserPhone) => {
    try {
        // ... existing checkout code until order creation ...
        // After successful order creation (after: await dbClient.from('order_items').insert(orderItems);)
        console.log('[CHECKOUT_ZOHO] Order created successfully, processing Zoho integration');
        // Clear cart first (existing code)
        await dbClient.from('cart_items').delete().eq('cart_id', cart.id);
        await dbClient.from('carts').update({ 
            applied_discount_id: null, 
            discount_amount: 0,
            updated_at: new Date().toISOString()
        }).eq('id', cart.id);

        // Send initial confirmation message
        let confirmationMessage = `âœ… **Order Confirmed!**\n\n`;
        confirmationMessage += `**Products:**\n`;
        pricing.items.forEach(item => {
            const unitPrice = item.carton_price_override || item.unitPrice;
            const actualQuantity = parseInt(item.quantity) || 1; // FIXED: ensure numeric quantity
            confirmationMessage += `ðŸ“¦ ${item.productName} Ã— ${actualQuantity} cartons\n   â‚¹${unitPrice}/pc (was â‚¹${item.unitPrice}/pc)\n   â‚¹${(unitPrice * item.unitsPerCarton).toFixed(2)}/carton (was â‚¹${(item.unitPrice * item.unitsPerCarton).toFixed(2)}/carton)\n`;
        });
        confirmationMessage += `\n**Pricing Breakdown:**\n`;
        confirmationMessage += `Subtotal: â‚¹${pricing.subtotal.toLocaleString()}\n`;
        if (pricing.discountAmount > 0) {
            confirmationMessage += `Discount: -â‚¹${pricing.discountAmount.toLocaleString()}\n`;
        }
        if (pricing.shipping.freeShippingApplied) {
            confirmationMessage += `Shipping: FREE âœ“\n`;
        } else if (pricing.shipping.charges > 0) {
            confirmationMessage += `Shipping: â‚¹${pricing.shipping.charges.toLocaleString()}\n`;
        }
        confirmationMessage += `GST (${pricing.gst.rate}%): â‚¹${pricing.gst.amount.toLocaleString()}\n`;
        confirmationMessage += `**Final Total: â‚¹${pricing.grandTotal.toLocaleString()}**\n\n`;
        confirmationMessage += `ðŸ“‹ Processing your sales order document...`;
        // Send initial confirmation
        await sendMessage(endUserPhone, confirmationMessage);

        // STEP 1: Create Zoho sales order and generate PDF (async)
        console.log('[CHECKOUT_ZOHO] Starting Zoho sales order creation');
        try {
            // Import the PDF delivery service
            const { deliverOrderPDF } = require('./pdfDeliveryService');
            // Process order to Zoho and deliver PDF
            const deliveryResult = await deliverOrderPDF(tenant.id, order.id, endUserPhone);
            if (deliveryResult.success) {
                // Success message
                const successMessage = `Ã°Å¸Å½â€° **Order Processing Complete!**\n\n` +
                                     `Ã¢Å“â€¦ Sales order created in Zoho CRM\n` +
                                     `Ã°Å¸â€œâ€ž Sales order document sent above\n` +
                                     `Ã°Å¸â€ â€ Reference: ${order.id.substring(0, 8)}\n\n` +
                                     `Your order is now being processed. We'll keep you updated on the status.`;
                await sendMessage(endUserPhone, successMessage);
                console.log('[CHECKOUT_ZOHO] Complete process successful');
            } else {
                // Partial success - order created but PDF failed
                const partialMessage = `Ã¢Å¡ Ã¯Â¸Â **Order Confirmed with Minor Issue**\n\n` +
                                     `Ã¢Å“â€¦ Your order has been created successfully\n` +
                                     `Ã¢ÂÅ’ Sales document generation is delayed\n` +
                                     `Ã°Å¸â€ â€ Reference: ${order.id.substring(0, 8)}\n\n` +
                                     `We'll send your sales document shortly and keep you updated.`;
                await sendMessage(endUserPhone, partialMessage);
                console.log('[CHECKOUT_ZOHO] Partial success - order created, PDF failed');
            }
        } catch (zohoError) {
            console.error('[CHECKOUT_ZOHO] Error in Zoho integration:', zohoError.message);
            // Fallback message - order is still valid even if Zoho fails
            const fallbackMessage = `Ã¢Å“â€¦ **Order Confirmed!**\n\n` +
                                  `Your order has been created successfully.\n` +
                                  `Ã°Å¸â€ â€ Reference: ${order.id.substring(0, 8)}\n\n` +
                                  `Our team will process your order and send you the details shortly.`;
            await sendMessage(endUserPhone, fallbackMessage);
        }

        // Add payment details if configured
        try {
            const paymentDetails = await generatePaymentDetails(tenant, pricing.grandTotal, order.id);
            if (paymentDetails) {
                await sendMessage(endUserPhone, `Ã°Å¸â€™Â³ **Payment Information**\n\n${paymentDetails}`);
            }
        } catch (paymentError) {
            console.warn('[CHECKOUT_ZOHO] Payment details generation failed:', paymentError.message);
        }

        return `Order processing initiated. Check messages above for details.`;

    } catch (error) {
        console.error('Error during enhanced checkout:', error.message);
        return 'An error occurred during checkout. Your order may have been created - please contact support.';
    }
};

/**
 * Background order processing service (for webhook/async processing)
 */
const processOrderBackground = async (orderId) => {
    try {
        console.log('[BACKGROUND_ORDER] Processing order:', orderId);
        // Get order details
        const { data: order } = await dbClient
            .from('orders')
            .select(`
                *,
                conversations (end_user_phone, tenant_id)
            `)
            .eq('id', orderId)
            .single();
        if (!order) {
            throw new Error('Order not found');
        }
        // Check if already processed
        if (order.zoho_sales_order_id) {
            console.log('[BACKGROUND_ORDER] Order already processed');
            return { success: true, message: 'Already processed' };
        }
        const { deliverOrderPDF } = require('./pdfDeliveryService');
        // Process to Zoho and deliver PDF
        const result = await deliverOrderPDF(
            order.conversations.tenant_id,
            orderId,
            order.conversations.end_user_phone
        );
        if (result.success) {
            // Send success notification
            await sendMessage(
                order.conversations.end_user_phone,
                `Ã°Å¸â€œâ€¹ **Order Update**\n\nYour sales order document for order ${orderId.substring(0, 8)} has been generated and sent!\n\nÃ¢Å“â€¦ Processing complete`
            );
        }
        return result;
    } catch (error) {
        console.error('[BACKGROUND_ORDER] Error:', error.message);
        return { success: false, error: error.message };
    }
};
// services/cartService.js - COMPLETE FIXED VERSION with Force Clear on New Orders
const { dbClient } = require('./config');
const { getConversationId } = require('./historyService');
const { addPointsForPurchase } = require('./loyaltyService');
const { sendMessage } = require('./whatsappService');
const { generatePaymentDetails } = require('./paymentService');

// Import modular services
const { calculateComprehensivePricing, formatPricingForWhatsApp, roundAmount } = require('./pricingService');
const CustomerService = require('./core/CustomerService');

/**
 * Debug function to inspect cart state
 */
const debugCartState = async (tenantId, endUserPhone, context = '') => {
    try {
        console.log(`[CART_DEBUG] ${context} - Checking cart state for:`, endUserPhone);
        
        const conversationId = await getConversationId(tenantId, endUserPhone);
        console.log(`[CART_DEBUG] ConversationId:`, conversationId);
        
        if (!conversationId) {
            console.log(`[CART_DEBUG] No conversation found`);
            return;
        }

        // Check conversation state
        const { data: conversation } = await dbClient
            .from('conversations')
            .select('*')
            .eq('id', conversationId)
            .single();
        
        console.log(`[CART_DEBUG] Conversation state:`, {
            id: conversation?.id,
            state: conversation?.state,
            lastProduct: conversation?.last_product_discussed,
            updatedAt: conversation?.updated_at
        });

        // Check all carts for this conversation
        const { data: carts } = await dbClient
            .from('carts')
            .select('*')
            .eq('conversation_id', conversationId);
        
        console.log(`[CART_DEBUG] Found ${carts?.length || 0} carts:`, carts);

        // Check cart items for each cart
        if (carts && carts.length > 0) {
            for (const cart of carts) {
                const { data: items } = await dbClient
                    .from('cart_items')
                    .select(`
                        *,
                        product:products (name, price)
                    `)
                    .eq('cart_id', cart.id);
                
                console.log(`[CART_DEBUG] Cart ${cart.id} has ${items?.length || 0} items:`, 
                    items?.map(item => ({
                        product: item.product?.name,
                        quantity: item.quantity,
                        price: item.product?.price
                    }))
                );
            }
        }

    } catch (error) {
        console.error(`[CART_DEBUG] Error during debug:`, error.message);
    }
};

/**
 * CRITICAL FIX: Force clear cart before adding new order items
 */
const forceResetCartForNewOrder = async (tenantId, endUserPhone) => {
    try {
        console.log('[CART_FORCE_RESET] Starting complete cart reset for new order:', endUserPhone);
        
        await debugCartState(tenantId, endUserPhone, 'BEFORE_FORCE_RESET');
        
        const conversationId = await getConversationId(tenantId, endUserPhone);
        if (!conversationId) {
            console.log('[CART_FORCE_RESET] No conversation found');
            return { success: false, error: 'No conversation' };
        }

        // Get ALL carts for this conversation
        const { data: allCarts, error: cartsError } = await dbClient
            .from('carts')
            .select('id')
            .eq('conversation_id', conversationId);

        if (cartsError) {
            console.error('[CART_FORCE_RESET] Error fetching carts:', cartsError);
            return { success: false, error: cartsError.message };
        }

        console.log('[CART_FORCE_RESET] Found carts to clear:', allCarts?.map(c => c.id) || []);

        // Delete ALL cart items from ALL carts
        if (allCarts && allCarts.length > 0) {
            for (const cart of allCarts) {
                const { error: deleteError } = await dbClient
                    .from('cart_items')
                    .delete()
                    .eq('cart_id', cart.id);
                
                if (deleteError) {
                    console.error('[CART_FORCE_RESET] Error deleting items from cart', cart.id, ':', deleteError);
                } else {
                    console.log('[CART_FORCE_RESET] Successfully deleted items from cart:', cart.id);
                }

                // Reset cart metadata
                const { error: resetError } = await dbClient
                    .from('carts')
                    .update({
                        applied_discount_id: null,
                        discount_amount: 0,
                        updated_at: new Date().toISOString()
                    })
                    .eq('id', cart.id);
                
                if (resetError) {
                    console.warn('[CART_FORCE_RESET] Error resetting cart metadata:', resetError);
                }
            }
        }

        // Reset conversation state
        const { error: convError } = await dbClient
            .from('conversations')
            .update({
                state: null,
                last_product_discussed: null,
                updated_at: new Date().toISOString()
            })
            .eq('id', conversationId);

        if (convError) {
            console.warn('[CART_FORCE_RESET] Error resetting conversation:', convError);
        }

        await debugCartState(tenantId, endUserPhone, 'AFTER_FORCE_RESET');

        console.log('[CART_FORCE_RESET] Complete cart reset finished successfully');
        return { success: true };

    } catch (error) {
        console.error('[CART_FORCE_RESET] Unexpected error:', error.message);
        return { success: false, error: error.message };
    }
};

/**
 * Enhanced clear cart with force option
 */
const forceClearCartCompletely = async (tenantId, endUserPhone) => {
    try {
        console.log('[FORCE_CLEAR] Starting complete cart reset for:', endUserPhone);
        
        await debugCartState(tenantId, endUserPhone, 'BEFORE_FORCE_CLEAR');
        
        const conversationId = await getConversationId(tenantId, endUserPhone);
        if (!conversationId) {
            return "Could not identify your conversation.";
        }

        // Step 1: Get ALL carts for this conversation
        const { data: allCarts } = await dbClient
            .from('carts')
            .select('id')
            .eq('conversation_id', conversationId);

        console.log('[FORCE_CLEAR] Found carts:', allCarts?.map(c => c.id));

        // Step 2: Delete ALL cart items from ALL carts
        if (allCarts && allCarts.length > 0) {
            for (const cart of allCarts) {
                const { error: deleteError } = await dbClient
                    .from('cart_items')
                    .delete()
                    .eq('cart_id', cart.id);
                
                if (deleteError) {
                    console.error('[FORCE_CLEAR] Error deleting items from cart', cart.id, ':', deleteError);
                } else {
                    console.log('[FORCE_CLEAR] Deleted items from cart:', cart.id);
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
        }

        // Step 3: Reset conversation completely
        await dbClient
            .from('conversations')
            .update({
                state: null,
                last_product_discussed: null,
                updated_at: new Date().toISOString()
            })
            .eq('id', conversationId);

        await debugCartState(tenantId, endUserPhone, 'AFTER_FORCE_CLEAR');

        console.log('[FORCE_CLEAR] Complete reset finished');
        return "Ã°Å¸â€Â¥ Cart completely reset! All previous items removed.";

    } catch (error) {
        console.error('[FORCE_CLEAR] Error:', error.message);
        return 'Error during complete reset. Please contact support.';
    }
};

/**
 * Enhanced add product to cart with validation
 */
const addProductToCartEnhanced = async (tenantId, endUserPhone, product, quantity, options = {}) => {
    try {
        console.log('[CART_ADD_ENHANCED] Adding product:', {
            productId: product.id,
            productName: product.name,
            quantity: quantity,
            price: product.price
        });

        if (!product || !product.id || product.price <= 0) {
            console.error('[CART_ADD_ENHANCED] Invalid product:', product);
            return {
                success: false,
                error: 'Invalid product or zero price product'
            };
        }

        await CustomerService.ensureCustomerProfile(tenantId, endUserPhone);
        const conversationId = await getConversationId(tenantId, endUserPhone);
        
        if (!conversationId) {
            return {
                success: false,
                error: 'Could not identify conversation'
            };
        }

        const cart = await getOrCreateCart(conversationId);

        // Check for existing item
        const { data: existingItem } = await dbClient
            .from('cart_items')
            .select('id, quantity')
            .eq('cart_id', cart.id)
            .eq('product_id', product.id)
            .single();

        if (existingItem) {
            // Update existing item
            const newQuantity = options.replace ? 
                Number(quantity) : 
                Number(existingItem.quantity) + Number(quantity);
                
            const { error: updateError } = await dbClient
                .from('cart_items')
                .update({ quantity: newQuantity })
                .eq('id', existingItem.id);
            
            if (updateError) throw updateError;
            
            console.log('[CART_ADD_ENHANCED] Updated existing item, new quantity:', newQuantity);
        } else {
            // Add new item
            const { error: insertError } = await dbClient
                .from('cart_items')
                .insert({
                    cart_id: cart.id,
                    product_id: product.id,
                    quantity: Number(quantity)
                });
            
            if (insertError) throw insertError;
            
            console.log('[CART_ADD_ENHANCED] Added new cart item');
        }
        
        // Update cart timestamp
        await dbClient
            .from('carts')
            .update({ updated_at: new Date().toISOString() })
            .eq('id', cart.id);

        return { success: true };

    } catch (error) {
        console.error('[CART_ADD_ENHANCED] Error:', error.message);
        return {
            success: false,
            error: error.message
        };
    }
};

/**
 * Finds or creates a shopping cart for a given conversation.
 */
const getOrCreateCart = async (conversationId) => {
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
    return cart;
};

/**
 * FIXED: View cart using comprehensive pricing service consistently
 */
const viewCartWithDiscounts = async (tenantId, endUserPhone) => {
    // Always apply approved discount from conversation context before pricing
    await applyApprovedDiscountToCart(tenantId, endUserPhone);
    try {
        await CustomerService.ensureCustomerProfile(tenantId, endUserPhone);

        const conversationId = await getConversationId(tenantId, endUserPhone);
        if (!conversationId) return "Could not identify your conversation.";

        // Get cart with items - SAME structure as checkout
        const { data: cart } = await dbClient
            .from('carts')
            .select(`
                *,
                cart_items (
                    quantity,
                    carton_price_override,
                    carton_discount_amount,
                    product:products (
                        id, 
                        name, 
                        price, 
                        packaging_unit, 
                        units_per_carton
                    )
                )
            `)
            .eq('conversation_id', conversationId)
            .single();

        if (!cart || !cart.cart_items || cart.cart_items.length === 0) {
            return "Your shopping cart is empty.";
        }

        // Filter out items with zero price or invalid products
        const validItems = cart.cart_items.filter(item => 
            item.product && item.product.price > 0
        );

        if (validItems.length === 0) {
            return "Your shopping cart is empty (no valid items).";
        }

        console.log('[CART_VIEW] Using comprehensive pricing service for', validItems.length, 'valid items');

        // Get customer profile for last purchase pricing
        let customerProfileId = null;
        try {
            const { data: profile } = await dbClient
                .from('customer_profiles')
                .select('id')
                .eq('tenant_id', tenantId)
                .eq('phone', endUserPhone)
                .single();
            customerProfileId = profile?.id;
            console.log('[CART_VIEW] Customer profile ID:', customerProfileId, 'for phone:', endUserPhone);
        } catch (error) {
            console.warn('[CART_VIEW] Could not fetch customer profile:', error.message);
        }

        // Check if items have personalized pricing (carton_price_override)
        const hasPersonalizedPricing = validItems.some(item => item.carton_price_override);
        console.log('[CART_VIEW] Has personalized pricing:', hasPersonalizedPricing);

        // CRITICAL FIX: Calculate base order total using ORIGINAL catalog prices only
        // Don't use carton_price_override here because it may contain already-discounted prices
        // This prevents double-discounting when comparing negotiated vs automatic discounts
        const baseOrderTotal = validItems.reduce((sum, item) =>
            sum + (item.quantity * item.product.price), 0
        );
        console.log('[CART_VIEW] Base order total (catalog prices):', baseOrderTotal);

        // Step 1: Check for negotiated discounts from AI conversation
        let negotiatedDiscountPercent = 0;
        let negotiatedDiscountAmount = 0;
        try {
            const { data: conversation } = await dbClient
                .from('conversations')
                .select('context_data')
                .eq('id', conversationId)
                .single();

            if (conversation?.context_data) {
                const contextData = typeof conversation.context_data === 'string'
                    ? JSON.parse(conversation.context_data)
                    : conversation.context_data;

                if (contextData.offeredDiscount || contextData.approvedDiscount) {
                    negotiatedDiscountPercent = contextData.offeredDiscount || contextData.approvedDiscount;
                    negotiatedDiscountAmount = (baseOrderTotal * negotiatedDiscountPercent) / 100;
                    console.log('[CART_VIEW] Negotiated discount found:', negotiatedDiscountPercent, '% = â‚¹', negotiatedDiscountAmount);
                }
            }
        } catch (error) {
            console.warn('[CART_VIEW] Error checking negotiated discount:', error.message);
        }

        // Step 2: DISABLED - Do NOT calculate automatic discount rules in cart view
        // Discounts are ONLY applied when customer explicitly asks for them
        // This prevents automatic discount application without customer request
        console.log('[CART_VIEW] Automatic discounts DISABLED - only applied on explicit request');

        // Step 3: Use ONLY negotiated discount (if customer requested one)
        const finalDiscountAmount = negotiatedDiscountAmount;

        let discountSource = 'none';
        if (finalDiscountAmount > 0) {
            discountSource = `negotiated (${negotiatedDiscountPercent}%)`;
        }

        console.log('[CART_VIEW] Final discount:', finalDiscountAmount, 'from', discountSource);

        // CRITICAL FIX: Clear carton_price_override from DATABASE if NO approved discount exists
        // This prevents showing old discounted prices from previous interactions
        if (negotiatedDiscountPercent === 0 && hasPersonalizedPricing) {
            console.log('[CART_VIEW] No approved discount - clearing carton_price_override from database');

            // Clear from database for all cart items
            const cartItemIds = validItems
                .filter(item => item.carton_price_override)
                .map(item => item.product.id);

            if (cartItemIds.length > 0) {
                await dbClient
                    .from('cart_items')
                    .update({ carton_price_override: null })
                    .eq('cart_id', cart.id)
                    .in('product_id', cartItemIds);

                console.log(`[CART_VIEW] Cleared carton_price_override for ${cartItemIds.length} items in database`);

                // Also clear from memory array for current request
                validItems.forEach(item => {
                    if (item.carton_price_override) {
                        console.log(`[CART_VIEW] Clearing ${item.product.name}: was â‚¹${item.carton_price_override}, now catalog â‚¹${item.product.price}`);
                        item.carton_price_override = null;
                    }
                });
            }
        }

        // CRITICAL BUSINESS LOGIC: Determine if customer is NEW or RETURNING
        // This affects pricing display and discount handling
        let isReturningCustomer = false;
        try {
            const { count } = await dbClient
                .from('orders')
                .select('*', { count: 'exact', head: true })
                .eq('tenant_id', tenantId)
                .eq('customer_profile_id', customerProfileId)
                .in('status', ['pending', 'confirmed', 'completed', 'pending_payment']);
            
            isReturningCustomer = count > 0;
            console.log('[CART_VIEW] Customer type:', isReturningCustomer ? 'RETURNING' : 'NEW', '- Orders:', count);
        } catch (error) {
            console.warn('[CART_VIEW] Error checking customer type:', error.message);
        }

        // PRICING STRATEGY:
        // - RETURNING customers: Show last purchase prices, discount requests go to human
        // - NEW customers: ALWAYS show catalog prices, apply dashboard discounts automatically
        const ignorePriceOverride = !isReturningCustomer;
        
        // CRITICAL: For NEW customers, clear any old carton_price_override from database
        if (!isReturningCustomer) {
            console.log('[CART_VIEW] NEW customer - clearing old carton_price_override to show catalog prices');
            
            const itemsWithOverride = validItems.filter(item => item.carton_price_override);

            if (itemsWithOverride.length > 0) {
                // Clear from database for ALL cart items (safest approach)
                await dbClient
                    .from('cart_items')
                    .update({ carton_price_override: null })
                    .eq('cart_id', cart.id);
                
                console.log(`[CART_VIEW] Cleared carton_price_override for all items in cart`);

                // Clear from memory - CRITICAL: Set to null so pricing service uses catalog prices
                validItems.forEach(item => {
                    if (item.carton_price_override) {
                        console.log(`[CART_VIEW] Memory: Clearing ${item.product.name}: was â‚¹${item.carton_price_override}, now will use catalog â‚¹${item.product.price}`);
                        item.carton_price_override = null;
                    }
                });
            }
        }
        
        console.log('[CART_VIEW] ðŸ” DEBUG - Pricing call parameters:');
        console.log('[CART_VIEW] - Customer type:', isReturningCustomer ? 'RETURNING' : 'NEW');
        console.log('[CART_VIEW] - negotiatedDiscountPercent:', negotiatedDiscountPercent);
        console.log('[CART_VIEW] - ignorePriceOverride flag:', ignorePriceOverride);
        console.log('[CART_VIEW] - hasPersonalizedPricing:', hasPersonalizedPricing);
        console.log('[CART_VIEW] - finalDiscountAmount:', finalDiscountAmount);
        console.log('[CART_VIEW] - Items carton_price_override status AFTER clearing:');
        validItems.forEach(item => {
            console.log(`[CART_VIEW]   - ${item.product.name}: carton_price_override=${item.carton_price_override || 'null'}, catalog=â‚¹${item.product.price}`);
        });
        
        const pricing = await calculateComprehensivePricing(
            tenantId,
            validItems,
            {
                customerState: null,
                customerId: customerProfileId,
                customerPhone: customerProfileId ? null : endUserPhone,
                discountAmount: hasPersonalizedPricing ? 0 : finalDiscountAmount,
                ignorePriceOverride: ignorePriceOverride, // Only ignore for NEW customers without approved discount
                isReturningCustomer: isReturningCustomer, // Pass customer type to pricing service
                roundTotals: true
            }
        );

    let cartMessage = "*Your Shopping Cart*\n\n";

        // Show individual items with pieces info
        pricing.items.forEach(item => {
            cartMessage += `*${item.productName}*\n`;
            // Find original product for pieces calculation
            const originalItem = validItems.find(ci => ci.product.id === item.productId);
            if (originalItem && originalItem.product.packaging_unit === 'carton' && originalItem.product.units_per_carton) {
                var totalPieces = item.quantity * originalItem.product.units_per_carton;
                var pricePerPiece = (item.unitPrice / originalItem.product.units_per_carton).toFixed(2);
                cartMessage += `  - ${item.quantity} carton(s) (${totalPieces.toLocaleString()} pieces)\n`;
                cartMessage += `  - ${item.quantity} cartons @ â‚¹${item.unitPrice}/carton (â‚¹${pricePerPiece} per piece)\n`;
            } else {
                cartMessage += `  - Qty: ${item.quantity}\n`;
                cartMessage += `  - ${item.quantity} @ â‚¹${item.unitPrice} each\n`;
            }
            // Show total for each item
            cartMessage += `  - Total: â‚¹${item.roundedItemTotal.toLocaleString()}\n\n`;
        });

        // CRITICAL FIX: Show EXACT same pricing breakdown as checkout will show
        cartMessage += "*Pricing Breakdown:*\n";
        cartMessage += `Subtotal: â‚¹${pricing.subtotal.toLocaleString()}\n`;

        if (pricing.discountAmount > 0) {
            cartMessage += `Discount: -â‚¹${pricing.discountAmount.toLocaleString()}`;
            if (discountSource !== 'none') {
                cartMessage += ` (${discountSource})`;
            }
            cartMessage += '\n';
        }
        
        // CRITICAL: Include shipping charges (was missing before)
        if (pricing.shipping.freeShippingApplied) {
            cartMessage += `Shipping: FREE âœ“\n`;
        } else if (pricing.shipping.charges > 0) {
            cartMessage += `Shipping: â‚¹${pricing.shipping.charges.toLocaleString()} (${pricing.totalCartons} cartons Ã— â‚¹${pricing.shipping.ratePerCarton})\n`;
        }

        cartMessage += `GST (${pricing.gst.rate}%): â‚¹${pricing.gst.amount.toLocaleString()}\n`;
        cartMessage += `*Final Total: â‚¹${pricing.grandTotal.toLocaleString()}*`;
        
        if (pricing.isRounded && pricing.roundingAdjustment > 0) {
            cartMessage += ` (rounded from â‚¹${pricing.grandTotalBeforeRounding.toLocaleString()})`;
        }
        
        cartMessage += '\n\nTo complete purchase: say "yes go ahead" or type /checkout';

        return cartMessage;

    } catch (error) {
        console.error('Error viewing cart:', error.message);
        return 'An error occurred while fetching your cart. Please try again.';
    }
};

/**
 * FIXED: Checkout using comprehensive pricing service consistently
 */
const checkoutWithDiscounts = async (tenant, endUserPhone) => {
    // Always apply approved discount from conversation context before pricing
    await applyApprovedDiscountToCart(tenant.id, endUserPhone);
    try {
        // IDEMPOTENCY CHECK: Prevent duplicate order creation for same conversation/user in a short window
        const conversationId = await getConversationId(tenant.id, endUserPhone);
        if (!conversationId) return "Could not identify your conversation.";

        // Check for existing order for this conversation in the last 10 minutes (or today)
        const { data: recentOrders, error: orderCheckError } = await dbClient
            .from('orders')
            .select('id, created_at, order_status')
            .eq('tenant_id', tenant.id)
            .eq('conversation_id', conversationId)
            .order('created_at', { ascending: false })
            .limit(1);

        if (orderCheckError) {
            console.warn('[IDEMPOTENCY] Error checking for recent orders:', orderCheckError.message);
        }

        if (recentOrders && recentOrders.length > 0) {
            const lastOrder = recentOrders[0];
            // Only block if not cancelled and created very recently (e.g., last 10 min)
            const status = (lastOrder.order_status || '').toLowerCase();
            const createdAt = new Date(lastOrder.created_at);
            const now = new Date();
            const minutesAgo = (now - createdAt) / 60000;
            if (status !== 'cancelled' && minutesAgo < 10) {
                console.warn('[IDEMPOTENCY] Duplicate checkout attempt blocked for conversation:', conversationId);
                return 'Your order is already being processed. Please wait a few minutes before trying again.';
            }
        }
        
        // Ensure customer profile exists and get profile data
        const profileSync = await CustomerService.ensureCustomerProfile(tenant.id, endUserPhone);
        const customerProfile = profileSync.profile;
        console.log('[CHECKOUT] Customer profile:', customerProfile?.id);

        // ===== GST VALIDATION CHECK =====
        // Check if customer has set GST preference before allowing checkout
        console.log('[CHECKOUT] Checking GST preference...');
        const GSTService = require('./core/GSTService');
        const needsGST = await GSTService.needsGSTCollection(tenant.id, endUserPhone);

        if (needsGST) {
            // Customer hasn't set GST preference yet - block checkout and ask
            console.log('[CHECKOUT] GST preference not set, requesting details');

            // Request GST using the new service (handles state transition automatically)
            const { message } = await GSTService.requestGSTPreference(tenant.id, endUserPhone);
            
            return `â¸ï¸ ${message}`;
        }

        const { preference, gstNumber } = await GSTService.getGSTPreference(tenant.id, endUserPhone);
        console.log('[CHECKOUT] GST preference confirmed:', preference);
        // ===== END GST VALIDATION =====

        // Get cart with EXACT same structure as viewCart
        const { data: cart } = await dbClient
            .from('carts')
            .select(`
                *,
                cart_items (
                    quantity,
                    carton_price_override,
                    carton_discount_amount,
                    product:products (id, name, price, units_per_carton, packaging_unit)
                )
            `)
            .eq('conversation_id', conversationId)
            .single();

        if (!cart || !cart.cart_items || cart.cart_items.length === 0) {
            return "Your cart is empty. Add some products before checking out!";
        }

        // Filter out zero price items
        const validItems = cart.cart_items.filter(item => 
            item.product && item.product.price > 0
        );

        if (validItems.length === 0) {
            return "Your cart contains no valid items. Please add products with valid prices.";
        }

        console.log('[CHECKOUT] Processing', validItems.length, 'valid items');

        // CRITICAL FIX: DISABLED - Do NOT apply automatic discounts at checkout
        // Discounts are ONLY applied when explicitly approved via dashboard discount rules
        // and already stored in cart.discount_amount or carton_price_override
        console.log('[CHECKOUT] Automatic dashboard discounts DISABLED at checkout - using only pre-approved cart discounts');
        
        // Use ONLY the discount that was already approved and stored in the cart
        // This comes from the discount negotiation flow where admin approves the discount
        const preApprovedDiscount = cart.discount_amount || 0;
        console.log('[CHECKOUT] Using pre-approved discount from cart:', preApprovedDiscount);

        // CRITICAL FIX: Use EXACT same pricing calculation as viewCart
        const pricing = await calculateComprehensivePricing(
            tenant.id,
            validItems,
            {
                customerState: null,
                customerId: customerProfile?.id,
                customerPhone: customerProfile?.id ? null : endUserPhone, // Fallback to phone if no profile
                discountAmount: preApprovedDiscount, // ONLY use pre-approved discount from cart
                roundTotals: true // EXACT same as viewCart
            }
        );

        // Create order using comprehensive pricing
        console.log('[CHECKOUT] Order data being inserted:', {
            original_amount: pricing.originalSubtotal,
            subtotal_amount: pricing.subtotal,
            total_amount: pricing.grandTotal,
            shipping_cartons: pricing.totalCartons
        });

        const { data: order, error: orderError} = await dbClient
            .from('orders')
            .insert({
                tenant_id: tenant.id,
                conversation_id: conversationId,
                customer_profile_id: customerProfile?.id || null,
                original_amount: pricing.originalSubtotal,
                subtotal_amount: pricing.subtotal,
                discount_amount: pricing.discountAmount,
                volume_discount_amount: pricing.volumeDiscount?.amount || 0,
                volume_discount_percent: pricing.volumeDiscount?.percent || 0,
                gst_rate: pricing.gst.rate,
                gst_amount: pricing.gst.amount,
                cgst_amount: pricing.gst.cgstAmount,
                sgst_amount: pricing.gst.sgstAmount,
                igst_amount: pricing.gst.igstAmount,
                is_interstate: pricing.gst.isInterstate,
                shipping_charges: pricing.shipping.charges,
                shipping_cartons: pricing.totalCartons,
                shipping_rate_per_carton: pricing.shipping.ratePerCarton,
                free_shipping_applied: pricing.shipping.freeShippingApplied,
                total_amount: pricing.grandTotal,
                customer_name: customerProfile?.business_name || customerProfile?.name || null
            })
            .select('id')
            .single();

        if (orderError) {
            console.error('[CHECKOUT] Order insertion error:', orderError);
            throw orderError;
        }

        // Create order items with DISCOUNTED prices
        // CRITICAL: pricing.items[].unitPrice contains ORIGINAL price, NOT discounted
        // We need to distribute the discount proportionally across all items
        const totalOriginalPrice = pricing.originalSubtotal;
        const totalDiscountedPrice = pricing.subtotal;
        const discountRatio = totalOriginalPrice > 0 ? totalDiscountedPrice / totalOriginalPrice : 1;
        
        const orderItems = validItems.map((item, index) => {
            const pricingItem = pricing.items[index];
            const originalPriceWithTax = parseFloat(pricingItem.unitPrice);
            
            // Apply proportional discount to get the ACTUAL price customer pays
            const discountedPriceWithTax = originalPriceWithTax * discountRatio;
            
            const unitPriceBeforeTax = (discountedPriceWithTax / 1.18).toFixed(2);
            const gstAmount = ((discountedPriceWithTax - unitPriceBeforeTax) * item.quantity).toFixed(2);
            
            console.log(`[ORDER_ITEM] ${item.product.name}: Original Ã¢â€šÂ¹${originalPriceWithTax} Ã¢â€ â€™ Discounted Ã¢â€šÂ¹${discountedPriceWithTax.toFixed(2)}`);
            
            return {
                order_id: order.id,
                product_id: item.product.id,
                quantity: item.quantity,
                price_at_time_of_purchase: discountedPriceWithTax.toFixed(2), // FIXED: Now stores discounted price
                unit_price_before_tax: unitPriceBeforeTax,
                gst_rate: 18,
                gst_amount: gstAmount,
                zoho_item_id: null
            };
        });
        

        await dbClient.from('order_items').insert(orderItems);

        // REMOVED: Discount logging code since we're no longer applying automatic discounts at checkout
        // Discounts are now only applied via explicit approval in discount negotiation flow
        // If needed, discount logs should be created during the negotiation/approval step, not at checkout

        // === SHIPPING INFO REQUEST ===
        // Request shipping address and transporter details after order creation
        console.log('[CHECKOUT] Order created, requesting shipping info');
        console.log('[CHECKOUT] Phone for shipping:', endUserPhone);
        console.log('[CHECKOUT] Order ID:', order.id);
        try {
            const { requestShippingInfo } = require('./shippingInfoService');
            const orderSummary = `Order #${order.id.substring(0, 8)} - â‚¹${pricing.grandTotal.toLocaleString()}`;
            const shippingResult = await requestShippingInfo(tenant.id, endUserPhone, order.id, orderSummary);
            console.log('[CHECKOUT] Shipping info request sent, result:', shippingResult);
        } catch (shippingError) {
            console.error('[CHECKOUT] Error requesting shipping info:', shippingError);
            console.error('[CHECKOUT] Shipping error stack:', shippingError.stack);
            // Send fallback message to customer
            try {
                const { sendMessage } = require('./whatsappService');
                await sendMessage(endUserPhone, `âœ… Order confirmed! Order ID: ${order.id.substring(0, 8)}\n\nâš ï¸ Please provide your shipping address and transporter details.`);
            } catch (fallbackError) {
                console.error('[CHECKOUT] Fallback message also failed:', fallbackError);
            }
        }

        // ZOHO INTEGRATION - Process synchronously to ensure local order is updated
        console.log('[CHECKOUT] Order created, starting Zoho integration');
        try {
            const { processOrderToZoho } = require('./zohoSalesOrderService');
            console.log('[CHECKOUT] About to call processOrderToZoho');
            const result = await processOrderToZoho(tenant.id, order.id);
            console.log('[CHECKOUT] processOrderToZoho returned:', {
                success: result?.success,
                hasBuffer: !!result?.pdfBuffer,
                bufferSize: result?.pdfBuffer?.length,
                filename: result?.filename,
                zohoOrderId: result?.zohoOrderId,
                keys: Object.keys(result || {})
            });

            if (result.success) {
                console.log('[ZOHO_INTEGRATION] Success:', result.zohoOrderId);
                // Send success notification
                await sendMessage(endUserPhone, 
                    `Ã°Å¸â€œâ€¹ Sales Order Created!\n\nZoho Order: ${result.zohoOrderId.substring(0, 8)}\nReference: ${order.id.substring(0, 8)}`
                );

                // PDF Delivery after Zoho success
                console.log('[CHECKOUT] Zoho sync successful, starting PDF delivery');
                if (result.pdfBuffer && result.filename) {
                    const { sendPDFViaWhatsApp } = require('./pdfDeliveryService');
                    try {
                        const pdfDelivery = await sendPDFViaWhatsApp(
                            endUserPhone,
                            result.pdfBuffer,
                            result.filename,
                            `Ã°Å¸â€œâ€ž Your sales order invoice\nOrder: ${result.zohoOrderId}\nThank you for your business!`
                        );
                        if (pdfDelivery.success) {
                            console.log('[PDF_SEND] PDF delivered successfully');
                            // PATCH: Update order with PDF delivery URL
                            await dbClient
                                .from('orders')
                                .update({
                                    pdf_delivery_url: pdfDelivery.fileUrl,
                                    pdf_delivery_status: 'delivered',
                                    pdf_delivered_at: new Date().toISOString(),
                                    whatsapp_message_id: pdfDelivery.messageId
                                })
                                .eq('id', order.id);
                        } else {
                            console.error('[PDF_SEND] PDF delivery failed:', pdfDelivery.error);
                        }
                    } catch (error) {
                        console.error('[PDF_SEND] Error delivering PDF:', error.message);
                    }
                } else {
                    console.log('[PDF_SEND] No PDF buffer available for delivery');
                    console.log('[PDF_SEND] Result contents:', result);
                }
            } else {
                console.error('[ZOHO_INTEGRATION] Failed:', result.error);
            }
        } catch (error) {
            console.error('[ZOHO_INTEGRATION] Error:', error.message);
        }

        // CRITICAL: Clear cart completely after successful order
        await dbClient.from('cart_items').delete().eq('cart_id', cart.id);
        await dbClient.from('carts').update({ 
            applied_discount_id: null, 
            discount_amount: 0,
            updated_at: new Date().toISOString()
        }).eq('id', cart.id);

        // CRITICAL FIX: Customer confirmation with IDENTICAL pricing breakdown as cart view
        let confirmationMessage = `âœ… *Order Confirmed!*\n\n`;
        
        // Add product details with per-piece pricing and discount breakdown
        if (validItems && validItems.length > 0) {
            confirmationMessage += `*Products:*\n`;
            validItems.forEach((item, index) => {
                const pricingItem = pricing.items[index];
                const productName = item.product.name;
                const quantity = item.quantity;
                const discountedPrice = parseFloat(pricingItem.unitPrice);
                const originalPrice = item.product.price;
                const unitsPerCarton = item.product.units_per_carton || 0;
                
                // Calculate per-piece prices
                let discountedPerPiece = null;
                let originalPerPiece = null;
                if (unitsPerCarton > 0) {
                    discountedPerPiece = (discountedPrice / unitsPerCarton).toFixed(2);
                    originalPerPiece = (originalPrice / unitsPerCarton).toFixed(2);
                }
                
                const actualQuantity = parseInt(quantity) || 1; // FIXED: ensure numeric quantity
                confirmationMessage += `ðŸ“¦ ${productName} Ã— ${actualQuantity} carton${actualQuantity > 1 ? 's' : ''}\n`;
                if (discountedPerPiece && originalPerPiece) {
                    confirmationMessage += `   â‚¹${discountedPerPiece}/pc (was â‚¹${originalPerPiece}/pc)\n`;
                    confirmationMessage += `   â‚¹${discountedPrice.toFixed(2)}/carton (was â‚¹${originalPrice.toFixed(2)}/carton)\n`;
                } else {
                    confirmationMessage += `   â‚¹${discountedPrice.toFixed(2)}/carton (was â‚¹${originalPrice.toFixed(2)}/carton)\n`;
                }
            });
            confirmationMessage += `\n`;
        }

        confirmationMessage += `Subtotal: â‚¹${pricing.subtotal.toLocaleString()}\n`;
        // Removed bulk discount line since discounts are now shown per item above
        if (pricing.shipping.freeShippingApplied) {
            confirmationMessage += `Shipping: FREE âœ“\n`;
        } else if (pricing.shipping.charges > 0) {
            confirmationMessage += `Shipping: â‚¹${pricing.shipping.charges.toLocaleString()} (${pricing.totalCartons} cartons Ã— â‚¹${pricing.shipping.ratePerCarton})\n`;
        }
        confirmationMessage += `GST (${pricing.gst.rate}%): â‚¹${pricing.gst.amount.toLocaleString()}\n`;
        confirmationMessage += `**Final Total: â‚¹${pricing.grandTotal.toLocaleString()}**`;
        if (pricing.isRounded && pricing.roundingAdjustment > 0) {
            confirmationMessage += ` (rounded from â‚¹${pricing.grandTotalBeforeRounding.toLocaleString()})`;
        }
        confirmationMessage += '\n\nThank you for your order!';

        // Optionally: send payment details
        // const paymentDetails = await generatePaymentDetails(order.id, pricing.grandTotal);
        // confirmationMessage += `\n\n${paymentDetails}`;

        // Optionally: add loyalty points
        await addPointsForPurchase(tenant.id, endUserPhone, pricing.grandTotal);

        // Optionally: send WhatsApp message
        // await sendMessage(endUserPhone, confirmationMessage);

        return confirmationMessage;

    } catch (error) {
        console.error('[CHECKOUT] Error:', error.message);
        return 'An error occurred during checkout. Please try again.';
    }
};

/**
 * Add product to cart (simple interface)
 */
const addProductToCart = async (tenantId, endUserPhone, productName) => {
    try {
        await CustomerService.ensureCustomerProfile(tenantId, endUserPhone);

        const conversationId = await getConversationId(tenantId, endUserPhone);
        if (!conversationId) return "Could not identify your conversation.";

        const { data: product } = await dbClient
            .from('products')
            .select('id, name, price')
            .eq('tenant_id', tenantId)
            .ilike('name', `%${productName}%`)
            .gt('price', 0) // Only get products with price > 0
            .single();

        if (!product) {
            return `Sorry, I couldn't find a product named "${productName}".`;
        }

        const result = await addProductToCartEnhanced(tenantId, endUserPhone, product, 1);
        
        if (result.success) {
            return `Added "${product.name}" to your cart.`;
        } else {
            return `Error adding "${product.name}" to cart: ${result.error}`;
        }
        
    } catch (error) {
        console.error('Error adding product to cart:', error.message);
        return 'An error occurred while adding the item to your cart.';
    }
};

/**
 * FIXED: Clear cart function with complete reset
 */
const clearCart = async (tenantId, endUserPhone) => {
    try {
        console.log('[CART_CLEAR] Clearing cart for:', endUserPhone);
        
        const resetResult = await forceResetCartForNewOrder(tenantId, endUserPhone);
        
        if (resetResult.success) {
            return "Your shopping cart has been cleared! You can start adding new products anytime.";
        } else {
            return 'An error occurred while clearing your cart. Please try again.';
        }

    } catch (error) {
        console.error('[CART_CLEAR] Error:', error.message);
        return 'An error occurred while clearing your cart. Please try again.';
    }
};

/**
 * Get order status
 */
const getOrderStatus = async (tenantId, endUserPhone) => {
    try {
        const conversationId = await getConversationId(tenantId, endUserPhone);
        if (!conversationId) return "Could not identify your conversation.";

        const { data: orders } = await dbClient
            .from('orders')
            .select('id, total_amount, created_at, order_status, shipping_charges, gst_amount')
            .eq('tenant_id', tenantId)
            .eq('conversation_id', conversationId)
            .order('created_at', { ascending: false })
            .limit(5);

        if (!orders || orders.length === 0) {
            return "You haven't placed any orders yet.";
        }

        let statusMessage = "Ã°Å¸â€œâ€¹ **Your Recent Orders**\n\n";
        orders.forEach((order, index) => {
            const orderDate = new Date(order.created_at).toLocaleDateString();
            statusMessage += `${index + 1}. Order #${order.id.substring(0, 8)}\n`;
            statusMessage += `   Date: ${orderDate}\n`;
            
            if (order.shipping_charges > 0) {
                statusMessage += `   Shipping: Ã¢â€šÂ¹${order.shipping_charges}\n`;
            }
            if (order.gst_amount > 0) {
                statusMessage += `   GST: Ã¢â€šÂ¹${order.gst_amount}\n`;
            }
            
            statusMessage += `   **Total: Ã¢â€šÂ¹${order.total_amount}**\n`;
            statusMessage += `   Status: ${order.order_status || 'Processing'}\n\n`;
        });

        return statusMessage;
    } catch (error) {
        console.error('Error getting order status:', error.message);
        return 'Error retrieving order status. Please try again.';
    }
};

// Legacy functions for backward compatibility
const viewCart = async (tenantId, endUserPhone) => {
    return await viewCartWithDiscounts(tenantId, endUserPhone);
};

const checkout = async (tenant, endUserPhone) => {
    return await checkoutWithDiscounts(tenant, endUserPhone);
};

// ...existing code...

/**
 * Remove a product from the cart by product name or code
 */
const removeCartItem = async (tenantId, endUserPhone, productNameOrCode) => {
    try {
        const conversationId = await getConversationId(tenantId, endUserPhone);
        if (!conversationId) return { success: false, message: "Could not identify your conversation." };

        // Get cart
        const { data: cart } = await dbClient
            .from('carts')
            .select('id')
            .eq('conversation_id', conversationId)
            .single();

        if (!cart) return { success: false, message: "Your cart is empty." };

        // Get cart items with product details
        const { data: cartItems } = await dbClient
            .from('cart_items')
            .select('id, product_id')
            .eq('cart_id', cart.id);

        if (!cartItems || cartItems.length === 0) {
            return { success: false, message: "Your cart is empty." };
        }

        // Get product details for each item
        for (const item of cartItems) {
            const { data: product } = await dbClient
                .from('products')
                .select('id, name, code')
                .eq('id', item.product_id)
                .single();
            item.product = product;
        }

        // Find cart item that matches the product name or code
        let matchingItem = null;
        for (const item of cartItems) {
            if (!item.product) continue;

            const productName = item.product.name || '';
            const productCode = item.product.code || '';

            // Check if the input matches product name or code (case insensitive)
            const input = productNameOrCode.toLowerCase();
            const name = productName.toLowerCase();
            const code = productCode.toLowerCase();

            if (name.includes(input) ||
                (productCode && code.includes(input)) ||
                (productCode && input.includes(code))) {
                matchingItem = item;
                break;
            }
        }

        if (!matchingItem) {
            return { success: false, message: `Could not find product "${productNameOrCode}" in your cart.` };
        }

        // Delete the cart item
        const { error: deleteError } = await dbClient
            .from('cart_items')
            .delete()
            .eq('id', matchingItem.id);

        if (deleteError) {
            return { success: false, message: `Error removing item: ${deleteError.message}` };
        }

        return { success: true, message: `Removed "${matchingItem.product.name}" from your cart.` };
    } catch (error) {
        console.error('[REMOVE_CART_ITEM] Error:', error.message);
        return { success: false, message: "Error removing item from cart." };
    }
};

module.exports = {
    addProductToCart,
    addProductToCartEnhanced,
    viewCart,
    clearCart,
    checkout,
    viewCartWithDiscounts,
    checkoutWithDiscounts,
    getOrderStatus,
    getOrCreateCart,
    forceResetCartForNewOrder,  // Ã¢â€ Â Make sure this is exported
    debugCartState,
    forceClearCartCompletely,
    checkoutWithZohoIntegration,
    processOrderBackground,
    removeCartItem,
    applyApprovedDiscountToCart
};
