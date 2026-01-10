// routes/handlers/documentHandler.js
const { sendMessage } = require('../../services/whatsappService');
const { handleImageUpload } = require('./imageHandler');
const { checkSubscriptionStatus } = require('../../services/subscriptionService');
const { processProductSheet } = require('../../services/productService');
const { scheduleBroadcast } = require('../../services/broadcastService');
const { subscribeUsersFromSheet } = require('../../services/dripCampaignService');
const { dbClient } = require('../../services/config');
const broadcastCommands = require('../../commands/broadcast');
const { analyzePDF } = require('../../services/pdfAnalysisService');
const { uploadPDFToGCS, savePDFMetadata } = require('../../services/pdfUploadService');
const { toWhatsAppFormat } = require('../../utils/phoneUtils');

/**
 * Safe context data parser
 */
function safeParseContextData(contextData) {
    if (!contextData) return {};
    if (typeof contextData === 'object' && contextData !== null) return contextData;
    if (typeof contextData === 'string') {
        try {
            return JSON.parse(contextData);
        } catch (e) {
            console.error('[CONTEXT_PARSE] Invalid JSON:', e.message);
            return {};
        }
    }
    return {};
}

/**
 * Enhanced GST certificate detection with multiple criteria
 */
const isGSTCertificate = (filename, caption) => {
  const lowerFilename = (filename || '').toLowerCase();
  const lowerCaption = (caption || '').toLowerCase();
  
  // GST-related keywords
  const gstKeywords = [
    'gst', 'tax', 'registration', 'certificate', 'gstin',
    'goods and services tax', 'business registration',
    'company registration', 'trade license'
  ];
  
  // Check filename for GST keywords
  const filenameHasGST = gstKeywords.some(keyword => 
    lowerFilename.includes(keyword)
  );
  
  // Check caption for GST keywords
  const captionHasGST = gstKeywords.some(keyword => 
    lowerCaption.includes(keyword)
  );
  
  // Additional patterns for common GST certificate filenames
  const gstPatterns = [
    /gst.*cert/i,
    /certificate.*gst/i,
    /registration.*cert/i,
    /business.*cert/i,
    /company.*reg/i,
    /gstin.*cert/i
  ];
  
  const patternMatch = gstPatterns.some(pattern => 
    pattern.test(lowerFilename) || pattern.test(lowerCaption)
  );
  
  console.log('[GST_DETECTION] Analysis:', {
    filename: lowerFilename,
    caption: lowerCaption,
    filenameHasGST,
    captionHasGST,
    patternMatch,
    isGST: filenameHasGST || captionHasGST || patternMatch
  });
  
  return filenameHasGST || captionHasGST || patternMatch;
};

/**
 * Enhanced Excel processing function for contact lists
 */
const processContactExcel = async (documentUrl) => {
  try {
    const fetch = (await import('node-fetch')).default;
    const XLSX = require('xlsx');
    
    console.log('[CONTACT_EXCEL] Downloading file from:', documentUrl);
    
    const response = await fetch(documentUrl);
    if (!response.ok) {
      throw new Error(`Failed to download file: ${response.status} ${response.statusText}`);
    }
    
    const buffer = await response.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'array' });
    
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(sheet, { header: 1 });
    
    const contacts = [];
    
    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      if (!row || row.length === 0) continue;
      
      let phoneNumber = String(row[0] || '').trim();
      const name = String(row[1] || '').trim();
      
      if (!phoneNumber) continue;
      
      // Clean and validate phone number
      phoneNumber = phoneNumber.replace(/[^\d+]/g, '');
      
      // Add country code if missing (assuming India +91 as default)
      if (!phoneNumber.startsWith('+')) {
        if (phoneNumber.startsWith('91') && phoneNumber.length === 12) {
          phoneNumber = '+' + phoneNumber;
        } else if (phoneNumber.length === 10) {
          phoneNumber = '+91' + phoneNumber;
        } else if (phoneNumber.length > 6) {
          phoneNumber = '+' + phoneNumber;
        }
      }
      
      // Remove + for internal storage (Maytapi expects digits only)
      const digitsOnly = phoneNumber.replace(/\D/g, '');
      
      if (digitsOnly.length >= 10) {
        contacts.push({
          phone: digitsOnly,
          name: name || null,
          original: phoneNumber
        });
      }
    }
    
    console.log(`[CONTACT_EXCEL] Processed ${contacts.length} valid contacts from ${data.length} rows`);
    return contacts.map(c => c.phone);
    
  } catch (error) {
    console.error('[CONTACT_EXCEL] Error processing Excel file:', error);
    throw new Error(`Failed to process Excel file: ${error.message}`);
  }
};

