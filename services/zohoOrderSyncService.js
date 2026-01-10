const { dbClient } = require('../config/database');
const axios = require('axios');

/**
 * FIX 2: Sync Zoho orders and update unit prices in our database
 * This runs periodically to fetch orders created directly in Zoho
 */

/**
 * Fetch orders from Zoho and sync to our database
 */
async function syncZohoOrdersToDatabase(tenantId) {
    try {
        console.log('[ZOHO_SYNC] Starting order sync for tenant:', tenantId);

        // Get tenant's Zoho credentials
        const { data: tenant } = await dbClient
            .from('tenants')
            .select('zoho_access_token, zoho_organization_id, zoho_refresh_token')
            .eq('id', tenantId)
            .single();

        if (!tenant?.zoho_access_token && !tenant?.zoho_refresh_token) {
            console.log('[ZOHO_SYNC] No Zoho credentials found');
            return { success: false, message: 'No Zoho credentials' };
        }

        let accessToken = tenant.zoho_access_token;
        
        // If we have a refresh token, try to get a fresh access token
        if (tenant.zoho_refresh_token) {
            try {
                const refreshedToken = await refreshZohoToken(tenant.zoho_refresh_token, tenantId);
                if (refreshedToken) {
                    accessToken = refreshedToken;
                }
            } catch (refreshError) {
                console.log('[ZOHO_SYNC] Token refresh failed, using existing token:', refreshError.message);
            }
        }

        if (!accessToken) {
            console.log('[ZOHO_SYNC] No valid access token available');
            return { success: false, message: 'No valid access token' };
        }

        // Fetch recent Zoho orders (last 30 days)
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        let zohoOrders = await fetchZohoOrders(
            accessToken,
            tenant.zoho_organization_id,
            thirtyDaysAgo.toISOString().split('T')[0]
        );

        // If we got 0 orders and have a refresh token, it might be a 401 - try refreshing
        if (zohoOrders.length === 0 && tenant.zoho_refresh_token) {
            console.log('[ZOHO_SYNC] No orders returned, attempting token refresh and retry...');
            try {
                const newToken = await refreshZohoToken(tenant.zoho_refresh_token, tenantId);
                if (newToken) {
                    zohoOrders = await fetchZohoOrders(
                        newToken,
                        tenant.zoho_organization_id,
                        thirtyDaysAgo.toISOString().split('T')[0]
                    );
                }
            } catch (retryError) {
                console.error('[ZOHO_SYNC] Retry after refresh failed:', retryError.message);
            }
        }

        console.log(`[ZOHO_SYNC] Found ${zohoOrders.length} Zoho orders`);

        let syncedCount = 0;
        let updatedPrices = 0;

        for (const zohoOrder of zohoOrders) {
            // Check if order already exists in our database
            const { data: existingOrder } = await dbClient
                .from('orders')
                .select('id')
                .eq('zoho_salesorder_id', zohoOrder.salesorder_id)
                .single();

            if (existingOrder) {
                // Order exists - update prices from Zoho
                updatedPrices += await updateOrderItemPricesFromZoho(
                    existingOrder.id,
                    zohoOrder
                );
            } else {
                // New order from Zoho - create in our database
                await createOrderFromZoho(tenantId, zohoOrder);
                syncedCount++;
            }
        }

        console.log(`[ZOHO_SYNC] Synced ${syncedCount} new orders, updated ${updatedPrices} prices`);

        return {
            success: true,
            syncedOrders: syncedCount,
            updatedPrices: updatedPrices
        };

    } catch (error) {
        console.error('[ZOHO_SYNC] Error:', error.message);
        return { success: false, error: error.message };
    }
}

/**
 * Refresh Zoho access token using refresh token
 */
