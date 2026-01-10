// services/pdfDeliveryService.js - WhatsApp PDF Document Delivery
const { dbClient } = require('./config');
const { sendMessage } = require('./whatsappService');
const FormData = require('form-data');
const fetch = require('node-fetch');

/**
 * Upload PDF to a temporary hosting service (Google Cloud Storage or similar)
 */
const uploadPDFToStorage = async (pdfBuffer, filename) => {
    try {
        console.log('[PDF_UPLOAD] Uploading PDF to storage:', filename);
        
        // Option 1: Upload to Google Cloud Storage (if configured)
        if (process.env.GOOGLE_CLOUD_STORAGE_BUCKET) {
            return await uploadToGCS(pdfBuffer, filename);
        }
        
        // Option 2: Upload to a temporary file sharing service
        // Using a generic file upload service (adjust based on your preference)
        const formData = new FormData();
        formData.append('file', pdfBuffer, {
            filename: filename,
            contentType: 'application/pdf'
        });
        
        // Example using a temporary file hosting service
        // Replace with your preferred service (Cloudinary, AWS S3, etc.)
        const uploadResponse = await fetch('https://api.uploadcare.com/base/', {
            method: 'POST',
            headers: {
                'Authorization': `Uploadcare.Simple ${process.env.UPLOADCARE_PUBLIC_KEY}:${process.env.UPLOADCARE_SECRET_KEY}`
            },
            body: formData
        });
        
        if (uploadResponse.ok) {
            const uploadData = await uploadResponse.json();
            const publicUrl = `https://ucarecdn.com/${uploadData.file}/`;
            
            console.log('[PDF_UPLOAD] PDF uploaded successfully:', publicUrl);
            return {
                success: true,
                url: publicUrl,
                filename: filename
            };
        } else {
            throw new Error(`Upload failed: ${uploadResponse.status} ${uploadResponse.statusText}`);
        }
        
    } catch (error) {
        console.error('[PDF_UPLOAD] Error uploading PDF:', error.message);
        return {
            success: false,
            error: error.message
        };
    }
};

/**
 * Upload to Google Cloud Storage (if configured)
 */
const uploadToGCS = async (pdfBuffer, filename) => {
    try {
        const { Storage } = require('@google-cloud/storage');
        const storage = new Storage({
            keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
            projectId: process.env.GOOGLE_CLOUD_PROJECT_ID
        });
        
        const bucket = storage.bucket(process.env.GOOGLE_CLOUD_STORAGE_BUCKET);
        const file = bucket.file(`sales_orders/${Date.now()}_${filename}`);
        
        await file.save(pdfBuffer, {
            metadata: {
                contentType: 'application/pdf',
                cacheControl: 'public, max-age=86400' // 24 hours
            }
        });
        
        // Make file publicly accessible for 24 hours
        await file.makePublic();
        
        const publicUrl = `https://storage.googleapis.com/${bucket.name}/${file.name}`;
        
        console.log('[GCS_UPLOAD] PDF uploaded to GCS:', publicUrl);
        return {
            success: true,
            url: publicUrl,
            filename: filename
        };
        
    } catch (error) {
        console.error('[GCS_UPLOAD] Error:', error.message);
        throw error;
    }
};

/**
 * Send PDF document via WhatsApp
 */