/**
 * Helper function to extract document URL from various message formats
 */
const extractDocumentUrl = (message) => {
  return message?.document?.url ||
         message?.url ||
         message?._original?.document?.url ||
         message?._original?.message?.url ||
         message?._original?.url ||
         null;
};

/**
 * Handles document uploads for admin users
 */
const handleAdminDocument = async (req, res) => {
  const { message, tenant } = req;
  const from = message.from;

  // Check subscription status
  const subscription = await checkSubscriptionStatus(tenant.id);
  if (subscription.status !== 'active' && subscription.status !== 'trial') {
    await sendMessage(from, `Your subscription is not active, so you cannot upload files. Please use '/activate <key>' to continue.`);
    await dbClient.from('tenants').update({ last_command_context: null }).eq('id', tenant.id);
    return res.status(200).json({ ok: false, error: 'subscription_inactive' });
  }

  const contextString = tenant.last_command_context;
  if (!contextString) {
    await sendMessage(from, 'I received a file, but I\'m not sure what to do with it. Please use a command first (like /products or /broadcast).');
    return res.status(200).json({ ok: false, error: 'no_context' });
  }

  const fileUrl = extractDocumentUrl(message);
  if (!fileUrl) {
    await sendMessage(from, "Could not access the document. Please try uploading again.");
    await dbClient.from('tenants').update({ last_command_context: null }).eq('id', tenant.id);
    return res.status(200).json({ ok: false, error: 'no_file_url' });
  }

  // Handle product uploads
  if (contextString === 'upload_products') {
    await processProductSheet(tenant.id, fileUrl, from);
    await dbClient.from('tenants').update({ last_command_context: null }).eq('id', tenant.id);
    return res.status(200).json({ ok: true, type: 'products_processed' });
  }

  // Handle JSON context (broadcast, drip campaigns, etc.)
  try {
    const context = JSON.parse(contextString);
    
    if (context.type === 'awaiting_broadcast_contacts') {
      await sendMessage(from, 'Processing your contact list...');
      try {
        const phoneNumbers = await processContactExcel(fileUrl);
        if (phoneNumbers.length === 0) {
          await sendMessage(from, 'No valid phone numbers found. Please check your Excel format:\n\nColumn A: Phone numbers\nColumn B: Names (optional)');
          return res.status(200).json({ ok: false, error: 'no_contacts' });
        }
        
        const result = await scheduleBroadcast(
          tenant.id, 
          context.campaignName, 
          context.message, 
          context.sendAt, 
          phoneNumbers
        );
        await sendMessage(from, result);
        
      } catch (error) {
        console.error('Error processing broadcast contacts:', error);
        await sendMessage(from, 'Error processing the Excel file. Please ensure it has phone numbers in column A.');
      }
      
    } else if (context.type === 'awaiting_broadcast_image_contacts') {
      await sendMessage(from, 'Processing your contact list for image broadcast...');
      try {
        const phoneNumbers = await processContactExcel(fileUrl);
        if (phoneNumbers.length === 0) {
          await sendMessage(from, 'No valid phone numbers found.');
          return res.status(200).json({ ok: false, error: 'no_contacts' });
        }
        
        const result = await scheduleBroadcast(
          tenant.id, 
          context.campaignName, 
          context.message, 
          context.sendAt, 
          phoneNumbers, 
          context.imageUrl
        );
        await sendMessage(from, result);
        
      } catch (error) {
        console.error('Error processing image broadcast contacts:', error);
        await sendMessage(from, 'Error processing the Excel file.');
      }
      
    } else if (context.type === 'awaiting_drip_subscribers') {
      await sendMessage(from, 'Processing subscribers for drip campaign...');
      try {
        const result = await subscribeUsersFromSheet(tenant.id, context.campaignName, fileUrl);
        await sendMessage(from, result);
      } catch (error) {
        console.error('Error processing drip subscribers:', error);
        await sendMessage(from, 'Error processing the subscriber list.');
      }
      
    } else {
      await sendMessage(from, 'I received a file, but I\'m not sure what to do with it in this context.');
      return res.status(200).json({ ok: false, error: 'unknown_context' });
    }
    
  } catch (e) {
    console.error('Error parsing context or handling document:', e);
    await sendMessage(from, 'There was an issue processing your request. Please start over with the appropriate command.');
    return res.status(200).json({ ok: false, error: 'context_parse_error' });
  }

  // Clear context for final steps
  const finalSteps = [
    'awaiting_broadcast_contacts', 
    'awaiting_broadcast_image_contacts', 
    'awaiting_drip_subscribers'
  ];
  
  try {
    const currentContext = JSON.parse(contextString);
    if (finalSteps.includes(currentContext.type)) {
      await dbClient.from('tenants').update({ last_command_context: null }).eq('id', tenant.id);
    }
  } catch (e) {
    console.error('Error clearing context:', e);
  }

  return res.status(200).json({ ok: true, type: 'document_processed' });
};

