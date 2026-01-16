/**
 * @title Order Management Service
 * @description Manages the logic for fetching and updating order statuses.
 */
const { dbClient } = require('./config');

/**
 * Fetches the status of the most recent order for an end-user.
 * @param {string} tenantId The ID of the tenant.
 * @param {string} endUserPhone The phone number of the customer.
 * @returns {Promise<string>} A formatted string with the order status.
 */
const getOrderStatus = async (tenantId, endUserPhone) => {
    try {
        const conversationId = (await dbClient.from('conversations_new').select('id').eq('tenant_id', tenantId).eq('end_user_phone', endUserPhone).single())?.data?.id;
        if (!conversationId) {
            return "You do not have any order history with us.";
        }

        const { data: order, error } = await dbClient
            .from('orders_new')
            .select('id, status, created_at')
            .eq('conversation_id', conversationId)
            .order('created_at', { ascending: false }) // Get the most recent order
            .limit(1)
            .single();

        if (error || !order) {
            return "You do not have any order history with us.";
        }

        const orderId = order.id.substring(0, 8);
        const orderDate = new Date(order.created_at).toLocaleDateString();
        const status = order.status.replace('_', ' ').toUpperCase();

        return `Your most recent order (#${orderId}) from ${orderDate} has a status of: *${status}*.`;

    } catch (error) {
        console.error('Error fetching order status:', error.message);
        return 'An error occurred while fetching your order status.';
    }
};

/**
 * Allows a tenant to update the status of an order.
 * @param {string} tenantId The ID of the tenant.
 * @param {string} endUserPhone The phone number of the customer whose order is being updated.
 * @param {string} newStatus The new status for the order.
 * @returns {Promise<string>} A confirmation or error message.
 */
const updateOrderStatus = async (tenantId, endUserPhone, newStatus) => {
    const validStatuses = ['pending_payment', 'paid', 'shipped', 'completed', 'cancelled'];
    if (!validStatuses.includes(newStatus.toLowerCase())) {
        return `Invalid status. Please use one of the following: ${validStatuses.join(', ')}.`;
    }

    try {
        const conversationId = (await dbClient.from('conversations_new').select('id').eq('tenant_id', tenantId).eq('end_user_phone', endUserPhone).single())?.data?.id;
        if (!conversationId) {
            return `No order history found for customer ${endUserPhone}.`;
        }

        const { data: order, error: findError } = await dbClient
            .from('orders_new')
            .select('id')
            .eq('conversation_id', conversationId)
            .order('created_at', { ascending: false })
            .limit(1)
            .single();

        if (findError || !order) {
            return `No order history found for customer ${endUserPhone}.`;
        }

        const { error: updateError } = await dbClient
            .from('orders_new')
            .update({ status: newStatus.toLowerCase() })
            .eq('id', order.id);

        if (updateError) throw updateError;

        return `The latest order for ${endUserPhone} has been updated to *${newStatus.toUpperCase()}*.`;

    } catch (error) {
        console.error('Error updating order status:', error.message);
        return 'An error occurred while updating the order status.';
    }
};

/**
 * Create order from field visit (Phase 2 - Auto-order creation)
 * Called when visit completes with products_discussed
 */