const sendPDFViaWhatsApp = async (phoneNumber, pdfBuffer, filename, caption = '') => {
    try {
        console.log('[PDF_WHATSAPP] Using GCS link method (Maytapi document limitations)');
        // Upload to GCS and send download link
        const uploadResult = await uploadPDFToStorage(pdfBuffer, filename);
        if (uploadResult.success) {
            // Use correct title for invoice vs sales order
            let message;
            if (/^invoice/i.test(filename)) {
                message = `ðŸ“„ **Your Invoice is Ready!**\n\nâœ… Invoice PDF generated\nðŸ“‹ File: ${filename}\nðŸ“ Size: ${Math.round(pdfBuffer.length / 1024)}KB\n\nðŸ“Ž **Download Link:**\n${uploadResult.url}\n\nðŸ’¼ Click the link to download your invoice.\nðŸ™ Thank you for your business!`;
            } else {
                message = `ðŸ“„ **Your Sales Order is created!**\n\nâœ… Sales Order PDF generated\nðŸ“‹ File: ${filename}\nðŸ“ Size: ${Math.round(pdfBuffer.length / 1024)}KB\n\nðŸ“Ž **Download Link:**\n${uploadResult.url}\n\nðŸ’¼ Click the link to download your sales order.\nðŸ™ Thank you for your business!`;
            }
            await sendMessage(phoneNumber, message);
            console.log('[PDF_WHATSAPP] PDF link sent successfully');
            return { success: true, method: 'gcs_link', url: uploadResult.url };
        } else {
            throw new Error('GCS upload failed');
        }
    } catch (error) {
        console.error('[PDF_WHATSAPP] GCS method failed:', error.message);
        // Final fallback: notification only
        const fallbackMsg = `ðŸ“„ **Invoice Generated!**\n\nâœ… Your sales order PDF has been created\nðŸ“‹ Reference: ${filename.replace('sales_order_', '').replace('.pdf', '')}\nðŸ“ Size: ${Math.round(pdfBuffer.length / 1024)}KB\n\nðŸ’¼ Please contact us to receive your invoice.\nðŸ™ Thank you for your business!`;
        await sendMessage(phoneNumber, fallbackMsg);
        return { success: true, method: 'notification_fallback' };
    }
};

/**
 * Send document message via WhatsApp Business API
 */
const sendDocumentMessage = async (phoneNumber, documentUrl, filename, caption) => {
    try {
        // Clean phone number
        const cleanPhone = phoneNumber.replace('@c.us', '').replace(/[^\d]/g, '');
        
        // WhatsApp Business API endpoint (adjust based on your provider)
        const whatsappApiUrl = process.env.WHATSAPP_API_URL || 'https://graph.facebook.com/v18.0';
        const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
        const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
        
        const messageData = {
            messaging_product: 'whatsapp',
            to: cleanPhone,
            type: 'document',
            document: {
                link: documentUrl,
                filename: filename,
                caption: caption || `ðŸ“„ Your sales order document: ${filename}`
            }
        };
        
        const response = await fetch(`${whatsappApiUrl}/${phoneNumberId}/messages`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(messageData)
        });
        
        const responseData = await response.json();
        
        if (response.ok && responseData.messages) {
            return {
                success: true,
                messageId: responseData.messages[0].id
            };
        } else {
            throw new Error(`WhatsApp API error: ${JSON.stringify(responseData)}`);
        }
        
    } catch (error) {
        console.error('[WHATSAPP_DOCUMENT] Error:', error.message);
        return {
            success: false,
            error: error.message
        };
    }
};

/**
 * Alternative: Send PDF via your existing WhatsApp service (if it supports documents)
 */
const sendPDFViaExistingService = async (phoneNumber, pdfBuffer, filename, caption) => {
    try {
        // Check if your existing whatsappService supports document sending
        const { sendDocument } = require('./whatsappService');
        
        if (typeof sendDocument === 'function') {
            console.log('[PDF_EXISTING] Using existing WhatsApp service');
            
            const result = await sendDocument(phoneNumber, pdfBuffer, filename, caption);
            return result;
        } else {
            // Fallback to URL method
            return await sendPDFViaWhatsApp(phoneNumber, pdfBuffer, filename, caption);
        }
        
    } catch (error) {
        console.error('[PDF_EXISTING] Error:', error.message);
        return {
            success: false,
            error: error.message
        };
    }
};

/**
 * Complete order PDF delivery process
 */
