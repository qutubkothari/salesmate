const { dbClient } = require('../config/database');

/**
 * Get customer's last purchase price for a specific product
 * Returns the price they paid in their most recent order for this product
 */
async function getCustomerLastPrice(tenantId, phoneNumber, productId) {
    try {
        console.log('[PERSONALIZED_PRICING] Checking last price for:', { 
            phoneNumber, 
            productId 
        });

        // Get customer profile
        const { data: customer } = await dbClient
            .from('customer_profiles_new')
            .select('id')
            .eq('tenant_id', tenantId)
            .eq('phone', phoneNumber)
            .single();

        if (!customer) {
            console.log('[PERSONALIZED_PRICING] No customer profile found');
            return null;
        }

        // Get last order containing this product
        const { data: lastOrderItem, error } = await dbClient
            .from('order_items')
            .select(`
                price_at_time_of_purchase,
                quantity,
                orders!inner(
                    id,
                    created_at,
                    status
                )
            `)
            .eq('orders.customer_profile_id', customer.id)
            .eq('orders.tenant_id', tenantId)
            .eq('product_id', productId)
            .in('orders.status', ['pending', 'confirmed', 'completed'])
            .order('orders.created_at', { ascending: false })
            .limit(1)
            .single();

        if (error || !lastOrderItem) {
            console.log('[PERSONALIZED_PRICING] No previous purchase found');
            return null;
        }

        console.log('[PERSONALIZED_PRICING] Found last purchase:', {
            price: lastOrderItem.price_at_time_of_purchase,
            quantity: lastOrderItem.quantity,
            orderDate: lastOrderItem.orders.created_at
        });

        return {
            price: parseFloat(lastOrderItem.price_at_time_of_purchase),
            lastOrderDate: lastOrderItem.orders.created_at,
            lastQuantity: lastOrderItem.quantity,
            isReturningCustomer: true
        };

    } catch (error) {
        console.error('[PERSONALIZED_PRICING] Error:', error.message);
        return null;
    }
}

/**
 * Get customer's purchase history for a product
 * Shows all previous orders with prices
 */
async function getCustomerPurchaseHistory(tenantId, phoneNumber, productId) {
    try {
        const { data: customer } = await dbClient
            .from('customer_profiles_new')
            .select('id')
            .eq('tenant_id', tenantId)
            .eq('phone', phoneNumber)
            .single();

        if (!customer) return [];

        const { data: history } = await dbClient
            .from('order_items')
            .select(`
                price_per_unit,
                quantity,
                total_price,
                orders!inner(
                    id,
                    order_number,
                    created_at,
                    status
                )
            `)
            .eq('orders.customer_profile_id', customer.id)
            .eq('orders.tenant_id', tenantId)
            .eq('product_id', productId)
            .order('orders.created_at', { ascending: false })
            .limit(10);

        return history || [];

    } catch (error) {
        console.error('[PERSONALIZED_PRICING] Error getting history:', error.message);
        return [];
    }
}

/**
 * Get personalized price for customer
 * Returns last purchase price if available, otherwise catalog price
 */
async function getPersonalizedPrice(tenantId, phoneNumber, productId, catalogPrice) {
    try {
        const lastPrice = await getCustomerLastPrice(tenantId, phoneNumber, productId);

        if (lastPrice) {
            // Customer has purchased before - use their last price
            return {
                price: lastPrice.price,
                isPersonalized: true,
                message: `Your last price: ₹${lastPrice.price} (ordered on ${new Date(lastPrice.lastOrderDate).toLocaleDateString()})`,
                catalogPrice: catalogPrice,
                savings: catalogPrice > lastPrice.price ? catalogPrice - lastPrice.price : 0
            };
        }

        // New customer - use catalog price
        return {
            price: catalogPrice,
            isPersonalized: false,
            message: `Price: ₹${catalogPrice}`,
            catalogPrice: catalogPrice,
            savings: 0
        };

    } catch (error) {
        console.error('[PERSONALIZED_PRICING] Error:', error.message);
        return {
            price: catalogPrice,
            isPersonalized: false,
            message: `Price: ₹${catalogPrice}`,
            catalogPrice: catalogPrice,
            savings: 0
        };
    }
}