const createOrderFromVisit = async (tenantId, visitId) => {
    try {
        const crypto = require('crypto');
        console.log('[ORDER] Creating order from visit:', visitId);

        // Get visit details
        const visitResult = await dbClient
            .from('visits')
            .select('*')
            .eq('id', visitId)
            .single();

        if (visitResult.error || !visitResult.data) {
            return {
                ok: false,
                error: 'Visit not found'
            };
        }

        const visit = visitResult.data;
        const productsDiscussed = JSON.parse(visit.products_discussed || '[]');

        if (productsDiscussed.length === 0) {
            return {
                ok: true,
                order: null,
                message: 'No products to create order from'
            };
        }

        // Get customer details
        const customerResult = await dbClient
            .from('customer_profiles_new')
            .select('id, name, phone, email, default_shipping_address, gst_number')
            .eq('id', visit.customer_id)
            .single();

        if (customerResult.error || !customerResult.data) {
            return {
                ok: false,
                error: 'Customer not found'
            };
        }

        const customer = customerResult.data;

        // Get product details
        const productIds = productsDiscussed.map(p => p.id || p.product_id).filter(Boolean);
        let products = [];

        if (productIds.length > 0) {
            const productsResult = await dbClient
                .from('products')
                .select('id, name, price, hsn_code')
                .in('id', productIds);

            products = productsResult.data || [];
        }

        // Build order items
        const orderItems = productsDiscussed
            .map(discussed => {
                const product = products.find(p => p.id === (discussed.id || discussed.product_id));
                return {
                    product_id: discussed.id || discussed.product_id,
                    product_name: product?.name || discussed.name,
                    quantity: discussed.quantity || 0,
                    unit_price: product?.price || discussed.price || 0,
                    line_total: (discussed.quantity || 0) * (product?.price || discussed.price || 0),
                    hsn_code: product?.hsn_code
                };
            })
            .filter(item => item.quantity > 0);

        if (orderItems.length === 0) {
            return {
                ok: true,
                order: null,
                message: 'No valid products with quantity > 0'
            };
        }

        // Calculate totals
        const subtotal = orderItems.reduce((sum, item) => sum + item.line_total, 0);
        const gstRate = 0.18;
        const gstAmount = subtotal * gstRate;
        const totalAmount = subtotal + gstAmount;

        // Create order
        const orderId = `ORD-${Date.now()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

        const insertData = {
            id: orderId,
            tenant_id: tenantId,
            order_number: orderId,
            customer_id: visit.customer_id,
            customer_name: customer.name,
            customer_phone: customer.phone,
            customer_email: customer.email,
            salesman_id: visit.salesman_id,
            visit_id: visitId,
            source_type: 'field_visit',
            status: 'draft',
            items: JSON.stringify(orderItems),
            subtotal,
            gst_rate: gstRate * 100,
            gst_amount: gstAmount,
            total_amount: totalAmount,
            shipping_address: customer.default_shipping_address,
            gst_number: customer.gst_number,
            notes: `Auto-created from field visit. Potential: ${visit.potential}. Products: ${productsDiscussed.map(p => p.name || p.id).join(', ')}`,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };

        const result = await dbClient
            .from('orders_new')
            .insert(insertData)
            .select();

        if (result.error) {
            return {
                ok: false,
                error: result.error.message
            };
        }

        // Update visit with order_id
        await dbClient
            .from('visits')
            .update({ order_id: orderId })
            .eq('id', visitId);

        console.log('[ORDER] Order created from visit:', orderId);

        return {
            ok: true,
            order: result.data?.[0],
            order_id: orderId,
            items_count: orderItems.length,
            total_amount: totalAmount,
            message: 'Order created as draft from visit'
        };

    } catch (error) {
        console.error('[ORDER] Create from visit error:', error);
        return {
            ok: false,
            error: error.message
        };
    }
};

/**
 * Confirm draft order from visit
 * Also records achievement in targets
 */
const confirmOrderFromVisit = async (tenantId, orderId) => {
    try {
        console.log('[ORDER] Confirming order from visit:', orderId);

        // Get order
        const orderResult = await dbClient
            .from('orders_new')
            .select('*')
            .eq('id', orderId)
            .single();

        if (orderResult.error || !orderResult.data) {
            return {
                ok: false,
                error: 'Order not found'
            };
        }

        const order = orderResult.data;

        if (order.status !== 'draft') {
            return {
                ok: false,
                error: `Order status is ${order.status}, not draft`
            };
        }

        // Update to pending
        const result = await dbClient
            .from('orders_new')
            .update({
                status: 'pending',
                confirmed_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            })
            .eq('id', orderId)
            .select();

        if (result.error) {
            return {
                ok: false,
                error: result.error.message
            };
        }

        // Record achievement in targets
        if (order.visit_id && order.salesman_id) {
            try {
                const now = new Date();
                const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

                await dbClient
                    .from('salesman_targets')
                    .select('*')
                    .eq('salesman_id', order.salesman_id)
                    .eq('period', period)
                    .then(async (targetResult) => {
                        if (targetResult.data && targetResult.data.length > 0) {
                            const target = targetResult.data[0];
                            await dbClient
                                .from('salesman_targets')
                                .update({
                                    achieved_orders: (target.achieved_orders || 0) + 1,
                                    achieved_revenue: (target.achieved_revenue || 0) + order.total_amount
                                })
                                .eq('id', target.id);
                        }
                    });
            } catch (e) {
                console.warn('[ORDER] Could not update target achievement:', e.message);
            }
        }

        return {
            ok: true,
            order: result.data?.[0],
            message: 'Order confirmed and moved to pending'
        };

    } catch (error) {
        console.error('[ORDER] Confirm error:', error);
        return {
            ok: false,
            error: error.message
        };
    }
};

/**
 * Get daily orders summary
 */
const getDailyOrdersSummary = async (tenantId, date) => {
    try {
        const dateStr = date || new Date().toISOString().split('T')[0];

        const result = await dbClient
            .from('orders_new')
            .select('status, total_amount, salesman_id')
            .eq('tenant_id', tenantId)
            .gte('created_at', `${dateStr}T00:00:00`)
            .lt('created_at', `${dateStr}T23:59:59`);

        if (result.error) {
            return {
                ok: false,
                error: result.error.message
            };
        }

        const orders = result.data || [];

        const summary = {
            date: dateStr,
            total_orders: orders.length,
            confirmed_count: orders.filter(o => o.status === 'pending' || o.status === 'confirmed').length,
            draft_count: orders.filter(o => o.status === 'draft').length,
            total_revenue: orders.reduce((sum, o) => sum + (o.total_amount || 0), 0),
            by_salesman: {}
        };

        // Group by salesman
        orders.forEach(order => {
            if (!summary.by_salesman[order.salesman_id]) {
                summary.by_salesman[order.salesman_id] = {
                    order_count: 0,
                    total_amount: 0
                };
            }
            summary.by_salesman[order.salesman_id].order_count += 1;
            summary.by_salesman[order.salesman_id].total_amount += order.total_amount || 0;
        });

        return {
            ok: true,
            summary
        };

    } catch (error) {
        console.error('[ORDER] Daily summary error:', error);
        return {
            ok: false,
            error: error.message
        };
    }
};

module.exports = {
    getOrderStatus,
    updateOrderStatus,
    createOrderFromVisit,
    confirmOrderFromVisit,
    getDailyOrdersSummary
};


