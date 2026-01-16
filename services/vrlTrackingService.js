const axios = require('axios');
const { dbClient } = require('./config');

const VRL_SCRAPER_URL = process.env.VRL_SCRAPER_URL || 'https://vrl-scraper-557586370061.asia-south1.run.app/track';

/**
 * Track VRL shipment using Cloud Run scraper
 * @param {string} lrNumber - VRL LR number (10 digits)
 * @returns {Promise<Object>} Tracking data
 */
async function trackVRLShipment(lrNumber) {
  try {
    console.log(`[VRL_TRACKING] Tracking LR: ${lrNumber}`);
    
    const response = await axios.post(VRL_SCRAPER_URL, {
      lrNumber: lrNumber
    }, {
      timeout: 95000 // 95 seconds (scraper has 90s timeout)
    });
    
    if (response.data.success) {
      console.log(`[VRL_TRACKING] Success:`, response.data);
      return {
        success: true,
        carrier: 'VRL',
        tracking: response.data
      };
    } else {
      console.log(`[VRL_TRACKING] No data found for LR: ${lrNumber}`);
      return {
        success: false,
        error: 'No tracking data found'
      };
    }
  } catch (error) {
    console.error('[VRL_TRACKING] Error:', error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Format VRL tracking data for WhatsApp message
 * @param {Object} data - Tracking data from scraper
 * @returns {string} Formatted message
 */
function formatVRLTrackingMessage(data) {
  let message = `📦 *VRL Shipment Tracking*\n\n`;
  message += `📋 *LR Number:* ${data.lrNumber}\n`;
  message += `📊 *Status:* ${data.status}\n`;
  
  // Determine current location from the last history entry if available
  let currentLocation = data.currentLocation;
  if (data.history && data.history.length > 0) {
    // Filter out potentially incorrect entries (like "arrived at origin city")
    const filteredHistory = data.history.filter(entry => {
      // Skip entries that say "arrived at" the origin city (doesn't make sense for outbound shipments)
      if (entry.description && entry.location &&
          entry.description.toLowerCase().includes('arrived at') &&
          entry.location.toLowerCase() === (data.origin || '').toLowerCase()) {
        return false;
      }
      return true;
    });
    
    // Use the last location from filtered history as current location if available
    if (filteredHistory.length > 0) {
      currentLocation = filteredHistory[filteredHistory.length - 1].location;
    }
  }
  
  message += `📍 *Current Location:* ${currentLocation}\n`;
  
  if (data.origin) {
    message += `🏁 *From:* ${data.origin}\n`;
  }
  if (data.destination) {
    message += `🎯 *To:* ${data.destination}\n`;
  }
  
  message += `\n`;
  
  if (data.history && data.history.length > 0) {
    // Sort history by datetime ascending
    const sortedHistory = [...data.history].sort((a, b) => {
      const dateA = a.datetime ? new Date(a.datetime) : new Date(0);
      const dateB = b.datetime ? new Date(b.datetime) : new Date(0);
      return dateA - dateB;
    });
    message += `*📜 Tracking History:*\n`;
    sortedHistory.forEach((event, index) => {
      // Highlight the latest event
      const isLatest = index === sortedHistory.length - 1;
      const icon = isLatest ? '⭐' : (index === 0 ? '🔴' : '🟢');
      message += `\n${icon} *${event.status}*`;
      if (isLatest) message += ' (Latest Update)';
      message += `\n`;
      if (event.datetime) {
        message += `   📅 ${event.datetime}\n`;
      }
      if (event.location) {
        message += `   📍 ${event.location}\n`;
      }
    });
  }
  
  message += `\n\n💡 _Track updated: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}_`;
  
  return message;
}

/**
 * Save or update shipment tracking in database
 * @param {string} lrNumber - LR number
 * @param {string} phoneNumber - Customer phone number
 * @param {Object} trackingData - Tracking data from scraper
 * @param {string|null} customerProfileId - Customer profile UUID if available
 * @param {string|null} tenantId - Tenant UUID
 * @param {string|null} orderId - Order ID if available
 * @returns {Promise<Object>} Database record
 */
async function saveShipmentTracking(lrNumber, phoneNumber, trackingData, customerProfileId = null, tenantId = null, orderId = null) {
  try {
    // Check if tracking already exists for this LR number or order
    let existing = null;
    if (orderId) {
      const { data } = await dbClient
        .from('shipment_tracking')
        .select('*')
        .eq('order_id', orderId)
        .single();
      existing = data;
    } else {
      // For standalone tracking, check by LR number
      const { data } = await dbClient
        .from('shipment_tracking')
        .select('*')
        .eq('lr_number', lrNumber)
        .single();
      existing = data;
    }
    
    const trackingRecord = {
      order_id: orderId,
      lr_number: lrNumber,
      transporter_name: 'VRL',
      tracking_data: orderId ? trackingData : { ...trackingData, phone_number: phoneNumber }, // Store phone for standalone tracking
      last_status: trackingData.status,
      current_location: trackingData.currentLocation,
      destination: trackingData.destination,
      last_checked_at: new Date().toISOString()
    };
    
    if (existing) {
      // Update existing record
      const { data, error } = await dbClient
        .from('shipment_tracking')
        .update(trackingRecord)
        .eq('id', existing.id)
        .select()
        .single();
      
      if (error) throw error;
      
      // Save history events
      await saveTrackingHistory(data.id, trackingData.history);
      
      console.log(`[VRL_TRACKING] Updated tracking record ID: ${data.id}`);
      return data;
    } else {
      // Insert new record
      const { data, error } = await dbClient
        .from('shipment_tracking')
        .insert([trackingRecord])
        .select()
        .single();
      
      if (error) throw error;
      
      // Save history events
      await saveTrackingHistory(data.id, trackingData.history);
      
      console.log(`[VRL_TRACKING] Created tracking record ID: ${data.id}`);
      return data;
    }
  } catch (error) {
    console.error('[VRL_TRACKING] Error saving to database:', error);
    throw error;
  }
}

/**
 * Save tracking history events
 * @param {number} shipmentTrackingId - Shipment tracking ID
 * @param {Array} history - Array of tracking events
 */
async function saveTrackingHistory(shipmentTrackingId, history) {
  if (!history || history.length === 0) return;
  
  try {
    // Delete existing history
    await dbClient
      .from('shipment_tracking_history')
      .delete()
      .eq('shipment_tracking_id', shipmentTrackingId);
    
    // Insert new history
    const historyRecords = history.map(event => ({
      shipment_tracking_id: shipmentTrackingId,
      status: event.status,
      location: event.location,
      event_datetime: event.datetime ? parseVRLDateTime(event.datetime) : null,
      description: event.description,
      event_data: event
    }));
    
    const { error } = await dbClient
      .from('shipment_tracking_history')
      .insert(historyRecords);
    
    if (error) throw error;
    
    console.log(`[VRL_TRACKING] Saved ${historyRecords.length} history events`);
  } catch (error) {
    console.error('[VRL_TRACKING] Error saving history:', error);
  }
}

/**
 * Parse VRL date/time format to ISO timestamp
 * @param {string} datetime - Date like "16-Oct-2025 08:10"
 * @returns {string|null} ISO timestamp
 */
function parseVRLDateTime(datetime) {
  if (!datetime) return null;
  
  try {
    // Format: "16-Oct-2025 08:10" or just "16-Oct-2025"
    const parts = datetime.trim().split(' ');
    const datePart = parts[0]; // "16-Oct-2025"
    const timePart = parts[1] || '00:00'; // "08:10" or default
    
    const [day, month, year] = datePart.split('-');
    const [hours, minutes] = timePart.split(':');
    
    const monthMap = {
      'Jan': 0, 'Feb': 1, 'Mar': 2, 'Apr': 3, 'May': 4, 'Jun': 5,
      'Jul': 6, 'Aug': 7, 'Sep': 8, 'Oct': 9, 'Nov': 10, 'Dec': 11
    };
    
    const date = new Date(
      parseInt(year),
      monthMap[month],
      parseInt(day),
      parseInt(hours),
      parseInt(minutes)
    );
    
    return date.toISOString();
  } catch (error) {
    console.error('[VRL_TRACKING] Error parsing datetime:', datetime, error);
    return null;
  }
}

/**
 * Check if shipment is delivered
 * @param {string} status - Shipment status
 * @returns {boolean}
 */
function isDelivered(status) {
  if (!status) return false;
  const lowerStatus = status.toLowerCase();
  return lowerStatus.includes('delivered') || 
         lowerStatus.includes('delivery completed') ||
         lowerStatus.includes('pod');
}

/**
 * Get all active shipments for periodic checking
 * @returns {Promise<Array>} Active shipment records
 */
async function getActiveShipments() {
  try {
    // Get shipments linked to orders
    const { data: orderShipments, error: orderError } = await dbClient
      .from('shipment_tracking')
      .select(`
        *,
        orders!inner(
          customer_profile_id,
          customer_profiles!inner(phone)
        )
      `)
      .is('actual_delivery_date', null) // Not delivered yet
      .not('order_id', 'is', null); // Has order_id
    
    if (orderError) throw orderError;
    
    // Get standalone shipments (no order_id)
    const { data: standaloneShipments, error: standaloneError } = await dbClient
      .from('shipment_tracking')
      .select('*')
      .is('actual_delivery_date', null) // Not delivered yet
      .is('order_id', null); // No order_id
    
    if (standaloneError) throw standaloneError;
    
    // Combine and transform data
    const allShipments = [
      ...(orderShipments || []).map(shipment => ({
        ...shipment,
        phone_number: shipment.orders?.customer_profiles?.phone,
        tracking_number: shipment.lr_number,
        status: shipment.last_status
      })),
      ...(standaloneShipments || []).map(shipment => ({
        ...shipment,
        phone_number: shipment.tracking_data?.phone_number,
        tracking_number: shipment.lr_number,
        status: shipment.last_status
      }))
    ];
    
    // Sort by last_checked_at and limit
    return allShipments
      .sort((a, b) => new Date(a.last_checked_at) - new Date(b.last_checked_at))
      .slice(0, 100);
      
  } catch (error) {
    console.error('[VRL_TRACKING] Error getting active shipments:', error);
    return [];
  }
}

/**
 * Check for status updates and notify customers
 * @param {Function} sendMessageFunc - Function to send WhatsApp message
 * @returns {Promise<Object>} Summary of checks
 */
async function checkShipmentsForUpdates(sendMessageFunc) {
  const summary = {
    total: 0,
    updated: 0,
    notified: 0,
    errors: 0
  };
  
  try {
    const shipments = await getActiveShipments();
    summary.total = shipments.length;
    
    console.log(`[VRL_TRACKING] Checking ${shipments.length} active shipments...`);
    
    for (const shipment of shipments) {
      try {
        // Track shipment
        const result = await trackVRLShipment(shipment.tracking_number);
        
        if (result.success) {
          const oldStatus = shipment.last_status;
          const newStatus = result.tracking.status;
          
          // Check if status changed
          if (oldStatus !== newStatus) {
            console.log(`[VRL_TRACKING] Status changed for ${shipment.lr_number}: ${oldStatus} → ${newStatus}`);
            
            // Update database
            const updateData = {
              last_status: newStatus,
              current_location: result.tracking.currentLocation,
              tracking_data: result.tracking,
              last_checked_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            };
            
            // If delivered, set delivery date
            if (isDelivered(newStatus)) {
              updateData.actual_delivery_date = new Date().toISOString();
            }
            
            await dbClient
              .from('shipment_tracking')
              .update(updateData)
              .eq('id', shipment.id);
            
            summary.updated++;
            
            // Send notification to customer (only if not delivered, or if this is the delivery notification)
            if (sendMessageFunc && shipment.phone_number && (!isDelivered(newStatus) || isDelivered(newStatus))) {
              const message = `🔔 *Shipment Update*\n\n${formatVRLTrackingMessage(result.tracking)}`;
              
              try {
                await sendMessageFunc(shipment.phone_number, message);
                
                summary.notified++;
              } catch (msgError) {
                console.error(`[VRL_TRACKING] Error sending notification:`, msgError);
              }
            }
          } else {
            // Update last checked time even if no status change
            await dbClient
              .from('shipment_tracking')
              .update({ 
                last_checked_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
              })
              .eq('id', shipment.id);
          }
        } else {
          console.log(`[VRL_TRACKING] Failed to track ${shipment.lr_number}: ${result.error}`);
        }
        
        // Small delay between requests to avoid overloading
        await new Promise(resolve => setTimeout(resolve, 2000));
        
      } catch (error) {
        console.error(`[VRL_TRACKING] Error checking shipment ${shipment.tracking_number}:`, error);
        summary.errors++;
      }
    }
    
    console.log(`[VRL_TRACKING] Check complete:`, summary);
    return summary;
    
  } catch (error) {
    console.error('[VRL_TRACKING] Error in checkShipmentsForUpdates:', error);
    return summary;
  }
}

module.exports = {
  trackVRLShipment,
  formatVRLTrackingMessage,
  saveShipmentTracking,
  getActiveShipments,
  checkShipmentsForUpdates,
  isDelivered
};


