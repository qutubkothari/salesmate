// services/zohoSalesOrderService.js - Complete Sales Order Management
const { dbClient } = require('./config');
const fetch = require('node-fetch');

/**
 * ZOHO Sales Order Configuration - FIXED FOR BOOKS API
 */
const ZOHO_CONFIG = {
    apiUrl: 'https://www.zohoapis.in/books/v3',
    clientId: process.env.ZOHO_CLIENT_ID,
    clientSecret: process.env.ZOHO_CLIENT_SECRET,
    refreshToken: process.env.ZOHO_REFRESH_TOKEN,
    organizationId: process.env.ZOHO_ORGANIZATION_ID,
    scope: 'ZohoBooks.fullaccess.all'
};

/**
 * Get fresh Zoho access token
 */
const getZohoAccessToken = async () => {
    try {
        const response = await fetch('https://accounts.zoho.in/oauth/v2/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: new URLSearchParams({
                refresh_token: ZOHO_CONFIG.refreshToken,
                client_id: ZOHO_CONFIG.clientId,
                client_secret: ZOHO_CONFIG.clientSecret,
                grant_type: 'refresh_token'
            })
        });

        const data = await response.json();
        
        if (data.access_token) {
            console.log('[ZOHO_AUTH] Access token refreshed successfully');
            return data.access_token;
        } else {
            throw new Error(`Token refresh failed: ${JSON.stringify(data)}`);
        }
    } catch (error) {
        console.error('[ZOHO_AUTH] Error refreshing token:', error.message);
        throw error;
    }
};

/**
 * Find or create customer in Zoho Books - FIXED API ENDPOINTS
 */
