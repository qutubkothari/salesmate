// Clear cart for test customer to force fresh catalog prices
const { supabase } = require('./services/config');

async function clearTestCart() {
    try {
        // Find conversation for test customer
        const { data: conv } = await supabase
            .from('conversations')
            .select('id, end_user_phone')
            .like('end_user_phone', '%8484830021%')
            .eq('tenant_id', 'a10aa26a-b5f9-4afe-87cc-70bfb4d1f6e6')
            .single();

        if (!conv) {
            console.log('❌ Conversation not found');
            return;
        }

        console.log('✅ Found conversation:', conv.id, 'for', conv.end_user_phone);

        // Find cart
        const { data: cart } = await supabase
            .from('carts')
            .select('id')
            .eq('conversation_id', conv.id)
            .single();

        if (!cart) {
            console.log('❌ No cart found');
            return;
        }

        console.log('✅ Found cart:', cart.id);

        // Delete all cart items (will cascade delete)
        const { error: deleteError } = await supabase
            .from('cart_items')
            .delete()
            .eq('cart_id', cart.id);

        if (deleteError) {
            console.error('❌ Error deleting cart items:', deleteError);
            return;
        }

        console.log('✅ Deleted all cart items');

        // Delete the cart itself
        const { error: cartDeleteError } = await supabase
            .from('carts')
            .delete()
            .eq('id', cart.id);

        if (cartDeleteError) {
            console.error('❌ Error deleting cart:', cartDeleteError);
            return;
        }

        console.log('✅ Deleted cart');
        console.log('\n🎉 SUCCESS! Cart cleared. Next price request will create fresh cart with catalog prices.');

    } catch (error) {
        console.error('❌ Error:', error.message);
    }
}

clearTestCart();
