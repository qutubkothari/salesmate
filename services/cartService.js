const { calculateDiscount } = require('./volumeDiscountService');
const { randomUUID } = require('crypto');

function generateId() {
    // Use UUID v4 for portability across Postgres/Supabase and local SQLite.
    return randomUUID();
}

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
    const { data: conversation } = await supabase
        .from('conversations')
        .select('id, context, last_quoted_products')
        .eq('id', conversationId)
        .single();

    if (!conversation || !conversation.context) return;

    let approvedDiscount = null;
    try {
        const contextData = safeParseContextData(conversation.context);
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
    const { data: cart } = await supabase
        .from('carts')
        .select('id')
        .eq('conversation_id', conversationId)
        .single();

    if (!cart) return;

    // Get all cart items INCLUDING any existing carton_price_override (personalized prices)
    const { data: cartItems } = await supabase
        .from('cart_items')
        .select(`
            id,
            quantity,
            carton_price_override,
            product:products(id, name, price)
        `)
        .eq('cart_id', cart.id);

    if (!cartItems || cartItems.length === 0) return;

    // âœ… Apply discount to EACH item individually
    for (const item of cartItems) {
        // Priority for base price:
        // 1. Personalized price from quotedProductsMap (from price quote)
        // 2. Catalog price from product
        // NOTE: We IGNORE carton_price_override to avoid double discounting!
        const unitsPerCarton = parseInt(item.product.units_per_carton, 10) > 0 ? parseInt(item.product.units_per_carton, 10) : 1;
        // quotedProductsMap prices come from quotes/negotiation and are per-carton.
        // catalog price is per-unit; convert to per-carton for cart math.
        const basePrice = quotedProductsMap.get(item.product.id) || (Number(item.product.price) || 0) * unitsPerCarton;
        const discountedPrice = basePrice * (1 - approvedDiscount / 100);
        const discountAmountPerCarton = basePrice - discountedPrice;

        const priceSource = quotedProductsMap.has(item.product.id) ? 'quoted products' : 'catalog';
        console.log(`[DISCOUNT_PER_ITEM] ${item.product.name}: â‚¹${basePrice} â†’ â‚¹${discountedPrice.toFixed(2)} (${approvedDiscount}% off, source: ${priceSource})`);

        // Update cart_item with discounted price
        await supabase
            .from('cart_items')
            .update({
                carton_price_override: discountedPrice,
                carton_discount_amount: discountAmountPerCarton * item.quantity
            })
            .eq('id', item.id);
    }

    // Reset cart-level discount (since we're using per-item discounts now)
    await supabase
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
        // After successful order creation (after: await supabase.from('order_items').insert(orderItems);)
        console.log('[CHECKOUT_ZOHO] Order created successfully, processing Zoho integration');
        // Clear cart first (existing code)
        await supabase.from('cart_items').delete().eq('cart_id', cart.id);
        await supabase.from('carts').update({ 
            applied_discount_id: null, 
            discount_amount: 0,
            updated_at: new Date().toISOString()
        }).eq('id', cart.id);

        // Send initial confirmation message
        let confirmationMessage = `✅ **Order Confirmed!**\n\n`;
        confirmationMessage += `**Products:**\n`;
        pricing.items.forEach(item => {
            const unitPrice = item.carton_price_override || item.unitPrice;
            const actualQuantity = parseInt(item.quantity) || 1; // FIXED: ensure numeric quantity
            confirmationMessage += `📦 ${item.productName} × ${actualQuantity} cartons\n   ₹${unitPrice}/pc (was ₹${item.unitPrice}/pc)\n   ₹${(unitPrice * item.unitsPerCarton).toFixed(2)}/carton (was ₹${(item.unitPrice * item.unitsPerCarton).toFixed(2)}/carton)\n`;
        });
        confirmationMessage += `\n**Pricing Breakdown:**\n`;
        confirmationMessage += `Subtotal: ₹${pricing.subtotal.toLocaleString()}\n`;
        if (pricing.discountAmount > 0) {
            confirmationMessage += `Discount: -₹${pricing.discountAmount.toLocaleString()}\n`;
        }
        if (pricing.shipping.freeShippingApplied) {
            confirmationMessage += `Shipping: FREE ✓\n`;
        } else if (pricing.shipping.charges > 0) {
            confirmationMessage += `Shipping: ₹${pricing.shipping.charges.toLocaleString()}\n`;
        }
        confirmationMessage += `GST (${pricing.gst.rate}%): ₹${pricing.gst.amount.toLocaleString()}\n`;
        confirmationMessage += `**Final Total: ₹${pricing.grandTotal.toLocaleString()}**\n\n`;
        confirmationMessage += `📋 Processing your sales order document...`;
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
                const successMessage = `ðŸŽ‰ **Order Processing Complete!**\n\n` +
                                     `âœ… Sales order created in Zoho CRM\n` +
                                     `ðŸ“„ Sales order document sent above\n` +
                                     `ðŸ†” Reference: ${order.id.substring(0, 8)}\n\n` +
                                     `Your order is now being processed. We'll keep you updated on the status.`;
                await sendMessage(endUserPhone, successMessage);
                console.log('[CHECKOUT_ZOHO] Complete process successful');
            } else {
                // Partial success - order created but PDF failed
                const partialMessage = `âš ï¸ **Order Confirmed with Minor Issue**\n\n` +
                                     `âœ… Your order has been created successfully\n` +
                                     `âŒ Sales document generation is delayed\n` +
                                     `ðŸ†” Reference: ${order.id.substring(0, 8)}\n\n` +
                                     `We'll send your sales document shortly and keep you updated.`;
                await sendMessage(endUserPhone, partialMessage);
                console.log('[CHECKOUT_ZOHO] Partial success - order created, PDF failed');
            }
        } catch (zohoError) {
            console.error('[CHECKOUT_ZOHO] Error in Zoho integration:', zohoError.message);
            // Fallback message - order is still valid even if Zoho fails
            const fallbackMessage = `âœ… **Order Confirmed!**\n\n` +
                                  `Your order has been created successfully.\n` +
                                  `ðŸ†” Reference: ${order.id.substring(0, 8)}\n\n` +
                                  `Our team will process your order and send you the details shortly.`;
            await sendMessage(endUserPhone, fallbackMessage);
        }

        // Add payment details if configured
        try {
            const paymentDetails = await generatePaymentDetails(tenant, pricing.grandTotal, order.id);
            if (paymentDetails) {
                await sendMessage(endUserPhone, `ðŸ’³ **Payment Information**\n\n${paymentDetails}`);
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
        const { data: order } = await supabase
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
                `ðŸ“‹ **Order Update**\n\nYour sales order document for order ${orderId.substring(0, 8)} has been generated and sent!\n\nâœ… Processing complete`
            );
        }
        return result;
    } catch (error) {
        console.error('[BACKGROUND_ORDER] Error:', error.message);
        return { success: false, error: error.message };
    }
};
// services/cartService.js - COMPLETE FIXED VERSION with Force Clear on New Orders
const { supabase, USE_LOCAL_DB } = require('./config');
const { getConversationId } = require('./historyService');
const { addPointsForPurchase } = require('./loyaltyService');
const { sendMessage } = require('./whatsappService');
const { generatePaymentDetails } = require('./paymentService');

