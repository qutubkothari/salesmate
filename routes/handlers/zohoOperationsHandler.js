// routes/handlers/zohoOperationsHandler.js
// Extracted from customerHandler.js (lines 1-147)
// Handles all Zoho Books operations: status checks, invoices, sales orders

const { dbClient } = require('../../services/config');
const { convertSalesOrderToInvoice, generateInvoicePDF } = require('../../services/zohoInvoiceService');
const { sendMessage } = require('../../services/whatsappService');
const { logMessage } = require('../../services/historyService');

/**
 * Wrapper for sendMessage + logMessage
 */
const sendAndLogMessage = async (to, text, tenantId, messageType) => {
    await sendMessage(to, text);
    await logMessage(tenantId, to, 'bot', text, messageType);
};

/**
 * Check Zoho authorization status for a tenant
 */
const checkZohoAuthorizationStatus = async (tenantId) => {
    try {
        const zohoTenantAuth = require('../../services/zohoTenantAuthService');
        const status = await zohoTenantAuth.getAuthorizationStatus(tenantId);
        return {
            authorized: status.authorized,
            organizationName: status.organizationName,
            tokenExpired: status.tokenExpired,
            message: status.message
        };
    } catch (error) {
        console.error('[ZOHO_STATUS_CHECK] Error:', error);
        return {
            authorized: false,
            message: 'Unable to check authorization status'
        };
    }
};

/**
 * Handle /zoho_status command
 */
const handleZohoStatusCommand = async (tenantId, from) => {
    try {
        const status = await checkZohoAuthorizationStatus(tenantId);
        let message;
        
        if (status.authorized) {
            if (status.tokenExpired) {
                message = `âš ï¸ **Zoho Status: Token Expired**\n\nOrganization: ${status.organizationName}\n\nThe token has expired but will auto-refresh on next use.`;
            } else {
                message = `âœ… **Zoho Status: Active**\n\nOrganization: ${status.organizationName}\n\nInvoice generation is working properly.`;
            }
        } else {
            message = `âŒ **Zoho Status: Not Authorized**\n\nZoho Books integration is not set up. Please authorize Zoho access first.\n\nContact admin for authorization setup.`;
        }
        
        return {
            success: true,
            message: message
        };
    } catch (error) {
        return {
            success: false,
            message: 'Error checking Zoho status.'
        };
    }
};

/**
 * Handle invoice/order status requests
 */
