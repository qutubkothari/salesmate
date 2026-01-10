/**
 * TEST: Directly update customer_profiles with known values and log result
 */
async function testCustomerProfileUpdate() {
  const tenantId = 'a10aa26a-b5f9-4afe-87cc-70bfb4d1f6e6';
  const customerPhone = '919106886259@c.us';
  const updateFields = {
    default_shipping_address: 'C606, Hatimi Hills',
    default_shipping_city: 'Pune',
    default_shipping_state: 'Maharashtra',
    default_shipping_pincode: '411060',
    default_transporter_name: 'VRL Logistics',
    default_transporter_contact: '9537653927'
  };
  console.log('[TEST] Attempting to update customer_profiles for tenantId:', tenantId, 'phone:', customerPhone);
  const updateResult = await dbClient
    .from('customer_profiles')
    .update(updateFields)
    .eq('tenant_id', tenantId)
    .eq('phone', customerPhone);
  console.log('[TEST] Update result:', updateResult);
  if (updateResult.error) {
    console.error('[TEST][ERROR] Customer profile update failed:', updateResult.error);
  } else {
    console.log('[TEST] Customer profile update succeeded:', updateResult.data);
  }
}

module.exports.testCustomerProfileUpdate = testCustomerProfileUpdate;
const { dbClient } = require('../config/database');
const { sendMessage } = require('./whatsappService');

/**
 * SHIPPING INFO COLLECTION SERVICE
 * Asks customer for shipping address and transporter details after order placement
 */

/**
 * Get previous shipping address from customer profile or recent orders
 */
