// services/zohoInvoiceService.js - Updated for Tenant-Based Authentication
const { dbClient } = require('./config');
const zohoTenantAuth = require('./zohoTenantAuthService');
const fetch = require('node-fetch');

/**
 * Get sales order details from Zoho Books for a specific tenant
 */
const getSalesOrderDetails = async (tenantId, salesOrderId) => {
    try {
        console.log('[ZOHO_SALES_ORDER] Getting details for tenant:', tenantId, 'SO:', salesOrderId);
        
        const { accessToken, organizationId } = await zohoTenantAuth.getValidAccessToken(tenantId);
        const apiUrl = 'https://www.zohoapis.in';
        
        const response = await fetch(
            `${apiUrl}/books/v3/salesorders/${salesOrderId}?organization_id=${organizationId}`,
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
            console.error('[ZOHO_SALES_ORDER] API Error:', data);
            
            // Enhanced error handling for authorization issues
            if (data.code === 57 || /not authorized/i.test(data.message || '')) {
                throw new Error(`Zoho authorization error for tenant ${tenantId}: ${data.message}.\n\nPossible causes:\n- Insufficient permissions for this sales order\n- Token expired or invalid\n- Wrong organization\n\nSolution: Re-authorize Zoho access with full permissions.`);
            }
            
            throw new Error(`Failed to get sales order: ${data.message || 'Unknown error'}`);
        }
        
        return {
            success: true,
            salesOrder: data.salesorder,
            tenantId
        };
        
    } catch (error) {
        console.error('[ZOHO_SALES_ORDER] Error:', error);
        return {
            success: false,
            error: error.message,
            tenantId
        };
    }
};

/**
 * Convert sales order to invoice for a specific tenant
 */
