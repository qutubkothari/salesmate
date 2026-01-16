/**
 * Shipment Tracking Service
 * 
 * Handles shipment tracking for various logistics providers
 * - VRL Logistics
 * - Other transporters (can be extended)
 */

const axios = require('axios');
const cheerio = require('cheerio');
const { dbClient } = require('../config/database');

// Cloud Run scraper service URL
const SCRAPER_SERVICE_URL = process.env.VRL_SCRAPER_URL || 'https://vrl-scraper-557586370061.asia-south1.run.app';

/**
 * Track VRL Logistics shipment
 * Calls Cloud Run scraper service which has Puppeteer installed
 * @param {string} lrNumber - LR/Consignment number
 * @returns {Object} Tracking information
 */
async function trackVRLShipment(lrNumber) {
  try {
    console.log(`[VRL_TRACKING] Tracking LR: ${lrNumber}`);
    
    // If scraper service is configured, use it
    if (SCRAPER_SERVICE_URL) {
      try {
        console.log(`[VRL_TRACKING] Calling scraper service: ${SCRAPER_SERVICE_URL}`);
        
        const response = await axios.post(
          `${SCRAPER_SERVICE_URL}/track`,
          { lrNumber },
          { 
            timeout: 60000, // 60 second timeout
            headers: {
              'Content-Type': 'application/json'
            }
          }
        );
        
        console.log(`[VRL_TRACKING] Scraper response:`, response.data);
        
        if (response.data.success) {
          // Save to database for history
          // TODO: Implement database saving
          
          return {
            success: true,
            lrNumber,
            ...response.data
          };
        } else {
          console.log(`[VRL_TRACKING] Scraper failed, falling back to manual`);
          throw new Error(response.data.error || 'Scraping failed');
        }
        
      } catch (scraperError) {
        console.error(`[VRL_TRACKING] Scraper service error:`, scraperError.message);
        // Fall through to manual tracking
      }
    }
    
    // Fallback: Manual tracking
    console.log(`[VRL_TRACKING] Using manual tracking for LR: ${lrNumber}`);
    
    return {
      success: false,
      lrNumber,
      message: 'LR number saved. Will track and notify you of updates.',
      manualTrackingRequired: true,
      trackingUrl: 'https://www.vrlgroup.in/track_consignment.aspx',
      savedForTracking: true
    };

  } catch (error) {
    console.error('[VRL_TRACKING] Error:', error.message);
    
    return {
      success: false,
      lrNumber,
      error: error.message,
      manualTrackingRequired: true,
      trackingUrl: 'https://www.vrlgroup.in/track_consignment.aspx'
    };
  }
}

/**
 * Parse VRL Logistics HTML response
 * @param {string} html - HTML response
 * @param {string} lrNumber - LR number
 * @returns {Object} Parsed tracking data
 */
