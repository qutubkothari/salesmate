// routes/handlers/imageHandler.js
const { sendMessage } = require('../../services/whatsappService');
const broadcastCommands = require('../../commands/broadcast');
const { uploadImageToGCS, saveImageMetadata } = require('../../services/imageUploadService');
const { identifyProductFromImage } = require('../../services/ocrService');
const { dbClient } = require('../../services/config');

/**
 * Enhanced image URL extraction that handles all Maytapi formats
 * This is your main debugging target for the current issue
 */
const extractImageUrl = (message, originalBody) => {
  console.log('[IMAGE_DEBUG] Full message object:', JSON.stringify(message, null, 2));
  console.log('[IMAGE_DEBUG] Original body object:', JSON.stringify(originalBody, null, 2));
  
  // Comprehensive list of all possible image URL locations in Maytapi responses
  const possibleUrls = [
    // Direct URL fields
    message.url,
    message.media?.url,
    message.image?.url,
    message.media_url,
    message.imageUrl,
    message.message_url,
    
    // Media object variations
    message.media?.link,
    message.media?.src,
    message.media?.source,
    
    // Document fallback (images sometimes come as documents)
    message.document?.url,
    message.document?.link,
    
    // Original body fallbacks
    originalBody?.url,
    originalBody?.media?.url,
    originalBody?.image?.url,
    originalBody?.document?.url,
    originalBody?.message?.url,
    originalBody?.message?.media?.url,
    
    // Nested message structures
    originalBody?.message?.image?.url,
    originalBody?.message?.media?.url,
    originalBody?.message?.document?.url,
    
    // Alternative field names
    message.file_url,
    message.attachment_url,
    originalBody?.file_url,
    originalBody?.attachment_url
  ];
  
  // Log each possible location for debugging
  possibleUrls.forEach((url, index) => {
    if (url !== undefined) {
      console.log(`[IMAGE_DEBUG] Possible URL ${index}: ${url}`);
    }
  });
  
  // Find first valid HTTP(S) URL
  for (const url of possibleUrls) {
    if (url && typeof url === 'string' && (url.startsWith('http://') || url.startsWith('https://'))) {
      console.log('[IMAGE_EXTRACT] Found valid image URL:', url);
      return url;
    }
  }
  
  console.log('[IMAGE_EXTRACT] No valid image URL found');
  return null;
};

/**
 * Handles image uploads for admin users
 */