/**
 * Handle customer PDF uploads with intelligent analysis and context saving
 */
const handleCustomerPDFUpload = async (req, res) => {
  const { message, tenant } = req;
  const phoneNumber = message.from;
  const filename = message.document?.filename || 'document.pdf';
  
  console.log('[PDF_HANDLER] Processing customer PDF upload:', filename);
  
  const pdfUrl = extractDocumentUrl(message);

  if (!pdfUrl) {
    await sendMessage(phoneNumber, "I couldn't access the PDF document. Please try uploading it again.");
    return res.status(200).json({ success: false, error: 'no_pdf_url' });
  }

  try {
    // Analyze PDF content with OCR and intelligent categorization
    const analysisResult = await analyzePDF(pdfUrl, tenant.id, filename);
    
    // Upload to Google Cloud Storage for permanent storage
    const gcsUrl = await uploadPDFToGCS(pdfUrl, tenant.id, phoneNumber, filename);
    console.log('[PDF_HANDLER] Uploaded to GCS:', gcsUrl);
    
    // Send response based on analysis
    let responseMessage = `Thank you! I've received your ${analysisResult.documentType || 'document'}.`;
    
    if (analysisResult.type === 'product_inquiry') {
      responseMessage += ` I found ${analysisResult.productsFound || 0} product references. Our team will review and respond with pricing shortly.`;
    } else if (analysisResult.type === 'quotation_request') {
      responseMessage += ` This appears to be a quotation request. We'll prepare a detailed quote for you.`;
    } else if (analysisResult.type === 'technical_document') {
      responseMessage += ` This technical document has been forwarded to our engineering team for review.`;
    } else {
      responseMessage += ` Our team will review it and get back to you soon.`;
    }
    
    await sendMessage(phoneNumber, responseMessage);
    
    // Save metadata to database
    try {
      await savePDFMetadata(
        tenant.id,
        phoneNumber,
        pdfUrl,
        gcsUrl,
        analysisResult,
        filename
      );
      console.log('[PDF_METADATA] Metadata saved successfully');
    } catch (metaError) {
      console.warn('[PDF_METADATA] Save failed (non-critical):', metaError.message);
    }
    
    // Log complete analysis for admin review
    console.log('[CUSTOMER_PDF] Analysis Complete:', {
      type: analysisResult.type,
      documentType: analysisResult.documentType,
      confidence: analysisResult.confidence,
      productsFound: analysisResult.productsFound,
      filename: filename,
      gcsUrl: gcsUrl
    });
    
    return res.status(200).json({
      success: true,
      type: analysisResult.type,
      documentType: analysisResult.documentType,
      confidence: analysisResult.confidence,
      productsFound: analysisResult.productsFound,
      gcsUrl: gcsUrl
    });
    
  } catch (error) {
    console.error('[PDF_HANDLER] Error processing customer PDF:', error.message);
    await sendMessage(phoneNumber, "I received your PDF document and our team will review it. There was a minor processing delay, but we'll handle it manually.");
    return res.status(200).json({ success: false, error: 'processing_failed' });
  }
};

