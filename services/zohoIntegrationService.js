// services/zohoIntegrationService.js - Updated for Tenant-Based Authentication
const fetch = require('node-fetch');
const zohoTenantAuth = require('./zohoTenantAuthService');

class ZohoIntegrationService {
    constructor() {
        this.apiUrl = 'https://www.zohoapis.in';
        this.accountsUrl = 'https://accounts.zoho.in';
    }

    /**
     * Make authenticated API request to Zoho Books for a specific tenant
     */
    async makeRequest(tenantId, endpoint, method = 'GET', data = null) {
        try {
            // Get valid access token for the tenant
            const { accessToken, organizationId } = await zohoTenantAuth.getValidAccessToken(tenantId);

            // Build URL with organization parameter
            const url = `${this.apiUrl}/books/v3/${endpoint}${endpoint.includes('?') ? '&' : '?'}organization_id=${organizationId}`;

            const options = {
                method,
                headers: {
                    'Authorization': `Zoho-oauthtoken ${accessToken}`,
                    'Content-Type': 'application/json'
                }
            };

            if (data && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
                options.body = JSON.stringify(data);
            }

            console.log(`[ZOHO_API] ${method} ${url} (Tenant: ${tenantId})`);
            
            const response = await fetch(url, options);
            const status = response.status;
            const raw = await response.text();

            let parsed = null;
            try { 
                parsed = JSON.parse(raw); 
            } catch (e) { 
                parsed = null; 
            }

            if (!response.ok) {
                console.error(`[ZOHO_API] HTTP ${status} - ${raw}`);
                
                // Handle specific authorization errors
                if (status === 401 || (parsed && parsed.code === 57)) {
                    throw new Error(`Authorization failed for tenant ${tenantId}. Please re-authorize with Zoho.`);
                }
                
                return { 
                    success: false, 
                    status, 
                    error: `HTTP ${status}: ${raw}`, 
                    raw, 
                    data: parsed 
                };
            }

            // Zoho success responses
            if (parsed && (parsed.code === 0 || parsed.code === '0' || parsed.code === 'SUCCESS')) {
                return { success: true, data: parsed };
            }

            // Handle successful responses with different structures
            if (parsed && (parsed.contact || parsed.contacts || parsed.item || parsed.items || 
                          parsed.salesorder || parsed.invoice || parsed.organization)) {
                return { success: true, data: parsed };
            }

            console.error('[ZOHO_API] Unexpected response:', { status, parsed });
            return {
                success: false,
                status,
                error: parsed?.message || parsed?.error || 'Unexpected response format',
                data: parsed,
                raw
            };

        } catch (error) {
            console.error('[ZOHO_API] Request error:', error);
            
            // Re-throw authorization errors
            if (error.message.includes('Authorization failed') || error.message.includes('not authorized')) {
                throw error;
            }
            
            return { 
                success: false, 
                error: error.message || String(error) 
            };
        }
    }