async function getPreviousShippingAddress(tenantId, customerPhone) {
  try {
    // First check customer profile for default address
    const { data: profile } = await dbClient
      .from('customer_profiles')
      .select('default_shipping_address, default_shipping_city, default_shipping_state, default_shipping_pincode, default_transporter_name')
      .eq('tenant_id', tenantId)
      .eq('phone', customerPhone)
      .single();

    if (profile?.default_shipping_address) {
      console.log('[SHIPPING] Found default address in customer profile');
      return {
        hasAddress: true,
        address: profile.default_shipping_address,
        city: profile.default_shipping_city,
        state: profile.default_shipping_state,
        pincode: profile.default_shipping_pincode,
        transporter: profile.default_transporter_name,
        source: 'profile'
      };
    }

    // Check recent orders for shipping address
    const { data: conversation } = await dbClient
      .from('conversations')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('end_user_phone', customerPhone)
      .single();

    if (conversation) {
      const { data: recentOrder } = await dbClient
        .from('orders')
        .select('shipping_address, transporter_name, transporter_contact')
        .eq('tenant_id', tenantId)
        .eq('conversation_id', conversation.id)
        .not('shipping_address', 'is', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (recentOrder?.shipping_address) {
        console.log('[SHIPPING] Found address from recent order');
        return {
          hasAddress: true,
          address: recentOrder.shipping_address,
          transporter: recentOrder.transporter_name,
          contact: recentOrder.transporter_contact,
          source: 'recent_order'
        };
      }
    }

    console.log('[SHIPPING] No previous address found');
    return { hasAddress: false };

  } catch (error) {
    console.error('[SHIPPING] Error checking previous address:', error);
    return { hasAddress: false };
  }
}

/**
 * Ask customer for shipping information (only if no previous address exists)
 */
async function requestShippingInfo(tenantId, customerPhone, orderId, orderDetails) {
  try {
    console.log(`[SHIPPING] Requesting shipping info for order ${orderId} from ${customerPhone}`);
    console.log(`[SHIPPING] Tenant ID: ${tenantId}`);
    console.log(`[SHIPPING] Order details: ${orderDetails}`);

    // Check for previous shipping address
    const previousAddress = await getPreviousShippingAddress(tenantId, customerPhone);
    console.log(`[SHIPPING] Previous address check result:`, previousAddress);

    if (previousAddress.hasAddress) {
      console.log(`[SHIPPING] Found previous address from ${previousAddress.source}, using it automatically`);
      
      // Use previous address automatically
      await dbClient
        .from('orders')
        .update({
          shipping_address: previousAddress.address,
          transporter_name: previousAddress.transporter || null,
          transporter_contact: previousAddress.contact || null,
          shipping_collected_at: new Date().toISOString()
        })
        .eq('id', orderId);

      // Update Zoho
      try {
        await updateZohoSalesOrderNotes(orderId);
      } catch (zohoError) {
        console.error('[SHIPPING] Zoho update failed (non-blocking):', zohoError.message);
      }

      // Send confirmation with option to update
      const message = `âœ… *Order Confirmed!*

ðŸ“¦ *Order Summary:*
${orderDetails}

---

ðŸšš *Using your saved shipping details:*

ðŸ“ *Address:* ${previousAddress.address}${previousAddress.city ? `, ${previousAddress.city}` : ''}${previousAddress.state ? `, ${previousAddress.state}` : ''}${previousAddress.pincode ? ` - ${previousAddress.pincode}` : ''}
${previousAddress.transporter ? `ðŸšš *Transporter:* ${previousAddress.transporter}` : ''}

---

_To update your shipping address, reply with:_
*"update my shipping address"*`;

      await sendMessage(customerPhone, message);
      return { success: true, usedPreviousAddress: true };
    }

    // No previous address - ask for it
    const message = `âœ… *Order Confirmed!*

ðŸ“¦ *Order Summary:*
${orderDetails}

---

ðŸšš To complete your order, please provide:

*1. Shipping Address:*
(Full address with pincode)

*2. Transporter Details:*
(Preferred courier/transporter name)

*3. Transporter Contact:*
(Phone number for delivery coordination)

Please reply with all three details.`;

    // Send message
    await sendMessage(customerPhone, message);

    // Update conversation state
    const newMetadata = {
      ...await getConversationMetadata(tenantId, customerPhone),
      pending_shipping_order_id: orderId,
      shipping_request_sent_at: new Date().toISOString()
    };
    const updateResult = await dbClient
      .from('conversations')
      .update({
        state: 'awaiting_shipping_info',
        metadata: newMetadata
      })
      .eq('tenant_id', tenantId)
      .eq('end_user_phone', customerPhone);

    console.log(`[SHIPPING] Request sent for order ${orderId}`);
    console.log('[SHIPPING][DEBUG] Metadata update result:', updateResult);
    console.log('[SHIPPING][DEBUG] New metadata:', newMetadata);
    return { success: true, usedPreviousAddress: false };

  } catch (error) {
    console.error('[SHIPPING] Error requesting shipping info:', error);
    throw error;
  }
}

/**
 * Extract city, state, and pincode from address string
 */
function extractAddressComponents(address) {
  if (!address) {
    return { city: null, state: null, pincode: null };
  }

  let city = null;
  let state = null;
  let pincode = null;

  // Extract 6-digit pincode
  const pincodeMatch = address.match(/\b\d{6}\b/);
  if (pincodeMatch) {
    pincode = pincodeMatch[0];
  }

  // Common Indian states (partial list)
  const states = [
    'Maharashtra', 'Delhi', 'Karnataka', 'Tamil Nadu', 'Gujarat',
    'Rajasthan', 'Uttar Pradesh', 'West Bengal', 'Madhya Pradesh',
    'Andhra Pradesh', 'Telangana', 'Kerala', 'Punjab', 'Haryana',
    'Bihar', 'Odisha', 'Assam', 'Jharkhand', 'Chhattisgarh', 'Goa'
  ];

  // Try to find state name
  for (const stateName of states) {
    const regex = new RegExp(`\\b${stateName}\\b`, 'i');
    if (regex.test(address)) {
      state = stateName;
      break;
    }
  }

  // Extract city - look for word before state or pincode
  // Common patterns: "City Name, State" or "City Name - Pincode"
  const cityPatterns = [
    // "Pune, Maharashtra" or "Pune Maharashtra"
    new RegExp(`([A-Z][a-z]+(?:\\s+[A-Z][a-z]+)?)\\s*,?\\s*${state}`, 'i'),
    // "Pune 411060" or "Pune - 411060"
    new RegExp(`([A-Z][a-z]+(?:\\s+[A-Z][a-z]+)?)\\s*[-,]?\\s*${pincode}`, 'i'),
    // Fallback: Last word before pincode/state
    /,\s*([A-Za-z\s]+?)\s*[-,]?\s*\d{6}/,
    /,\s*([A-Za-z\s]+?)\s*$/
  ];

  for (const pattern of cityPatterns) {
    const match = address.match(pattern);
    if (match && match[1]) {
      city = match[1].trim();
      break;
    }
  }

  console.log(`[ADDRESS_EXTRACTION] Input: "${address}"`);
  console.log(`[ADDRESS_EXTRACTION] Result:`, { city, state, pincode });

  return { city, state, pincode };
}

/**
 * Parse shipping info from customer message
 */
function parseShippingInfo(messageText) {
  try {
    // Try to extract structured info
    const lines = messageText.split('\n').filter(line => line.trim());

    let shippingAddress = '';
    let transporterName = '';
    let transporterContact = '';

    // Remove bold markers and other markdown first
    const cleanedText = messageText.replace(/\*\*/g, '').replace(/\*/g, '');

    // FIRST: Try label-based format (address:, transporter:, contact:)
    // Match "address:" or "shipping address:" followed by the value (stops at next label)
    const addressLabelMatch = cleanedText.match(/(?:^|\n)(?:address|shipping\s*address)\s*:\s*\n?\s*([^\n]+(?:\n(?!(?:transporter|contact)\s*(?:details|:))[^\n]+)*)/i);
    // Match "transporter:" or "transporter details" (with or without colon) followed by value
    const transporterLabelMatch = cleanedText.match(/(?:^|\n)transporter(?:\s+(?:name|details))?\s*:?\s*\n\s*([^\n]+(?:\n(?!(?:transporter\s+contact|contact)\s*:?)[^\n]+)*)/i);
    // Match "contact:" or "transporter contact:" or "transporter contact" (with or without colon) followed by value
    const contactLabelMatch = cleanedText.match(/(?:^|\n)(?:transporter\s+)?contact\s*:?\s*\n?\s*([^\n]+)/i);

    if (addressLabelMatch) {
      shippingAddress = addressLabelMatch[1]
        .replace(/transporter\s*:.*/i, '') // Remove transporter section if captured
        .trim();
      console.log('[SHIPPING_PARSE] Found address via label:', shippingAddress);
    }
    if (transporterLabelMatch) {
      transporterName = transporterLabelMatch[1]
        .replace(/(?:transporter\s+)?contact\s*:.*/i, '') // Remove contact section if captured
        .trim();
      console.log('[SHIPPING_PARSE] Found transporter via label:', transporterName);
    }
    if (contactLabelMatch) {
      const rawContact = contactLabelMatch[1].trim();
      let cleanedContact = rawContact.replace(/\s+/g, '').replace(/[^\d+]/g, '');
      if (/^\d{6}$/.test(cleanedContact)) {
        transporterContact = '';
      } else if (/^(\+?\d{10,})$/.test(cleanedContact)) {
        transporterContact = cleanedContact;
      }
      console.log('[SHIPPING_PARSE] Found contact via label:', transporterContact);
    }

    // SECOND: Try numbered format (1. 2. 3. or 1: 2: 3:)
    if (!shippingAddress || !transporterName) {
      const addressMatch = cleanedText.match(/1[.\):]?\s*(?:Shipping Address:?)?\s*\n?\s*([^\n]+(?:\n(?![23][.\):])[^\n]+)*)/i);
      const transporterMatch = cleanedText.match(/2[.\):]?\s*(?:Transporter Details:?)?\s*\n?\s*([^\n]+(?:\n(?!3[.\):])[^\n]+)*)/i);
      const contactMatch = cleanedText.match(/3[.\):]?\s*(?:Transporter Contact:?)?\s*\n?\s*([^\n]+)/i);

      if (addressMatch) {
        // Clean up address - remove extra newlines and labels
        shippingAddress = addressMatch[1]
          .replace(/\(.*?\)/g, '') // Remove anything in parentheses like (Full address with pincode)
          .replace(/\n+/g, ' ')    // Replace newlines with space
          .trim();
      }
      if (transporterMatch) {
        // Clean up transporter name
        transporterName = transporterMatch[1]
          .replace(/\(.*?\)/g, '')
          .replace(/\n+/g, ' ')
          .trim();
      }
      if (contactMatch) {
        // Extract and format phone number - only from the contact line
        const rawContact = contactMatch[1].trim();
        // Format phone number: remove spaces, keep + and digits only
        let cleanedContact = rawContact.replace(/\s+/g, '').replace(/[^\d+]/g, '').trim();
        // Only accept as contact if it is a valid phone number (10+ digits, not a 6-digit pincode)
        if (/^\d{6}$/.test(cleanedContact)) {
          // Looks like a pincode, not a phone number
          transporterContact = '';
        } else if (/^(\+?\d{10,})$/.test(cleanedContact)) {
          transporterContact = cleanedContact;
        } else {
          transporterContact = '';
        }
      }
    }

    // THIRD: If numbered format didn't work, try line-by-line
    if (!shippingAddress && lines.length >= 3) {
      shippingAddress = lines[0].trim();
      transporterName = lines[1].trim();
      let possibleContact = lines[2].replace(/\s+/g, '').replace(/[^\d+]/g, '').trim();
      if (/^\d{6}$/.test(possibleContact)) {
        transporterContact = '';
      } else if (/^(\+?\d{10,})$/.test(possibleContact)) {
        transporterContact = possibleContact;
      } else {
        transporterContact = '';
      }
    }

    // If still nothing, try to find phone number and address
    if (!shippingAddress) {
      const phoneRegex = /\+?[\d\s-]{10,}/;
      const phoneMatches = messageText.match(phoneRegex);
      if (phoneMatches) {
        let possibleContact = phoneMatches[0].replace(/\s+/g, '').replace(/[^\d+]/g, '').trim();
        if (/^\d{6}$/.test(possibleContact)) {
          transporterContact = '';
        } else if (/^(\+?\d{10,})$/.test(possibleContact)) {
          transporterContact = possibleContact;
        } else {
          transporterContact = '';
        }
        shippingAddress = messageText.replace(phoneRegex, '').trim();
      } else {
        shippingAddress = messageText.trim();
      }
    }

    // Clean up final values
    shippingAddress = shippingAddress.replace(/\s+/g, ' ').trim(); // Normalize spaces
    transporterName = transporterName.replace(/\s+/g, ' ').trim();

    console.log('[SHIPPING] Parsed shipping info:', {
      address: shippingAddress,
      transporter: transporterName,
      contact: transporterContact
    });

    return {
      shippingAddress,
      transporterName: transporterName || 'To be confirmed',
      transporterContact: transporterContact || 'Not provided',
      parsed: true
    };

  } catch (error) {
    console.error('[SHIPPING] Error parsing shipping info:', error);
    return {
      shippingAddress: messageText.trim(),
      transporterName: 'To be confirmed',
      transporterContact: 'Not provided',
      parsed: false
    };
  }
}

