// Helper function for pricing breakdown (add at top)
function calculatePricingBreakdown(priceBeforeTax, quantity) {
    const unitPriceBeforeTax = parseFloat(priceBeforeTax);
    const priceWithTax = unitPriceBeforeTax * 1.18;
    const gstAmount = unitPriceBeforeTax * 0.18 * quantity;
    const totalPriceWithTax = priceWithTax * quantity;
    
    return {
        price_at_time_of_purchase: totalPriceWithTax.toFixed(2),
        unit_price_before_tax: unitPriceBeforeTax.toFixed(2),
        gst_rate: 18,
        gst_amount: gstAmount.toFixed(2)
    };
}
// services/enhancedOrderProcessingWithZoho.js - FIXED VERSION
const { dbClient } = require('./config');
const { processOrderToZoho } = require('./zohoSalesOrderService');
const zohoMatching = require('./zohoCustomerMatchingService');
const { sendMessage } = require('./whatsappService');

class EnhancedOrderProcessingWithZoho {
    
    /**
     * Process order with automatic Zoho integration
     */
    async processOrderWithZohoSync(tenantId, phoneNumber, orderDetails) {
        const result = {
            success: false,
            orderId: null,
            zohoOrderId: null,
            message: '',
            pdfGenerated: false
        };

        try {
            console.log('[ZOHO_ORDER] Starting order processing with Zoho sync');
            console.log('[ZOHO_ORDER] Raw order details:', JSON.stringify(orderDetails, null, 2));

            // Step 1: Match/sync customer to Zoho first
            const customerMatch = await zohoMatching.matchAndSyncCustomer(tenantId, phoneNumber);
            console.log('[ZOHO_ORDER] Customer match result:', customerMatch.action);

            // Step 2: Convert order details to proper format
            const processedOrderDetails = await this.processOrderDetails(tenantId, orderDetails);
            console.log('[ZOHO_ORDER] Processed order details:', JSON.stringify(processedOrderDetails, null, 2));

            if (!processedOrderDetails.success) {
                result.message = processedOrderDetails.message;
                return result;
            }

            // Step 3: Create order in local database
            const localOrderResult = await this.createLocalOrder(tenantId, phoneNumber, processedOrderDetails.orderData);
            
            if (!localOrderResult.success) {
                result.message = localOrderResult.message;
                return result;
            }

            result.orderId = localOrderResult.orderId;
            result.success = true;

            // Step 4: Sync to Zoho (async - don't block user experience)
            this.syncToZohoAsync(tenantId, result.orderId, phoneNumber);

            result.message = this.generateOrderConfirmationMessage(localOrderResult, customerMatch);
            return result;

        } catch (error) {
            console.error('[ZOHO_ORDER] Error processing order:', error);
            result.message = 'Order processing failed. Please try again.';
            return result;
        }
    }

    /**
     * Convert raw order details from extraction to proper order format
     */
    async processOrderDetails(tenantId, rawOrderDetails) {
        try {
            console.log('[ORDER_PROCESS] Converting raw order details to proper format');

            // Handle single product order
            if (!rawOrderDetails.isMultipleProducts) {
                const productId = rawOrderDetails.productId;
                const quantity = parseInt(rawOrderDetails.quantity) || 1;

                if (!productId) {
                    return {
                        success: false,
                        message: 'Product ID not found in order details'
                    };
                }

                // Get product details
                const { data: product, error: productError } = await dbClient
                    .from('products')
                    .select('*')
                    .eq('id', productId)
                    .eq('tenant_id', tenantId)
                    .single();

                if (productError || !product) {
                    console.error('[ORDER_PROCESS] Product not found:', productId);
                    return {
                        success: false,
                        message: 'Product not found'
                    };
                }

                console.log('[ORDER_PROCESS] Found product:', product.name, 'Price:', product.price);

                // Calculate pricing
                const unitPrice = product.price || 0;
                const subtotal = unitPrice * quantity;
                const gstRate = 0.18; // 18% GST
                const gstAmount = subtotal * gstRate;
                const cgstAmount = gstAmount / 2;
                const sgstAmount = gstAmount / 2;
                const total = subtotal + gstAmount;

                const orderData = {
                    subtotal: subtotal,
                    gstAmount: gstAmount,
                    gstRate: gstRate,
                    cgstAmount: cgstAmount,
                    sgstAmount: sgstAmount,
                    igstAmount: 0, // Assuming intra-state transaction
                    total: total,
                    shippingCharges: 0,
                    discountAmount: 0,
                    items: [
                        {
                            productId: productId,
                            quantity: quantity,
                            price: unitPrice,
                            productName: product.name,
                            productDescription: product.description
                        }
                    ]
                };

                console.log('[ORDER_PROCESS] Single product order data created:', JSON.stringify(orderData, null, 2));
                return {
                    success: true,
                    orderData: orderData
                };
            }

            // Handle multiple products order (if needed later)
            else {
                console.log('[ORDER_PROCESS] Multiple products not implemented yet');
                return {
                    success: false,
                    message: 'Multiple products orders not yet supported'
                };
            }

        } catch (error) {
            console.error('[ORDER_PROCESS] Error processing order details:', error);
            return {
                success: false,
                message: 'Error processing order details'
            };
        }
    }