    /**
     * Create or update customer in Zoho Books for a tenant
     */
    async syncCustomer(tenantId, customerData) {
        try {
            console.log('[ZOHO_CUSTOMER] Syncing customer for tenant:', tenantId);
            console.log('[ZOHO_CUSTOMER] Customer:', customerData.display_name || customerData.company_name || customerData.phone);

            let existingCustomer = null;

            // Check if customer exists by GST number
            if (customerData.gst_no) {
                const searchResult = await this.makeRequest(
                    tenantId,
                    `contacts?gst_no=${encodeURIComponent(customerData.gst_no)}`
                );

                if (searchResult.success && searchResult.data?.contacts?.length > 0) {
                    existingCustomer = searchResult.data.contacts[0];
                    console.log('[ZOHO_CUSTOMER] Found existing customer by GST:', existingCustomer.contact_id);
                }
            }

            // Build customer payload
            const payload = {
                contact_name: customerData.display_name || customerData.company_name || 
                             (customerData.first_name ? `${customerData.first_name} ${customerData.last_name || ''}`.trim() : 'Contact'),
                company_name: customerData.company_name || customerData.display_name || undefined,
                contact_type: 'customer',
                customer_sub_type: 'business',
                gst_no: customerData.gst_no || undefined,
                gst_treatment: (() => {
                    if (customerData.gst_no && String(customerData.gst_no).trim()) return 'business_gst';
                    if (customerData.country && String(customerData.country).toLowerCase() !== 'india') return 'overseas';
                    if (customerData.is_consumer === true || customerData.type === 'consumer') return 'consumer';
                    return 'business_none';
                })(),
                place_of_supply: customerData.place_of_supply || 'MH',
                contact_persons: Array.isArray(customerData.contact_persons) ? customerData.contact_persons : [],
                billing_address: customerData.billing_address || {},
                shipping_address: customerData.shipping_address || {},
                notes: customerData.notes || ''
            };

            // Add phone as primary contact person if provided
            if (customerData.phone) {
                payload.contact_persons.unshift({
                    first_name: customerData.first_name || 'Contact',
                    last_name: customerData.last_name || 'Person',
                    mobile: customerData.phone,
                    is_primary_contact: true
                });
            }

            let result;
            if (existingCustomer?.contact_id) {
                // Update existing customer
                result = await this.makeRequest(tenantId, `contacts/${existingCustomer.contact_id}`, 'PUT', payload);
                if (!result.success) {
                    return { 
                        success: false, 
                        error: result.error || 'Failed to update contact',
                        tenantId 
                    };
                }
                return { 
                    success: true, 
                    customerId: existingCustomer.contact_id, 
                    action: 'updated',
                    tenantId,
                    data: result.data 
                };
            } else {
                // Create new customer
                result = await this.makeRequest(tenantId, 'contacts', 'POST', payload);
                if (!result.success) {
                    return { 
                        success: false, 
                        error: result.error || 'Failed to create contact',
                        tenantId 
                    };
                }

                const contactId = result.data?.contact?.contact_id || 
                                result.data?.contacts?.[0]?.contact_id || 
                                result.data?.data?.contact_id;

                return { 
                    success: true, 
                    customerId: contactId, 
                    action: 'created',
                    tenantId,
                    data: result.data 
                };
            }
        } catch (error) {
            console.error('[ZOHO_CUSTOMER] Error:', error);
            return { 
                success: false, 
                error: error.message || String(error),
                tenantId 
            };
        }
    }

    /**
     * Create sales order in Zoho Books for a tenant
     */
    async createSalesOrder(tenantId, orderData) {
        try {
            console.log('[ZOHO_SALES_ORDER] Creating for tenant:', tenantId);
            console.log('[ZOHO_SALES_ORDER] Customer ID:', orderData.customer_id);

            const lineItems = orderData.line_items.map(item => ({
                item_id: item.item_id,
                name: item.name,
                description: item.description || '',
                rate: item.rate,
                quantity: item.quantity,
                discount: item.discount || 0,
                tax_id: item.tax_id || null
            }));

            // Add shipping charges as line item if present (so GST is calculated)
            if (orderData.shipping_charge && parseFloat(orderData.shipping_charge) > 0) {
                console.log('[ZOHO_SALES_ORDER] Adding shipping as line item:', orderData.shipping_charge);
                lineItems.push({
                    name: 'Shipping & Handling Charges',
                    description: 'Freight and delivery charges',
                    rate: parseFloat(orderData.shipping_charge),
                    quantity: 1,
                    discount: 0,
                    tax_id: null
                });
            }

            const payload = {
                customer_id: orderData.customer_id,
                salesorder_number: orderData.order_number,
                date: orderData.date || new Date().toISOString().split('T')[0],
                shipment_date: orderData.shipment_date,
                line_items: lineItems,
                notes: orderData.notes || '',
                terms: orderData.terms || '',
                adjustment: orderData.adjustment || 0,
                adjustment_description: orderData.adjustment_description || ''
            };

            const result = await this.makeRequest(tenantId, 'salesorders', 'POST', payload);

            return {
                success: result.success,
                salesOrderId: result.data?.salesorder?.salesorder_id,
                salesOrderNumber: result.data?.salesorder?.salesorder_number,
                tenantId,
                data: result.data,
                error: result.error
            };
        } catch (error) {
            console.error('[ZOHO_SALES_ORDER] Error:', error);
            return {
                success: false,
                error: error.message || String(error),
                tenantId
            };
        }
    }

