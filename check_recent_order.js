const { supabase } = require('./config/database');

async function checkRecentOrder() {
    try {
        console.log('🔍 Checking most recent order...\n');
        
        // Get the most recent order
        const { data: orders, error } = await supabase
            .from('orders')
            .select(`
                id,
                order_number,
                status,
                total_amount,
                subtotal_amount,
                gst_amount,
                volume_discount_percent,
                volume_discount_amount,
                zoho_sync_status,
                zoho_sales_order_id,
                zoho_sync_error,
                created_at,
                order_items(
                    id,
                    quantity,
                    unit_price_before_tax,
                    gst_rate,
                    gst_amount,
                    price_at_time_of_purchase,
                    product:products(name)
                )
            `)
            .order('created_at', { ascending: false })
            .limit(1);

        if (error) {
            console.error('❌ Error:', error.message);
            return;
        }

        if (!orders || orders.length === 0) {
            console.log('📭 No orders found');
            return;
        }

        const order = orders[0];
        console.log('📦 Order Details:');
        console.log('─────────────────────────────────────');
        console.log(`Order ID: ${order.id}`);
        console.log(`Order Number: ${order.order_number || 'N/A'}`);
        console.log(`Status: ${order.status}`);
        console.log(`Created: ${new Date(order.created_at).toLocaleString()}`);
        console.log('');
        
        console.log('💰 Pricing:');
        console.log(`Subtotal: ₹${order.subtotal_amount}`);
        console.log(`Volume Discount: ${order.volume_discount_percent || 0}% (₹${order.volume_discount_amount || 0})`);
        console.log(`GST: ₹${order.gst_amount}`);
        console.log(`Total: ₹${order.total_amount}`);
        console.log('');
        
        console.log('🔄 Zoho Sync Status:');
        console.log(`Status: ${order.zoho_sync_status || 'not_synced'}`);
        console.log(`Zoho Sales Order ID: ${order.zoho_sales_order_id || 'N/A'}`);
        if (order.zoho_sync_error) {
            console.log(`❌ Error: ${order.zoho_sync_error}`);
        }
        console.log('');
        
        console.log('📦 Order Items:');
        console.log('─────────────────────────────────────');
        order.order_items.forEach((item, idx) => {
            console.log(`${idx + 1}. ${item.product.name}`);
            console.log(`   Quantity: ${item.quantity}`);
            console.log(`   Unit Price (before tax): ₹${item.unit_price_before_tax}`);
            console.log(`   GST Rate: ${item.gst_rate}%`);
            console.log(`   GST Amount: ₹${item.gst_amount}`);
            console.log(`   Total: ₹${item.price_at_time_of_purchase}`);
            console.log('');
        });

    } catch (error) {
        console.error('❌ Unexpected error:', error.message);
    }
}

checkRecentOrder();