// Import modular services
const { calculateComprehensivePricing, formatPricingForWhatsApp, roundAmount } = require('./pricingService');
const CustomerService = require('./core/CustomerService');

/**
 * Fetch cart and items in a way that works for both Supabase Postgres and the local SQLite wrapper.
 * Local mode does not reliably support nested relationship selects.
 */
const fetchCartWithItems = async ({ conversationId, productSelectFields }) => {
    if (!conversationId) {
        return { data: null, error: null };
    }

    if (!USE_LOCAL_DB) {
        return supabase
            .from('carts')
            .select(`
                *,
                cart_items (
                    quantity,
                    carton_price_override,
                    carton_discount_amount,
                    product:products (${productSelectFields})
                )
            `)
            .eq('conversation_id', conversationId)
            .single();
    }

    const { data: cart, error: cartError } = await supabase
        .from('carts')
        .select('*')
        .eq('conversation_id', conversationId)
        .maybeSingle();

    if (cartError && cartError.code !== 'PGRST116') return { data: null, error: cartError };
    if (!cart) return { data: null, error: null };

    const { data: cartItems, error: itemsError } = await supabase
        .from('cart_items')
        .select('quantity, carton_price_override, carton_discount_amount, product_id')
        .eq('cart_id', cart.id);

    if (itemsError) return { data: null, error: itemsError };

    const uniqueProductIds = Array.from(
        new Set((cartItems || []).map((i) => i.product_id).filter(Boolean))
    );

    let productsById = {};

    if (uniqueProductIds.length > 0) {
        try {
            const baseQuery = supabase.from('products').select(productSelectFields);
            if (typeof baseQuery.in === 'function') {
                const { data: products, error: productsError } = await baseQuery.in('id', uniqueProductIds);
                if (!productsError && products) {
                    productsById = Object.fromEntries(products.map((p) => [p.id, p]));
                } else if (productsError) {
                    console.warn('[CART] Local mode product fetch failed:', productsError.message);
                }
            } else {
                // Fallback: N+1 queries (cart sizes are typically small)
                for (const productId of uniqueProductIds) {
                    const { data: productRow, error: productError } = await supabase
                        .from('products')
                        .select(productSelectFields)
                        .eq('id', productId)
                        .single();
                    if (!productError && productRow) {
                        productsById[productId] = productRow;
                    }
                }
            }
        } catch (e) {
            console.warn('[CART] Local mode product join fallback error:', e.message);
        }
    }

    const enrichedItems = (cartItems || []).map((item) => ({
        quantity: item.quantity,
        carton_price_override: item.carton_price_override,
        carton_discount_amount: item.carton_discount_amount,
        product: productsById[item.product_id] || null,
    }));

    return { data: { ...cart, cart_items: enrichedItems }, error: null };
};

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
        const { data: conversation } = await supabase
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
        const { data: carts } = await supabase
            .from('carts')
            .select('*')
            .eq('conversation_id', conversationId);
        
        console.log(`[CART_DEBUG] Found ${carts?.length || 0} carts:`, carts);

        // Check cart items for each cart
        if (carts && carts.length > 0) {
            for (const cart of carts) {
                const { data: items } = await supabase
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
        const { data: allCarts, error: cartsError } = await supabase
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
                const { error: deleteError } = await supabase
                    .from('cart_items')
                    .delete()
                    .eq('cart_id', cart.id);
                
                if (deleteError) {
                    console.error('[CART_FORCE_RESET] Error deleting items from cart', cart.id, ':', deleteError);
                } else {
                    console.log('[CART_FORCE_RESET] Successfully deleted items from cart:', cart.id);
                }

                // Reset cart metadata
                const { error: resetError } = await supabase
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
        const { error: convError } = await supabase
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
        const { data: allCarts } = await supabase
            .from('carts')
            .select('id')
            .eq('conversation_id', conversationId);

        console.log('[FORCE_CLEAR] Found carts:', allCarts?.map(c => c.id));

        // Step 2: Delete ALL cart items from ALL carts
        if (allCarts && allCarts.length > 0) {
            for (const cart of allCarts) {
                const { error: deleteError } = await supabase
                    .from('cart_items')
                    .delete()
                    .eq('cart_id', cart.id);
                
                if (deleteError) {
                    console.error('[FORCE_CLEAR] Error deleting items from cart', cart.id, ':', deleteError);
                } else {
                    console.log('[FORCE_CLEAR] Deleted items from cart:', cart.id);
                }

                // Reset cart metadata
                await supabase
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
        await supabase
            .from('conversations')
            .update({
                state: null,
                last_product_discussed: null,
                updated_at: new Date().toISOString()
            })
            .eq('id', conversationId);

        await debugCartState(tenantId, endUserPhone, 'AFTER_FORCE_CLEAR');

        console.log('[FORCE_CLEAR] Complete reset finished');
        return "ðŸ”¥ Cart completely reset! All previous items removed.";

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

        const cart = await getOrCreateCart(conversationId, tenantId);

        // Check for existing item
        const { data: existingItem, error: existingItemError } = await supabase
            .from('cart_items')
            .select('id, quantity')
            .eq('cart_id', cart.id)
            .eq('product_id', product.id)
            .maybeSingle();

        if (existingItemError && existingItemError.code !== 'PGRST116') {
            throw existingItemError;
        }

        if (existingItem) {
            // Update existing item
            const newQuantity = options.replace ? 
                Number(quantity) : 
                Number(existingItem.quantity) + Number(quantity);
                
            const { error: updateError } = await supabase
                .from('cart_items')
                .update({ quantity: newQuantity, updated_at: new Date().toISOString() })
                .eq('id', existingItem.id);
            
            if (updateError) throw updateError;
            
            console.log('[CART_ADD_ENHANCED] Updated existing item, new quantity:', newQuantity);
        } else {
            // Add new item
            const { error: insertError } = await supabase
                .from('cart_items')
                .insert({
                    id: generateId(),
                    cart_id: cart.id,
                    product_id: product.id,
                    quantity: Number(quantity),
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                });
            
            if (insertError) throw insertError;
            
            console.log('[CART_ADD_ENHANCED] Added new cart item');
        }
        
        // Update cart timestamp
        await supabase
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
const getOrCreateCart = async (conversationId, tenantId = null) => {
    let { data: cart, error: cartSelectError } = await supabase
        .from('carts')
        .select('*')
        .eq('conversation_id', conversationId)
        .maybeSingle();

    if (cartSelectError && cartSelectError.code !== 'PGRST116') {
        throw cartSelectError;
    }

    if (!cart) {
        const insertPayload = tenantId
            ? { id: generateId(), conversation_id: conversationId, tenant_id: tenantId }
            : { id: generateId(), conversation_id: conversationId };

        const { data: newCart, error: insertError } = await supabase
            .from('carts')
            .insert(insertPayload)
            .select('*')
            .maybeSingle();

        if (insertError) throw insertError;
        cart = newCart;
    }

    if (!cart) {
        throw new Error('Failed to create or fetch cart');
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

        // Get cart with items - SAME structure as checkout (SQLite-compatible)
        const { data: cart, error: cartError } = await fetchCartWithItems({
            conversationId,
            productSelectFields: 'id, name, price, packaging_unit, units_per_carton'
        });

        if (cartError) {
            console.error('[CART_VIEW] Cart fetch error:', cartError);
            throw cartError;
        }

        if (!cart || !cart.cart_items || cart.cart_items.length === 0) {
            return "Your shopping cart is empty.";
        }

        // Filter out items with zero price or invalid products
        const validItems = cart.cart_items.filter(item =>
            item.product && Number(item.product.price) > 0
        );

        if (validItems.length === 0) {
            return "Your shopping cart is empty (no valid items).";
        }

        console.log('[CART_VIEW] Using comprehensive pricing service for', validItems.length, 'valid items');

        // Get customer profile for last purchase pricing
        let customerProfileId = null;
        try {
            const { data: profile } = await supabase
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
        const baseOrderTotal = validItems.reduce((sum, item) => {
            const upc = parseInt(item.product.units_per_carton, 10) > 0 ? parseInt(item.product.units_per_carton, 10) : 1;
            const catalogCartonPrice = (Number(item.product.price) || 0) * upc;
            return sum + (item.quantity * catalogCartonPrice);
        }, 0);
        console.log('[CART_VIEW] Base order total (catalog prices):', baseOrderTotal);

        // Step 1: Check for negotiated discounts from AI conversation
        let negotiatedDiscountPercent = 0;
        let negotiatedDiscountAmount = 0;
        try {
            const { data: conversation } = await supabase
                .from('conversations')
                .select('context')
                .eq('id', conversationId)
                .single();

            if (conversation?.context) {
                const contextData = typeof conversation.context === 'string'
                    ? JSON.parse(conversation.context)
                    : conversation.context;

                if (contextData.offeredDiscount || contextData.approvedDiscount) {
                    negotiatedDiscountPercent = contextData.offeredDiscount || contextData.approvedDiscount;
                    negotiatedDiscountAmount = (baseOrderTotal * negotiatedDiscountPercent) / 100;
                    console.log('[CART_VIEW] Negotiated discount found:', negotiatedDiscountPercent, '% = ₹', negotiatedDiscountAmount);
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
                await supabase
                    .from('cart_items')
                    .update({ carton_price_override: null })
                    .eq('cart_id', cart.id)
                    .in('product_id', cartItemIds);

                console.log(`[CART_VIEW] Cleared carton_price_override for ${cartItemIds.length} items in database`);

                // Also clear from memory array for current request
                validItems.forEach(item => {
                    if (item.carton_price_override) {
                        console.log(`[CART_VIEW] Clearing ${item.product.name}: was ₹${item.carton_price_override}, now catalog ₹${item.product.price}`);
                        item.carton_price_override = null;
                    }
                });
            }
        }

        // CRITICAL BUSINESS LOGIC: Determine if customer is NEW or RETURNING
        // This affects pricing display and discount handling
        let isReturningCustomer = false;
        try {
            const { count } = await supabase
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
                await supabase
                    .from('cart_items')
                    .update({ carton_price_override: null })
                    .eq('cart_id', cart.id);
                
                console.log(`[CART_VIEW] Cleared carton_price_override for all items in cart`);

                // Clear from memory - CRITICAL: Set to null so pricing service uses catalog prices
                validItems.forEach(item => {
                    if (item.carton_price_override) {
                        console.log(`[CART_VIEW] Memory: Clearing ${item.product.name}: was ₹${item.carton_price_override}, now will use catalog ₹${item.product.price}`);
                        item.carton_price_override = null;
                    }
                });
            }
        }
        
        console.log('[CART_VIEW] 🔍 DEBUG - Pricing call parameters:');
        console.log('[CART_VIEW] - Customer type:', isReturningCustomer ? 'RETURNING' : 'NEW');
        console.log('[CART_VIEW] - negotiatedDiscountPercent:', negotiatedDiscountPercent);
        console.log('[CART_VIEW] - ignorePriceOverride flag:', ignorePriceOverride);
        console.log('[CART_VIEW] - hasPersonalizedPricing:', hasPersonalizedPricing);
        console.log('[CART_VIEW] - finalDiscountAmount:', finalDiscountAmount);
        console.log('[CART_VIEW] - Items carton_price_override status AFTER clearing:');
        validItems.forEach(item => {
            console.log(`[CART_VIEW]   - ${item.product.name}: carton_price_override=${item.carton_price_override || 'null'}, catalog=₹${item.product.price}`);
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
                cartMessage += `  - ${item.quantity} cartons @ ₹${item.unitPrice}/carton (₹${pricePerPiece} per piece)\n`;
            } else {
                cartMessage += `  - Qty: ${item.quantity}\n`;
                cartMessage += `  - ${item.quantity} @ ₹${item.unitPrice} each\n`;
            }
            // Show total for each item
            cartMessage += `  - Total: ₹${item.roundedItemTotal.toLocaleString()}\n\n`;
        });

        // CRITICAL FIX: Show EXACT same pricing breakdown as checkout will show
        cartMessage += "*Pricing Breakdown:*\n";
        cartMessage += `Subtotal: ₹${pricing.subtotal.toLocaleString()}\n`;

        if (pricing.discountAmount > 0) {
            cartMessage += `Discount: -₹${pricing.discountAmount.toLocaleString()}`;
            if (discountSource !== 'none') {
                cartMessage += ` (${discountSource})`;
            }
            cartMessage += '\n';
        }
        
        // CRITICAL: Include shipping charges (was missing before)
        if (pricing.shipping.freeShippingApplied) {
            cartMessage += `Shipping: FREE ✓\n`;
        } else if (pricing.shipping.charges > 0) {
            cartMessage += `Shipping: ₹${pricing.shipping.charges.toLocaleString()} (${pricing.totalCartons} cartons × ₹${pricing.shipping.ratePerCarton})\n`;
        }

        cartMessage += `GST (${pricing.gst.rate}%): ₹${pricing.gst.amount.toLocaleString()}\n`;
        cartMessage += `*Final Total: ₹${pricing.grandTotal.toLocaleString()}*`;
        
        if (pricing.isRounded && pricing.roundingAdjustment > 0) {
            cartMessage += ` (rounded from ₹${pricing.grandTotalBeforeRounding.toLocaleString()})`;
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
        const { data: recentOrders, error: orderCheckError } = await supabase
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
        // NEW LOGIC: Do NOT block checkout on missing GST.
        // If GST details are missing, create a generic (non-GST) order now,
        // then ask customer whether they want a GST bill. Only after GST is provided
        // do we trigger Zoho invoicing.
        console.log('[CHECKOUT] Checking GST preference...');
        const GSTService = require('./core/GSTService');
        const needsGST = await GSTService.needsGSTCollection(tenant.id, endUserPhone);
        let gstPreference = null;
        let gstNumber = null;
        if (!needsGST) {
            const gstPref = await GSTService.getGSTPreference(tenant.id, endUserPhone);
            gstPreference = gstPref?.preference || null;
            gstNumber = gstPref?.gstNumber || gstPref?.gst_number || null;
            console.log('[CHECKOUT] GST preference confirmed:', gstPreference);
        } else {
            console.log('[CHECKOUT] GST preference not set - proceeding with generic (non-GST) checkout');
        }
        // ===== END GST VALIDATION =====

        // Get cart with EXACT same structure as viewCart (SQLite-compatible)
        const { data: cart, error: cartError } = await fetchCartWithItems({
            conversationId,
            productSelectFields: 'id, name, price, units_per_carton, packaging_unit'
        });

        if (cartError) {
            console.error('[CHECKOUT] Cart fetch error:', cartError);
            throw cartError;
        }

        if (!cart || !cart.cart_items || cart.cart_items.length === 0) {
            return "Your cart is empty. Add some products before checking out!";
        }

        // Filter out zero price items
        const validItems = cart.cart_items.filter(item =>
            item.product && Number(item.product.price) > 0
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
                roundTotals: true, // EXACT same as viewCart
                includeGST: needsGST ? false : true
            }
        );

        // Create order using comprehensive pricing
        console.log('[CHECKOUT] Order data being inserted:', {
            original_amount: pricing.originalSubtotal,
            subtotal_amount: pricing.subtotal,
            total_amount: pricing.grandTotal,
            shipping_cartons: pricing.totalCartons
        });

        const { data: order, error: orderError} = await supabase
            .from('orders')
            .insert({
                id: generateId(),
                tenant_id: tenant.id,
                conversation_id: conversationId,
                status: needsGST ? 'pending_gst' : 'confirmed',
                order_status: needsGST ? 'pending_gst' : 'confirmed',
                customer_profile_id: customerProfile?.id || null,
                phone_number: endUserPhone,
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
                final_amount: pricing.grandTotal,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
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
        const gstRateForItems = Number(pricing?.gst?.rate) || 0;
        const taxMultiplier = 1 + (gstRateForItems / 100);
        
        const orderItems = validItems.map((item, index) => {
            const pricingItem = pricing.items[index];
            const originalPriceWithTax = parseFloat(pricingItem.unitPrice);
            
            // Apply proportional discount to get the ACTUAL price customer pays
            const discountedPriceWithTax = originalPriceWithTax * discountRatio;
            
            const unitPriceBeforeTax = taxMultiplier > 0 ? (discountedPriceWithTax / taxMultiplier) : discountedPriceWithTax;
            const gstAmount = (discountedPriceWithTax - unitPriceBeforeTax) * item.quantity;
            
            console.log(`[ORDER_ITEM] ${item.product.name}: Original â‚¹${originalPriceWithTax} â†’ Discounted â‚¹${discountedPriceWithTax.toFixed(2)}`);
            
            return {
                tenant_id: tenant.id,
                order_id: order.id,
                product_id: item.product.id,
                // Legacy/local schema fields (also useful as a fallback when joins aren't available)
                product_name: item.product.name,
                quantity: item.quantity,
                unit_price: Number(unitPriceBeforeTax.toFixed(2)),
                total_price: Number((unitPriceBeforeTax * item.quantity).toFixed(2)),

                // Newer schema fields
                // Store per-unit BEFORE tax so dashboard line totals align with subtotal/gst fields.
                price_at_time_of_purchase: Number(unitPriceBeforeTax.toFixed(2)),
                unit_price_before_tax: Number(unitPriceBeforeTax.toFixed(2)),
                gst_rate: gstRateForItems,
                gst_amount: Number(gstAmount.toFixed(2)),
                zoho_item_id: null
            };
        });
        let orderItemsInsert = await supabase.from('order_items').insert(orderItems);

        // Backward compatibility for older SQLite schemas missing tenant_id
        if (orderItemsInsert?.error && /tenant_id/i.test(String(orderItemsInsert.error?.message || orderItemsInsert.error))) {
            const orderItemsWithoutTenantId = orderItems.map(({ tenant_id, ...rest }) => rest);
            orderItemsInsert = await supabase.from('order_items').insert(orderItemsWithoutTenantId);
        }

        if (orderItemsInsert?.error) {
            console.error('[CHECKOUT] Order items insertion error:', orderItemsInsert.error);
            throw orderItemsInsert.error;
        }

        // REMOVED: Discount logging code since we're no longer applying automatic discounts at checkout
        // Discounts are now only applied via explicit approval in discount negotiation flow
        // If needed, discount logs should be created during the negotiation/approval step, not at checkout

        // If GST is not yet collected, defer Zoho integration.
        // We'll ask the customer whether they want a GST bill; once provided, we activate Zoho.
        if (needsGST) {
            try {
                const { message } = await GSTService.requestGSTPreference(tenant.id, endUserPhone);
                // Clear cart completely after order creation (generic invoice/PO path)
                await supabase.from('cart_items').delete().eq('cart_id', cart.id);
                await supabase.from('carts').update({
                    applied_discount_id: null,
                    discount_amount: 0,
                    updated_at: new Date().toISOString()
                }).eq('id', cart.id);

                return (
                    `✅ *Order Created (Generic / Non-GST)*\n` +
                    `Order ID: ${order.id.substring(0, 8)}\n\n` +
                    `This is a *generic (non-GST) purchase order / invoice* for now.\n\n` +
                    `${formatPricingForWhatsApp(pricing, { showItemBreakdown: true, showGSTBreakdown: false })}\n\n` +
                    `⏸️ ${message}`
                );
            } catch (gstAskError) {
                console.error('[CHECKOUT] GST request failed after order creation:', gstAskError?.message || gstAskError);
                // Still clear cart and return a direct prompt even if state transition failed.
                await supabase.from('cart_items').delete().eq('cart_id', cart.id);
                await supabase.from('carts').update({
                    applied_discount_id: null,
                    discount_amount: 0,
                    updated_at: new Date().toISOString()
                }).eq('id', cart.id);

                return (
                    `✅ *Order Created (Generic / Non-GST)*\n` +
                    `Order ID: ${order.id.substring(0, 8)}\n\n` +
                    `Would you like a GST bill? Reply with:\n` +
                    `• Your 15-digit GST number\n` +
                    `• "No GST"\n`
                );
            }
        }

        // === SHIPPING INFO REQUEST ===
        // Request shipping address and transporter details after order creation
        console.log('[CHECKOUT] Order created, requesting shipping info');
        console.log('[CHECKOUT] Phone for shipping:', endUserPhone);
        console.log('[CHECKOUT] Order ID:', order.id);
        try {
            const { requestShippingInfo } = require('./shippingInfoService');
            const orderSummary = `Order #${order.id.substring(0, 8)} - ₹${pricing.grandTotal.toLocaleString()}`;
            const shippingResult = await requestShippingInfo(tenant.id, endUserPhone, order.id, orderSummary);
            console.log('[CHECKOUT] Shipping info request sent, result:', shippingResult);
        } catch (shippingError) {
            console.error('[CHECKOUT] Error requesting shipping info:', shippingError);
            console.error('[CHECKOUT] Shipping error stack:', shippingError.stack);
            // Send fallback message to customer
            try {
                const { sendMessage } = require('./whatsappService');
                await sendMessage(endUserPhone, `✅ Order confirmed! Order ID: ${order.id.substring(0, 8)}\n\n⚠️ Please provide your shipping address and transporter details.`);
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
                    `ðŸ“‹ Sales Order Created!\n\nZoho Order: ${result.zohoOrderId.substring(0, 8)}\nReference: ${order.id.substring(0, 8)}`
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
                            `ðŸ“„ Your sales order invoice\nOrder: ${result.zohoOrderId}\nThank you for your business!`
                        );
                        if (pdfDelivery.success) {
                            console.log('[PDF_SEND] PDF delivered successfully');
                            // PATCH: Update order with PDF delivery URL
                            await supabase
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
        await supabase.from('cart_items').delete().eq('cart_id', cart.id);
        await supabase.from('carts').update({ 
            applied_discount_id: null, 
            discount_amount: 0,
            updated_at: new Date().toISOString()
        }).eq('id', cart.id);

        // CRITICAL FIX: Customer confirmation with IDENTICAL pricing breakdown as cart view
        let confirmationMessage = `✅ *Order Confirmed!*\n\n`;
        
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
                confirmationMessage += `📦 ${productName} × ${actualQuantity} carton${actualQuantity > 1 ? 's' : ''}\n`;
                if (discountedPerPiece && originalPerPiece) {
                    confirmationMessage += `   ₹${discountedPerPiece}/pc (was ₹${originalPerPiece}/pc)\n`;
                    confirmationMessage += `   ₹${discountedPrice.toFixed(2)}/carton (was ₹${originalPrice.toFixed(2)}/carton)\n`;
                } else {
                    confirmationMessage += `   ₹${discountedPrice.toFixed(2)}/carton (was ₹${originalPrice.toFixed(2)}/carton)\n`;
                }
            });
            confirmationMessage += `\n`;
        }

        confirmationMessage += `Subtotal: ₹${pricing.subtotal.toLocaleString()}\n`;
        // Removed bulk discount line since discounts are now shown per item above
        if (pricing.shipping.freeShippingApplied) {
            confirmationMessage += `Shipping: FREE ✓\n`;
        } else if (pricing.shipping.charges > 0) {
            confirmationMessage += `Shipping: ₹${pricing.shipping.charges.toLocaleString()} (${pricing.totalCartons} cartons × ₹${pricing.shipping.ratePerCarton})\n`;
        }
        confirmationMessage += `GST (${pricing.gst.rate}%): ₹${pricing.gst.amount.toLocaleString()}\n`;
        confirmationMessage += `**Final Total: ₹${pricing.grandTotal.toLocaleString()}**`;
        if (pricing.isRounded && pricing.roundingAdjustment > 0) {
            confirmationMessage += ` (rounded from ₹${pricing.grandTotalBeforeRounding.toLocaleString()})`;
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
 * Activate Zoho integration for the latest pending-GST order in this conversation.
 * Used after customer provides GST details.
 */
const activateZohoForLatestPendingGSTOrder = async (tenantId, endUserPhone) => {
    const conversationId = await getConversationId(tenantId, endUserPhone);
    if (!conversationId) {
        return { success: false, message: 'Could not identify your conversation.' };
    }

    const { data: recentOrders, error } = await supabase
        .from('orders')
        .select('id, order_status, zoho_sales_order_id, created_at')
        .eq('tenant_id', tenantId)
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: false })
        .limit(5);

    if (error) {
        console.error('[ZOHO_ACTIVATE] Failed to fetch recent orders:', error);
        return { success: false, message: 'Could not find your order to generate GST invoice.' };
    }

    const pendingOrder = (recentOrders || []).find((o) => !o.zoho_sales_order_id && (o.order_status || '').toLowerCase() === 'pending_gst');
    if (!pendingOrder) {
        return { success: false, message: 'No pending order found for GST invoicing.' };
    }

    try {
        const { processOrderToZoho } = require('./zohoSalesOrderService');
        const zohoResult = await processOrderToZoho(tenantId, pendingOrder.id);
        if (!zohoResult?.success) {
            return { success: false, message: `Zoho invoice creation failed: ${zohoResult?.error || 'unknown error'}` };
        }

        // Best-effort PDF delivery
        if (zohoResult.pdfBuffer && zohoResult.filename) {
            try {
                const { sendPDFViaWhatsApp } = require('./pdfDeliveryService');
                await sendPDFViaWhatsApp(
                    endUserPhone,
                    zohoResult.pdfBuffer,
                    zohoResult.filename,
                    `ðŸ“„ Your GST invoice\nReference: ${pendingOrder.id.substring(0, 8)}\nThank you for your business!`
                );
            } catch (e) {
                console.error('[ZOHO_ACTIVATE] PDF delivery failed:', e?.message || e);
            }
        }

        // Mark order no longer pending GST
        await supabase
            .from('orders')
            .update({ order_status: 'confirmed', status: 'confirmed', updated_at: new Date().toISOString() })
            .eq('id', pendingOrder.id);

        return { success: true, message: '✅ GST details received. Generating invoice now.' };
    } catch (e) {
        console.error('[ZOHO_ACTIVATE] Error:', e?.message || e);
        return { success: false, message: 'Failed to activate GST invoice creation. Please try again.' };
    }
};

/**
 * Mark the latest pending-GST order as confirmed without GST.
 */
const markLatestPendingGSTOrderAsNoGST = async (tenantId, endUserPhone) => {
    const conversationId = await getConversationId(tenantId, endUserPhone);
    if (!conversationId) return { success: false };

    const { data: recentOrders } = await supabase
        .from('orders')
        .select('id, order_status, zoho_sales_order_id, created_at')
        .eq('tenant_id', tenantId)
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: false })
        .limit(5);

    const pendingOrder = (recentOrders || []).find((o) => !o.zoho_sales_order_id && (o.order_status || '').toLowerCase() === 'pending_gst');
    if (!pendingOrder) return { success: false };

    await supabase
        .from('orders')
        .update({ order_status: 'confirmed_no_gst', status: 'confirmed_no_gst', updated_at: new Date().toISOString() })
        .eq('id', pendingOrder.id);

    return { success: true };
};

/**
 * Add product to cart (simple interface)
 */
const addProductToCart = async (tenantId, endUserPhone, productName) => {
    try {
        await CustomerService.ensureCustomerProfile(tenantId, endUserPhone);

        const conversationId = await getConversationId(tenantId, endUserPhone);
        if (!conversationId) return "Could not identify your conversation.";

        const { data: product } = await supabase
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

        const { data: orders } = await supabase
            .from('orders')
            .select('id, total_amount, created_at, order_status, shipping_charges, gst_amount')
            .eq('tenant_id', tenantId)
            .eq('conversation_id', conversationId)
            .order('created_at', { ascending: false })
            .limit(5);

        if (!orders || orders.length === 0) {
            return "You haven't placed any orders yet.";
        }

        let statusMessage = "ðŸ“‹ **Your Recent Orders**\n\n";
        orders.forEach((order, index) => {
            const orderDate = new Date(order.created_at).toLocaleDateString();
            statusMessage += `${index + 1}. Order #${order.id.substring(0, 8)}\n`;
            statusMessage += `   Date: ${orderDate}\n`;
            
            if (order.shipping_charges > 0) {
                statusMessage += `   Shipping: â‚¹${order.shipping_charges}\n`;
            }
            if (order.gst_amount > 0) {
                statusMessage += `   GST: â‚¹${order.gst_amount}\n`;
            }
            
            statusMessage += `   **Total: â‚¹${order.total_amount}**\n`;
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
        const { data: cart } = await supabase
            .from('carts')
            .select('id')
            .eq('conversation_id', conversationId)
            .single();

        if (!cart) return { success: false, message: "Your cart is empty." };

        // Get cart items with product details
        const { data: cartItems } = await supabase
            .from('cart_items')
            .select('id, product_id')
            .eq('cart_id', cart.id);

        if (!cartItems || cartItems.length === 0) {
            return { success: false, message: "Your cart is empty." };
        }

        // Get product details for each item
        for (const item of cartItems) {
            const { data: product } = await supabase
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
        const { error: deleteError } = await supabase
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
    activateZohoForLatestPendingGSTOrder,
    markLatestPendingGSTOrderAsNoGST,
    getOrderStatus,
    getOrCreateCart,
    forceResetCartForNewOrder,  // â† Make sure this is exported
    debugCartState,
    forceClearCartCompletely,
    checkoutWithZohoIntegration,
    processOrderBackground,
    removeCartItem,
    applyApprovedDiscountToCart
};