async function refreshZohoToken(refreshToken, tenantId) {
    try {
        // Use .in domain for India region
        const response = await axios.post('https://accounts.zoho.in/oauth/v2/token', null, {
            params: {
                refresh_token: refreshToken,
                client_id: process.env.ZOHO_CLIENT_ID,
                client_secret: process.env.ZOHO_CLIENT_SECRET,
                grant_type: 'refresh_token'
            }
        });

        if (response.data.access_token) {
            // Update the access token in the database
            await dbClient
                .from('tenants')
                .update({ 
                    zoho_access_token: response.data.access_token,
                    updated_at: new Date().toISOString()
                })
                .eq('id', tenantId);

            console.log('[ZOHO_SYNC] Access token refreshed successfully');
            return response.data.access_token;
        }

        return null;
    } catch (error) {
        console.error('[ZOHO_SYNC] Token refresh failed:', error.response?.data || error.message);
        throw error;
    }
}

/**
 * Fetch orders from Zoho API
 */
async function fetchZohoOrders(accessToken, organizationId, fromDate) {
    try {
        const response = await axios.get('https://books.zoho.com/api/v3/salesorders', {
            headers: {
                'Authorization': `Zoho-oauthtoken ${accessToken}`,
                'Content-Type': 'application/json'
            },
            params: {
                organization_id: organizationId,
                date_start: fromDate,
                status: 'confirmed',
                per_page: 200
            }
        });

        return response.data.salesorders || [];

    } catch (error) {
        if (error.response?.status === 401) {
            console.error('[ZOHO_SYNC] 401 Unauthorized - Token expired or invalid');
        } else {
            console.error('[ZOHO_SYNC] Error fetching orders:', error.message);
        }
        return [];
    }
}

/**
 * Update order item prices from Zoho data
 */
async function updateOrderItemPricesFromZoho(orderId, zohoOrder) {
    try {
        let updatedCount = 0;

        for (const zohoItem of zohoOrder.line_items) {
            // Find matching product in our database
            const { data: product } = await dbClient
                .from('products')
                .select('id')
                .eq('zoho_item_id', zohoItem.item_id)
                .single();

            if (!product) {
                console.warn(`[ZOHO_SYNC] Product not found for Zoho item:`, zohoItem.item_id);
                continue;
            }

            // Zoho's rate is BEFORE GST
            const unitPriceBeforeTax = parseFloat(zohoItem.rate);
            const gstRate = parseFloat(zohoItem.tax_percentage) || 18;
            // Calculate price WITH tax
            const priceWithTax = unitPriceBeforeTax * (1 + gstRate / 100);
            // Total price for all units including GST
            const totalPriceWithTax = priceWithTax * zohoItem.quantity;
            // GST amount for all units
            const gstAmount = unitPriceBeforeTax * (gstRate / 100) * zohoItem.quantity;

            // Update order item with Zoho prices
            const { error } = await dbClient
                .from('order_items')
                .update({
                    unit_price_before_tax: unitPriceBeforeTax.toFixed(2),
                    gst_rate: gstRate,
                    gst_amount: gstAmount.toFixed(2),
                    price_at_time_of_purchase: totalPriceWithTax.toFixed(2),
                    zoho_item_id: zohoItem.item_id
                })
                .eq('order_id', orderId)
                .eq('product_id', product.id);

            if (!error) {
                updatedCount++;
                console.log(`[ZOHO_SYNC] Updated prices for product ${product.id}`);
            }
        }

        return updatedCount;

    } catch (error) {
        console.error('[ZOHO_SYNC] Error updating prices:', error.message);
        return 0;
    }
}

/**
 * Create new order in our database from Zoho data
 */