const handleInvoiceRequest = async (tenant, from, conversation, userQuery) => {
    try {
    console.log('[INVOICE_REQUEST] Processing request for:', from, 'Query:', userQuery, 'Tenant:', tenant.id);
        
        // Get conversation ID
        const { getConversationId } = require('../../services/historyService');
        const conversationId = await getConversationId(tenant.id, from);
        console.log('[INVOICE_REQUEST][DEBUG] tenantId:', tenant.id, 'from:', from, 'conversationId:', conversationId);
        
        if (!conversationId) {
            console.log('[INVOICE_REQUEST][DEBUG] No conversationId found for:', from);
            await sendAndLogMessage(from, "I couldn't find your conversation history.", tenant.id, 'no_conversation');
            return { handled: true, success: false, type: 'no_conversation' };
        }
        // Log all conversations for this phone

        // --- Enhanced: Add error logging for all dbClient queries ---
        const { data: allConvs, error: allConvsError } = await dbClient
            .from('conversations')
            .select('id, end_user_phone')
            .eq('end_user_phone', from);
        if (allConvsError) {
            console.error('[INVOICE_REQUEST][ERROR] allConvs query:', allConvsError.message);
        }
        console.log('[INVOICE_REQUEST][DEBUG] All conversations for phone:', from, allConvs);

        const { data: allRecentOrders, error: allRecentOrdersError } = await dbClient
            .from('orders')
            .select('*')
            .eq('tenant_id', tenant.id)
            .order('created_at', { ascending: false })
            .limit(5);
        if (allRecentOrdersError) {
            console.error('[INVOICE_REQUEST][ERROR] allRecentOrders query:', allRecentOrdersError.message);
        }
        console.log('[INVOICE_REQUEST][DEBUG] All recent orders for tenant:', tenant.id, allRecentOrders);

        let { data: recentOrders, error: recentOrdersError } = await dbClient
            .from('orders')
            .select('*')
            .eq('tenant_id', tenant.id)
            .eq('conversation_id', conversationId)
            .order('created_at', { ascending: false })
            .limit(3);
        if (recentOrdersError) {
            console.error('[INVOICE_REQUEST][ERROR] recentOrders query:', recentOrdersError.message);
        }

        // Fallback: If no orders found, try searching by phone (end_user_phone in conversations)
        if (!recentOrders || recentOrders.length === 0) {
            console.log('[INVOICE_REQUEST][DEBUG] No recent orders for conversationId, trying phone fallback:', from);
            const { data: conversations, error: conversationsError } = await dbClient
                .from('conversations')
                .select('id')
                .eq('end_user_phone', from);
            if (conversationsError) {
                console.error('[INVOICE_REQUEST][ERROR] conversations query:', conversationsError.message);
            }
            if (conversations && conversations.length > 0) {
                const conversationIds = conversations.map(c => c.id);
                const { data: phoneOrders, error: phoneOrdersError } = await dbClient
                    .from('orders')
                    .select('*')
                    .eq('tenant_id', tenant.id)
                    .in('conversation_id', conversationIds)
                    .order('created_at', { ascending: false })
                    .limit(3);
                if (phoneOrdersError) {
                    console.error('[INVOICE_REQUEST][ERROR] phoneOrders query:', phoneOrdersError.message);
                }
                recentOrders = phoneOrders;
            }
        }

        // Retry: If still no orders, wait 1s and try again (handles DB write latency)
        if (!recentOrders || recentOrders.length === 0) {
            console.log('[INVOICE_REQUEST][DEBUG] No recent orders after phone fallback, retrying after 1s...');
            await new Promise(res => setTimeout(res, 1000));
            const { data: retryOrders, error: retryOrdersError } = await dbClient
                .from('orders')
                .select('*')
                .eq('tenant_id', tenant.id)
                .eq('conversation_id', conversationId)
                .order('created_at', { ascending: false })
                .limit(3);
            if (retryOrdersError) {
                console.error('[INVOICE_REQUEST][ERROR] retryOrders query:', retryOrdersError.message);
            }
            recentOrders = retryOrders;
        }

        if (!recentOrders || recentOrders.length === 0) {
            console.log('[INVOICE_REQUEST][DEBUG] No recent orders found for:', from, 'Orders:', recentOrders);
            // LAST RESORT: Try most recent order for tenant
            if (allRecentOrders && allRecentOrders.length > 0) {
                const latestOrder = allRecentOrders[0];
                if (latestOrder.pdf_delivery_url) {
                    await sendAndLogMessage(
                        from,
                        `ðŸ”— *Download your invoice PDF here:*
${latestOrder.pdf_delivery_url}`,
                        tenant.id,
                        'invoice_link_sent_fallback'
                    );
                    await sendAndLogMessage(from, "âœ… Invoice previously generated and sent! Check the download link above.", tenant.id, 'invoice_sent_existing_fallback');
                    return { handled: true, success: true, type: 'invoice_link_existing_fallback' };
                }
            }
            await sendAndLogMessage(from, "You don't have any recent orders. Place an order first!", tenant.id, 'no_orders');
            return { handled: true, success: false, type: 'no_orders' };
        }
        
        // Handle "send invoice", "invoice", "bill", "sendinvoice", etc.
        if (/(send[\s_-]*)?invoice|bill/i.test(userQuery)) {
            console.log('[INVOICE_REQUEST] Invoice trigger matched for query:', userQuery);
            const latestOrder = recentOrders[0];
            console.log('[INVOICE_REQUEST][DEBUG] latestOrder:', latestOrder);

            // PATCH: If PDF already exists, send it and return
            if (latestOrder.pdf_delivery_url) {
                console.log('[INVOICE_REQUEST][DEBUG] Found existing pdf_delivery_url:', latestOrder.pdf_delivery_url);
                await sendAndLogMessage(
                    from,
                    `ðŸ”— *Download your invoice PDF here:*\n${latestOrder.pdf_delivery_url}`,
                    tenant.id,
                    'invoice_link_sent_existing'
                );
                await sendAndLogMessage(from, "âœ… Invoice previously generated and sent! Check the download link above.", tenant.id, 'invoice_sent_existing');
                return { handled: true, success: true, type: 'invoice_link_existing' };
            }

            if (!latestOrder.zoho_sales_order_id) {
                console.log('[INVOICE_REQUEST][DEBUG] No zoho_sales_order_id for order:', latestOrder.id);
                await sendAndLogMessage(from, "Your order is still being processed. Please try again in a moment.", tenant.id, 'order_processing');
                return { handled: true, success: false, type: 'order_processing' };
            }

            console.log('[INVOICE_REQUEST] Converting sales order to invoice:', latestOrder.zoho_sales_order_id);

            // Convert to invoice
            const invoiceResult = await convertSalesOrderToInvoice(tenant.id, latestOrder.zoho_sales_order_id);
            console.log('[INVOICE_REQUEST][DEBUG] invoiceResult:', invoiceResult);

            if (invoiceResult.success) {
                await sendAndLogMessage(from, `âœ… Converting your sales order to invoice...\n\nInvoice ID: ${invoiceResult.invoiceId}\nGenerating PDF...`, tenant.id, 'invoice_converting');

                // Generate and send PDF
                const pdfResult = await generateInvoicePDF(tenant.id, invoiceResult.invoiceId);
                console.log('[INVOICE_REQUEST][DEBUG] pdfResult:', pdfResult);
                if (pdfResult.success) {
                    const { sendPDFViaWhatsApp } = require('../../services/pdfDeliveryService');
                    const pdfSendResult = await sendPDFViaWhatsApp(
                        from,
                        pdfResult.pdfBuffer,
                        pdfResult.filename,
                        `ðŸ“„ Your invoice - Order #${latestOrder.id.substring(0, 8)}`
                    );
                    console.log('[INVOICE_REQUEST][DEBUG] pdfSendResult:', pdfSendResult);

                    // Always send clickable invoice link
                    if (pdfSendResult && pdfSendResult.url) {
                        await sendAndLogMessage(
                            from,
                            `ðŸ”— *Download your invoice PDF here:*\n${pdfSendResult.url}`,
                            tenant.id,
                            'invoice_link_sent'
                        );
                    }

                    await sendAndLogMessage(from, "âœ… Invoice generated and sent! Check the download link above.", tenant.id, 'invoice_sent');
                } else {
                    await sendAndLogMessage(from, "Invoice created but PDF generation failed. Please contact support.", tenant.id, 'pdf_failed');
                }
            } else {
                await sendAndLogMessage(from, `Error creating invoice: ${invoiceResult.error}`, tenant.id, 'invoice_error');
            }
        } 
        // Handle "my orders" or "order status"
        else {
            console.log('[INVOICE_REQUEST] No invoice trigger match for query:', userQuery);
            let statusMessage = "ðŸ“‹ **Your Recent Orders**\n\n";
            
            recentOrders.forEach((order, index) => {
                const orderDate = new Date(order.created_at).toLocaleDateString();
                statusMessage += `${index + 1}. Order #${order.id.substring(0, 8)}\n`;
                statusMessage += `   Date: ${orderDate}\n`;
                statusMessage += `   Total: â‚¹${order.total_amount}\n`;
                statusMessage += `   Status: ${order.zoho_sync_status === 'synced' ? 'Processed' : 'Processing'}\n`;
                if (order.zoho_sales_order_id) {
                    statusMessage += `   Zoho ID: ${order.zoho_sales_order_id.substring(0, 8)}\n`;
                }
                statusMessage += '\n';
            });
            await sendAndLogMessage(from, statusMessage, tenant.id, 'order_status');
        }
        
        return { handled: true, success: true, type: 'invoice_request_handled' };
        
    } catch (error) {
    console.error('[INVOICE_REQUEST][ERROR] Exception thrown:', error);
        await sendAndLogMessage(from, "Sorry, there was an error processing your request. Please try again.", tenant.id, 'invoice_error');
        return { handled: true, success: false, type: 'invoice_error' };
    }
};

