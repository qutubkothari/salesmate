// services/automation/proactiveMessaging.js
const { dbClient } = require('../config');
const { sendMessage } = require('../whatsappService');
const anomalyDetector = require('../intelligence/anomalyDetector');

/**
 * Send proactive messages to customers based on patterns
 */
const { analyzePurchaseFrequency } = require('../analytics/purchaseFrequency');
const { analyzeProductAffinity } = require('../analytics/productAffinity');

// Top-level function declaration
async function sendProactiveReminders() {
        try {
            console.log('[PROACTIVE] Starting reorder reminder check...');
            const today = new Date();
            const results = { checked: 0, reminded: 0, skipped: 0, errors: 0 };
            // Get all active customer profiles with order history
            const { data: customers, error } = await dbClient
                .from('customer_profiles')
                .select('id, phone, first_name, tenant_id, last_order_date')
                .not('last_order_date', 'is', null)
                .order('last_order_date', { ascending: true })
                .limit(100);
            if (error || !customers) {
                console.error('[PROACTIVE] Error fetching customers:', error);
                return results;
            }
            console.log(`[PROACTIVE] Checking ${customers.length} customers...`);
            for (const customer of customers) {
                results.checked++;
                try {
                    // Check if reminder was sent recently (don't spam)
                    const { data: recentReminder } = await dbClient
                        .from('proactive_messages')
                        .select('id, sent_at')
                        .eq('customer_profile_id', customer.id)
                        .eq('message_type', 'reorder_reminder')
                        .gte('sent_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
                        .maybeSingle();
                    if (recentReminder) {
                        console.log(`[PROACTIVE] Skipping ${customer.first_name} - reminded recently`);
                        results.skipped++;
                        continue;
                    }
                    // Check if customer recently messaged us (don't interrupt active conversations)
                    const { data: recentMessage } = await dbClient
                        .from('messages')
                        .select('created_at')
                        .eq('conversation_id', (await dbClient
                            .from('conversations')
                            .select('id')
                            .eq('end_user_phone', customer.phone)
                            .eq('tenant_id', customer.tenant_id)
                            .single()).data?.id)
                        .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
                        .maybeSingle();
                    if (recentMessage) {
                        console.log(`[PROACTIVE] Skipping ${customer.first_name} - recently active`);
                        results.skipped++;
                        continue;
                    }
                    // Analyze purchase frequency
                    const frequency = await analyzePurchaseFrequency(customer.id);
                    if (!frequency || frequency.confidence_score < 0.5) {
                        console.log(`[PROACTIVE] Skipping ${customer.first_name} - insufficient pattern`);
                        results.skipped++;
                        continue;
                    }
                    // Check if due for reorder (within 5 days of expected date)
                    const daysSinceLastOrder = Math.floor(
                        (today - new Date(frequency.last_order_date)) / (1000 * 60 * 60 * 24)
                    );
                    const daysUntilExpected = Math.floor(
                        (new Date(frequency.expected_next_order) - today) / (1000 * 60 * 60 * 24)
                    );
                    const isDue = daysUntilExpected <= 5 && daysUntilExpected >= -2;
                    if (!isDue) {
                        console.log(`[PROACTIVE] Skipping ${customer.first_name} - not due yet (${daysUntilExpected} days)`);
                        results.skipped++;
                        continue;
                    }
                    // Get customer's usual products
                    const affinity = await analyzeProductAffinity(customer.id);
                    const regularProducts = affinity.filter(p => p.is_regular_product);
                    let productMention = '';
                    if (regularProducts.length > 0) {
                        const { data: products } = await dbClient
                            .from('products')
                            .select('name')
                            .in('id', regularProducts.slice(0, 3).map(p => p.product_id));
                        if (products && products.length > 0) {
                            productMention = ` Need ${products.map(p => p.name).join(', ')}?`;
                        }
                    }
                    // Build natural reminder message
                    const messages = [
                        `Hi ${customer.first_name || 'there'}! Just checking in.${productMention} Let me know if you need anything.`,
                        `Hey ${customer.first_name || 'there'}! Hope all is well.${productMention} I'm here if you need to order.`,
                        `Hi ${customer.first_name || 'there'}! It's been a while.${productMention} Let me know how I can help.`
                    ];
                    const message = messages[Math.floor(Math.random() * messages.length)];
                    // Send reminder
                    await sendMessage(customer.phone, message);
                    // Log the proactive message
                    await dbClient
                        .from('proactive_messages')
                        .insert({
                            customer_profile_id: customer.id,
                            tenant_id: customer.tenant_id,
                            message_type: 'reorder_reminder',
                            message_body: message,
                            sent_at: new Date().toISOString(),
                            days_since_last_order: daysSinceLastOrder,
                            expected_reorder_date: frequency.expected_next_order
                        });
                    console.log(`[PROACTIVE] âœ… Sent reminder to ${customer.first_name} (${daysSinceLastOrder} days since last order)`);
                    results.reminded++;
                    // Small delay between messages to avoid rate limits
                    await new Promise(resolve => setTimeout(resolve, 2000));
                } catch (customerError) {
                    console.error(`[PROACTIVE] Error processing customer ${customer.id}:`, customerError.message);
                    results.errors++;
                }
            }
            console.log('[PROACTIVE] Summary:', results);
            return results;
        } catch (error) {
            console.error('[PROACTIVE] Fatal error:', error);
            return { checked: 0, reminded: 0, skipped: 0, errors: 1 };
        }
}

// Top-level function declaration
async function sendManagerAlerts(tenantId, alertType, data) {
        try {
            // Get tenant's admin phones
            const { data: tenant } = await dbClient
                .from('tenants')
                .select('admin_phones, sales_phone_primary')
                .eq('id', tenantId)
                .single();
            if (!tenant?.admin_phones && !tenant?.sales_phone_primary) {
                console.log('[ALERT] No admin phones configured');
                return;
            }
            const adminPhones = tenant.admin_phones || [tenant.sales_phone_primary];
            let alertMessage = '';
            switch (alertType) {
                case 'large_order':
                    alertMessage = `ðŸš¨ Large Order Alert!\n\nCustomer: ${data.customerName}\nOrder Value: â‚¹${data.orderValue}\nProducts: ${data.productCount} items`;
                    break;
                case 'vip_activity':
                    alertMessage = `â­ VIP Customer Activity\n\nCustomer: ${data.customerName}\nAction: ${data.action}\nLifetime Value: â‚¹${data.lifetimeValue}`;
                    break;
                case 'unusual_pattern':
                    alertMessage = `âš ï¸ Unusual Pattern Detected\n\nCustomer: ${data.customerName}\nPattern: ${data.pattern}\nAction: ${data.action}`;
                    break;
                default:
                    alertMessage = `ðŸ“¢ Alert: ${alertType}\n\n${JSON.stringify(data, null, 2)}`;
            }
            // Send to all admin phones
            for (const phone of adminPhones) {
                await sendMessage(phone, alertMessage);
            }
            console.log(`[ALERT] Sent ${alertType} alert to ${adminPhones.length} admins`);
        } catch (error) {
            console.error('[ALERT] Error sending manager alert:', error);
        }
}

module.exports = {
  sendProactiveReminders,
  sendManagerAlerts
};