    /**
     * Create order in local database
     */
    async createLocalOrder(tenantId, phoneNumber, orderDetails) {
        try {
            console.log('[LOCAL_ORDER] Creating order with details:', JSON.stringify(orderDetails, null, 2));

            // Get conversation
            const { data: conversation } = await dbClient
                .from('conversations')
                .select('id')
                .eq('tenant_id', tenantId)
                .eq('end_user_phone', phoneNumber)
                .single();

            if (!conversation) {
                return { success: false, message: 'Conversation not found' };
            }

            // Create order
            const { data: order, error: orderError } = await dbClient
                .from('orders')
                .insert({
                    tenant_id: tenantId,
                    conversation_id: conversation.id,
                    subtotal_amount: orderDetails.subtotal,
                    gst_amount: orderDetails.gstAmount,
                    gst_rate: orderDetails.gstRate,
                    total_amount: orderDetails.total,
                    cgst_amount: orderDetails.cgstAmount,
                    sgst_amount: orderDetails.sgstAmount,
                    igst_amount: orderDetails.igstAmount,
                    shipping_charges: orderDetails.shippingCharges || 0,
                    discount_amount: orderDetails.discountAmount || 0,
                    status: 'pending',
                    zoho_sync_status: 'pending'
                })
                .select('id')
                .single();

            if (orderError) {
                console.error('[LOCAL_ORDER] Order creation error:', orderError);
                throw orderError;
            }

            console.log('[LOCAL_ORDER] Order created with ID:', order.id);

            // Create order items with pricing breakdown
            if (orderDetails.items && orderDetails.items.length > 0) {
                const orderItems = orderDetails.items.map(item => {
                    const pricing = calculatePricingBreakdown(item.price, item.quantity);
                    return {
                        order_id: order.id,
                        product_id: item.productId,
                        quantity: item.quantity,
                        ...pricing,
                        zoho_item_id: null // Will be filled by Zoho sync later
                    };
                });

                console.log('[LOCAL_ORDER] Inserting order items:', JSON.stringify(orderItems, null, 2));

                const { error: itemsError } = await dbClient
                    .from('order_items')
                    .insert(orderItems);

                if (itemsError) {
                    console.error('[LOCAL_ORDER] Items insert error:', itemsError);
                    throw itemsError;
                } else {
                    console.log('[LOCAL_ORDER] Successfully inserted', orderItems.length, 'order items');
                }
            } else {
                console.error('[LOCAL_ORDER] No items to insert - this will cause Zoho sync to fail');
            }

            return { 
                success: true, 
                orderId: order.id,
                orderDetails: orderDetails
            };

        } catch (error) {
            console.error('[LOCAL_ORDER] Error:', error);
            return { 
                success: false, 
                message: 'Failed to create order. Please try again.' 
            };
        }
    }