async function createOrderFromZoho(tenantId, zohoOrder) {
    try {
        // Find or create customer
        const customer = await findOrCreateCustomerFromZoho(
            tenantId,
            zohoOrder.customer_id,
            zohoOrder.customer_name,
            zohoOrder.customer_phone
        );

        if (!customer) {
            console.warn('[ZOHO_SYNC] Could not find/create customer');
            return null;
        }

        // Create order
        const { data: order, error: orderError } = await dbClient
            .from('orders')
            .insert({
                tenant_id: tenantId,
                customer_profile_id: customer.id,
                order_number: zohoOrder.salesorder_number,
                status: 'confirmed',
                total_amount: zohoOrder.total,
                subtotal: zohoOrder.sub_total,
                tax_amount: zohoOrder.tax_total,
                zoho_salesorder_id: zohoOrder.salesorder_id,
                zoho_synced_at: new Date().toISOString(),
                created_at: zohoOrder.date
            })
            .select()
            .single();

        if (orderError) {
            console.error('[ZOHO_SYNC] Error creating order:', orderError);
            return null;
        }

        // Create order items
        for (const zohoItem of zohoOrder.line_items) {
            const { data: product } = await dbClient
                .from('products')
                .select('id')
                .eq('zoho_item_id', zohoItem.item_id)
                .single();

            if (!product) continue;

            // Zoho's rate is BEFORE GST
            const unitPriceBeforeTax = parseFloat(zohoItem.rate);
            const gstRate = parseFloat(zohoItem.tax_percentage) || 18;
            // Calculate price WITH tax per unit
            const priceWithTax = unitPriceBeforeTax * (1 + gstRate / 100);
            // Total price for all units including GST
            const totalPriceWithTax = priceWithTax * zohoItem.quantity;
            // GST amount for all units
            const gstAmount = unitPriceBeforeTax * (gstRate / 100) * zohoItem.quantity;

            await dbClient
                .from('order_items')
                .insert({
                    order_id: order.id,
                    product_id: product.id,
                    quantity: zohoItem.quantity,
                    unit_price_before_tax: unitPriceBeforeTax.toFixed(2),
                    gst_rate: gstRate,
                    gst_amount: gstAmount.toFixed(2),
                    price_at_time_of_purchase: totalPriceWithTax.toFixed(2),
                    zoho_item_id: zohoItem.item_id
                });
        }

        console.log(`[ZOHO_SYNC] Created order ${order.order_number} from Zoho`);
        return order;

    } catch (error) {
        console.error('[ZOHO_SYNC] Error creating order:', error.message);
        return null;
    }
}

/**
 * Find or create customer from Zoho data
 */
async function findOrCreateCustomerFromZoho(tenantId, zohoCustomerId, name, phone) {
    try {
        // Try to find by Zoho customer ID
        let { data: customer } = await dbClient
            .from('customer_profiles')
            .select('id')
            .eq('tenant_id', tenantId)
            .eq('zoho_contact_id', zohoCustomerId)
            .single();

        if (customer) return customer;

        // Try to find by phone
        if (phone) {
            const { data: customerByPhone } = await dbClient
                .from('customer_profiles')
                .select('id')
                .eq('tenant_id', tenantId)
                .eq('phone', phone)
                .single();

            if (customerByPhone) {
                // Update with Zoho ID
                await dbClient
                    .from('customer_profiles')
                    .update({ zoho_contact_id: zohoCustomerId })
                    .eq('id', customerByPhone.id);

                return customerByPhone;
            }
        }

        // Create new customer
        const nameParts = name.split(' ');
        const { data: newCustomer } = await dbClient
            .from('customer_profiles')
            .insert({
                tenant_id: tenantId,
                phone: phone || `zoho_${zohoCustomerId}`,
                first_name: nameParts[0] || name,
                last_name: nameParts.slice(1).join(' ') || '',
                zoho_contact_id: zohoCustomerId
            })
            .select()
            .single();

        return newCustomer;

    } catch (error) {
        console.error('[ZOHO_SYNC] Error finding/creating customer:', error.message);
        return null;
    }
}

/**
 * Cron job to sync Zoho orders every hour
 */
async function scheduleZohoOrderSync() {
    console.log('[ZOHO_SYNC] Starting scheduled sync...');

    // Get all tenants with Zoho integration
    const { data: tenants } = await dbClient
        .from('tenants')
        .select('id')
        .not('zoho_access_token', 'is', null);

    for (const tenant of tenants || []) {
        await syncZohoOrdersToDatabase(tenant.id);
    }

    console.log('[ZOHO_SYNC] Scheduled sync complete');
}

module.exports = {
    syncZohoOrdersToDatabase,
    updateOrderItemPricesFromZoho,
    scheduleZohoOrderSync
};
