/**
 * Coupon Code Management for Cart
 * Integrates with discount management system
 */

const { dbClient } = require('./config');
const { getConversationId } = require('./historyService');

/**
 * Apply a coupon code to the cart
 */
async function applyCouponCode(tenantId, endUserPhone, couponCode) {
    try {
        const conversationId = await getConversationId(tenantId, endUserPhone);
        if (!conversationId) return "Could not identify your conversation.";

        // Get cart with items
        const { data: cart } = await dbClient
            .from('carts')
            .select(`
                *,
                cart_items (
                    quantity,
                    product:products (id, name, price, category)
                )
            `)
            .eq('conversation_id', conversationId)
            .single();

        if (!cart || !cart.cart_items || cart.cart_items.length === 0) {
            return "Your cart is empty. Add products before applying a coupon.";
        }

        // Calculate cart total
        const cartTotal = cart.cart_items.reduce((sum, item) => 
            sum + (item.quantity * item.product.price), 0
        );

        // Validate coupon using discount calculation service
        const discountCalculationService = require('./discountCalculationService');
        const validation = await discountCalculationService.validateCoupon(
            tenantId,
            couponCode.toUpperCase(),
            {
                items: cart.cart_items.map(item => ({
                    product_id: item.product.id,
                    category: item.product.category
                })),
                totalAmount: cartTotal,
                quantity: cart.cart_items.reduce((sum, item) => sum + item.quantity, 0)
            }
        );

        if (!validation.valid) {
            return `❌ ${validation.message}`;
        }

        // Apply coupon to cart
        await dbClient
            .from('carts')
            .update({
                coupon_code: couponCode.toUpperCase(),
                discount_amount: validation.discountAmount || 0,
                updated_at: new Date().toISOString()
            })
            .eq('id', cart.id);

        return `✅ Coupon "${couponCode.toUpperCase()}" applied successfully!\n\n${validation.message}\n\nType "cart" or "show cart" to see your updated total.`;
    } catch (error) {
        console.error('[APPLY_COUPON] Error:', error.message);
        return 'Error applying coupon code. Please try again.';
    }
}

/**
 * Remove coupon from cart
 */
async function removeCouponCode(tenantId, endUserPhone) {
    try {
        const conversationId = await getConversationId(tenantId, endUserPhone);
        if (!conversationId) return "Could not identify your conversation.";

        const { data: cart } = await dbClient
            .from('carts')
            .select('id, coupon_code')
            .eq('conversation_id', conversationId)
            .single();

        if (!cart || !cart.coupon_code) {
            return "No coupon code applied to your cart.";
        }

        const removedCoupon = cart.coupon_code;

        await dbClient
            .from('carts')
            .update({
                coupon_code: null,
                discount_amount: 0,
                updated_at: new Date().toISOString()
            })
            .eq('id', cart.id);

        return `✅ Coupon "${removedCoupon}" removed from your cart.`;
    } catch (error) {
        console.error('[REMOVE_COUPON] Error:', error.message);
        return 'Error removing coupon code.';
    }
}

module.exports = {
    applyCouponCode,
    removeCouponCode
};


