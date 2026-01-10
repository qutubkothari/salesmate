const {
  trackVRLShipment,
  formatVRLTrackingMessage,
  saveShipmentTracking
} = require('../services/vrlTrackingService');

/**
 * Handle shipment tracking request
 * Detects LR numbers from customer messages and provides tracking info
 */
async function handleShipmentTracking(sessionId, message, from, conversationContext, sendMessage) {
  try {
    console.log(`[SHIPMENT_TRACKING] Processing message from ${from}`);
    
    // Only treat a 10-digit number as LR if message context is tracking-related and NOT transporter/contact
    const trackingKeywords = ['track', 'tracking', 'status', 'shipment', 'consignment', 'lr', 'docket'];
    const transporterKeywords = ['transporter', 'contact', 'shipping address', 'address', 'phone'];
    const lowerMsg = message.toLowerCase();
    const lrNumberMatch = message.match(/\b\d{10}\b/);
    const isTrackingQuery = trackingKeywords.some(keyword => lowerMsg.includes(keyword));
    const isTransporterContext = transporterKeywords.some(keyword => lowerMsg.includes(keyword));

    if (!lrNumberMatch || isTransporterContext) {
      // If transporter/contact context, do NOT treat as LR
      if (isTrackingQuery && !isTransporterContext) {
        await sendMessage(from, 
          `ðŸ“¦ *Shipment Tracking*\n\n` +
          `To track your VRL shipment, please provide your 10-digit LR number.\n\n` +
          `For example: "Track my shipment 1099492944"`
        );
        return true;
      }
      return false; // Not a tracking request
    }

    const lrNumber = lrNumberMatch[0];
    console.log(`[SHIPMENT_TRACKING] Detected LR number: ${lrNumber}`);
    
    // Send "tracking..." message
    await sendMessage(from, 
      `â³ Tracking your shipment...\nðŸ“‹ LR Number: ${lrNumber}\n\nPlease wait 20-30 seconds...`
    );
    
    // Track the shipment
    const result = await trackVRLShipment(lrNumber);
    
    if (result.success) {
      // Format and send tracking info
      const trackingMessage = formatVRLTrackingMessage(result.tracking);
      await sendMessage(from, trackingMessage);
      
      // Save to database
      try {
        // Try to get customer profile ID and tenant ID from phone number
        const { dbClient } = require('../services/config');
        const { data: customerProfile } = await dbClient
          .from('customer_profiles')
          .select('id, tenant_id')
          .eq('phone', from)
          .single();
        
        await saveShipmentTracking(
          lrNumber,
          from,
          result.tracking,
          customerProfile?.id,
          customerProfile?.tenant_id
        );
        
        console.log(`[SHIPMENT_TRACKING] Saved tracking for ${lrNumber}`);
      } catch (dbError) {
        console.error('[SHIPMENT_TRACKING] Error saving to database:', dbError);
        // Continue even if database save fails
      }
      
      // Update conversation context
      conversationContext.lastShipmentTracked = lrNumber;
      conversationContext.lastActivity = 'shipment_tracking';
      
      return true;
      
    } else {
      // Tracking failed
      await sendMessage(from, 
        `âŒ *Unable to Track Shipment*\n\n` +
        `LR Number: ${lrNumber}\n\n` +
        `Please check:\n` +
        `â€¢ LR number is correct (10 digits)\n` +
        `â€¢ Shipment is with VRL Logistics\n` +
        `â€¢ Try again in a few minutes\n\n` +
        `If the issue persists, please contact our support team.`
      );
      
      return true;
    }
    
  } catch (error) {
    console.error('[SHIPMENT_TRACKING] Error:', error);
    await sendMessage(from, 
      `âŒ Sorry, there was an error tracking your shipment. Please try again later.`
    );
    return false;
  }
}

/**
 * Handle manual track command
 * Command: /track <LR_NUMBER> or !track <LR_NUMBER>
 */
async function handleTrackCommand(sessionId, message, from, conversationContext, sendMessage) {
  try {
    // Extract LR number from command
    const commandMatch = message.match(/^[\/!]track\s+(\d{10})/i);
    
    if (!commandMatch) {
      await sendMessage(from, 
        `âŒ *Invalid Command*\n\n` +
        `Usage: /track <LR_NUMBER>\n` +
        `Example: /track 1099492944`
      );
      return;
    }
    
    const lrNumber = commandMatch[1];
    
    // Use the same handler
    await handleShipmentTracking(sessionId, lrNumber, from, conversationContext, sendMessage);
    
  } catch (error) {
    console.error('[TRACK_COMMAND] Error:', error);
    await sendMessage(from, 
      `âŒ Sorry, there was an error processing your command. Please try again.`
    );
  }
}

/**
 * Check if message contains shipment tracking intent
 */
function isShipmentTrackingIntent(message) {
  const trackingPatterns = [
    /\b\d{10}\b/, // 10-digit number
    /track.*shipment/i,
    /track.*consignment/i,
    /track.*lr/i,
    /where.*my.*shipment/i,
    /shipment.*status/i,
    /delivery.*status/i
  ];
  
  return trackingPatterns.some(pattern => pattern.test(message));
}

module.exports = {
  handleShipmentTracking,
  handleTrackCommand,
  isShipmentTrackingIntent
};

