// services/zohoInvoiceSyncService.js
const { dbClient } = require('../config/database');
const zohoTenantAuth = require('./zohoTenantAuthService');
const fetch = require('node-fetch');

/**
 * Sync a specific invoice from Zoho back to local database
 * @param {string} tenantId - The tenant ID
 * @param {string} invoiceId - The Zoho invoice ID
 * @returns {Object} - Result of the sync operation
 */
async function syncInvoiceFromZoho(tenantId, invoiceId) {
    try {
        console.log(`[ZOHO_INVOICE_SYNC] Syncing invoice ${invoiceId} for tenant ${tenantId}`);

        // Get Zoho credentials
        const { accessToken, organizationId } = await zohoTenantAuth.getValidAccessToken(tenantId);

        // Fetch invoice from Zoho
        const response = await fetch(
            `https://www.zohoapis.in/books/v3/invoices/${invoiceId}?organization_id=${organizationId}`,
            {
                method: 'GET',
                headers: {
                    'Authorization': `Zoho-oauthtoken ${accessToken}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        const data = await response.json();

        if (!response.ok) {
            throw new Error(`Zoho API error: ${data.message || 'Unknown error'}`);
        }

        const invoice = data.invoice;
        console.log(`[ZOHO_INVOICE_SYNC] Fetched invoice: ${invoice.invoice_number}`);
        console.log(`[ZOHO_INVOICE_SYNC] Invoice line items from Zoho:`, JSON.stringify(invoice.line_items.map(item => ({
            name: item.name,
            item_id: item.item_id,
            rate: item.rate,
            quantity: item.quantity,
            total: item.item_total
        })), null, 2));

        // Find the order in local database using Zoho invoice ID
        const { data: order, error: orderError } = await dbClient
            .from('orders')
            .select('*')
            .eq('tenant_id', tenantId)
            .eq('zoho_invoice_id', invoiceId)
            .single();

        if (orderError || !order) {
            console.log(`[ZOHO_INVOICE_SYNC] No local order found for invoice ${invoiceId}`);
            // Try to find by sales order ID
            const { data: orderBySO } = await dbClient
                .from('orders')
                .select('*')
                .eq('tenant_id', tenantId)
                .eq('zoho_salesorder_id', invoice.salesorder_id)
                .single();

            if (!orderBySO) {
                return {
                    success: false,
                    error: 'No matching order found in local database'
                };
            }
            
            // Update this order with the invoice ID
            await dbClient
                .from('orders')
                .update({ zoho_invoice_id: invoiceId })
                .eq('id', orderBySO.id);
        }

        // Update order with latest invoice data
        // Using actual column names from orders table schema
        const updateData = {
            total_amount: invoice.total,
            subtotal_amount: invoice.sub_total || invoice.total,  // Column is subtotal_amount, not subtotal
            gst_amount: invoice.tax_total || 0,                   // Column is gst_amount, not tax_amount
            zoho_invoice_id: invoiceId,
            zoho_sync_status: 'synced',
            zoho_synced_at: new Date().toISOString()
        };

        const { error: updateError } = await dbClient
            .from('orders')
            .update(updateData)
            .eq('zoho_invoice_id', invoiceId)
            .eq('tenant_id', tenantId);

        if (updateError) {
            throw new Error(`Failed to update order: ${updateError.message}`);
        }

        // Sync line items (product prices)
        // First, get all products to match by item_id
        const { data: products, error: productsError } = await dbClient
            .from('products')
            .select('id, zoho_item_id, name')
            .eq('tenant_id', tenantId);

        console.log(`[ZOHO_INVOICE_SYNC] Found ${products?.length || 0} products in database`);

        const { data: orderItems, error: itemsError } = await dbClient
            .from('order_items')
            .select('*')
            .eq('order_id', order?.id || orderBySO?.id);

        console.log(`[ZOHO_INVOICE_SYNC] Found ${orderItems?.length || 0} order items for order ${order?.id || orderBySO?.id}`);
        console.log(`[ZOHO_INVOICE_SYNC] Invoice has ${invoice.line_items?.length || 0} line items from Zoho`);

        if (!itemsError && orderItems && !productsError && products) {
            for (const zohoItem of invoice.line_items) {
                console.log(`[ZOHO_INVOICE_SYNC] Processing Zoho item: ${zohoItem.name}, item_id: ${zohoItem.item_id}, rate: ${zohoItem.rate}`);
                
                // Find matching product by zoho_item_id OR by name (fallback if item_id is empty)
                let product = null;
                if (zohoItem.item_id) {
                    product = products.find(p => p.zoho_item_id === zohoItem.item_id);
                }
                
                // If no match by item_id, try matching by name
                if (!product) {
                    product = products.find(p => p.name === zohoItem.name);
                }
                
                if (product) {
                    console.log(`[ZOHO_INVOICE_SYNC] Found matching product: ${product.name} (ID: ${product.id})`);
                    
                    // Find matching local order item by product_id
                    const localItem = orderItems.find(item => item.product_id === product.id);

                    if (localItem) {
                        console.log(`[ZOHO_INVOICE_SYNC] Found matching order item (ID: ${localItem.id})`);
                        
                        // Calculate prices from Zoho data
                        // NOTE: Zoho's rate is BEFORE GST
                        const rate = parseFloat(zohoItem.rate) || 0;
                        const quantity = parseFloat(zohoItem.quantity) || 0;
                        const gstRate = parseFloat(zohoItem.tax_percentage) || 18;
                        
                        // Zoho's rate is already the price before tax
                        const unitPriceBeforeTax = rate;
                        
                        // Calculate price WITH tax per unit
                        const priceWithTax = unitPriceBeforeTax * (1 + gstRate / 100);
                        
                        // Total price for all units INCLUDING GST
                        const totalPrice = priceWithTax * quantity;
                        
                        // GST amount for all units
                        const gstAmount = unitPriceBeforeTax * (gstRate / 100) * quantity;

                        console.log(`[ZOHO_INVOICE_SYNC] Updating ${product.name}:`);
                        console.log(`[ZOHO_INVOICE_SYNC]   Old Unit Price: â‚¹${localItem.unit_price_before_tax}`);
                        console.log(`[ZOHO_INVOICE_SYNC]   New Unit Price: â‚¹${unitPriceBeforeTax.toFixed(2)}`);
                        console.log(`[ZOHO_INVOICE_SYNC]   Old Total: â‚¹${localItem.price_at_time_of_purchase}`);
                        console.log(`[ZOHO_INVOICE_SYNC]   New Total: â‚¹${totalPrice.toFixed(2)}`);
                        
                        const { error: updateItemError } = await dbClient
                            .from('order_items')
                            .update({
                                quantity: quantity,
                                price_at_time_of_purchase: totalPrice.toFixed(2),
                                unit_price_before_tax: unitPriceBeforeTax.toFixed(2),
                                gst_rate: gstRate,
                                gst_amount: gstAmount.toFixed(2),
                                zoho_item_id: zohoItem.line_item_id
                            })
                            .eq('id', localItem.id);
                        
                        if (updateItemError) {
                            console.error(`[ZOHO_INVOICE_SYNC] Error updating item: ${updateItemError.message}`);
                        } else {
                            console.log(`[ZOHO_INVOICE_SYNC] âœ“ Successfully updated order item ${localItem.id}`);
                        }
                    } else {
                        console.log(`[ZOHO_INVOICE_SYNC] âš  No order item found for product ${product.id}`);
                    }
                } else {
                    console.log(`[ZOHO_INVOICE_SYNC] âš  No product found with zoho_item_id: ${zohoItem.item_id}`);
                }
            }
        }

        console.log(`[ZOHO_INVOICE_SYNC] âœ… Successfully synced invoice ${invoiceId}`);

        return {
            success: true,
            invoice: {
                invoiceNumber: invoice.invoice_number,
                total: invoice.total,
                status: invoice.status,
                updatedItems: invoice.line_items.length
            }
        };

    } catch (error) {
        console.error('[ZOHO_INVOICE_SYNC] Error:', error.message);
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Sync all invoices for a tenant from Zoho
 * @param {string} tenantId - The tenant ID
 * @param {number} days - Number of days to look back (default: 30)
 */
async function syncAllInvoicesFromZoho(tenantId, days = 30) {
    try {
        console.log(`[ZOHO_INVOICE_SYNC] Syncing all invoices for tenant ${tenantId} (last ${days} days)`);

        const { accessToken, organizationId } = await zohoTenantAuth.getValidAccessToken(tenantId);

        // Calculate date range
        const fromDate = new Date();
        fromDate.setDate(fromDate.getDate() - days);
        const dateStr = fromDate.toISOString().split('T')[0];

        // Fetch invoices from Zoho
        const response = await fetch(
            `https://www.zohoapis.in/books/v3/invoices?organization_id=${organizationId}&date_start=${dateStr}&per_page=200`,
            {
                method: 'GET',
                headers: {
                    'Authorization': `Zoho-oauthtoken ${accessToken}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        const data = await response.json();

        if (!response.ok) {
            throw new Error(`Zoho API error: ${data.message}`);
        }

        const invoices = data.invoices || [];
        console.log(`[ZOHO_INVOICE_SYNC] Found ${invoices.length} invoices to sync`);

        let syncedCount = 0;
        let errorCount = 0;

        for (const invoice of invoices) {
            const result = await syncInvoiceFromZoho(tenantId, invoice.invoice_id);
            if (result.success) {
                syncedCount++;
            } else {
                errorCount++;
            }
        }

        return {
            success: true,
            totalInvoices: invoices.length,
            synced: syncedCount,
            errors: errorCount
        };

    } catch (error) {
        console.error('[ZOHO_INVOICE_SYNC] Error syncing all invoices:', error.message);
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Webhook handler for Zoho invoice updates
 * Call this when Zoho sends a webhook notification
 */
async function handleZohoInvoiceWebhook(req, res) {
    try {
        const { event_type, invoice_id, organization_id } = req.body;

        console.log(`[ZOHO_WEBHOOK] Received event: ${event_type} for invoice ${invoice_id}`);

        // Find tenant by organization ID
        const { data: tenant } = await dbClient
            .from('tenants')
            .select('id')
            .eq('zoho_organization_id', organization_id)
            .single();

        if (!tenant) {
            console.log(`[ZOHO_WEBHOOK] No tenant found for organization ${organization_id}`);
            return res.status(404).json({ error: 'Tenant not found' });
        }

        // Sync the invoice
        const result = await syncInvoiceFromZoho(tenant.id, invoice_id);

        if (result.success) {
            return res.status(200).json({
                success: true,
                message: 'Invoice synced successfully',
                invoice: result.invoice
            });
        } else {
            return res.status(500).json({
                success: false,
                error: result.error
            });
        }

    } catch (error) {
        console.error('[ZOHO_WEBHOOK] Error:', error.message);
        return res.status(500).json({
            success: false,
            error: error.message
        });
    }
}

module.exports = {
    syncInvoiceFromZoho,
    syncAllInvoicesFromZoho,
    handleZohoInvoiceWebhook
};

