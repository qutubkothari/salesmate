// controllers/documentController.js
const whatsappService = require('../services/whatsappService');
const { dbClient } = require('../config/database');
const { processShippingSlipUpload, formatTrackingMessage, trackVRLShipment } = require('../services/shipmentTrackingService');
// const productService = require('../services/productService'); // when ready

/**
 * Handle document/image uploads
 */
exports.handleDocument = async (req, res) => {
  try {
    const { message, tenant } = req;
    const from = message.from;
    const messageType = message.type;

    console.log(`[DOCUMENT] Processing ${messageType} from ${from}`);

    // Get image/document URL
    let fileUrl = null;
    let caption = null;

    if (messageType === 'image') {
      fileUrl = message.image?.url || message.image?.link;
      caption = message.image?.caption;
    } else if (messageType === 'document') {
      fileUrl = message.document?.url || message.document?.link;
      caption = message.document?.caption || message.document?.filename;
    }

    if (!fileUrl) {
      console.error('[DOCUMENT] No file URL found in message');
      return res.status(200).json({ ok: true, error: 'No file URL' });
    }

    console.log(`[DOCUMENT] File URL: ${fileUrl}, Caption: ${caption}`);

    // Check conversation context to determine what the upload is for
    const { data: conversation } = await dbClient
      .from('conversations')
      .select('state, context_data')
      .eq('tenant_id', tenant.id)
      .eq('end_user_phone', from)
      .single();

    // === SHIPPING SLIP UPLOAD ===
    // Check if user is uploading shipping slip for recent order
    const shippingKeywords = ['lr', 'shipping', 'consignment', 'docket', 'awb', 'waybill', 'courier'];
    const hasShippingCaption = caption && shippingKeywords.some(kw => caption.toLowerCase().includes(kw));
    
    if (hasShippingCaption) {
      console.log('[DOCUMENT] Detected shipping slip upload by caption');
      await handleShippingSlipUpload(tenant.id, from, fileUrl, caption);
      return res.status(200).json({ ok: true, type: 'shipping_slip' });
    }

    // Check if user has awaiting_shipping_slip state
    if (conversation?.state === 'awaiting_shipping_slip') {
      console.log('[DOCUMENT] User in awaiting_shipping_slip state');
      const orderId = conversation.context_data?.order_id;
      if (orderId) {
        await handleShippingSlipUpload(tenant.id, from, fileUrl, caption, orderId);
        return res.status(200).json({ ok: true, type: 'shipping_slip' });
      }
    }

    // Check if user has a recent order without LR - likely uploading shipping slip
    const { data: recentOrderCheck } = await dbClient
      .from('conversations')
      .select('id')
      .eq('tenant_id', tenant.id)
      .eq('end_user_phone', from)
      .single();

    if (recentOrderCheck) {
      const { data: recentOrder } = await dbClient
        .from('orders')
        .select('id, created_at')
        .eq('tenant_id', tenant.id)
        .eq('conversation_id', recentOrderCheck.id)
        .is('lr_number', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      // If order was created in last 7 days and no LR, assume it's a shipping slip
      if (recentOrder) {
        const orderAge = Date.now() - new Date(recentOrder.created_at).getTime();
        const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
        
        if (orderAge < sevenDaysMs) {
          console.log('[DOCUMENT] Recent order without LR detected, treating as shipping slip');
          await handleShippingSlipUpload(tenant.id, from, fileUrl, caption, recentOrder.id);
          return res.status(200).json({ ok: true, type: 'shipping_slip_auto' });
        }
      }
    }

    // === GST CERTIFICATE UPLOAD ===
    if (caption && caption.toLowerCase().includes('gst')) {
      console.log('[DOCUMENT] Detected GST certificate upload');
      // Handle GST certificate
      await whatsappService.sendMessage(from, 'âœ… GST certificate received! We will verify it shortly.');
      return res.status(200).json({ ok: true, type: 'gst_certificate' });
    }

    // === PRODUCT CATALOG UPLOAD ===
    if (caption && (caption.toLowerCase().includes('product') || caption.toLowerCase().includes('catalog'))) {
      console.log('[DOCUMENT] Detected product catalog upload');
      await whatsappService.sendMessage(from, 'ðŸ“„ Product catalog received! Use `/products` command to import products.');
      return res.status(200).json({ ok: true, type: 'product_catalog' });
    }

    // === DEFAULT: Generic document received ===
    await whatsappService.sendMessage(from, 'ðŸ“„ Document received! If this is a shipping slip, please reply with "shipping slip" or send with "LR" in the caption.');
    return res.status(200).json({ ok: true, type: 'generic_document' });

  } catch (error) {
    console.error('[DOCUMENT] Error:', error);
    return res.status(200).json({ ok: true, error: error.message });
  }
};

/**
 * Handle shipping slip upload
 */
async function handleShippingSlipUpload(tenantId, customerPhone, fileUrl, caption, orderId = null) {
  try {
    console.log(`[SHIPPING_SLIP] Processing upload for ${customerPhone}`);

    // If no orderId provided, find the most recent order
    if (!orderId) {
      const { data: conversation } = await dbClient
        .from('conversations')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('end_user_phone', customerPhone)
        .single();

      if (conversation) {
        const { data: recentOrder } = await dbClient
          .from('orders')
          .select('id')
          .eq('tenant_id', tenantId)
          .eq('conversation_id', conversation.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .single();

        orderId = recentOrder?.id;
      }
    }

    if (!orderId) {
      await whatsappService.sendMessage(
        customerPhone,
        'âŒ No recent order found. Please place an order first.'
      );
      return;
    }

    // Process the shipping slip
    const result = await processShippingSlipUpload(tenantId, orderId, fileUrl);

    if (result.success) {
      // Send tracking information
      await whatsappService.sendMessage(customerPhone, result.message);

      // If we have tracking data, format and send it
      if (result.trackingData && result.trackingData.success) {
        const trackingMessage = formatTrackingMessage(result.trackingData);
        await whatsappService.sendMessage(customerPhone, trackingMessage);
      }

      // Clear awaiting state if exists
      await dbClient
        .from('conversations')
        .update({ state: null })
        .eq('tenant_id', tenantId)
        .eq('end_user_phone', customerPhone);

    } else {
      await whatsappService.sendMessage(
        customerPhone,
        result.message || 'âŒ Error processing shipping slip. Please try again or provide LR number manually.'
      );
    }

  } catch (error) {
    console.error('[SHIPPING_SLIP] Error:', error);
    await whatsappService.sendMessage(
      customerPhone,
      'âŒ Error processing shipping slip. Please contact support.'
    );
  }
}

// Legacy export for compatibility
exports.handle = async (tenant, message) => {
  // Create a mock request object
  const req = { message, tenant };
  const res = {
    status: () => ({ json: () => {} }),
    json: () => {}
  };
  return await exports.handleDocument(req, res);
};