/**
 * Save shipping info to database and customer profile
 */
async function saveShippingInfo(orderId, shippingInfo, tenantId = null, customerPhone = null) {
  try {
    console.log(`[SHIPPING] Saving shipping info for order ${orderId}`);

    // Extract pincode and city/state from address
    const addressComponents = extractAddressComponents(shippingInfo.shippingAddress);
    
    console.log(`[SHIPPING] Extracted address components:`, addressComponents);

    const { error } = await dbClient
      .from('orders')
      .update({
        shipping_address: shippingInfo.shippingAddress,
        transporter_name: shippingInfo.transporterName,
        transporter_contact: shippingInfo.transporterContact,
        shipping_collected_at: new Date().toISOString()
      })
      .eq('id', orderId);

    if (error) throw error;

    // Save to customer profile as default address
    if (tenantId && customerPhone) {
      console.log(`[SHIPPING] Saving as default address for customer ${customerPhone}`);
      
      // Use raw phone (with @c.us) for matching
      console.log(`[SHIPPING][DEBUG] Attempting to update customer_profiles for tenantId: ${tenantId}, phone: ${customerPhone}`);
      const updateResult = await dbClient
        .from('customer_profiles')
        .update({
          default_shipping_address: shippingInfo.shippingAddress,
          default_shipping_city: addressComponents.city,
          default_shipping_state: addressComponents.state,
          default_shipping_pincode: addressComponents.pincode,
          default_transporter_name: shippingInfo.transporterName,
          default_transporter_contact: shippingInfo.transporterContact
        })
        .eq('tenant_id', tenantId)
        .eq('phone', customerPhone);
      console.log(`[SHIPPING][DEBUG] Update result:`, updateResult);
      if (updateResult.error) {
        console.error('[SHIPPING][ERROR] Customer profile update failed:', updateResult.error);
      } else {
        console.log('[SHIPPING][DEBUG] Customer profile update succeeded:', updateResult.data);
      }
    }

    console.log(`[SHIPPING] Shipping info saved for order ${orderId}`);
    return { success: true };

  } catch (error) {
    console.error('[SHIPPING] Error saving shipping info:', error);
    throw error;
  }
}