const handleAdminImageUpload = async (req, res) => {
  const { message, tenant, isAdmin } = req;
  const phoneNumber = message.from;
  
  if (!isAdmin) {
    return res.status(200).json({ ok: false, error: 'unauthorized' });
  }
  
  console.log('[IMAGE_HANDLER] Processing admin image upload');
  console.log('[IMAGE_HANDLER] Message type:', message.type);
  console.log('[IMAGE_HANDLER] Has image object:', !!message.image);
  console.log('[IMAGE_HANDLER] Has document object:', !!message.document);
  
  // Extract image URL with enhanced debugging
  const imageUrl = extractImageUrl(message, message._original);
  
  if (!imageUrl) {
    console.log('[IMAGE_HANDLER] Failed to extract image URL, sending error to user');
    await sendMessage(phoneNumber, 'Could not process the uploaded image. Please try uploading again.');
    return res.status(200).json({ success: false, error: 'No image URL found' });
  }
  
  console.log('[IMAGE_HANDLER] Successfully extracted image URL:', imageUrl);
  
  try {
    // Check if this is a shipping slip upload by admin
    const caption = message.caption || '';
    const shippingKeywords = ['lr', 'shipping', 'consignment', 'docket', 'awb', 'tracking'];
    const hasShippingCaption = shippingKeywords.some(kw => 
      caption.toLowerCase().includes(kw)
    );
    
    // Try to detect shipping slip content
    try {
      const { extractLRFromShippingSlip } = require('../../services/shipmentTrackingService');
      const extraction = await extractLRFromShippingSlip(imageUrl);
      
      if (extraction.success && extraction.lrNumber) {
        console.log('[ADMIN_IMAGE] Detected shipping slip with LR:', extraction.lrNumber);
        
        // Find the most recent order without LR number
        const { data: recentOrders, error } = await dbClient
          .from('orders')
          .select('id, customer_phone, created_at')
          .eq('tenant_id', tenant.id)
          .is('lr_number', null)
          .order('created_at', { ascending: false })
          .limit(1);
        
        if (error) {
          console.log('[ADMIN_IMAGE] Error finding recent orders:', error);
        }
        
        if (recentOrders && recentOrders.length > 0) {
          const order = recentOrders[0];
          console.log('[ADMIN_IMAGE] Associating LR with order:', order.id, 'for customer:', order.customer_phone);
          
          // Process the shipping slip upload
          const { processShippingSlipUpload } = require('../../services/shipmentTrackingService');
          const result = await processShippingSlipUpload(tenant.id, order.id, imageUrl);
          
          if (result.success) {
            // Send the LR copy to the customer
            const customerMessage = `ðŸ“¦ *Your Shipping Details*\n\nHere is your LR copy for the recent order:\n\n${result.message}`;
            await sendMessage(order.customer_phone, customerMessage);
            
            // Send the actual image
            // Note: Maytapi might have limitations on sending images programmatically
            // For now, just send the tracking info
            
            await sendMessage(phoneNumber, `âœ… LR Copy processed and sent to customer ${order.customer_phone}\n\n${result.message}`);
            return res.status(200).json({ success: true, type: 'shipping_slip_sent' });
          }
        } else {
          console.log('[ADMIN_IMAGE] No recent orders found without LR number');
        }
      }
    } catch (shippingError) {
      console.log('[ADMIN_IMAGE] Not a shipping slip or extraction failed:', shippingError.message);
    }
    
    // If not a shipping slip, use regular broadcast logic
    const result = await broadcastCommands.handleImageUpload(phoneNumber, imageUrl);
    console.log('[IMAGE_HANDLER] Broadcast image upload result:', result);
    
    if (result && result.ok) {
      return res.status(200).json({ success: true, result });
    } else {
      await sendMessage(phoneNumber, 'Error processing image upload. Please try again.');
      return res.status(200).json({ success: false, error: 'Upload processing failed' });
    }
  } catch (error) {
    console.error('[IMAGE_HANDLER] Error processing image upload:', error);
    await sendMessage(phoneNumber, `Error processing image: ${error.message}`);
    return res.status(200).json({ success: false, error: error.message });
  }
};

/**
 * Handles image uploads for end users (customers)
 */