    /**
     * Sync to Zoho asynchronously (don't block user)
     */
    async syncToZohoAsync(tenantId, orderId, phoneNumber) {
        try {
            console.log('[ZOHO_ASYNC] Starting Zoho sync for order:', orderId);

            // Add a small delay to ensure order items are committed
            await new Promise(resolve => setTimeout(resolve, 1000));

            // Verify order items exist before syncing
            const { data: orderItems } = await dbClient
                .from('order_items')
                .select('*')
                .eq('order_id', orderId);

            console.log('[ZOHO_ASYNC] Order items found for sync:', orderItems?.length || 0);

            if (!orderItems || orderItems.length === 0) {
                console.error('[ZOHO_ASYNC] No order items found - cannot sync to Zoho');
                
                await dbClient
                    .from('orders')
                    .update({
                        zoho_sync_status: 'failed',
                        zoho_sync_error: 'No order items found'
                    })
                    .eq('id', orderId);
                
                return;
            }

            // Process to Zoho and get PDF
            const zohoResult = await processOrderToZoho(tenantId, orderId);

            if (zohoResult.success) {
                console.log('[ZOHO_ASYNC] Order synced successfully:', zohoResult.zohoOrderId);
                console.log('[ZOHO_ASYNC] PDF Buffer exists:', !!zohoResult.pdfBuffer);
                console.log('[ZOHO_ASYNC] Filename:', zohoResult.filename);

                try {
                    const { getZohoSalesOrderPDF } = require('./zohoSalesOrderService');
                    if (!zohoResult.pdfBuffer && zohoResult.zohoOrderId) {
                        console.log('[PDF_SEND] Fetching PDF directly for delivery');
                        const pdfResult = await getZohoSalesOrderPDF(zohoResult.zohoOrderId);
                        if (pdfResult.success) {
                            console.log('[PDF_SEND] PDF fetched, delivering to customer');
                            await this.sendOrderPDFToCustomer(phoneNumber, pdfResult.pdfBuffer, pdfResult.filename);
                        } else {
                            console.log('[PDF_SEND] PDF fetch failed:', pdfResult.error);
                        }
                    } else if (zohoResult.pdfBuffer) {
                        console.log('[PDF_SEND] Using PDF buffer from result');
                        await this.sendOrderPDFToCustomer(phoneNumber, zohoResult.pdfBuffer, zohoResult.filename);
                    } else {
                        console.log('[PDF_SEND] No PDF buffer or order ID available');
                    }
                } catch (pdfError) {
                    console.error('[PDF_SEND] Error in PDF delivery:', pdfError.message);
                }

                // Send confirmation message
                const confirmMsg = `âœ… *Order Synced to Zoho CRM*\n\nZoho Sales Order ID: ${zohoResult.zohoOrderId}\nPDF has been generated for your records.`;
                await sendMessage(phoneNumber, confirmMsg);

            } else {
                console.error('[ZOHO_ASYNC] Zoho sync failed:', zohoResult.error);
                
                // Mark order as sync failed but don't notify customer (order still valid)
                await dbClient
                    .from('orders')
                    .update({
                        zoho_sync_status: 'failed',
                        zoho_sync_error: zohoResult.error
                    })
                    .eq('id', orderId);

                // Optionally notify admin
                await this.notifyAdminOfSyncFailure(tenantId, orderId, zohoResult.error);
            }

        } catch (error) {
            console.error('[ZOHO_ASYNC] Unexpected error during sync:', error);
            
            await dbClient
                .from('orders')
                .update({
                    zoho_sync_status: 'failed',
                    zoho_sync_error: error.message
                })
                .eq('id', orderId);
        }
    }