/**
 * Update customer's default shipping address
 */
async function updateCustomerShippingAddress(tenantId, customerPhone, shippingInfo) {
  try {
    console.log(`[SHIPPING] Updating default address for customer ${customerPhone}`);

    // Extract pincode and city/state from address
    const addressComponents = extractAddressComponents(shippingInfo.shippingAddress);
    
    console.log(`[SHIPPING] Extracted address components:`, addressComponents);

    // Use raw phone (with @c.us) for matching
    console.log(`[SHIPPING][DEBUG] Attempting to update customer_profiles for tenantId: ${tenantId}, phone: ${customerPhone}`);
    const updateResult = await dbClient
      .from('customer_profiles')
      .update({
        default_shipping_address: shippingInfo.shippingAddress,
        default_shipping_city: addressComponents.city,
        default_shipping_state: addressComponents.state,
        default_shipping_pincode: addressComponents.pincode,
        default_transporter_name: shippingInfo.transporterName,
        default_transporter_contact: shippingInfo.transporterContact
      })
      .eq('tenant_id', tenantId)
      .eq('phone', customerPhone);
    console.log(`[SHIPPING][DEBUG] Update result:`, updateResult);
    if (updateResult.error) {
      console.error('[SHIPPING][ERROR] Customer profile update failed:', updateResult.error);
      throw updateResult.error;
    } else {
      console.log('[SHIPPING][DEBUG] Customer profile update succeeded:', updateResult.data);
    }
    console.log(`[SHIPPING] Default address updated for customer ${customerPhone}`);
    return { success: true };

  } catch (error) {
    console.error('[SHIPPING] Error updating default address:', error);
    throw error;
  }
}