function parseVRLResponse(html, lrNumber) {
  try {
    const $ = cheerio.load(html);
    
    console.log('[VRL_PARSE] Starting to parse HTML response');
    
    const trackingInfo = {
      success: true,
      lrNumber,
      status: null,
      currentLocation: null,
      origin: null,
      destination: null,
      bookingDate: null,
      deliveryType: null,
      packages: null,
      latestUpdate: null,
      history: []
    };

    // VRL website uses JavaScript to populate data - look for JSON data in script tags
    $('script').each((i, elem) => {
      const scriptContent = $(elem).html();
      if (scriptContent && scriptContent.includes('Status')) {
        console.log('[VRL_PARSE] Found script with tracking data');
        
        // Try to extract JSON objects that match the pattern from console logs
        // Looking for: {Status: "IN-TRANSIT", eventDesc: "...", scanDate: "...", scanTime: "...", scannedLocation: "..."}
        const jsonMatches = scriptContent.match(/\{[^}]*Status[^}]*\}/g);
        if (jsonMatches) {
          console.log('[VRL_PARSE] Found JSON matches:', jsonMatches.length);
        }
      }
    });

    // Extract booking details from HTML structure
    // Look for table data with labels
    $('table tr').each((i, row) => {
      const $row = $(row);
      const label = $row.find('td:first-child, th:first-child').text().trim().toLowerCase();
      const value = $row.find('td:nth-child(2)').text().trim();
      
      if (label.includes('from')) {
        trackingInfo.origin = value;
      } else if (label.includes('to') && !label.includes('from')) {
        trackingInfo.destination = value;
      } else if (label.includes('booking date')) {
        trackingInfo.bookingDate = value;
      } else if (label.includes('package')) {
        trackingInfo.packages = value;
      } else if (label.includes('delivery type')) {
        trackingInfo.deliveryType = value;
      }
    });

    // Extract transit status from HTML - look for status badges or divs
    const statusElements = $('[class*="status"], [id*="status"]');
    statusElements.each((i, elem) => {
      const text = $(elem).text().trim();
      if (text && text.toLowerCase().includes('transit')) {
        trackingInfo.status = text;
      }
    });
    
    // Look for transit history in table format
    // Status | Datetime | Location | Description columns
    let foundHistoryHeader = false;
    $('table').each((tableIndex, table) => {
      const $table = $(table);
      const headers = $table.find('tr:first-child th, tr:first-child td');
      const headerText = headers.map((i, h) => $(h).text().trim().toLowerCase()).get().join('|');
      
      // Check if this table contains transit history
      if (headerText.includes('status') && (headerText.includes('location') || headerText.includes('date'))) {
        foundHistoryHeader = true;
        console.log('[VRL_PARSE] Found transit history table');
        
        $table.find('tr').each((rowIndex, row) => {
          if (rowIndex === 0) return; // Skip header
          
          const $row = $(row);
          const cells = $row.find('td');
          
          if (cells.length >= 3) {
            const status = $(cells[0]).text().trim();
            const datetime = $(cells[1]).text().trim();
            const location = $(cells[2]).text().trim();
            const description = cells.length >= 4 ? $(cells[3]).text().trim() : '';
            
            if (status && datetime && location) {
              trackingInfo.history.push({
                status,
                datetime,
                location,
                description: description || status
              });
            }
          }
        });
      }
    });
    
    // Set latest status from history
    if (trackingInfo.history.length > 0) {
      const latest = trackingInfo.history[0];
      trackingInfo.status = trackingInfo.status || latest.status;
      trackingInfo.currentLocation = latest.location;
      trackingInfo.latestUpdate = `${latest.datetime} - ${latest.description}`;
    }
    
    // Fallback: If no status found, set default
    if (!trackingInfo.status && (trackingInfo.origin || trackingInfo.history.length > 0)) {
      trackingInfo.status = 'In-transit';
    }

    console.log('[VRL_PARSE] Extracted data:', {
      hasOrigin: !!trackingInfo.origin,
      hasDestination: !!trackingInfo.destination,
      hasStatus: !!trackingInfo.status,
      historyCount: trackingInfo.history.length
    });
    
    // Validate we have at least some useful data
    if (trackingInfo.origin || trackingInfo.status || trackingInfo.history.length > 0) {
      return trackingInfo;
    }
    
    console.log('[VRL_PARSE] Insufficient data extracted');
    return null;

  } catch (error) {
    console.error('[VRL_PARSE] Parse error:', error.message);
    return null;
  }
}

/**
 * Save shipment tracking info to database
 * @param {string} orderId - Order ID
 * @param {string} lrNumber - LR/Consignment number
 * @param {string} transporter - Transporter name
 * @param {Object} trackingData - Tracking information
 */