const handleCustomerImageUpload = async (req, res) => {
  const { message, tenant } = req;
  const phoneNumber = message.from;
  
  console.log('[IMAGE_HANDLER] Processing customer image upload');
  console.log('[IMAGE_HANDLER] Message details:', {
    type: message.type,
    caption: message.caption,
    text: message.text?.body,
    filename: message.document?.filename
  });
  
  // Extract image URL using your existing utility
  const imageUrl = extractImageUrl(message, message._original);
  
  if (!imageUrl) {
    await sendMessage(phoneNumber, "I couldn't access the image. Please try sending it again.");
    return res.status(200).json({ success: false, error: 'no_image_url' });
  }
  
  try {
    // Smart image analysis with OCR (now async)
    const analysisResult = await analyzeCustomerImage(imageUrl, message, tenant.id);
    
    // Send response first (critical) - must not fail
    await sendMessage(phoneNumber, analysisResult.message);
    console.log('[IMAGE_HANDLER] Response sent successfully to customer');
    
    // Debug the analysis result before saving context
    console.log('[OCR_CONTEXT_DEBUG] Analysis result type:', analysisResult.type);
    console.log('[OCR_CONTEXT_DEBUG] Has product?', !!analysisResult.product);
    console.log('[OCR_CONTEXT_DEBUG] Product name:', analysisResult.product?.name);
    console.log('[OCR_CONTEXT_DEBUG] OCR result product:', analysisResult.ocrResult?.product?.name);
    console.log('[OCR_CONTEXT_DEBUG] Full analysis result:', JSON.stringify(analysisResult, null, 2));
    
    // Save conversation context after successful product identification (critical for context)
    if (analysisResult.type === 'product_identified' || analysisResult.type === 'product_auto_identified') {
        // Try multiple ways to get the product name
        const productName = analysisResult.product?.name || 
                           analysisResult.ocrResult?.product?.name ||
                           analysisResult.productName;
        
        console.log('[OCR_CONTEXT_DEBUG] Extracted product name:', productName);
        
        // Only save context if we actually have a product
        if (analysisResult.product && analysisResult.product.name) {
            try {
                const updateResult = await dbClient
                    .from('conversations')
                    .update({
                        last_product_discussed: analysisResult.product.name, // Should be "NFF 8x80"
                        updated_at: new Date().toISOString()
                    })
                    .eq('tenant_id', tenant.id)
                    .eq('end_user_phone', phoneNumber)
                    .select();
                
                console.log('[OCR_CONTEXT] Database update result:', updateResult);
                
                if (updateResult.error) {
                    console.error('[OCR_CONTEXT] Database error:', updateResult.error);
                } else if (updateResult.data && updateResult.data.length > 0) {
                    console.log('[OCR_CONTEXT] Successfully updated:', updateResult.data[0]);
                } else {
                    console.warn('[OCR_CONTEXT] No rows updated - conversation may not exist');
                }
            } catch (contextError) {
                console.error('[OCR_CONTEXT] Save failed:', contextError);
            }
        } else if (productName) {
            // Fallback: save with any product name we found
            try {
                const updateResult = await dbClient
                    .from('conversations')
                    .update({
                        last_product_discussed: productName,
                        updated_at: new Date().toISOString()
                    })
                    .eq('tenant_id', tenant.id)
                    .eq('end_user_phone', phoneNumber)
                    .select();
                
                console.log('[OCR_CONTEXT] Fallback database update result:', updateResult);
                
                if (updateResult.error) {
                    console.error('[OCR_CONTEXT] Fallback database error:', updateResult.error);
                } else if (updateResult.data && updateResult.data.length > 0) {
                    console.log('[OCR_CONTEXT] Successfully updated (fallback):', updateResult.data[0]);
                } else {
                    console.warn('[OCR_CONTEXT] No rows updated (fallback) - conversation may not exist');
                }
            } catch (contextError) {
                console.error('[OCR_CONTEXT] Fallback save failed:', contextError);
            }
        } else {
            console.log('[OCR_CONTEXT] No product to save in context - missing product data');
        }
    } else {
        console.log('[OCR_CONTEXT] Skipping context save - not a product identification type:', analysisResult.type);
    }
    
    // Then do non-critical operations with individual try-catch blocks
    let gcsUrl = imageUrl; // Default fallback
    
    // GCS Upload (non-critical)
    try {
        gcsUrl = await uploadImageToGCS(imageUrl, tenant.id, analysisResult.type);
        console.log('[GCS] Image uploaded successfully:', gcsUrl);
    } catch (uploadError) {
        console.warn('[GCS] Upload failed (non-critical):', uploadError.message);
        // gcsUrl remains as imageUrl fallback
    }
    
    // Metadata saving (non-critical)
    try {
        await saveImageMetadata(
            tenant.id, 
            phoneNumber, 
            imageUrl, 
            gcsUrl, 
            analysisResult.type, 
            {
                ...analysisResult,
                caption: message.caption,
                messageText: message.text?.body,
                filename: message.document?.filename,
                ocrResult: analysisResult.ocrResult || null
            }
        );
        console.log('[METADATA] Image metadata saved successfully');
    } catch (metaError) {
        console.warn('[METADATA] Save failed (non-critical):', metaError.message);
    }
    
    // Log for admin review with enhanced context
    console.log('[CUSTOMER_IMAGE] OCR Analysis Complete:', {
      type: analysisResult.type,
      extractedText: analysisResult.ocrResult?.extractedText,
      productFound: analysisResult.ocrResult?.found,
      confidence: analysisResult.ocrResult?.confidence,
      originalUrl: imageUrl,
      gcsUrl: gcsUrl
    });
    
    return res.status(200).json({ 
      success: true, 
      type: analysisResult.type,
      gcsUrl: gcsUrl,
      ocrResult: analysisResult.ocrResult || null
    });
    
  } catch (error) {
    console.error('[IMAGE_HANDLER] Error processing customer image:', error.message);
    await sendMessage(phoneNumber, "I received your image but had trouble processing it. Our team has been notified.");
    return res.status(200).json({ success: false, error: 'processing_failed' });
  }
};

/**
 * Smart customer image analysis
 */