/**
 * Main document handler that routes based on message type and user role
 */
const handleDocument = async (req, res) => {
  const { message, isAdmin, tenant } = req;
  
  console.log('[DOCUMENT_HANDLER] Processing file upload');
  console.log('[DOCUMENT_HANDLER] Message type:', message.type);
  console.log('[DOCUMENT_HANDLER] Is admin:', isAdmin);
  console.log('[DOCUMENT_HANDLER] Filename:', message.document?.filename || message.filename);

  // Check if this is an image upload (existing logic)
  const isImageFile = message.type === 'image' || 
                     message.type === 'media' || 
                     (message.type === 'document' && 
                      message.document?.filename && 
                      /\.(jpg|jpeg|png|gif|webp|bmp)$/i.test(message.document.filename));

  if (isImageFile) {
  // Check for shipping slip upload (for customers with recent orders)
  if (!isAdmin) {
    console.log('[DOCUMENT_HANDLER] Checking if image is shipping slip for customer');
    
    // Check caption for shipping keywords
    const caption = message.caption || '';
    const shippingKeywords = ['lr', 'shipping', 'consignment', 'docket', 'awb', 'tracking'];
    const hasShippingCaption = shippingKeywords.some(kw => 
      caption.toLowerCase().includes(kw)
    );

    // TEMPORARY: Always treat customer images as potential shipping slips for testing
    console.log('[DOCUMENT_HANDLER] Customer image detected - checking for recent orders');
    
    // Check for recent order without LR number
    try {
      const from = message.from;
      
      // First, try to find recent orders
      const { data: recentOrders, error: queryError } = await dbClient
        .from('orders')
        .select('id, created_at, order_data')
        .eq('tenant_id', tenant.id)
        .eq('customer_phone', from)
        .order('created_at', { ascending: false })
        .limit(1);

      console.log('[DOCUMENT_HANDLER] Recent orders query result:', {
        found: recentOrders?.length || 0,
        error: queryError?.message,
        hasOrders: !!recentOrders && recentOrders.length > 0
      });

      if (queryError) {
        console.log('[DOCUMENT_HANDLER] Database query error:', queryError);
      }

      const recentOrder = recentOrders && recentOrders.length > 0 ? recentOrders[0] : null;
      const orderAge = recentOrder ? Date.now() - new Date(recentOrder.created_at).getTime() : Infinity;
      const isRecentOrder = orderAge < 7 * 24 * 60 * 60 * 1000; // 7 days

      if (hasShippingCaption || (recentOrder && isRecentOrder)) {
        console.log('[DOCUMENT_HANDLER] Detected shipping slip upload', {
          orderId: recentOrder?.id,
          hasShippingCaption,
          isRecentOrder,
          orderAge: orderAge / (24 * 60 * 60 * 1000) // days
        });

        // Extract file URL
        const fileUrl = extractDocumentUrl(message);
        if (!fileUrl) {
          console.log('[DOCUMENT_HANDLER] No file URL found, falling through to image handler');
        } else {
          console.log('[DOCUMENT_HANDLER] Processing as shipping slip with URL:', fileUrl);
          // Process shipping slip
          const { processShippingSlipUpload } = require('../../services/shipmentTrackingService');
          await processShippingSlipUpload(
            tenant.id,
            recentOrder.id,
            fileUrl,
            from,
            caption
          );

          return res.status(200).json({ 
            ok: true, 
            type: 'shipping_slip',
            message: 'Shipping slip processed successfully'
          });
        }
      } else {
        console.log('[DOCUMENT_HANDLER] Not a shipping slip - no recent order or caption', {
          hasRecentOrder: !!recentOrder,
          isRecentOrder,
          hasShippingCaption
        });
      }
    } catch (error) {
      console.log('[DOCUMENT_HANDLER] Exception in shipping slip check:', error.message);
      console.error('[DOCUMENT_HANDLER] Full error:', error);
      // Continue to regular image handling
    }
  }    console.log('[DOCUMENT_HANDLER] Routing to image handler');
    return handleImageUpload(req, res);
  }

  // Check if this is a PDF upload
  const isPDFFile = message.type === 'document' && 
                   message.document?.filename && 
                   /\.pdf$/i.test(message.document.filename);

  // Handle PDF files based on user type and content
  if (isPDFFile) {
    console.log('[DOCUMENT_HANDLER] PDF file detected');
    
    // FIXED: Enhanced GST certificate detection for customer PDFs
    if (!isAdmin) {
      const filename = message.document?.filename || '';
      const caption = message.caption || '';
      
      console.log('[DOCUMENT_HANDLER] Checking if PDF is GST certificate:', {
        filename,
        caption,
        isGST: isGSTCertificate(filename, caption)
      });
      
      // Route GST certificates to business info handler
      if (isGSTCertificate(filename, caption)) {
        console.log('[DOCUMENT_HANDLER] GST certificate detected - routing to business info handler');
        
        try {
          const BusinessInfoHandler = require('./businessInfoHandler');
          const businessResult = await BusinessInfoHandler.handleBusinessInfo(
            req.tenant.id,
            message.from,
            {
              message_type: 'document',
              media_url: extractDocumentUrl(message),
              media_filename: filename,
              media_mime_type: 'application/pdf',
              caption: caption
            }
          );
          
          if (businessResult.success) {
            console.log('[DOCUMENT_HANDLER] âœ… GST certificate processed successfully');
            
            // ðŸ†• CRITICAL FIX: Update customer profile with extracted GST info
            const gstInfo = businessResult.business_info || {};
            
            if (gstInfo.gst_number || gstInfo.gstin) {
              console.log('[DOCUMENT_HANDLER] Updating customer profile with GST:', gstInfo.gst_number || gstInfo.gstin);
              
              // ðŸ”§ CRITICAL FIX: Ensure phone format matches database (with @c.us)
              const formattedPhone = toWhatsAppFormat(message.from);
              console.log('[DOCUMENT_HANDLER] Using phone format:', formattedPhone);
              
              try {
                await dbClient
                  .from('customer_profiles')
                  .update({
                    gst_number: gstInfo.gst_number || gstInfo.gstin,
                    company: gstInfo.company_name || gstInfo.business_name || null,
                    address: gstInfo.address || null,
                    onboarding_completed: true,
                    business_verified: true,
                    updated_at: new Date().toISOString()
                  })
                  .eq('tenant_id', req.tenant.id)
                  .eq('phone', formattedPhone);
                
                console.log('[DOCUMENT_HANDLER] âœ… Customer profile updated with GST');
                
                // ðŸ†• CRITICAL FIX: Check for pending checkout and clear state
                const { data: conversation } = await dbClient
                  .from('conversations')
                  .select('state, context_data')
                  .eq('tenant_id', req.tenant.id)
                  .eq('end_user_phone', message.from)
                  .single();
                
                if (conversation && conversation.state === 'awaiting_gst_info') {
                  console.log('[DOCUMENT_HANDLER] Clearing awaiting_gst_info state');
                  
                  let contextData = {};
                  try {
                    contextData = safeParseContextData(conversation.context_data);
                  } catch (e) {
                    console.warn('[DOCUMENT_HANDLER] Failed to parse context_data:', e.message);
                  }
                  
                  // Check if there's a pending checkout
                  if (contextData.pendingCheckout) {
                    console.log('[DOCUMENT_HANDLER] Pending checkout detected - proceeding to checkout');
                    
                    // Clear state and proceed with checkout
                    await dbClient
                      .from('conversations')
                      .update({
                        state: 'discount_approved',
                        context_data: JSON.stringify({
                          approvedDiscount: contextData.approvedDiscount || 0
                        })
                      })
                      .eq('tenant_id', req.tenant.id)
                      .eq('end_user_phone', message.from);
                    
                    // Send success message
                    await sendMessage(message.from, businessResult.response + "\n\nâœ… Processing your order now...");
                    
                    // Proceed with checkout
                    const { checkoutWithDiscounts } = require('../../services/cartService');
                    const checkoutResult = await checkoutWithDiscounts(req.tenant, message.from);
                    await sendMessage(message.from, checkoutResult);
                    
                    // Send QR code if available
                    if (req.tenant.payment_qr_code_url) {
                      try {
                        const qrMessage = "QR code available for payment. Please contact us for the QR code image.";
                        await sendMessage(message.from, qrMessage);
                      } catch (qrError) {
                        console.warn('[DOCUMENT_HANDLER] Failed to send QR code:', qrError.message);
                      }
                    }
                    
                    return res.status(200).json({ 
                      success: true, 
                      type: 'gst_certificate_processed_with_checkout',
                      business_info: businessResult.business_info 
                    });
                  } else {
                    // No pending checkout - just clear state
                    await dbClient
                      .from('conversations')
                      .update({
                        state: null,
                        context_data: null
                      })
                      .eq('tenant_id', req.tenant.id)
                      .eq('end_user_phone', message.from);
                    
                    console.log('[DOCUMENT_HANDLER] âœ… State cleared - no pending checkout');
                  }
                }
              } catch (updateError) {
                console.error('[DOCUMENT_HANDLER] Error updating profile/state:', updateError.message);
              }
            }
            
            await sendMessage(message.from, businessResult.response);
            return res.status(200).json({ 
              success: true, 
              type: 'gst_certificate_processed',
              business_info: businessResult.business_info 
            });
          } else {
            // Fallback to regular PDF processing if business info extraction fails
            console.log('[DOCUMENT_HANDLER] Business info extraction failed, falling back to regular PDF processing');
          }
        } catch (error) {
          console.error('[DOCUMENT_HANDLER] Error in business info handler:', error);
          // Fallback to regular PDF processing
        }
      }
      
      // Regular customer PDF processing
      console.log('[DOCUMENT_HANDLER] Processing PDF for customer (non-GST)');
      return handleCustomerPDFUpload(req, res);
    } else {
      // Admin PDF processing
      console.log('[DOCUMENT_HANDLER] Processing PDF for admin - routing to admin handler');
      return handleAdminDocument(req, res);
    }
  }

  // Handle Excel files for admin users (existing logic)
  if (isAdmin && message.type === 'document') {
    const filename = message.document?.filename || message.filename;
    if (filename && filename.toLowerCase().endsWith('.xlsx')) {
      console.log('[DOCUMENT_HANDLER] Processing Excel file for admin');
      return handleAdminDocument(req, res);
    }
    
    return handleAdminDocument(req, res);
  }

  // For non-admin users with non-PDF, non-image documents
  await sendMessage(message.from, "I can see you've uploaded a file. For best results, please upload PDF documents for automatic processing, or let me know how I can help you with this file.");
  return res.status(200).json({ ok: true, type: 'customer_document_general' });
};

module.exports = {
  handleDocument,
  processContactExcel,
  extractDocumentUrl,
  handleCustomerPDFUpload,
  isGSTCertificate  // Export for testing
};