async function saveShipmentTracking(orderId, lrNumber, transporter, trackingData) {
  try {
    const { data, error } = await dbClient
      .from('shipment_tracking')
      .upsert({
        order_id: orderId,
        lr_number: lrNumber,
        transporter_name: transporter,
        tracking_data: trackingData,
        last_status: trackingData.status,
        current_location: trackingData.currentLocation,
        last_checked_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'order_id'
      });

    if (error) {
      console.error('[SHIPMENT_TRACKING] Save error:', error);
      return { success: false, error };
    }

    console.log('[SHIPMENT_TRACKING] Saved tracking info for order:', orderId);
    return { success: true, data };

  } catch (error) {
    console.error('[SHIPMENT_TRACKING] Save error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Get shipment tracking status for an order
 * @param {string} orderId - Order ID
 * @returns {Object} Tracking information
 */
async function getShipmentStatus(orderId) {
  try {
    const { data, error } = await dbClient
      .from('shipment_tracking')
      .select('*')
      .eq('order_id', orderId)
      .single();

    if (error) {
      console.error('[SHIPMENT_TRACKING] Get error:', error);
      return { success: false, error };
    }

    return { success: true, data };

  } catch (error) {
    console.error('[SHIPMENT_TRACKING] Get error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Process uploaded shipping slip and extract LR number
 * @param {string} imageUrl - Uploaded image URL
 * @returns {Object} Extracted LR number
 */
async function extractLRFromShippingSlip(imageUrl) {
  try {
    console.log('[LR_EXTRACTION] Processing shipping slip:', imageUrl);

    // Use AI service to extract LR number from image
    const { analyzeImage } = require('./aiService');
    
    const prompt = `Extract the LR Number (also called Consignment Number or Docket Number) from this shipping slip.
    
Look for:
- LR No./LR Number
- Consignment No./CN No.
- Docket Number
- AWB Number

Return only the number, nothing else.`;

    const result = await analyzeImage(imageUrl, prompt);
    
    // Extract number from AI response
    const lrNumber = result.text?.match(/[A-Z0-9]{8,20}/)?.[0];
    
    if (lrNumber) {
      console.log('[LR_EXTRACTION] Successfully extracted LR:', lrNumber);
      return {
        success: true,
        lrNumber,
        imageUrl
      };
    }

    return {
      success: false,
      message: 'Could not extract LR number from shipping slip'
    };

  } catch (error) {
    console.error('[LR_EXTRACTION] Error:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Handle shipping slip upload and track shipment
 * @param {string} tenantId - Tenant ID
 * @param {string|null} orderId - Order ID (optional, will find recent order if not provided)
 * @param {string} imageUrl - Uploaded shipping slip URL
 * @param {string} phoneNumber - Customer phone number (optional)
 * @param {string} caption - Image caption (optional)
 */
async function processShippingSlipUpload(tenantId, orderId = null, imageUrl, phoneNumber = null, caption = null) {
  try {
    console.log('[SHIPPING_SLIP] Processing upload for order:', orderId || 'auto-detect');
    
    // Extract LR number from image
    const extraction = await extractLRFromShippingSlip(imageUrl);
    
    if (!extraction.success) {
      return {
        success: false,
        message: '❌ Could not read LR number from shipping slip. Please provide it manually.'
      };
    }

    // If no orderId provided, find the most recent order without LR number
    let targetOrderId = orderId;
    if (!targetOrderId) {
      const { data: recentOrders } = await dbClient
        .from('orders_new')
        .select('id, customer_phone')
        .eq('tenant_id', tenantId)
        .is('lr_number', null)
        .order('created_at', { ascending: false })
        .limit(1);
      
      if (recentOrders && recentOrders.length > 0) {
        targetOrderId = recentOrders[0].id;
        console.log('[SHIPPING_SLIP] Auto-selected order:', targetOrderId);
      } else {
        return {
          success: false,
          message: '❌ No recent orders found to associate with this LR copy.'
        };
      }
    }

    // Update order with LR number and slip URL
    await dbClient
      .from('orders_new')
      .update({
        lr_number: extraction.lrNumber,
        shipping_slip_url: imageUrl,
        shipping_slip_uploaded_at: new Date().toISOString()
      })
      .eq('id', targetOrderId);

    // Get transporter name from order
    const { data: order } = await dbClient
      .from('orders_new')
      .select('transporter_name')
      .eq('id', targetOrderId)
      .single();

    const transporter = order?.transporter_name || 'VRL Logistics';

    // Track shipment based on transporter
    let trackingData;
    if (transporter.toLowerCase().includes('vrl')) {
      trackingData = await trackVRLShipment(extraction.lrNumber);
    } else {
      trackingData = {
        success: false,
        message: `Tracking not yet supported for ${transporter}`
      };
    }

    // Save tracking info
    if (trackingData.success) {
      const { saveShipmentTracking } = require('./vrlTrackingService');
      await saveShipmentTracking(extraction.lrNumber, null, trackingData, null, tenantId, targetOrderId);
    }

    return {
      success: true,
      lrNumber: extraction.lrNumber,
      trackingData,
      message: trackingData.success 
        ? `✅ Shipping slip uploaded! LR: ${extraction.lrNumber}\n\n📦 Status: ${trackingData.status || 'In Transit'}`
        : `✅ Shipping slip uploaded! LR: ${extraction.lrNumber}\n\n📋 Track at: ${trackingData.trackingUrl}`
    };

  } catch (error) {
    console.error('[SHIPPING_SLIP] Processing error:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Format tracking status for customer message
 * @param {Object} trackingData - Tracking data
 * @returns {string} Formatted message
 */
function formatTrackingMessage(trackingData) {
  if (!trackingData.success) {
    return `📦 *Shipment Tracking*\n\nLR Number: ${trackingData.lrNumber}\n\n${trackingData.message || 'Tracking information not available'}\n\n🔗 Track manually: ${trackingData.trackingUrl}`;
  }

  let message = `📦 *VRL Shipment Tracking*\n\n`;
  message += `📋 *LR Number:* ${trackingData.lrNumber}\n`;
  message += `📊 *Status:* ${trackingData.status || 'In Transit'}\n\n`;
  
  // Booking Details section
  message += `*📍 Route Details:*\n`;
  if (trackingData.origin) {
    message += `   From: ${trackingData.origin}\n`;
  }
  if (trackingData.destination) {
    message += `   To: ${trackingData.destination}\n`;
  }
  if (trackingData.bookingDate) {
    message += `   Booked: ${trackingData.bookingDate}\n`;
  }
  if (trackingData.packages) {
    message += `   Packages: ${trackingData.packages}\n`;
  }
  if (trackingData.deliveryType) {
    message += `   Delivery Type: ${trackingData.deliveryType}\n`;
  }
  
  // Current status
  // We'll set this after processing history to use the correct location
  let currentLocationLine = '';
  if (trackingData.currentLocation) {
    currentLocationLine = `\n📌 *Current Location:* ${trackingData.currentLocation}\n`;
  }
  
  if (trackingData.latestUpdate) {
    message += `� *Latest Update:* ${trackingData.latestUpdate}\n`;
  }

  // Transit history
  if (trackingData.history && trackingData.history.length > 0) {
    // Filter out potentially incorrect entries (like "arrived at origin city")
    const filteredHistory = trackingData.history.filter(entry => {
      // Skip entries that say "arrived at" the origin city (doesn't make sense for outbound shipments)
      if (entry.description && entry.location &&
          entry.description.toLowerCase().includes('arrived at') &&
          entry.location.toLowerCase() === (trackingData.origin || '').toLowerCase()) {
        return false;
      }
      return true;
    });

    // Use the last location from filtered history as current location if available
    if (filteredHistory.length > 0) {
      const lastLocation = filteredHistory[filteredHistory.length - 1].location;
      currentLocationLine = `\n📌 *Current Location:* ${lastLocation}\n`;
    }

    if (filteredHistory.length > 0) {
      message += `\n*📜 Transit History:*\n`;
      filteredHistory.slice(0, 5).forEach((entry, index) => {
        const dateInfo = entry.datetime ? `${entry.datetime} - ` : '';
        message += `${index + 1}. ${dateInfo}${entry.description || entry.status}\n`;
        message += `   📍 ${entry.location}\n`;
      });
    }
  }
  
  // Add current location line after history processing
  message += currentLocationLine;
  
  message += `\n🔗 Track online: https://www.vrlgroup.in/track_consignment.aspx`;

  return message;
}

module.exports = {
  trackVRLShipment,
  saveShipmentTracking,
  getShipmentStatus,
  extractLRFromShippingSlip,
  processShippingSlipUpload,
  formatTrackingMessage
};


