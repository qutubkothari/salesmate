// services/quantityChangeService.js
const { dbClient } = require('./config');
const { getConversationId } = require('./historyService');

const detectQuantityChange = (userQuery) => {
    const patterns = [
        /-(\d+)\s*(?:ctns?|cartons?)/i, // matches '-10ctns' or '-10 cartons' anywhere
        /(?:make it|change to|update to)\s*(-?\d+)\s*(?:ctns?|cartons?)/i,
        /(?:no|nahi).*?(-?\d+)\s*(?:ctns?|cartons?)/i,
        /^(-?\d+)\s*(?:ctns?|cartons?)$/i,
        /(\d+)\s*(?:ctns?|cartons?)/i,   // matches '10ctns' or '10 cartons' anywhere
        /(?:ctns?|cartons?)\s*:?\s*(-?\d+)$/i, // matches 'cartons: 10' at end
        /(-?\d+)$/i // fallback: any number at end
    ];
    for (const pattern of patterns) {
        const match = userQuery.match(pattern);
        if (match) {
            return {
                detected: true,
                newQuantity: Math.abs(parseInt(match[1]))
            };
        }
    }
    return { detected: false };
};

const updateCartQuantity = async (tenantId, endUserPhone, newQuantity, productName = null) => {
    try {
        const conversationId = await getConversationId(tenantId, endUserPhone);
        
        // Get the most recent cart item (last discussed product)
        const { data: cartItems } = await dbClient
            .from('cart_items')
            .select(`
                id, product_id, quantity,
                product:products (name, price)
            `)
            .eq('cart_id', (
                await dbClient
                    .from('carts')
                    .select('id')
                    .eq('conversation_id', conversationId)
                    .single()
            ).data.id)
            .order('created_at', { ascending: false });
            
        if (!cartItems || cartItems.length === 0) {
            return { success: false, message: "No items in cart to update" };
        }
        
        // Update the most recent item or find by product name
        let itemToUpdate = cartItems[0];
        if (productName) {
            itemToUpdate = cartItems.find(item => 
                item.product.name.toLowerCase().includes(productName.toLowerCase())
            ) || cartItems[0];
        }
        
        // Update quantity
        await dbClient
            .from('cart_items')
            .update({ quantity: newQuantity })
            .eq('id', itemToUpdate.id);
            
        // Calculate new totals
        const subtotal = itemToUpdate.product.price * newQuantity;
        const gstAmount = subtotal * 0.18;
        const total = subtotal + gstAmount;
        
        return {
            success: true,
            message: `Updated to ${newQuantity} cartons of ${itemToUpdate.product.name}
Subtotal: ₹${subtotal.toFixed(2)}
GST (18%): ₹${gstAmount.toFixed(2)}
Total: ₹${total.toFixed(2)}`,
            product: itemToUpdate.product,
            newQuantity
        };
        
    } catch (error) {
        console.error('Error updating cart quantity:', error);
        return { success: false, message: "Error updating cart quantity" };
    }
};

module.exports = {
    detectQuantityChange,
    updateCartQuantity
};