/**
 * Update Zoho Books sales order with shipping info
 */
async function updateZohoSalesOrderNotes(orderId) {
  try {
    console.log(`[SHIPPING] Updating Zoho sales order for order ${orderId}`);

    // Get order with shipping info
    const { data: order, error } = await dbClient
      .from('orders')
      .select('*, tenants(zoho_organization_id)')
      .eq('id', orderId)
      .single();

    if (error || !order) {
      throw new Error(`Order not found: ${orderId}`);
    }

    // Check if we have Zoho sales order ID
    if (!order.zoho_sales_order_id) {
      console.log(`[SHIPPING] No Zoho sales order ID for order ${orderId}, skipping`);
      return { success: true, skipped: true };
    }

    // Format notes
    const shippingNotes = `
ðŸšš SHIPPING DETAILS:
â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”
ðŸ“ Shipping Address:
${order.shipping_address || 'Not provided'}

ðŸš› Transporter: ${order.transporter_name || 'Not specified'}
ðŸ“ž Contact: ${order.transporter_contact || 'Not provided'}

ðŸ“… Info Collected: ${order.shipping_collected_at ? new Date(order.shipping_collected_at).toLocaleString('en-IN') : 'N/A'}
â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”
`.trim();

    // Update in Zoho Books
    const zohoService = require('./zohoSalesOrderService');
    await zohoService.updateSalesOrderNotes(
      order.zoho_sales_order_id,
      shippingNotes,
      order.tenants.zoho_organization_id
    );

    console.log(`[SHIPPING] Zoho sales order updated for order ${orderId}`);
    return { success: true };

  } catch (error) {
    console.error('[SHIPPING] Error updating Zoho sales order:', error);
    // Don't throw - shipping info is saved, Zoho update is optional
    return { success: false, error: error.message };
  }
}

/**
 * Process shipping info from customer message
 */
