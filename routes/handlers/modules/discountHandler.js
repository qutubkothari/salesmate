// routes/handlers/modules/discountHandler.js
// Handles discount negotiation logic extracted from customerHandler.js

const { handleDiscountNegotiation } = require('../../../services/discountNegotiationService');
const { dbClient } = require('../../../services/config');

async function handleDiscountRequests(req, res, tenant, from, userQuery, intentResult, conversation) {
    console.log('[DISCOUNT_HANDLER] Processing discount request');

    // Check if this is a discount intent
    const isDiscountIntent = intentResult?.intent === 'DISCOUNT_REQUEST' ||
                           (intentResult?.confidence > 0.85 &&
                            ['discount_request', 'negotiation'].includes(intentResult?.intent?.toLowerCase()));

    if (!isDiscountIntent) {
        return null; // Not a discount request
    }

    console.log('[DISCOUNT_HANDLER] Discount intent detected, fetching fresh conversation');

    // Re-fetch conversation to get latest quoted products
    const { data: freshConv, error: convError } = await dbClient
        .from('conversations')
        .select('*')
        .eq('tenant_id', tenant.id)
        .eq('end_user_phone', from)
        .single();

    if (convError) {
        console.error('[DISCOUNT_HANDLER] Error fetching conversation:', convError.message);
        return null;
    }

    if (!freshConv) {
        console.log('[DISCOUNT_HANDLER] No conversation found');
        return null;
    }

    conversation = freshConv;

    try {
        // STEP 1: Check if customer is RETURNING or NEW
        let isReturningCustomer = false;
        try {
            // Use customer_profile_id from conversation (more reliable than phone lookup)
            const customerProfileId = conversation.customer_profile_id;
            
            if (!customerProfileId) {
                console.warn('[DISCOUNT_HANDLER] No customer_profile_id in conversation, assuming NEW');
            } else {
                const { count, error: ordersError } = await dbClient
                    .from('orders')
                    .select('*', { count: 'exact', head: true })
                    .eq('tenant_id', tenant.id)
                    .eq('customer_profile_id', customerProfileId)
                    .in('status', ['confirmed', 'completed']);
                
                if (ordersError) {
                    console.error('[DISCOUNT_HANDLER] Error querying orders:', ordersError.message);
                } else {
                    isReturningCustomer = count > 0;
                    console.log('[DISCOUNT_HANDLER] Customer type:', isReturningCustomer ? 'RETURNING' : 'NEW', '- Orders:', count, '- ProfileID:', customerProfileId);
                }
            }
        } catch (error) {
            console.warn('[DISCOUNT_HANDLER] Error checking customer type:', error.message);
        }

        // STEP 2: RETURNING customers â†’ Route to human agent
        if (isReturningCustomer) {
            console.log('[DISCOUNT_HANDLER] ðŸš¨ RETURNING customer discount request - needs human agent');
            
            // Flag for human agent follow-up
            await dbClient
                .from('conversations')
                .update({
                    context_data: {
                        ...(conversation.context_data || {}),
                        returningCustomerDiscountRequest: true,
                        discountRequestedAt: new Date().toISOString(),
                        needsHumanAgent: true
                    }
                })
                .eq('id', conversation.id);

            return {
                status: 'success',
                response: `Thank you for your continued business! ðŸ™ I've forwarded your discount request to our team. One of our representatives will get back to you shortly with a special offer. We truly value your loyalty! ðŸ’™`
            };
        }

        // STEP 3: NEW customers â†’ Apply dashboard discount rules automatically
        console.log('[DISCOUNT_HANDLER] NEW customer - applying dashboard discount rules');

        // Build context for negotiation
        let totalCartons = 0;
        let cartTotal = 0;
        let quotedProducts = [];

        // PRIORITY 1: Get quoted products from conversation (recent price inquiry)
        if (conversation.last_quoted_products) {
            try {
                quotedProducts = typeof conversation.last_quoted_products === 'string'
                    ? JSON.parse(conversation.last_quoted_products)
                    : conversation.last_quoted_products;

                if (quotedProducts && quotedProducts.length > 0) {
                    totalCartons = quotedProducts.reduce((sum, p) => sum + (parseInt(p.quantity) || 0), 0);
                    cartTotal = quotedProducts.reduce((sum, p) => sum + ((parseFloat(p.price) || 0) * (parseInt(p.quantity) || 1)), 0);
                    console.log('[DISCOUNT_HANDLER] Using quoted products:', quotedProducts.length, 'items');
                }
            } catch (e) {
                console.warn('[DISCOUNT_HANDLER] Error parsing quoted products:', e.message);
            }
        }

        // PRIORITY 2: If no quoted products, check cart for items
        if (quotedProducts.length === 0) {
            console.log('[DISCOUNT_HANDLER] No quoted products, checking cart...');

            // Get cart items via conversation_id (not end_user_phone - carts table doesn't have that field)
            const { data: cart } = await dbClient
                .from('carts')
                .select('id, cart_items(*, products(*))')
                .eq('conversation_id', conversation.id)
                .single();

            if (cart && cart.cart_items && cart.cart_items.length > 0) {
                console.log('[DISCOUNT_HANDLER] Found', cart.cart_items.length, 'items in cart');

                // Convert cart items to quoted products format
                quotedProducts = cart.cart_items.map(item => ({
                    productId: item.product_id,
                    productCode: item.products?.name?.match(/\d+[x*]\d+/)?.[0] || item.products?.name || 'UNKNOWN',
                    productName: item.products?.name || 'Product',
                    price: item.products?.price || item.unit_price,
                    quantity: item.quantity,
                    unitsPerCarton: item.products?.units_per_carton || 1500
                }));

                totalCartons = cart.cart_items.reduce((sum, item) => sum + item.quantity, 0);
                cartTotal = cart.cart_items.reduce((sum, item) =>
                    sum + ((item.products?.price || item.unit_price) * item.quantity), 0
                );

                console.log('[DISCOUNT_HANDLER] Cart-based context:', { totalCartons, cartTotal });
            } else {
                console.log('[DISCOUNT_HANDLER] No cart items found - customer needs to add products first');
                return {
                    response: "I'd be happy to discuss discounts! However, I don't see any products in your inquiry or cart yet. Please let me know which products you're interested in, and I'll provide you with the best pricing possible.",
                    source: 'discount_no_products',
                    discountPercent: 0
                };
            }
        }

        const conversationContext = {
            id: conversation.id, // CRITICAL: Needed by discountNegotiationService to query cart
            totalCartons: totalCartons || 10,
            cartTotal: cartTotal,
            isReturningCustomer: false, // Will be calculated in discount service
            averagePrice: cartTotal > 0 ? cartTotal / totalCartons : 2400,
            averageUnitsPerCarton: 1500,
            products: quotedProducts.map(qp => ({
                productCode: qp.productCode,
                productName: qp.productName,
                price: qp.price,
                unitsPerCarton: qp.unitsPerCarton || 1500,
                quantity: qp.quantity || 10
            })),
            quotedProducts: quotedProducts
        };

        console.log('[DISCOUNT_HANDLER] Context built:', {
            totalCartons,
            cartTotal,
            quotedProductsCount: quotedProducts.length
        });

        // Handle discount negotiation
        const discountResult = await handleDiscountNegotiation(
            tenant.id,
            from,
            userQuery,
            conversationContext
        );

        if (discountResult && discountResult.response) {
            console.log('[DISCOUNT_HANDLER] Discount negotiation successful');

            const discountPercent = discountResult.discountPercent ||
                                   discountResult.offeredDiscount ||
                                   discountResult.counterOffer || 0;

            // Save discount to conversation if offered
            if (discountPercent > 0) {
                console.log('[DISCOUNT_HANDLER] ðŸ’¾ Saving', discountPercent + '% to context');

                await dbClient
                    .from('conversations')
                    .update({
                        context_data: {
                            ...(conversation.context_data || {}),
                            approvedDiscount: discountPercent,
                            discountOfferedAt: new Date().toISOString()
                        }
                    })
                    .eq('id', conversation.id);
            }

            // Handle adding to cart if needed
            // Check if cart already has products to avoid duplication
                const { data: cart } = await dbClient.from('cart_items')
                    .select('id').eq('tenant_id', tenant.id)
                    .eq('end_user_phone', from).limit(1);

                if (discountResult.shouldAddToCart && discountResult.products && !cart) {
                console.log('[DISCOUNT_HANDLER] Adding products to cart with discount');
                const { addProductToCartEnhanced } = require('../../../services/cartService');

                // Use last_quoted_products from conversation context for full product details
                let quotedProducts = [];
                try {
                    quotedProducts = JSON.parse(conversation.last_quoted_products);
                } catch (e) {
                    console.warn('[DISCOUNT_HANDLER] Failed to parse last_quoted_products:', e.message);
                }

                async function addProductsToCartEnhanced(tenantId, endUserPhone, products, discountPercent) {
                    for (const product of products) {
                        // Map productId and productName to id and name for cartService compatibility
                        const mappedProduct = {
                            ...product,
                            id: product.productId,
                            name: product.productName
                        };
                        if (!mappedProduct.id || mappedProduct.price <= 0) {
                            console.warn(`[DISCOUNT_HANDLER] Invalid product:`, mappedProduct);
                            continue;
                        }
                        try {
                            await addProductToCartEnhanced(
                                tenantId,
                                endUserPhone,
                                mappedProduct,
                                mappedProduct.quantity || 1,
                                { discountPercent }
                            );
                        } catch (err) {
                            console.warn(`[DISCOUNT_HANDLER] Failed to add product ${mappedProduct.name}:`, err.message);
                        }
                    }
                }

                try {
                    await addProductsToCartEnhanced(
                        tenant.id,
                        from,
                        quotedProducts,
                        discountPercent
                    );
                } catch (cartError) {
                    console.warn('[DISCOUNT_HANDLER] Cart addition failed:', cartError.message);
                }
            }

            return {
                response: discountResult.response,
                source: 'discount_negotiation',
                discountPercent: discountPercent
            };
        }

    } catch (error) {
        console.error('[DISCOUNT_HANDLER] Error in discount negotiation:', error);
        return null;
    }

    return null;
}

module.exports = {
    handleDiscountRequests
};