    /**
     * Send PDF to customer via WhatsApp
     */
    async sendOrderPDFToCustomer(phoneNumber, pdfBuffer, filename) {
        try {
            console.log('[PDF_SEND] Starting GCS PDF delivery for:', filename);
            // Use your configured GCS bucket
            const { Storage } = require('@google-cloud/storage');
            const storage = new Storage({
                projectId: process.env.GCLOUD_PROJECT
            });
            const bucket = storage.bucket(process.env.GCS_BUCKET);
            const file = bucket.file(`invoices/${Date.now()}_${filename}`);

            // Upload PDF to GCS
            await file.save(pdfBuffer, {
                metadata: {
                    contentType: 'application/pdf',
                    cacheControl: 'public, max-age=86400'
                }
            });

            // Make file publicly accessible
            await file.makePublic();

            // Generate public URL
            const publicUrl = `https://storage.googleapis.com/${process.env.GCS_BUCKET}/${file.name}`;
            console.log('[PDF_SEND] PDF uploaded to GCS:', publicUrl);

            // Send WhatsApp message with download link
            const pdfMessage = `ðŸ“„ *Your Invoice is Ready!*\n\nâœ… Sales Order PDF generated successfully\nðŸ“‹ File: ${filename}\nï¿½ Size: ${Math.round(pdfBuffer.length / 1024)}KB\n\nðŸ“Ž **Download Link:**\n${publicUrl}\n\nðŸ’¼ Please save this invoice for your records.\nðŸ™ Thank you for your business!`;
            await sendMessage(phoneNumber, pdfMessage);
            console.log('[PDF_SEND] PDF delivery message sent successfully');
            return { success: true, url: publicUrl };
        } catch (error) {
            console.error('[PDF_SEND] GCS upload error:', error.message);
            // Fallback message
            const fallbackMsg = `ðŸ“„ *Invoice Generated!*\n\nYour sales order PDF has been created successfully.\nPlease contact us to receive your invoice.\n\nReference: ${filename}`;
            await sendMessage(phoneNumber, fallbackMsg);
            return { success: false, error: error.message };
        }
    }

    /**
     * Sync existing order to Zoho (called after checkout)
     */
    async syncExistingOrderToZoho(tenantId, orderId, phoneNumber) {
        try {
            console.log('[ZOHO_BACKGROUND] Syncing existing order:', orderId);
            // Update order status
            await dbClient
                .from('orders')
                .update({ zoho_sync_status: 'syncing' })
                .eq('id', orderId);

            // Start the sync process
            await this.syncToZohoAsync(tenantId, orderId, phoneNumber);

        } catch (error) {
            console.error('[ZOHO_BACKGROUND] Background sync error:', error);

            await dbClient
                .from('orders')
                .update({ 
                    zoho_sync_status: 'failed',
                    zoho_sync_error: error.message 
                })
                .eq('id', orderId);
        }
    }

    /**
     * Notify admin of sync failure
     */
    async notifyAdminOfSyncFailure(tenantId, orderId, error) {
        try {
            // Get admin phone or email from tenant settings
            const { data: tenant } = await dbClient
                .from('tenants')
                .select('admin_phone, admin_email')
                .eq('id', tenantId)
                .single();

            if (tenant?.admin_phone) {
                const adminMsg = `âš ï¸ *Zoho Sync Failed*\n\nOrder ID: ${orderId}\nError: ${error}\n\nPlease check admin dashboard.`;
                await sendMessage(tenant.admin_phone, adminMsg);
            }
        } catch (notifyError) {
            console.error('[ADMIN_NOTIFY] Error notifying admin:', notifyError);
        }
    }

    /**
     * Generate order confirmation message
     */
    generateOrderConfirmationMessage(orderResult, customerMatch) {
        let message = `âœ… *Order Confirmed!*\n\nOrder ID: ${orderResult.orderId.substring(0, 8)}\n`;
        
        if (orderResult.orderDetails) {
            message += `Total: â‚¹${orderResult.orderDetails.total}\n`;
            message += `Items: ${orderResult.orderDetails.items?.length || 0}\n`;
        }

        message += `\nðŸ“„ *Processing Status:*\n`;
        message += `â€¢ Order created locally âœ…\n`;
        message += `â€¢ Customer ${customerMatch.action === 'already_linked' ? 'already linked' : 'matched'} to Zoho âœ…\n`;
        message += `â€¢ Syncing to Zoho CRM... â³\n\n`;
        message += `You'll receive a confirmation once your order is fully processed in our CRM system.`;

        return message;
    }

    /**
     * Check order sync status
     */
    async checkOrderSyncStatus(tenantId, orderId) {
        try {
            const { data: order } = await dbClient
                .from('orders')
                .select('zoho_sync_status, zoho_sales_order_id, zoho_sync_error')
                .eq('id', orderId)
                .single();

            return {
                success: true,
                syncStatus: order?.zoho_sync_status || 'pending',
                zohoOrderId: order?.zoho_sales_order_id,
                error: order?.zoho_sync_error
            };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }
}

module.exports = new EnhancedOrderProcessingWithZoho();
