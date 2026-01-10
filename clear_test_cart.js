// Clear cart for test customer to force fresh catalog prices
const { dbClient } = require('./services/config');

async function clearTestCart() {
    try {
        // Find conversation for test customer
        const { data: conv } = await dbClient
            .from('conversations')
            .select('id, end_user_phone')
            .like('end_user_phone', '%8484830021%')
            .eq('tenant_id', 'a10aa26a-b5f9-4afe-87cc-70bfb4d1f6e6')
            .single();

        if (!conv) {
            console.log('âŒ Conversation not found');
            return;
        }

        console.log('âœ… Found conversation:', conv.id, 'for', conv.end_user_phone);

        // Find cart
        const { data: cart } = await dbClient
            .from('carts')
            .select('id')
            .eq('conversation_id', conv.id)
            .single();

        if (!cart) {
            console.log('âŒ No cart found');
            return;
        }

        console.log('âœ… Found cart:', cart.id);

        // Delete all cart items (will cascade delete)
        const { error: deleteError } = await dbClient
            .from('cart_items')
            .delete()
            .eq('cart_id', cart.id);

        if (deleteError) {
            console.error('âŒ Error deleting cart items:', deleteError);
            return;
        }

        console.log('âœ… Deleted all cart items');

        // Delete the cart itself
        const { error: cartDeleteError } = await dbClient
            .from('carts')
            .delete()
            .eq('id', cart.id);

        if (cartDeleteError) {
            console.error('âŒ Error deleting cart:', cartDeleteError);
            return;
        }

        console.log('âœ… Deleted cart');
        console.log('\nðŸŽ‰ SUCCESS! Cart cleared. Next price request will create fresh cart with catalog prices.');

    } catch (error) {
        console.error('âŒ Error:', error.message);
    }
}

clearTestCart();