    /**
     * Create invoice in Zoho Books for a tenant
     */
    async createInvoice(tenantId, invoiceData) {
        try {
            console.log('[ZOHO_INVOICE] Creating for tenant:', tenantId);
            console.log('[ZOHO_INVOICE] Customer ID:', invoiceData.customer_id);

            const payload = {
                customer_id: invoiceData.customer_id,
                invoice_number: invoiceData.invoice_number,
                date: invoiceData.date || new Date().toISOString().split('T')[0],
                due_date: invoiceData.due_date,
                payment_terms: invoiceData.payment_terms || 0,
                payment_terms_label: invoiceData.payment_terms_label || 'Due on Receipt',
                line_items: invoiceData.line_items.map(item => ({
                    item_id: item.item_id,
                    name: item.name,
                    description: item.description || '',
                    rate: item.rate,
                    quantity: item.quantity,
                    discount: item.discount || 0,
                    tax_id: item.tax_id || null
                })),
                notes: invoiceData.notes || '',
                terms: invoiceData.terms || '',
                shipping_charge: invoiceData.shipping_charge || 0,
                adjustment: invoiceData.adjustment || 0,
                adjustment_description: invoiceData.adjustment_description || ''
            };

            const result = await this.makeRequest(tenantId, 'invoices', 'POST', payload);

            return {
                success: result.success,
                invoiceId: result.data?.invoice?.invoice_id,
                invoiceNumber: result.data?.invoice?.invoice_number,
                tenantId,
                data: result.data,
                error: result.error
            };
        } catch (error) {
            console.error('[ZOHO_INVOICE] Error:', error);
            return {
                success: false,
                error: error.message || String(error),
                tenantId
            };
        }
    }

    /**
     * Sync product with Zoho Books for a tenant
     */
    async syncProduct(tenantId, productData) {
        try {
            console.log('[ZOHO_PRODUCT] Syncing for tenant:', tenantId);
            console.log('[ZOHO_PRODUCT] Product:', productData.name);

            let existingItem = null;

            // Search for existing item by SKU
            if (productData.sku) {
                const searchResult = await this.makeRequest(
                    tenantId,
                    `items?sku=${encodeURIComponent(productData.sku)}`
                );

                if (searchResult.success && searchResult.data?.items?.length > 0) {
                    existingItem = searchResult.data.items[0];
                }
            }

            const payload = {
                name: productData.name,
                sku: productData.sku,
                description: productData.description || '',
                rate: productData.rate,
                tax_id: productData.tax_id || null,
                item_type: 'sales',
                product_type: 'goods',
                is_taxable: productData.is_taxable !== false,
                tax_exemption_code: productData.tax_exemption_code || null,
                hsn_or_sac: productData.hsn_code || null
            };

            let result;
            if (existingItem) {
                result = await this.makeRequest(
                    tenantId,
                    `items/${existingItem.item_id}`,
                    'PUT',
                    payload
                );

                return {
                    success: result.success,
                    itemId: existingItem.item_id,
                    action: 'updated',
                    tenantId,
                    data: result.data,
                    error: result.error
                };
            } else {
                result = await this.makeRequest(tenantId, 'items', 'POST', payload);

                return {
                    success: result.success,
                    itemId: result.data?.item?.item_id,
                    action: 'created',
                    tenantId,
                    data: result.data,
                    error: result.error
                };
            }
        } catch (error) {
            console.error('[ZOHO_PRODUCT] Error:', error);
            return {
                success: false,
                error: error.message || String(error),
                tenantId
            };
        }
    }

    /**
     * Get items from Zoho Books for a tenant
     */
    async getItems(tenantId) {
        try {
            const result = await this.makeRequest(tenantId, 'items?per_page=200');
            return result;
        } catch (error) {
            console.error('[ZOHO_ITEMS] Error:', error);
            return {
                success: false,
                error: error.message || String(error),
                tenantId
            };
        }
    }

    /**
     * Get PDF for sales order or invoice
     */
    async getPDF(tenantId, documentType, documentId) {
        try {
            const { accessToken, organizationId } = await zohoTenantAuth.getValidAccessToken(tenantId);
            
            const url = `${this.apiUrl}/books/v3/${documentType}/${documentId}?organization_id=${organizationId}&accept=pdf`;
            
            const response = await fetch(url, {
                headers: {
                    'Authorization': `Zoho-oauthtoken ${accessToken}`,
                    'Accept': 'application/pdf'
                }
            });

            if (response.ok) {
                const pdfBuffer = await response.buffer();
                return {
                    success: true,
                    pdfBuffer: pdfBuffer,
                    filename: `${documentType}_${documentId}.pdf`,
                    tenantId
                };
            } else {
                throw new Error(`PDF generation failed: ${response.status} ${response.statusText}`);
            }
        } catch (error) {
            console.error('[ZOHO_PDF] Error:', error);
            return {
                success: false,
                error: error.message || String(error),
                tenantId
            };
        }
    }