const findOrCreateZohoCustomer = async (tenantId, endUserPhone) => {
    try {
        console.log('[ZOHO_CUSTOMER] Finding customer for:', endUserPhone);

        // Ensure customer profile exists and is populated
        const { data: existingProfile } = await dbClient
            .from('customer_profiles_new')
            .select('*')
            .eq('tenant_id', tenantId)
            .eq('phone', endUserPhone)
            .single();

        if (!existingProfile || !existingProfile.first_name) {
            await dbClient
                .from('customer_profiles_new')
                .upsert({
                    tenant_id: tenantId,
                    phone: endUserPhone,
                    first_name: existingProfile?.first_name || 'Customer',
                    last_name: existingProfile?.last_name || endUserPhone.replace('@c.us', '').slice(-4),
                    company: existingProfile?.company || 'WhatsApp Customer',
                    created_at: new Date().toISOString()
                });
        }

        // Get (now guaranteed) customer profile
        const { data: customerProfile } = await dbClient
            .from('customer_profiles_new')
            .select('*')
            .eq('tenant_id', tenantId)
            .eq('phone', endUserPhone)
            .single();

        if (!customerProfile) {
            console.warn('[ZOHO_CUSTOMER] No customer profile found');
            return null;
        }

        const accessToken = await getZohoAccessToken();

        // Search for existing contact in Zoho
        let zohoCustomer = null;
        if (customerProfile.company) {
            console.log('[ZOHO_CUSTOMER] Searching by company name:', customerProfile.company);
            const companySearchResponse = await fetch(
                `${ZOHO_CONFIG.apiUrl}/contacts?company_name=${encodeURIComponent(customerProfile.company)}&organization_id=${ZOHO_CONFIG.organizationId}`,
                {
                    headers: {
                        'Authorization': `Zoho-oauthtoken ${accessToken}`,
                        'Content-Type': 'application/json'
                    }
                }
            );
            const companySearchData = await companySearchResponse.json();
            if (companySearchData.contacts && companySearchData.contacts.length > 0) {
                zohoCustomer = companySearchData.contacts[0];
                console.log('[ZOHO_CUSTOMER] Found existing company:', zohoCustomer.contact_name);
                return zohoCustomer;
            }
        }

        // Fallback to phone search
        const searchResponse = await fetch(
            `${ZOHO_CONFIG.apiUrl}/contacts?phone=${encodeURIComponent(customerProfile.phone)}&organization_id=${ZOHO_CONFIG.organizationId}`,
            {
                headers: {
                    'Authorization': `Zoho-oauthtoken ${accessToken}`,
                    'Content-Type': 'application/json'
                }
            }
        );
        
        if (searchResponse.ok) {
            const searchData = await searchResponse.json();
            if (searchData.contacts && searchData.contacts.length > 0) {
                zohoCustomer = searchData.contacts[0];
                console.log('[ZOHO_CUSTOMER] Found existing customer:', zohoCustomer.contact_id);

                // Update existing contact with better data if needed
                const shouldUpdate = zohoCustomer.contact_name === customerProfile.phone ||
                    zohoCustomer.contact_name.includes('@c.us') ||
                    !zohoCustomer.company_name;
                    
                if (shouldUpdate && (customerProfile.first_name || customerProfile.company)) {
                    console.log('[ZOHO_CUSTOMER] Updating existing contact with better data');
                    const updateData = {
                        contact_name: customerProfile.company ||
                            `${customerProfile.first_name || 'Customer'} ${customerProfile.last_name || ''}`.trim(),
                        company_name: customerProfile.company || 'Individual Customer'
                    };
                    
                    const updateResponse = await fetch(
                        `${ZOHO_CONFIG.apiUrl}/contacts/${zohoCustomer.contact_id}?organization_id=${ZOHO_CONFIG.organizationId}`,
                        {
                            method: 'PUT',
                            headers: {
                                'Authorization': `Zoho-oauthtoken ${accessToken}`,
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify(updateData)
                        }
                    );
                    
                    if (updateResponse.ok) {
                        console.log('[ZOHO_CUSTOMER] Contact updated successfully');
                    }
                }

                // Return the COMPLETE contact data
                return {
                    id: zohoCustomer.contact_id,
                    contact_id: zohoCustomer.contact_id,
                    contact_name: zohoCustomer.contact_name,
                    company_name: zohoCustomer.company_name,
                    gst_no: zohoCustomer.gst_no,
                    contact_persons: zohoCustomer.contact_persons,
                    billing_address: zohoCustomer.billing_address,
                    ...zohoCustomer
                };
            }
        }

        // Create new contact if not found
        if (!zohoCustomer) {
            console.log('[ZOHO_CUSTOMER] Creating new customer in Zoho');
            
            const contactData = {
                contact_name: customerProfile.company || 
                    (customerProfile.first_name && customerProfile.last_name ? 
                        `${customerProfile.first_name} ${customerProfile.last_name}` : 
                        `Customer ${customerProfile.phone.replace('@c.us', '').slice(-4)}`),
                company_name: customerProfile.company || 'Individual Customer',
                contact_type: 'customer',
                customer_sub_type: customerProfile.company ? 'business' : 'individual',
                gst_no: customerProfile.gst_number || '',
                gst_treatment: customerProfile.gst_number ? 'business_gst' : 'consumer',
                place_of_supply: customerProfile.place_of_supply || 'MH',
                contact_persons: [{
                    first_name: customerProfile.first_name || 'Customer',
                    last_name: customerProfile.last_name || customerProfile.phone.replace('@c.us', '').slice(-4),
                    email: customerProfile.email || '',
                    mobile: customerProfile.phone.replace('@c.us', ''),
                    phone: customerProfile.phone.replace('@c.us', ''),
                    is_primary_contact: true
                }],
                billing_address: {
                    address: customerProfile.business_address || customerProfile.address || 'Address not provided',
                    city: customerProfile.city || '',
                    state: customerProfile.state || 'Maharashtra',
                    zip: customerProfile.pincode || '',
                    country: 'India'
                },
                notes: `WhatsApp Customer\nPhone: ${customerProfile.phone.replace('@c.us', '')}\nCreated: ${new Date().toLocaleDateString()}`
            };

            const createResponse = await fetch(`${ZOHO_CONFIG.apiUrl}/contacts?organization_id=${ZOHO_CONFIG.organizationId}`, {
                method: 'POST',
                headers: {
                    'Authorization': `Zoho-oauthtoken ${accessToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(contactData)
            });

            const createData = await createResponse.json();
            
            if (createData.contact) {
                zohoCustomer = createData.contact;
                console.log('[ZOHO_CUSTOMER] Created new customer:', zohoCustomer.contact_id);
            } else {
                throw new Error(`Failed to create customer: ${JSON.stringify(createData)}`);
            }
        }

        return {
            id: zohoCustomer.contact_id,
            contact_id: zohoCustomer.contact_id,
            ...zohoCustomer
        };
        
    } catch (error) {
        console.error('[ZOHO_CUSTOMER] Error:', error.message);
        throw error;
    }
};

/**
 * Create sales order in Zoho Books
 */
const createZohoSalesOrder = async (tenantId, orderId) => {
    try {
        console.log('[ZOHO_ORDER] Creating sales order for order ID:', orderId);
        
        const { data: order, error: orderError } = await dbClient
            .from('orders_new')
            .select(`*, 
                order_items(quantity, price_at_time_of_purchase, unit_price_before_tax, product_id, gst_rate, gst_amount, product:products(id, name, description, price)),
                customer_profiles!customer_profile_id(
                    default_shipping_address,
                    default_shipping_city,
                    default_shipping_state,
                    default_shipping_pincode,
                    default_transporter_name,
                    default_transporter_contact
                )
            `)
            .eq('id', orderId)
            .single();

        if (orderError) {
            console.error('[ZOHO_ORDER] Query error:', orderError);
            throw new Error(`Failed to fetch order: ${orderError.message}`);
        }

        if (!order) {
            console.error('[ZOHO_ORDER] Order not found:', orderId);
            throw new Error(`Order ${orderId} not found`);
        }

        console.log('[ZOHO_ORDER] Order items found:', order.order_items?.length || 0);

        const { data: conversation } = await dbClient
            .from('conversations_new')
            .select('end_user_phone')
            .eq('id', order.conversation_id)
            .single();

        if (!conversation) {
            console.error('[ZOHO_ORDER] Conversation not found for order:', orderId);
            throw new Error(`Conversation not found for order ${orderId}`);
        }

        const zohoCustomer = await findOrCreateZohoCustomer(tenantId, conversation.end_user_phone);
        if (!zohoCustomer) {
            throw new Error('Failed to find or create customer in Zoho');
        }

        const accessToken = await getZohoAccessToken();

        const contactResponse = await fetch(
            `${ZOHO_CONFIG.apiUrl}/contacts/${zohoCustomer.contact_id}?organization_id=${ZOHO_CONFIG.organizationId}`,
            {
                headers: {
                    'Authorization': `Zoho-oauthtoken ${accessToken}`,
                    'Content-Type': 'application/json'
                }
            }
        );
        const contactData = await contactResponse.json();

        const orderDate = new Date().toISOString().split('T')[0];
        const dueDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

        const lineItems = order.order_items.map((item) => ({
            name: item.product.name,
            description: item.product.description || item.product.name,
            rate: parseFloat(item.price_at_time_of_purchase), // Use discounted price from order
            quantity: item.quantity,
            discount: 0, // No additional discount needed - price is already discounted
            tax_id: null
        }));

        // Add shipping charges as a line item if present (so GST is calculated on it)
        if (order.shipping_charges && parseFloat(order.shipping_charges) > 0) {
            console.log('[ZOHO_ORDER] Adding shipping charges as line item:', order.shipping_charges);
            lineItems.push({
                name: 'Shipping & Handling Charges',
                description: 'Freight and delivery charges',
                rate: parseFloat(order.shipping_charges),
                quantity: 1,
                discount: 0,
                tax_id: null // GST will be applied same as other items
            });
        }

        if (!lineItems || lineItems.length === 0) {
            throw new Error('No line items found for this order');
        }

        const validLineItems = lineItems.filter(item => 
            item.name && item.rate && item.quantity
        );
        
        if (validLineItems.length === 0) {
            throw new Error('No valid line items found');
        }

        // Build comprehensive notes with shipping and transport details
        let orderNotes = `Order created via WhatsApp Sales Assistant\nOriginal Order ID: ${order.id}\nGST Rate: ${order.gst_rate}%`;
        
        // Add volume discount info if applicable
        if (order.volume_discount_percent && order.volume_discount_percent > 0) {
            orderNotes += `\n\n💰 Volume Discount Applied: ${order.volume_discount_percent}%`;
            orderNotes += `\nDiscount Amount: ₹${(order.volume_discount_amount || 0).toLocaleString()}`;
            orderNotes += `\n(Prices shown are already discounted)`;
        }
        
        // Add manual discount if any
        if (order.discount_amount) {
            orderNotes += `\n${order.volume_discount_percent ? 'Additional ' : ''}Manual Discount: ₹${order.discount_amount.toLocaleString()}`;
        }
        
        // Add shipping address if available
        const shippingAddress = order.shipping_address || order.customer_profiles?.default_shipping_address;
        const shippingCity = order.shipping_city || order.customer_profiles?.default_shipping_city;
        const shippingState = order.shipping_state || order.customer_profiles?.default_shipping_state;
        const shippingPincode = order.shipping_pincode || order.customer_profiles?.default_shipping_pincode;
        const transporterName = order.transporter_name || order.customer_profiles?.default_transporter_name;
        const transporterContact = order.transporter_contact || order.customer_profiles?.default_transporter_contact;
        
        if (shippingAddress || transporterName) {
            orderNotes += '\n\n🚚 SHIPPING & TRANSPORT DETAILS:\n━━━━━━━━━━━━━━━━━━━━━━━━━━';
            
            if (shippingAddress) {
                orderNotes += `\n📍 Shipping Address:\n${shippingAddress}`;
                if (shippingCity) orderNotes += `\n🏙️ City: ${shippingCity}`;
                if (shippingState) orderNotes += `\n📍 State: ${shippingState}`;
                if (shippingPincode) orderNotes += `\n📮 Pincode: ${shippingPincode}`;
            }
            
            if (transporterName) {
                orderNotes += `\n\n🚛 Transporter: ${transporterName}`;
                if (transporterContact) orderNotes += `\n📞 Contact: ${transporterContact}`;
            }
            
            orderNotes += '\n━━━━━━━━━━━━━━━━━━━━━━━━━━';
        }

        const salesOrderData = {
            customer_id: zohoCustomer.contact_id,
            date: orderDate,
            shipment_date: dueDate,
            line_items: validLineItems,
            notes: orderNotes,
            terms: 'Payment due within 7 days'
            // NOTE: Shipping charges added as line item above (so GST applies)
            // NOTE: Discount already applied to line item rates - no order-level discount needed
        };

        const response = await fetch(`${ZOHO_CONFIG.apiUrl}/salesorders?organization_id=${ZOHO_CONFIG.organizationId}`, {
            method: 'POST',
            headers: {
                'Authorization': `Zoho-oauthtoken ${accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(salesOrderData)
        });

        const responseData = await response.json();


        if (responseData.salesorder) {

            const zohoOrderId = responseData.salesorder.salesorder_id;
            const contactName = contactData.contact?.contact_name || contactData.contact?.company_name || conversation.end_user_phone;
            const contactMobile = contactData.contact?.mobile || conversation.end_user_phone;

            const shippingAddressObj = contactData.contact?.shipping_address || contactData.contact?.billing_address || {};
            const shippingAddress = [
                shippingAddressObj.address,
                shippingAddressObj.city,
                shippingAddressObj.state,
                shippingAddressObj.zip,
                shippingAddressObj.country
            ].filter(Boolean).join(', ');

            // Update order_items with zoho_item_id from Zoho response
            if (responseData.salesorder.line_items && responseData.salesorder.line_items.length > 0) {
                console.log('[ZOHO_ORDER] Updating order_items with zoho_item_id from response');
                for (let i = 0; i < order.order_items.length; i++) {
                    const localItem = order.order_items[i];
                    const zohoLineItem = responseData.salesorder.line_items[i];
                    
                    if (zohoLineItem && zohoLineItem.line_item_id) {
                        await dbClient
                            .from('order_items')
                            .update({ zoho_item_id: zohoLineItem.line_item_id })
                            .eq('order_id', orderId)
                            .eq('product_id', localItem.product.id);
                        
                        console.log(`[ZOHO_ORDER] Updated order_item with zoho_item_id: ${zohoLineItem.line_item_id}`);
                    }
                }
            }

            // ===== NEW: Convert Sales Order to Invoice =====
            const { convertSalesOrderToInvoice } = require('./zohoInvoiceService');
            let zohoInvoiceId = null;
            try {
                console.log('[ZOHO_INVOICE] Converting sales order to invoice:', zohoOrderId);
                const invoiceResult = await convertSalesOrderToInvoice(tenantId, zohoOrderId);
                if (invoiceResult.success) {
                    zohoInvoiceId = invoiceResult.invoiceId;
                    console.log('[ZOHO_INVOICE] Invoice created successfully:', zohoInvoiceId);
                } else {
                    console.warn('[ZOHO_INVOICE] Invoice creation failed:', invoiceResult.error);
                }
            } catch (invoiceError) {
                console.error('[ZOHO_INVOICE] Error creating invoice:', invoiceError.message);
            }
            // ===== END NEW CODE =====

            console.log('[ZOHO_ORDER][DEBUG] About to update local order:', {
                orderId,
                zoho_sales_order_id: zohoOrderId,
                zoho_invoice_id: zohoInvoiceId,
                zoho_customer_id: zohoCustomer.contact_id,
                customer_name: contactName,
                shipping_address: shippingAddress
            });

            const { error: updateError, data: updateData } = await dbClient
                .from('orders_new')
                .update({
                    zoho_sales_order_id: zohoOrderId,
                    zoho_invoice_id: zohoInvoiceId,
                    zoho_customer_id: zohoCustomer.contact_id,
                    customer_name: contactName,
                    shipping_address: shippingAddress,
                    zoho_sync_status: 'synced',
                    zoho_synced_at: new Date().toISOString()
                })
                .eq('id', orderId)
                .select();

            if (updateError) {
                console.error('[ZOHO_ORDER][DEBUG] Failed to update order:', updateError.message);
            } else {
                console.log('[ZOHO_ORDER][DEBUG] Update result:', updateData);
            }

            const pdfResult = await getZohoSalesOrderPDF(zohoOrderId);
            
            if (pdfResult.success) {
                return {
                    success: true,
                    zohoOrderId: zohoOrderId,
                    zohoCustomerId: zohoCustomer.contact_id,
                    pdfBuffer: pdfResult.pdfBuffer,
                    filename: pdfResult.filename,
                    message: 'Sales order created successfully in Zoho Books'
                };
            } else {
                return {
                    success: true,
                    zohoOrderId: zohoOrderId,
                    zohoCustomerId: zohoCustomer.contact_id,
                    message: 'Sales order created successfully (PDF generation failed)'
                };
            }
        } else {
            throw new Error(`Zoho API error: ${JSON.stringify(responseData)}`);
        }

    } catch (error) {
        console.error('[ZOHO_ORDER] Error:', error.message);
        
        await dbClient
            .from('orders_new')
            .update({
                zoho_sync_status: 'failed',
                zoho_sync_error: error.message,
                zoho_synced_at: new Date().toISOString()
            })
            .eq('id', orderId);
            
        return {
            success: false,
            error: error.message,
            orderId
        };
    }
};

/**
 * Process complete order to Zoho and get PDF
 */
const processOrderToZoho = async (tenantId, orderId) => {
    try {
        console.log('[ZOHO_PROCESS] Processing complete order to Zoho:', orderId);
        
        const orderResult = await createZohoSalesOrder(tenantId, orderId);
        
        if (!orderResult.success) {
            return orderResult;
        }

        const pdfResult = await getZohoSalesOrderPDF(orderResult.zohoOrderId);
        
        if (!pdfResult.success) {
            return {
                success: false,
                error: 'Sales order created but PDF generation failed',
                zohoOrderId: orderResult.zohoOrderId
            };
        }

        return {
            success: true,
            zohoOrderId: orderResult.zohoOrderId,
            zohoCustomerId: orderResult.zohoCustomerId,
            pdfBuffer: pdfResult.pdfBuffer,
            filename: pdfResult.filename,
            message: 'Order processed successfully and PDF generated'
        };
        
    } catch (error) {
        console.error('[ZOHO_PROCESS] Error processing order:', error.message);
        return {
            success: false,
            error: error.message
        };
    }
};

/**
 * Update order status in Zoho Books
 */
const updateZohoOrderStatus = async (zohoOrderId, status) => {
    try {
        const accessToken = await getZohoAccessToken();
        
        const updateData = {
            status: status
        };

        const response = await fetch(`${ZOHO_CONFIG.apiUrl}/salesorders/${zohoOrderId}?organization_id=${ZOHO_CONFIG.organizationId}`, {
            method: 'PUT',
            headers: {
                'Authorization': `Zoho-oauthtoken ${accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(updateData)
        });

        const responseData = await response.json();
        
        if (responseData.salesorder) {
            console.log('[ZOHO_UPDATE] Order status updated:', zohoOrderId, status);
            return { success: true };
        } else {
            throw new Error(`Status update failed: ${JSON.stringify(responseData)}`);
        }
        
    } catch (error) {
        console.error('[ZOHO_UPDATE] Error updating status:', error.message);
        return { success: false, error: error.message };
    }
};

/**
 * Download Zoho Sales Order PDF
 */
const getZohoSalesOrderPDF = async (zohoOrderId) => {
    try {
        const accessToken = await getZohoAccessToken();
        const url = `${ZOHO_CONFIG.apiUrl}/salesorders/${zohoOrderId}?accept=pdf&organization_id=${ZOHO_CONFIG.organizationId}`;
        
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Authorization': `Zoho-oauthtoken ${accessToken}`,
                'Accept': 'application/pdf'
            }
        });
        
        if (!response.ok) {
            const errorData = await response.text();
            throw new Error(`Failed to generate PDF: ${response.statusText} - ${errorData}`);
        }
        
        const pdfBuffer = await response.buffer();
        const filename = `salesorder_${zohoOrderId}_${Date.now()}.pdf`;
        
        return {
            success: true,
            pdfBuffer,
            filename
        };
    } catch (error) {
        console.error('[ZOHO_PDF] Error generating PDF:', error.message);
        return {
            success: false,
            error: error.message
        };
    }
};

/**
 * Update Zoho Sales Order with notes (shipping details)
 */
const updateSalesOrderNotes = async (tenantId, zohoSalesOrderId, notes) => {
    try {
        console.log(`[ZOHO_NOTES] Updating sales order ${zohoSalesOrderId} with shipping details`);

        const accessToken = await getZohoAccessToken();
        
        // Get current sales order
        const getResponse = await fetch(
            `${ZOHO_CONFIG.apiUrl}/salesorders/${zohoSalesOrderId}?organization_id=${ZOHO_CONFIG.organizationId}`,
            {
                method: 'GET',
                headers: {
                    'Authorization': `Zoho-oauthtoken ${accessToken}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        const currentData = await getResponse.json();
        
        if (!currentData.salesorder) {
            throw new Error('Sales order not found in Zoho');
        }

        const existingNotes = currentData.salesorder.notes || '';
        
        // Append new notes (don't overwrite existing)
        const updatedNotes = existingNotes 
            ? `${existingNotes}\n\n---\n\n${notes}`
            : notes;

        // Update sales order with notes
        const updateResponse = await fetch(
            `${ZOHO_CONFIG.apiUrl}/salesorders/${zohoSalesOrderId}?organization_id=${ZOHO_CONFIG.organizationId}`,
            {
                method: 'PUT',
                headers: {
                    'Authorization': `Zoho-oauthtoken ${accessToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    notes: updatedNotes
                })
            }
        );

        const responseData = await updateResponse.json();
        
        if (responseData.salesorder) {
            console.log(`[ZOHO_NOTES] Sales order updated successfully`);
            
            // Also update invoice if it exists
            if (currentData.salesorder.invoices && currentData.salesorder.invoices.length > 0) {
                for (const invoice of currentData.salesorder.invoices) {
                    await updateInvoiceNotes(tenantId, invoice.invoice_id, notes);
                }
            }
            
            return { success: true };
        } else {
            throw new Error(`Notes update failed: ${JSON.stringify(responseData)}`);
        }
        
    } catch (error) {
        console.error('[ZOHO_NOTES] Error updating notes:', error.message);
        return { success: false, error: error.message };
    }
};

/**
 * Update Zoho Invoice with notes (shipping details)
 */
const updateInvoiceNotes = async (tenantId, zohoInvoiceId, notes) => {
    try {
        console.log(`[ZOHO_NOTES] Updating invoice ${zohoInvoiceId} with shipping details`);

        const accessToken = await getZohoAccessToken();
        
        // Get current invoice
        const getResponse = await fetch(
            `${ZOHO_CONFIG.apiUrl}/invoices/${zohoInvoiceId}?organization_id=${ZOHO_CONFIG.organizationId}`,
            {
                method: 'GET',
                headers: {
                    'Authorization': `Zoho-oauthtoken ${accessToken}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        const currentData = await getResponse.json();
        
        if (!currentData.invoice) {
            console.warn('[ZOHO_NOTES] Invoice not found in Zoho');
            return { success: false, error: 'Invoice not found' };
        }

        const existingNotes = currentData.invoice.notes || '';
        
        // Append new notes
        const updatedNotes = existingNotes 
            ? `${existingNotes}\n\n---\n\n${notes}`
            : notes;

        // Update invoice with notes
        const updateResponse = await fetch(
            `${ZOHO_CONFIG.apiUrl}/invoices/${zohoInvoiceId}?organization_id=${ZOHO_CONFIG.organizationId}`,
            {
                method: 'PUT',
                headers: {
                    'Authorization': `Zoho-oauthtoken ${accessToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    notes: updatedNotes
                })
            }
        );

        const responseData = await updateResponse.json();
        
        if (responseData.invoice) {
            console.log(`[ZOHO_NOTES] Invoice updated successfully`);
            return { success: true };
        } else {
            throw new Error(`Invoice notes update failed: ${JSON.stringify(responseData)}`);
        }
        
    } catch (error) {
        console.error('[ZOHO_NOTES] Error updating invoice notes:', error.message);
        return { success: false, error: error.message };
    }
};

module.exports = {
    createZohoSalesOrder,
    getZohoSalesOrderPDF,
    processOrderToZoho,
    findOrCreateZohoCustomer,
    updateZohoOrderStatus,
    getZohoAccessToken,
    updateSalesOrderNotes,
    updateInvoiceNotes
};