/**
 * Handle order approval (convert SO to invoice)
 */
const handleOrderApproval = async (tenant, from, conversation) => {
                        if (latestOrder.pdf_delivery_url) {
                            await sendAndLogMessage(
                                from,
                                `ðŸ”— *Download your invoice PDF here:*\n${latestOrder.pdf_delivery_url}`,
                                tenant.id,
                                'invoice_link_sent_existing'
                            );
                            await sendAndLogMessage(from, "âœ… Invoice previously generated and sent! Check the download link above.", tenant.id, 'invoice_sent_existing');
                            return { handled: true, success: true, type: 'invoice_link_existing' };
                        }
    try {
        console.log('[ORDER_APPROVAL] Processing approval for Zoho order:', conversation.zoho_order_id);
        
        // Convert sales order to invoice
        const invoiceResult = await convertSalesOrderToInvoice(
            tenant.id,
            conversation.zoho_order_id
        );
        
        if (invoiceResult.success) {
            const approvalMsg = `âœ… *Order Approved!*\n\nYour sales order has been converted to invoice.\nðŸ“‹ Invoice ID: ${invoiceResult.invoiceId}\n\nðŸ“„ Your invoice PDF is being generated...`;
            await sendAndLogMessage(from, approvalMsg, tenant.id, 'order_approved');
            
            // Generate and send invoice PDF
            const pdfResult = await generateInvoicePDF(tenant.id, invoiceResult.invoiceId);
            
            if (pdfResult.success) {
                const { sendPDFViaWhatsApp } = require('../../services/pdfDeliveryService');
                await sendPDFViaWhatsApp(
                    from,
                    pdfResult.pdfBuffer,
                    pdfResult.filename,
                    `ðŸ“„ Your invoice - Order approved and ready for dispatch!`
                );
            }
            
            // Update conversation state
            await dbClient
                .from('conversations')
                .update({
                    state: 'order_approved',
                    invoice_id: invoiceResult.invoiceId
                })
                .eq('id', conversation.id);
                
            return { handled: true, success: true };
        } else {
            await sendAndLogMessage(from, `Error converting to invoice: ${invoiceResult.error}`, tenant.id, 'approval_error');
            return { handled: true, success: false };
        }
        
    } catch (error) {
        console.error('[ORDER_APPROVAL] Error:', error);
        await sendAndLogMessage(from, 'Sorry, there was an error processing your approval.', tenant.id, 'approval_error');
        return { handled: true, success: false };
    }
};

module.exports = {
    checkZohoAuthorizationStatus,
    handleZohoStatusCommand,
    handleInvoiceRequest,
    handleOrderApproval
};