/**
 * Check if customer gets a better price than catalog
 */
async function shouldOfferSpecialPrice(tenantId, phoneNumber, productId) {
    try {
        const { data: product } = await dbClient
            .from('products')
            .select('price')
            .eq('id', productId)
            .eq('tenant_id', tenantId)
            .single();

        if (!product) return false;

        const lastPrice = await getCustomerLastPrice(tenantId, phoneNumber, productId);

        // Offer special price if they previously paid less than current catalog price
        return lastPrice && lastPrice.price < product.price;

    } catch (error) {
        console.error('[PERSONALIZED_PRICING] Error:', error.message);
        return false;
    }
}

/**
 * Get pricing message for customer
 */
async function getPricingMessage(tenantId, phoneNumber, productName, productId) {
    try {
        // Get product details
        const { data: product } = await dbClient
            .from('products')
            .select('price, units_per_carton, packaging_unit')
            .eq('id', productId)
            .eq('tenant_id', tenantId)
            .single();

        if (!product) return `Product ${productName} not found.`;

        // Get personalized pricing
        const pricing = await getPersonalizedPrice(
            tenantId, 
            phoneNumber, 
            productId, 
            parseFloat(product.price)
        );

        let message = `📦 *${productName}*\n\n`;

        if (pricing.isPersonalized) {
            message += `✨ *Your Special Price*: ₹${pricing.price}/${product.packaging_unit || 'carton'}\n`;
            message += `   (Last ordered: ${new Date(await getLastOrderDate(tenantId, phoneNumber, productId)).toLocaleDateString()})\n\n`;
            
            if (pricing.savings > 0) {
                message += `💰 You save ₹${pricing.savings} from catalog price!\n\n`;
            }
        } else {
            message += `💵 *Price*: ₹${pricing.price}/${product.packaging_unit || 'carton'}\n\n`;
        }

        if (product.units_per_carton) {
            message += `📊 ${product.units_per_carton} pieces per carton\n\n`;
        }

        message += `Ready to order? Let me know the quantity! 🛒`;

        return message;

    } catch (error) {
        console.error('[PERSONALIZED_PRICING] Error creating message:', error.message);
        return `Error fetching pricing for ${productName}`;
    }
}

/**
 * Helper: Get last order date for a product
 */
async function getLastOrderDate(tenantId, phoneNumber, productId) {
    const lastPrice = await getCustomerLastPrice(tenantId, phoneNumber, productId);
    return lastPrice ? lastPrice.lastOrderDate : null;
}

/**
 * Admin function: Get all customer-specific prices for a product
 */
async function getProductCustomerPrices(tenantId, productId) {
    try {
        const { data: prices } = await dbClient
            .from('order_items')
            .select(`
                price_per_unit,
                quantity,
                orders!inner(
                    customer_profile_id,
                    created_at,
                    customer_profiles!inner(
                        phone,
                        first_name,
                        last_name
                    )
                )
            `)
            .eq('orders.tenant_id', tenantId)
            .eq('product_id', productId)
            .order('orders.created_at', { ascending: false });

        // Group by customer and get their last price
        const customerPrices = {};
        prices?.forEach(item => {
            const customerId = item.orders.customer_profile_id;
            if (!customerPrices[customerId]) {
                customerPrices[customerId] = {
                    phone: item.orders.customer_profiles.phone,
                    name: `${item.orders.customer_profiles.first_name || ''} ${item.orders.customer_profiles.last_name || ''}`.trim(),
                    lastPrice: item.price_per_unit,
                    lastOrderDate: item.orders.created_at,
                    lastQuantity: item.quantity
                };
            }
        });

        return Object.values(customerPrices);

    } catch (error) {
        console.error('[PERSONALIZED_PRICING] Error getting customer prices:', error.message);
        return [];
    }
}

module.exports = {
    getCustomerLastPrice,
    getCustomerPurchaseHistory,
    getPersonalizedPrice,
    shouldOfferSpecialPrice,
    getPricingMessage,
    getProductCustomerPrices
};

