/**
 * Shipment Tracking Commands
 * 
 * Commands for managing shipment tracking:
 * - /track <lr_number> - Track shipment by LR number
 * - /upload_lr - Request customer to upload shipping slip
 * - /shipment_status - Check status of current order
 */

const { dbClient } = require('../config/database');
const { sendMessage } = require('../services/whatsappService');
const { trackVRLShipment, formatTrackingMessage, getShipmentStatus } = require('../services/shipmentTrackingService');

/**
 * Request customer to upload shipping slip
 */
async function requestShippingSlipUpload(tenantId, customerPhone, orderId) {
  try {
    console.log(`[TRACKING_CMD] Requesting shipping slip for order ${orderId}`);

    // Set conversation state
    await dbClient
      .from('conversations')
      .update({
        state: 'awaiting_shipping_slip',
        context_data: { order_id: orderId }
      })
      .eq('tenant_id', tenantId)
      .eq('end_user_phone', customerPhone);

    // Send request message
    const message = `ðŸ“¦ *Shipment Tracking*

Please upload your shipping slip/LR copy so we can track your order.

ðŸ“¸ *How to upload:*
1. Take a clear photo of the LR/Consignment slip
2. Send it as an image with caption "LR" or "Shipping Slip"

Or reply with the LR number if you have it.`;

    await sendMessage(customerPhone, message);
    
    return { success: true };

  } catch (error) {
    console.error('[TRACKING_CMD] Error requesting slip:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Track shipment by LR number
 */
async function trackShipmentByLR(lrNumber, transporter = 'VRL Logistics') {
  try {
    console.log(`[TRACKING_CMD] Tracking LR: ${lrNumber}`);

    let trackingData;

    // Route to appropriate tracker based on transporter
    if (transporter.toLowerCase().includes('vrl')) {
      trackingData = await trackVRLShipment(lrNumber);
    } else {
      trackingData = {
        success: false,
        lrNumber,
        message: `Tracking not yet supported for ${transporter}`
      };
    }

    return trackingData;

  } catch (error) {
    console.error('[TRACKING_CMD] Error tracking:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Get shipment status for customer's recent order
 */
async function getCustomerShipmentStatus(tenantId, customerPhone) {
  try {
    console.log(`[TRACKING_CMD] Getting status for ${customerPhone}`);

    // Get customer's most recent order with shipping info
    const { data: conversation } = await dbClient
      .from('conversations')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('end_user_phone', customerPhone)
      .single();

    if (!conversation) {
      return {
        success: false,
        message: 'No conversation found'
      };
    }

    const { data: order } = await dbClient
      .from('orders')
      .select('id, lr_number, transporter_name, shipping_slip_uploaded_at')
      .eq('tenant_id', tenantId)
      .eq('conversation_id', conversation.id)
      .not('lr_number', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (!order) {
      return {
        success: false,
        message: 'âŒ No shipped orders found. Please upload your shipping slip first.'
      };
    }

    // Get tracking status from database
    const trackingStatus = await getShipmentStatus(order.id);

    if (trackingStatus.success && trackingStatus.data) {
      return {
        success: true,
        trackingData: trackingStatus.data.tracking_data,
        lrNumber: order.lr_number
      };
    }

    // If not in database, fetch from transporter
    const trackingData = await trackShipmentByLR(order.lr_number, order.transporter_name);
    return {
      success: trackingData.success,
      trackingData,
      lrNumber: order.lr_number
    };

  } catch (error) {
    console.error('[TRACKING_CMD] Error getting status:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Handle track command from customer
 */
async function handleTrackCommand(tenantId, customerPhone, commandText) {
  try {
    console.log(`[TRACKING_CMD] Processing command: ${commandText}`);

    // Extract LR number from command if provided
    const lrMatch = commandText.match(/track\s+([A-Z0-9]{8,20})/i);
    
    if (lrMatch) {
      // Track specific LR number
      const lrNumber = lrMatch[1];
      const trackingData = await trackShipmentByLR(lrNumber);
      const message = formatTrackingMessage(trackingData);
      await sendMessage(customerPhone, message);
      return { success: true };
    }

    // No LR provided, get status of recent order
    const statusResult = await getCustomerShipmentStatus(tenantId, customerPhone);
    
    if (statusResult.success) {
      const message = formatTrackingMessage(statusResult.trackingData);
      await sendMessage(customerPhone, message);
    } else {
      await sendMessage(customerPhone, statusResult.message);
    }

    return { success: true };

  } catch (error) {
    console.error('[TRACKING_CMD] Error handling command:', error);
    await sendMessage(customerPhone, 'âŒ Error processing tracking request. Please try again.');
    return { success: false, error: error.message };
  }
}

/**
 * Handle manual LR number input from customer
 */
async function handleManualLRInput(tenantId, customerPhone, lrNumber) {
  try {
    console.log(`[TRACKING_CMD] Processing manual LR: ${lrNumber}`);

    // Find recent order without LR
    const { data: conversation } = await dbClient
      .from('conversations')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('end_user_phone', customerPhone)
      .single();

    if (conversation) {
      const { data: order } = await dbClient
        .from('orders')
        .select('id, transporter_name')
        .eq('tenant_id', tenantId)
        .eq('conversation_id', conversation.id)
        .is('lr_number', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (order) {
        // Update order with LR number
        await dbClient
          .from('orders')
          .update({
            lr_number: lrNumber,
            shipping_slip_uploaded_at: new Date().toISOString()
          })
          .eq('id', order.id);

        // Track shipment
        const trackingData = await trackShipmentByLR(lrNumber, order.transporter_name);
        
        // Send tracking info
        const message = `âœ… LR Number saved: ${lrNumber}\n\n` + formatTrackingMessage(trackingData);
        await sendMessage(customerPhone, message);

        // Clear state
        await dbClient
          .from('conversations')
          .update({ state: null })
          .eq('tenant_id', tenantId)
          .eq('end_user_phone', customerPhone);

        return { success: true };
      }
    }

    // Just track the LR number
    const trackingData = await trackShipmentByLR(lrNumber);
    const message = formatTrackingMessage(trackingData);
    await sendMessage(customerPhone, message);

    return { success: true };

  } catch (error) {
    console.error('[TRACKING_CMD] Error handling manual LR:', error);
    return { success: false, error: error.message };
  }
}

module.exports = {
  requestShippingSlipUpload,
  trackShipmentByLR,
  getCustomerShipmentStatus,
  handleTrackCommand,
  handleManualLRInput
};

