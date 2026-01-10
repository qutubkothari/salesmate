const { checkShipmentsForUpdates } = require('../services/vrlTrackingService');
const whatsappService = require('../services/whatsappService');
const { dbClient } = require('../services/config');

/**
 * Handle /shipments command - list active shipments
 */
async function handleShipmentsCommand(phone, tenantId) {
  try {
    const { data: shipments, error } = await dbClient
      .from('shipment_tracking')
      .select('*')
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(20);
    
    if (error) throw error;
    
    if (!shipments || shipments.length === 0) {
      await whatsappService.sendMessage(phone, 'ðŸ“¦ *Active Shipments*\n\nNo active shipments found.');
      return;
    }
    
    let message = `ðŸ“¦ *Active Shipments* (${shipments.length})\n\n`;
    
    shipments.forEach((shipment, index) => {
      message += `${index + 1}. *LR: ${shipment.tracking_number}*\n`;
      message += `   Status: ${shipment.status}\n`;
      message += `   Location: ${shipment.current_location}\n`;
      if (shipment.customer_name) {
        message += `   Customer: ${shipment.customer_name}\n`;
      }
      message += `   Last checked: ${new Date(shipment.last_checked).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}\n\n`;
    });
    
    await whatsappService.sendMessage(phone, message);
    
  } catch (error) {
    console.error('[SHIPMENTS_CMD] Error:', error);
    await whatsappService.sendMessage(phone, 'âŒ Error fetching shipments: ' + error.message);
  }
}

/**
 * Handle /check_shipments command - manually trigger shipment checks
 */
async function handleCheckShipmentsCommand(phone, tenantId) {
  try {
    await whatsappService.sendMessage(phone, 'â³ Checking all active shipments...\nThis may take a few minutes.');
    
    const summary = await checkShipmentsForUpdates(whatsappService.sendMessage);
    
    let message = `âœ… *Shipment Check Complete*\n\n`;
    message += `ðŸ“Š Total checked: ${summary.total}\n`;
    message += `ðŸ”„ Updated: ${summary.updated}\n`;
    message += `ðŸ“¬ Notifications sent: ${summary.notified}\n`;
    
    if (summary.errors > 0) {
      message += `âš ï¸ Errors: ${summary.errors}\n`;
    }
    
    await whatsappService.sendMessage(phone, message);
    
  } catch (error) {
    console.error('[CHECK_SHIPMENTS_CMD] Error:', error);
    await whatsappService.sendMessage(phone, 'âŒ Error checking shipments: ' + error.message);
  }
}

/**
 * Handle /track <LR_NUMBER> command - track specific shipment
 */
async function handleTrackShipmentCommand(phone, tenantId, lrNumber) {
  const { trackVRLShipment, formatVRLTrackingMessage, saveShipmentTracking } = require('../services/vrlTrackingService');
  
  try {
    if (!lrNumber || !/^\d{10}$/.test(lrNumber)) {
      await whatsappService.sendMessage(phone, 'âŒ Invalid LR number. Please provide a 10-digit LR number.\n\nUsage: /track <LR_NUMBER>');
      return;
    }
    
    await whatsappService.sendMessage(phone, `â³ Tracking LR: ${lrNumber}...`);
    
    const result = await trackVRLShipment(lrNumber);
    
    if (result.success) {
      const message = formatVRLTrackingMessage(result.tracking);
      await whatsappService.sendMessage(phone, message);
      
      // Save to database
      await saveShipmentTracking(lrNumber, phone, result.tracking, null);
    } else {
      await whatsappService.sendMessage(phone, `âŒ Unable to track LR ${lrNumber}\n\nError: ${result.error}`);
    }
    
  } catch (error) {
    console.error('[TRACK_SHIPMENT_CMD] Error:', error);
    await whatsappService.sendMessage(phone, 'âŒ Error tracking shipment: ' + error.message);
  }
}

module.exports = {
  handleShipmentsCommand,
  handleCheckShipmentsCommand,
  handleTrackShipmentCommand
};

