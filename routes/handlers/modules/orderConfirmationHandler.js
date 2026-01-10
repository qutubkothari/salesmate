// routes/handlers/modules/orderConfirmationHandler.js
// Handles order confirmation and adding quoted products to cart

const { isOrderConfirmationEnhanced } = require('../../../services/orderConfirmationService');
const { addProductToCartEnhanced } = require('../../../services/cartService');
const { sendMessage } = require('../../../services/whatsappService');
const { dbClient } = require('../../../services/config');

async function handleOrderConfirmation(req, res, tenant, from, userQuery, intentResult, conversation) {
    console.log('[ORDER_CONFIRM_HANDLER] Checking for order confirmation');

    // Check if this is an order confirmation
    const isOrderConfirm = (intentResult?.intent === 'ORDER_CONFIRMATION' && intentResult?.confidence > 0.7) ||
                          await isOrderConfirmationEnhanced(userQuery, conversation, tenant.id);

    if (!isOrderConfirm) {
        console.log('[ORDER_CONFIRM_HANDLER] Not an order confirmation');
        return null;
    }

    console.log('[ORDER_CONFIRM_HANDLER] Order confirmation detected');

    if (!conversation) {
        console.log('[ORDER_CONFIRM_HANDLER] No conversation context');
        return null;
    }

    // Check if there are quoted products to add to cart
    if (conversation.last_quoted_products) {
        console.log('[ORDER_CONFIRM_HANDLER] Found quoted products, adding to cart');

        try {
            let quotedProducts = [];

            // Parse quoted products
            try {
                quotedProducts = typeof conversation.last_quoted_products === 'string'
                    ? JSON.parse(conversation.last_quoted_products)
                    : conversation.last_quoted_products;
            } catch (parseError) {
                console.error('[ORDER_CONFIRM_HANDLER] Error parsing quoted products:', parseError.message);
                return null;
            }

            if (!quotedProducts || quotedProducts.length === 0) {
                console.log('[ORDER_CONFIRM_HANDLER] No products in quote');
                return null;
            }

            console.log('[ORDER_CONFIRM_HANDLER] Adding', quotedProducts.length, 'products to cart');

            // Check if there's an approved discount to apply
            let discountPercent = 0;
            if (conversation.context_data) {
                try {
                    const contextData = typeof conversation.context_data === 'string'
                        ? JSON.parse(conversation.context_data)
                        : conversation.context_data;

                    if (contextData.approvedDiscount) {
                        discountPercent = contextData.approvedDiscount;
                        console.log('[ORDER_CONFIRM_HANDLER] Applying approved discount:', discountPercent + '%');
                    }
                } catch (e) {
                    console.warn('[ORDER_CONFIRM_HANDLER] Could not parse context_data:', e.message);
                }
            }

            // Add each product to cart
            for (const product of quotedProducts) {
                try {
                    console.log('[ORDER_CONFIRM_HANDLER] Adding product:', product.productCode || product.productName);

                    await addProductToCartEnhanced(
                        tenant.id,
                        from,
                        {
                            id: product.productId,
                            name: product.productName,
                            price: product.price,
                            units_per_carton: product.unitsPerCarton || 1500
                        },
                        parseInt(product.quantity) || 1,
                        { discountPercent }
                    );
                } catch (addError) {
                    console.error('[ORDER_CONFIRM_HANDLER] Error adding product:', addError.message);
                }
            }

            // Clear quoted products after adding to cart
            await dbClient
                .from('conversations')
                .update({
                    last_quoted_products: null,
                    state: 'cart_updated'
                })
                .eq('id', conversation.id);

            // Get cart to show summary
            const { getCartMessage } = require('../../../services/cartService');
            const cartMessage = await getCartMessage(tenant.id, from);

            if (cartMessage) {
                console.log('[ORDER_CONFIRM_HANDLER] Cart updated successfully');
                return {
                    response: cartMessage,
                    source: 'order_confirmation_cart_updated'
                };
            } else {
                return {
                    response: 'âœ… Products added to cart! Type "cart" to view your cart.',
                    source: 'order_confirmation_simple'
                };
            }

        } catch (error) {
            console.error('[ORDER_CONFIRM_HANDLER] Error in order confirmation:', error);
            return {
                response: 'Sorry, I had trouble adding products to your cart. Please try saying "add [product] [quantity]".',
                source: 'order_confirmation_error'
            };
        }
    }

    // If no quoted products, this might be a cart checkout confirmation
    console.log('[ORDER_CONFIRM_HANDLER] No quoted products, might be checkout confirmation');
    return null; // Let other handlers deal with checkout
}

module.exports = {
    handleOrderConfirmation
};