const analyzeCustomerImage = async (imageUrl, message, tenantId) => {
  const filename = message?.document?.filename || '';
  const caption = message?.caption || '';
  const messageText = message?.text?.body || '';
  const urlLower = imageUrl.toLowerCase();
  const filenameLower = filename.toLowerCase();
  const captionLower = caption.toLowerCase();
  const textLower = messageText.toLowerCase();
  
  // Combine all text sources for analysis
  const allText = `${caption} ${messageText} ${filename}`.toLowerCase();
  
  console.log('[IMAGE_ANALYSIS] Analyzing text:', allText);
  
  // 0. SHIPPING SLIP / LR NUMBER DETECTION (Highest Priority)
  const shippingKeywords = ['lr', 'tracking', 'consignment', 'docket', 'awb', 'waybill', 'courier', 'shipment', 'delivery note'];
  const hasShippingKeyword = shippingKeywords.some(kw => allText.includes(kw));
  
  if (hasShippingKeyword || filename.includes('VRL') || caption.includes('VRL') || allText.includes('vrl')) {
    console.log('[SHIPPING_SLIP] Detected shipping slip image, extracting LR number...');
    
    try {
      // Import the extraction function
      const { extractLRFromShippingSlip } = require('../../services/shipmentTrackingService');
      const extractionResult = await extractLRFromShippingSlip(imageUrl);
      
      if (extractionResult.success && extractionResult.lrNumber) {
        console.log('[SHIPPING_SLIP] LR extracted:', extractionResult.lrNumber);
        
        // Try to track it immediately
        const { trackVRLShipment, formatTrackingMessage, processShippingSlipUpload } = require('../../services/shipmentTrackingService');
        const trackingResult = await trackVRLShipment(extractionResult.lrNumber);
        
        // Also persist to database (associate with order and save tracking)
        try {
          const persistResult = await processShippingSlipUpload(tenantId, null, imageUrl, phoneNumber, caption);
          if (persistResult.success) {
            console.log('[SHIPPING_SLIP] Successfully saved LR to database:', extractionResult.lrNumber);
          } else {
            console.log('[SHIPPING_SLIP] Failed to save LR to database:', persistResult.message);
          }
        } catch (persistError) {
          console.error('[SHIPPING_SLIP] Error saving to database:', persistError.message);
        }
        
        if (trackingResult.success) {
          const trackingMessage = formatTrackingMessage(trackingResult);
          return {
            type: 'shipping_slip_tracked',
            message: trackingMessage,
            lrNumber: extractionResult.lrNumber,
            trackingData: trackingResult
          };
        } else {
          return {
            type: 'shipping_slip_extracted',
            message: `âœ… I found the LR Number: **${extractionResult.lrNumber}**\n\nI'm checking the shipment status now... Please wait a moment.`,
            lrNumber: extractionResult.lrNumber
          };
        }
      } else {
        console.log('[SHIPPING_SLIP] Could not extract LR number from image');
        return {
          type: 'shipping_slip_unclear',
          message: `I can see this is a shipping document, but I'm having trouble reading the LR/Tracking number clearly. Could you please type the LR number for me? It's usually below the barcode.`
        };
      }
    } catch (error) {
      console.error('[SHIPPING_SLIP] Error processing shipping slip:', error);
      // Fall through to product detection
    }
  }
  
  // 1. PRODUCT INQUIRY DETECTION (High Priority) - Now with OCR
  const productInquiryPatterns = [
    /you have this|do you have|available|stock|price|rate|cost/i,
    /kya hai|milta hai|available hai|price kya|rate kya/i,
    /interested|want|need|chahiye|order|buy/i,
    /what is this|ye kya hai|identify|tell me about/i
  ];
  
  for (const pattern of productInquiryPatterns) {
    if (pattern.test(allText)) {
      console.log('[IMAGE_ANALYSIS] Product inquiry detected, running OCR...');
      
      // Use OCR to identify the product
      const ocrResult = await identifyProductFromImage(imageUrl, tenantId);
      
      // ðŸ”§ FIX: Be more conservative - don't claim we have products unless very confident
      if (ocrResult.found && ocrResult.confidence === 'high' && ocrResult.topMatch.relevanceScore >= 7) {
        const product = ocrResult.topMatch;
        // âœ… Only confirm if we're VERY sure (high relevance score)
        return {
          type: 'product_identified',
          message: `I found this in our catalog: **${product.name}**\n\nðŸ’° Price: â‚¹${product.price}${product.packaging_unit === 'carton' ? '/carton' : ''}\nðŸ“¦ ${product.description || 'Product details available'}\n\nIs this what you're looking for? Reply "yes" to get pricing or add to cart.`,
          ocrResult,
          product
        };
      } else if (ocrResult.found && (ocrResult.confidence === 'high' || ocrResult.confidence === 'medium')) {
        // ðŸ”§ FIX: Show options instead of claiming we have it
        const products = ocrResult.products.slice(0, 3);
        const productList = products.map((p, idx) => `${idx + 1}. **${p.name}** - â‚¹${p.price}${p.packaging_unit === 'carton' ? '/carton' : ''}`).join('\n');
        return {
          type: 'product_suggestions',
          message: `I found these similar products in our catalog:\n\n${productList}\n\nDoes any of these match what you're looking for? Please reply with the number or product name.`,
          ocrResult,
          suggestions: products
        };
      } else {
        // ðŸ”§ FIX: Be honest when we can't identify it clearly
        const extractedInfo = ocrResult.extractedText && !ocrResult.isVisualDescription 
          ? `I could see some text: "${ocrResult.extractedText.substring(0, 100)}"` 
          : `I can see it's a product image`;
        return {
          type: 'product_inquiry_manual',
          message: `${extractedInfo}, but I couldn't match it confidently to our catalog.\n\nCould you please share:\nâ€¢ Product code/model number\nâ€¢ Brand name\nâ€¢ Product type\n\nThis will help me find exact pricing and availability for you.`,
          ocrResult
        };
      }
    }
  }
  
  // 2. INVOICE/BILL DETECTION
  if (filenameLower.includes('invoice') || filenameLower.includes('bill') ||
      allText.includes('invoice') || allText.includes('bill') ||
      urlLower.includes('invoice') || urlLower.includes('bill')) {
    return {
      type: 'invoice_detected',
      message: "I can see this looks like an invoice. I've forwarded this to our accounts team for processing. They'll contact you regarding payment or any queries."
    };
  }
  
  // 3. DELIVERY/RECEIPT DETECTION
  if (filenameLower.includes('receipt') || filenameLower.includes('delivery') ||
      allText.includes('receipt') || allText.includes('delivery') ||
      allText.includes('delivered') || allText.includes('transport') ||
      urlLower.includes('receipt') || urlLower.includes('delivery')) {
    return {
      type: 'delivery_receipt',
      message: "Thank you for sharing the delivery receipt! I've noted the delivery confirmation. If you have any issues with the delivered items, please let me know."
    };
  }
  
  // 4. PURCHASE ORDER DETECTION
  if (filenameLower.includes('order') || filenameLower.includes('po_') ||
      allText.includes('order') || allText.includes('purchase') ||
      allText.includes('requirement') || allText.includes('quotation')) {
    return {
      type: 'purchase_order',
      message: "Thank you for the purchase order. I've forwarded this to our fulfillment team. We'll confirm the order details and delivery timeline shortly."
    };
  }
  
  // 5. QUALITY/COMPLAINT DETECTION
  if (allText.includes('problem') || allText.includes('issue') || 
      allText.includes('defect') || allText.includes('complaint') ||
      allText.includes('wrong') || allText.includes('damage')) {
    return {
      type: 'quality_issue',
      message: "I see there might be a quality concern. I've forwarded this image to our quality team immediately. They will contact you within 2 hours to resolve this issue. Your satisfaction is our priority."
    };
  }
  
  // 6. SAMPLE REQUEST DETECTION
  if (allText.includes('sample') || allText.includes('demo') ||
      allText.includes('test') || allText.includes('trial')) {
    return {
      type: 'sample_request',
      message: "I understand you're looking for samples. I've noted your request and our sales team will contact you with sample availability and arrangements."
    };
  }
  
  // 7. DEFAULT - Try OCR anyway for general product images
  console.log('[IMAGE_ANALYSIS] No specific intent detected, trying OCR for general product identification...');
  const ocrResult = await identifyProductFromImage(imageUrl, tenantId);
  
  // â­ CHECK IF OCR DETECTED A SHIPPING SLIP
  if (ocrResult.isShippingSlip && ocrResult.lrNumber) {
    console.log('[SHIPPING_SLIP] OCR detected shipping slip with LR:', ocrResult.lrNumber);
    
    try {
      const { trackVRLShipment, formatTrackingMessage } = require('../../services/shipmentTrackingService');
      const trackingResult = await trackVRLShipment(ocrResult.lrNumber);
      
      if (trackingResult.success) {
        const trackingMessage = formatTrackingMessage(trackingResult);
        return {
          type: 'shipping_slip_tracked',
          message: trackingMessage,
          lrNumber: ocrResult.lrNumber,
          trackingData: trackingResult,
          ocrResult
        };
      } else if (trackingResult.manualTrackingRequired) {
        // LR number saved for tracking - notify customer we'll monitor it
        return {
          type: 'shipping_slip_saved_for_tracking',
          message: `âœ… *Shipping Slip Received!*\n\nðŸ“‹ *LR Number:* ${ocrResult.lrNumber}\nðŸšš *Transporter:* VRL Logistics\n\nï¿½ *We're on it!*\nI've saved your tracking number. I'll monitor the shipment status and notify you of any updates, including:\n\nâœ¨ Shipment dispatched\nðŸ“¦ In transit updates\nðŸš› Out for delivery\nâœ… Delivered\n\nðŸ” *Want to track manually?*\nVisit: ${trackingResult.trackingUrl}\nLR Number: ${ocrResult.lrNumber}\n\nYou'll hear from me as soon as there's an update! ðŸ™Œ`,
          lrNumber: ocrResult.lrNumber,
          trackingUrl: trackingResult.trackingUrl,
          ocrResult
        };
      } else {
        return {
          type: 'shipping_slip_extracted',
          message: `âœ… I found the LR Number: **${ocrResult.lrNumber}**\n\nðŸ” Track at: https://www.vrlgroup.in/track_consignment.aspx\n\nEnter this LR number on their website to check shipment status.`,
          lrNumber: ocrResult.lrNumber,
          ocrResult
        };
      }
    } catch (error) {
      console.error('[SHIPPING_SLIP] Error tracking:', error);
      return {
        type: 'shipping_slip_error',
        message: `âœ… *Shipping Slip Detected!*\n\nðŸ“‹ *LR Number:* ${ocrResult.lrNumber}\nðŸšš *Transporter:* VRL Logistics\n\nðŸ” *Track Your Shipment:*\nVisit: https://www.vrlgroup.in/track_consignment.aspx\nEnter LR: ${ocrResult.lrNumber}\n\nðŸ“ž Or call VRL customer care for updates.`,
        lrNumber: ocrResult.lrNumber,
        ocrResult
      };
    }
  }
  
  // ðŸ”§ FIX: Be very conservative with auto-identification
  if (ocrResult.found) {
    const product = ocrResult.topMatch;

    // Only auto-identify with VERY high confidence (relevance score >= 8)
    if (ocrResult.confidence === 'high' && product.relevanceScore >= 8) {
      return {
        type: 'product_auto_identified',
        message: `I think I found this in our catalog: **${product.name}**\n\nðŸ’° Price: â‚¹${product.price}${product.packaging_unit === 'carton' ? '/carton' : ''}\n\nIs this correct? Let me know if you need more details or want to order!`,
        ocrResult,
        product
      };
    } else if (ocrResult.confidence === 'high' || ocrResult.confidence === 'medium') {
      // ðŸ”§ FIX: Show as suggestion, not confirmation
      const topProducts = ocrResult.products.slice(0, 2);
      const productList = topProducts.map((p, idx) => `${idx + 1}. **${p.name}** - â‚¹${p.price}${p.packaging_unit === 'carton' ? '/carton' : ''}`).join('\n');
      return {
        type: 'product_suggestions',
        message: `I found similar products in our catalog:\n\n${productList}\n\nWhich one matches your image? Or please share the product code/name for exact details.`,
        ocrResult,
        suggestions: topProducts
      };
    }
  }

  // 8. FINAL FALLBACK - No match found
  return {
    type: 'general_product_image',
    message: "Thank you for sharing this image! I can see you're interested in our products. Let me help you with details - could you share the product code or let me know what specific information you need about this item?"
  };
};

/**
 * Main image handler router
 */
const handleImageUpload = async (req, res) => {
  const { message, isAdmin } = req;
  
  // Verify this is actually an image/media message
  const isImageMessage = message.type === 'image' || 
                        message.type === 'media' || 
                        (message.type === 'document' && 
                         message.document?.filename && 
                         /\.(jpg|jpeg|png|gif|webp|bmp)$/i.test(message.document.filename));
  
  if (!isImageMessage) {
    return res.status(200).json({ ok: false, error: 'not-image-message' });
  }
  
  console.log('[IMAGE_HANDLER] Routing image upload - Admin:', isAdmin);
  
  if (isAdmin) {
    return handleAdminImageUpload(req, res);
  } else {
    return handleCustomerImageUpload(req, res);
  }
};

module.exports = {
  handleImageUpload,
  extractImageUrl,
  analyzeCustomerImage
};