const deliverOrderPDF = async (tenantId, orderId, phoneNumber) => {
    try {
        console.log('[PDF_DELIVERY] Starting PDF delivery for order:', orderId);
        
        // Import Zoho service
        const { processOrderToZoho } = require('./zohoSalesOrderService');
        
        // Step 1: Process order to Zoho and get PDF
        const zohoResult = await processOrderToZoho(tenantId, orderId);
        
        if (!zohoResult.success) {
            return {
                success: false,
                error: `Zoho processing failed: ${zohoResult.error}`,
                stage: 'zoho_processing'
            };
        }
        
        // Step 2: Send PDF via WhatsApp
        const deliveryResult = await sendPDFViaWhatsApp(
            phoneNumber,
            zohoResult.pdfBuffer,
            zohoResult.filename,
            `ðŸ“‹ Your sales order from ${new Date().toLocaleDateString()}\n\nOrder ID: ${orderId.substring(0, 8)}\nZoho Sales Order: ${zohoResult.zohoOrderId.substring(0, 8)}\n\nThank you for your business!`
        );
        
        if (!deliveryResult.success) {
            return {
                success: false,
                error: `PDF delivery failed: ${deliveryResult.error}`,
                stage: 'pdf_delivery',
                zohoOrderId: zohoResult.zohoOrderId
            };
        }
        
        // Step 3: Update order with delivery status
        await dbClient
            .from('orders')
            .update({
                pdf_delivery_status: 'delivered',
                pdf_delivery_url: deliveryResult.fileUrl,
                pdf_delivered_at: new Date().toISOString(),
                whatsapp_message_id: deliveryResult.messageId
            })
            .eq('id', orderId);
        
        console.log('[PDF_DELIVERY] Complete delivery successful');
        
        return {
            success: true,
            zohoOrderId: zohoResult.zohoOrderId,
            fileUrl: deliveryResult.fileUrl,
            messageId: deliveryResult.messageId,
            message: 'Sales order PDF delivered successfully via WhatsApp'
        };
        
    } catch (error) {
        console.error('[PDF_DELIVERY] Error in complete delivery:', error.message);
        
        // Update order with error status
        await dbClient
            .from('orders')
            .update({
                pdf_delivery_status: 'failed',
                pdf_delivery_error: error.message,
                pdf_delivered_at: new Date().toISOString()
            })
            .eq('id', orderId);
            
        return {
            success: false,
            error: error.message,
            stage: 'complete_process'
        };
    }
};

/**
 * Retry failed PDF deliveries
 */
const retryFailedDeliveries = async () => {
    try {
        console.log('[PDF_RETRY] Checking for failed deliveries');
        
        const { data: failedOrders } = await dbClient
            .from('orders')
            .select(`
                id,
                tenant_id,
                zoho_sales_order_id,
                conversations (end_user_phone)
            `)
            .eq('pdf_delivery_status', 'failed')
            .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()) // Last 24 hours
            .limit(10);
            
        if (!failedOrders || failedOrders.length === 0) {
            console.log('[PDF_RETRY] No failed deliveries found');
            return { retried: 0 };
        }
        
        let retriedCount = 0;
        
        for (const order of failedOrders) {
            try {
                const result = await deliverOrderPDF(
                    order.tenant_id,
                    order.id,
                    order.conversations.end_user_phone
                );
                
                if (result.success) {
                    retriedCount++;
                    console.log('[PDF_RETRY] Successfully retried order:', order.id);
                }
            } catch (retryError) {
                console.error('[PDF_RETRY] Retry failed for order:', order.id, retryError.message);
            }
        }
        
        return { retried: retriedCount, total: failedOrders.length };
        
    } catch (error) {
        console.error('[PDF_RETRY] Error in retry process:', error.message);
        return { retried: 0, error: error.message };
    }
};

module.exports = {
    deliverOrderPDF,
    sendPDFViaWhatsApp,
    sendPDFViaExistingService,
    uploadPDFToStorage,
    retryFailedDeliveries,
    sendDocumentMessage
};