    /**
     * Get sales order PDF
     */
    async getSalesOrderPDF(tenantId, salesOrderId) {
        return await this.getPDF(tenantId, 'salesorders', salesOrderId);
    }

    /**
     * Get invoice PDF
     */
    async getInvoicePDF(tenantId, invoiceId) {
        return await this.getPDF(tenantId, 'invoices', invoiceId);
    }

    /**
     * Get customer details
     */
    async getCustomer(tenantId, customerId) {
        try {
            const result = await this.makeRequest(tenantId, `contacts/${customerId}`);
            return result;
        } catch (error) {
            console.error('[ZOHO_CUSTOMER_GET] Error:', error);
            return {
                success: false,
                error: error.message || String(error),
                tenantId
            };
        }
    }

    /**
     * Get taxes for a tenant
     */
    async getTaxes(tenantId) {
        try {
            const result = await this.makeRequest(tenantId, 'settings/taxes');
            return result;
        } catch (error) {
            console.error('[ZOHO_TAXES] Error:', error);
            return {
                success: false,
                error: error.message || String(error),
                tenantId
            };
        }
    }

    /**
     * Sync product prices from Zoho to local database
     */
    async syncProductPrices(tenantId) {
        try {
            console.log('[ZOHO_PRICE_SYNC] Starting for tenant:', tenantId);
            
            const itemsResult = await this.makeRequest(tenantId, 'items?per_page=200');
            
            if (!itemsResult.success) {
                throw new Error(`Failed to fetch Zoho items: ${itemsResult.error}`);
            }
            
            const zohoItems = itemsResult.data?.items || [];
            console.log(`[ZOHO_PRICE_SYNC] Found ${zohoItems.length} items in Zoho`);
            
            let syncedCount = 0;
            let errors = [];
            
            const { dbClient } = require('./config');
            
            for (const zohoItem of zohoItems) {
                try {
                    const { data: localProducts, error } = await dbClient
                        .from('products')
                        .select('id, name, price, sku')
                        .eq('tenant_id', tenantId)
                        .or(`name.ilike.%${zohoItem.name}%,sku.eq.${zohoItem.sku || 'NOSKU'}`)
                        .limit(1);
                    
                    if (error) {
                        errors.push(`DB error for ${zohoItem.name}: ${error.message}`);
                        continue;
                    }
                    
                    if (localProducts && localProducts.length > 0) {
                        const localProduct = localProducts[0];
                        
                        if (localProduct.price != zohoItem.rate) {
                            const { error: updateError } = await dbClient
                                .from('products')
                                .update({ 
                                    price: zohoItem.rate,
                                    zoho_item_id: zohoItem.item_id,
                                    updated_at: new Date().toISOString()
                                })
                                .eq('id', localProduct.id);
                            
                            if (updateError) {
                                errors.push(`Update error for ${zohoItem.name}: ${updateError.message}`);
                            } else {
                                console.log(`[ZOHO_PRICE_SYNC] Updated ${localProduct.name}: ₹${localProduct.price} → ₹${zohoItem.rate}`);
                                syncedCount++;
                            }
                        }
                    }
                } catch (itemError) {
                    errors.push(`Error processing ${zohoItem.name}: ${itemError.message}`);
                }
            }
            
            console.log(`[ZOHO_PRICE_SYNC] Complete: ${syncedCount} products updated`);
            
            return {
                success: true,
                syncedCount,
                totalItems: zohoItems.length,
                errors: errors.slice(0, 10),
                tenantId
            };
            
        } catch (error) {
            console.error('[ZOHO_PRICE_SYNC] Error:', error);
            return {
                success: false,
                error: error.message || String(error),
                syncedCount: 0,
                tenantId
            };
        }
    }
}

module.exports = new ZohoIntegrationService();