async function processShippingInfo(tenantId, customerPhone, messageText, orderId) {
  try {
    console.log(`[SHIPPING] Processing shipping info for order ${orderId}`);

    // Parse shipping info from message
    const shippingInfo = parseShippingInfo(messageText);

    // Save to database and customer profile
    await saveShippingInfo(orderId, shippingInfo, tenantId, customerPhone);

    // Update Zoho sales order
    await updateZohoSalesOrderNotes(orderId);

    // Send confirmation
    const confirmationMessage = `âœ… *Shipping Details Received!*

ðŸ“ *Address:* ${shippingInfo.shippingAddress}
ðŸš› *Transporter:* ${shippingInfo.transporterName}
ðŸ“ž *Contact:* ${shippingInfo.transporterContact}

_This address has been saved as your default for future orders._

Your order will be processed and shipped soon. We'll keep you updated! ðŸ“¦`;

    await sendMessage(customerPhone, confirmationMessage);

    // Clear conversation state
    await dbClient
      .from('conversations')
      .update({
        state: null,
        metadata: {
          ...await getConversationMetadata(tenantId, customerPhone),
          pending_shipping_order_id: null,
          last_shipping_update: new Date().toISOString()
        }
      })
      .eq('tenant_id', tenantId)
      .eq('end_user_phone', customerPhone);

    console.log(`[SHIPPING] Shipping info processed for order ${orderId}`);
    return { success: true, shippingInfo };

  } catch (error) {
    console.error('[SHIPPING] Error processing shipping info:', error);
    throw error;
  }
}

/**
 * Handle "update my shipping address" request
 */
async function handleShippingAddressUpdate(tenantId, customerPhone) {
  try {
    console.log(`[SHIPPING] Customer ${customerPhone} wants to update shipping address`);

    // Set conversation state to await address update
    const { data: updateResult, error: updateError } = await dbClient
      .from('conversations')
      .update({
        state: 'awaiting_address_update'
      })
      .eq('tenant_id', tenantId)
      .eq('end_user_phone', customerPhone)
      .select();

    console.log(`[SHIPPING] State update result:`, { 
      success: !updateError, 
      rowsAffected: updateResult?.length,
      newState: updateResult?.[0]?.state,
      error: updateError?.message 
    });

    if (updateError) {
      console.error('[SHIPPING] Failed to set state:', updateError);
    }

    // Send request message
    const message = `ðŸ“ *Update Shipping Address*

Please provide your new shipping details:

*1. Shipping Address:*
(Full address with pincode)

*2. Transporter Details:*
(Preferred courier/transporter name)

*3. Transporter Contact:*
(Phone number for delivery coordination)

Reply with all three details.`;

    await sendMessage(customerPhone, message);

    console.log(`[SHIPPING] Address update request sent to ${customerPhone}`);
    return { success: true };

  } catch (error) {
    console.error('[SHIPPING] Error handling address update:', error);
    throw error;
  }
}

/**
 * Process address update from customer
 */
async function processAddressUpdate(tenantId, customerPhone, messageText) {
  try {
    console.log(`[SHIPPING] Processing address update for ${customerPhone}`);

    // Parse new shipping info
    const shippingInfo = parseShippingInfo(messageText);

    // Update customer profile
    await updateCustomerShippingAddress(tenantId, customerPhone, shippingInfo);

    // Build confirmation message
    const confirmationMessage = `âœ… *Shipping Address Updated!*

Your new default shipping details:

ðŸ“ *Address:* ${shippingInfo.shippingAddress}
ðŸš› *Transporter:* ${shippingInfo.transporterName}
ðŸ“ž *Contact:* ${shippingInfo.transporterContact}

This address will be used for all future orders. âœ“`;

    // NOTE: Don't send message here - mainHandler will send it
    // await sendMessage(customerPhone, confirmationMessage);

    // Clear conversation state
    await dbClient
      .from('conversations')
      .update({
        state: null
      })
      .eq('tenant_id', tenantId)
      .eq('end_user_phone', customerPhone);

    console.log(`[SHIPPING] Address updated for ${customerPhone}`);
    return { 
      success: true, 
      message: confirmationMessage,
      shippingInfo 
    };

  } catch (error) {
    console.error('[SHIPPING] Error processing address update:', error);
    return {
      success: false,
      message: 'âŒ Sorry, there was an error updating your address. Please try again.',
      error: error.message
    };
  }
}

/**
 * Helper to get conversation metadata
 */
async function getConversationMetadata(tenantId, customerPhone) {
  const { data } = await dbClient
    .from('conversations')
    .select('metadata')
    .eq('tenant_id', tenantId)
    .eq('end_user_phone', customerPhone)
    .single();

  return data?.metadata || {};
}

module.exports = {
  requestShippingInfo,
  parseShippingInfo,
  saveShippingInfo,
  updateZohoSalesOrderNotes,
  processShippingInfo,
  handleShippingAddressUpdate,
  processAddressUpdate,
  getPreviousShippingAddress,
  updateCustomerShippingAddress,
  testCustomerProfileUpdate
};