const convertSalesOrderToInvoice = async (tenantId, salesOrderId) => {
    try {
        console.log('[ZOHO_CONVERT] Converting SO to invoice for tenant:', tenantId, 'SO:', salesOrderId);
        
        // Get sales order details first
        const salesOrderResult = await getSalesOrderDetails(tenantId, salesOrderId);
        if (!salesOrderResult.success) {
            return {
                success: false,
                error: `Failed to get sales order details: ${salesOrderResult.error}`,
                tenantId
            };
        }
        
        const salesOrder = salesOrderResult.salesOrder;
        const { accessToken, organizationId } = await zohoTenantAuth.getValidAccessToken(tenantId);
        const apiUrl = 'https://www.zohoapis.in';
        
        // Helper function to safely concatenate address fields
        function concatAddress(addr) {
            if (!addr || typeof addr !== 'object') return '';
            const parts = [
                addr.address, addr.street2, addr.city, addr.state, 
                addr.zip, addr.country, addr.county, addr.phone
            ].filter(Boolean);
            return parts.join(', ').substring(0, 99);
        }
        
        // Validate template_id
        const isValidTemplateId = Number.isInteger(salesOrder.template_id) && salesOrder.template_id > 0;
        
        // Build line items array
        const lineItems = salesOrder.line_items.map(item => ({
            item_id: item.item_id,
            name: item.name,
            description: item.description,
            quantity: item.quantity,
            rate: item.rate,
            discount: item.discount,
            tax_id: item.tax_id,
            hsn_or_sac: item.hsn_or_sac
        }));

        // Add shipping charges as line item if present (so GST is calculated)
        if (salesOrder.shipping_charge && parseFloat(salesOrder.shipping_charge) > 0) {
            console.log('[ZOHO_INVOICE] Adding shipping as line item:', salesOrder.shipping_charge);
            lineItems.push({
                name: 'Shipping & Handling Charges',
                description: 'Freight and delivery charges',
                quantity: 1,
                rate: parseFloat(salesOrder.shipping_charge),
                discount: 0,
                tax_id: salesOrder.line_items[0]?.tax_id || null // Use same tax as first item
            });
        }

        // Build invoice payload
        const invoicePayload = {
            customer_id: salesOrder.customer_id,
            contact_persons: salesOrder.contact_persons || [],
            date: new Date().toISOString().split('T')[0],
            due_date: salesOrder.due_date || new Date(Date.now() + 30*24*60*60*1000).toISOString().split('T')[0],
            reference_number: `SO-${salesOrder.salesorder_number}`,
            place_of_supply: salesOrder.place_of_supply,
            gst_treatment: salesOrder.gst_treatment,
            ...(isValidTemplateId ? { template_id: salesOrder.template_id } : {}),
            line_items: lineItems,
            notes: `Invoice created from Sales Order #${salesOrder.salesorder_number} (Tenant: ${tenantId})`,
            terms: salesOrder.terms,
            adjustment: salesOrder.adjustment || 0,
            discount: salesOrder.discount || 0,
            tax_total: salesOrder.tax_total || 0,
            shipping_address: concatAddress(salesOrder.shipping_address),
            billing_address: concatAddress(salesOrder.billing_address)
        };
        
        console.log('[ZOHO_CONVERT] Creating invoice for tenant:', tenantId);
        
        // Create the invoice
        const response = await fetch(
            `${apiUrl}/books/v3/invoices?organization_id=${organizationId}`,
            {
                method: 'POST',
                headers: {
                    'Authorization': `Zoho-oauthtoken ${accessToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(invoicePayload)
            }
        );
        
        const data = await response.json();

        if (!response.ok) {
            console.error('[ZOHO_CONVERT] API Error:', data);
            return {
                success: false,
                error: `Failed to create invoice: ${data.message || JSON.stringify(data)}`,
                tenantId
            };
        }

        if (!data.invoice || !data.invoice.invoice_id) {
            console.error('[ZOHO_CONVERT][ERROR] No invoice object in Zoho API response:', data);
            return {
                success: false,
                error: 'Zoho API did not return an invoice object. See logs for full response.',
                tenantId,
                zohoResponse: data
            };
        }

        console.log('[ZOHO_CONVERT] Invoice created successfully:', data.invoice.invoice_id);

        // Try to close the sales order (optional)
        try {
            await fetch(
                `${apiUrl}/books/v3/salesorders/${salesOrderId}/status/closed?organization_id=${organizationId}`,
                {
                    method: 'POST',
                    headers: {
                        'Authorization': `Zoho-oauthtoken ${accessToken}`,
                        'Content-Type': 'application/json'
                    }
                }
            );
        } catch (statusError) {
            console.warn('[ZOHO_CONVERT] Could not update sales order status:', statusError.message);
        }

        return {
            success: true,
            invoiceId: data.invoice.invoice_id,
            invoiceNumber: data.invoice.invoice_number,
            invoice: data.invoice,
            tenantId
        };
        
    } catch (error) {
        console.error('[ZOHO_CONVERT] Error converting sales order to invoice:', error);
        return {
            success: false,
            error: error.message,
            tenantId
        };
    }
};

/**
 * Generate and download invoice PDF for a specific tenant
 */
const generateInvoicePDF = async (tenantId, invoiceId) => {
    try {
        console.log('[ZOHO_PDF] Generating PDF for tenant:', tenantId, 'Invoice:', invoiceId);
        
        const { accessToken, organizationId } = await zohoTenantAuth.getValidAccessToken(tenantId);
        const apiUrl = 'https://www.zohoapis.in';
        
        const response = await fetch(
            `${apiUrl}/books/v3/invoices/${invoiceId}?accept=pdf&organization_id=${organizationId}`,
            {
                method: 'GET',
                headers: {
                    'Authorization': `Zoho-oauthtoken ${accessToken}`,
                    'Accept': 'application/pdf'
                }
            }
        );
        
        if (!response.ok) {
            const errorData = await response.text();
            throw new Error(`Failed to generate PDF: ${response.statusText} - ${errorData}`);
        }
        
        const pdfBuffer = await response.buffer();
        const filename = `invoice_${invoiceId}_${Date.now()}.pdf`;
        
        console.log('[ZOHO_PDF] PDF generated successfully, size:', pdfBuffer.length, 'bytes');
        
        return {
            success: true,
            pdfBuffer: pdfBuffer,
            filename: filename,
            tenantId
        };
        
    } catch (error) {
        console.error('[ZOHO_PDF] Error generating PDF:', error);
        return {
            success: false,
            error: error.message,
            tenantId
        };
    }
};

/**
 * Get invoice details from Zoho Books for a specific tenant
 */
const getInvoiceDetails = async (tenantId, invoiceId) => {
    try {
        console.log('[ZOHO_INVOICE] Getting details for tenant:', tenantId, 'Invoice:', invoiceId);
        
        const { accessToken, organizationId } = await zohoTenantAuth.getValidAccessToken(tenantId);
        const apiUrl = 'https://www.zohoapis.in';
        
        const response = await fetch(
            `${apiUrl}/books/v3/invoices/${invoiceId}?organization_id=${organizationId}`,
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
            console.error('[ZOHO_INVOICE] API Error:', data);
            throw new Error(`Failed to get invoice: ${data.message || 'Unknown error'}`);
        }
        
        return {
            success: true,
            invoice: data.invoice,
            tenantId
        };
        
    } catch (error) {
        console.error('[ZOHO_INVOICE] Error:', error);
        return {
            success: false,
            error: error.message,
            tenantId
        };
    }
};

/**
 * List invoices for a specific tenant
 */
const listInvoices = async (tenantId, filters = {}) => {
    try {
        console.log('[ZOHO_INVOICES] Listing invoices for tenant:', tenantId);
        
        const { accessToken, organizationId } = await zohoTenantAuth.getValidAccessToken(tenantId);
        const apiUrl = 'https://www.zohoapis.in';
        
        // Build query parameters
        const queryParams = new URLSearchParams({
            organization_id: organizationId,
            per_page: filters.per_page || 50,
            page: filters.page || 1
        });
        
        if (filters.customer_id) queryParams.set('customer_id', filters.customer_id);
        if (filters.status) queryParams.set('status', filters.status);
        if (filters.date_start) queryParams.set('date_start', filters.date_start);
        if (filters.date_end) queryParams.set('date_end', filters.date_end);
        
        const response = await fetch(
            `${apiUrl}/books/v3/invoices?${queryParams.toString()}`,
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
            console.error('[ZOHO_INVOICES] API Error:', data);
            throw new Error(`Failed to list invoices: ${data.message || 'Unknown error'}`);
        }
        
        return {
            success: true,
            invoices: data.invoices || [],
            page_context: data.page_context || {},
            tenantId
        };
        
    } catch (error) {
        console.error('[ZOHO_INVOICES] Error:', error);
        return {
            success: false,
            error: error.message,
            tenantId
        };
    }
};

/**
 * Update invoice status (e.g., mark as sent, paid)
 */
const updateInvoiceStatus = async (tenantId, invoiceId, status) => {
    try {
        console.log('[ZOHO_INVOICE_STATUS] Updating for tenant:', tenantId, 'Invoice:', invoiceId, 'Status:', status);
        
        const { accessToken, organizationId } = await zohoTenantAuth.getValidAccessToken(tenantId);
        const apiUrl = 'https://www.zohoapis.in';
        
        let endpoint;
        switch (status.toLowerCase()) {
            case 'sent':
                endpoint = `invoices/${invoiceId}/status/sent`;
                break;
            case 'paid':
                endpoint = `invoices/${invoiceId}/status/paid`;
                break;
            case 'void':
                endpoint = `invoices/${invoiceId}/status/void`;
                break;
            default:
                throw new Error(`Unsupported status: ${status}`);
        }
        
        const response = await fetch(
            `${apiUrl}/books/v3/${endpoint}?organization_id=${organizationId}`,
            {
                method: 'POST',
                headers: {
                    'Authorization': `Zoho-oauthtoken ${accessToken}`,
                    'Content-Type': 'application/json'
                }
            }
        );
        
        const data = await response.json();
        
        if (!response.ok) {
            console.error('[ZOHO_INVOICE_STATUS] API Error:', data);
            throw new Error(`Failed to update invoice status: ${data.message || 'Unknown error'}`);
        }
        
        return {
            success: true,
            message: `Invoice status updated to ${status}`,
            tenantId
        };
        
    } catch (error) {
        console.error('[ZOHO_INVOICE_STATUS] Error:', error);
        return {
            success: false,
            error: error.message,
            tenantId
        };
    }
};

module.exports = {
    getSalesOrderDetails,
    convertSalesOrderToInvoice,
    generateInvoicePDF,
    getInvoiceDetails,
    listInvoices,
    updateInvoiceStatus
};

