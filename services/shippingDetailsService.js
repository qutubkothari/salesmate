/**
 * SHIPPING DETAILS COLLECTION SERVICE
 * Captures shipping address and transporter info after order placement
 */

const { dbClient } = require('../config/database');

/**
 * Check if order needs shipping details collection
 */
async function shouldCollectShippingDetails(orderId) {
  try {
    const { data: order, error } = await dbClient
      .from('orders_new')
      .select('id, shipping_details_collected, order_status')
      .eq('id', orderId)
      .single();

    if (error || !order) return false;

    // Collect if not already collected and order is confirmed
    return !order.shipping_details_collected && 
           ['confirmed', 'pending'].includes(order.order_status?.toLowerCase());
  } catch (error) {
    console.error('[SHIPPING] Error checking order:', error);
    return false;
  }
}

/**
 * Start shipping details collection flow
 */
async function initiateShippingDetailsCollection(tenantId, customerPhone, orderId) {
  try {
    console.log(`[SHIPPING] Initiating collection for order ${orderId}`);

    // Get customer's default shipping info if available
    const { data: customer } = await dbClient
      .from('customer_profiles_new')
      .select('first_name, default_shipping_address, default_shipping_city, default_transporter_name')
      .eq('tenant_id', tenantId)
      .eq('phone', customerPhone)
      .single();

    let message = `✅ Order confirmed!\n\n`;
    message += `📦 *Shipping Details Required*\n\n`;

    // If customer has default address, offer to use it
    if (customer?.default_shipping_address) {
      message += `We have your previous shipping address on file:\n`;
      message += `📍 ${customer.default_shipping_address}\n`;
      message += `🏙️ ${customer.default_shipping_city || ''}\n\n`;
      message += `Reply with:\n`;
      message += `• *"Same address"* to use this\n`;
      message += `• *"New address"* to provide different address\n\n`;
    } else {
      message += `Please provide your shipping details:\n\n`;
      message += `📍 *Shipping Address*\n`;
      message += `Example: "123, ABC Road, Near XYZ Mall, Area Name"\n\n`;
    }

    // Set conversation state to collect shipping
    await dbClient
      .from('conversations_new')
      .update({
        state: 'collecting_shipping_address',
        metadata: {
          pending_order_id: orderId,
          shipping_collection_started_at: new Date().toISOString()
        }
      })
      .eq('tenant_id', tenantId)
      .eq('end_user_phone', customerPhone);

    return { message, requiresResponse: true };
  } catch (error) {
    console.error('[SHIPPING] Error initiating collection:', error);
    return null;
  }
}

/**
 * Process shipping address input
 */
async function processShippingAddress(tenantId, customerPhone, userMessage, orderId) {
  try {
    console.log(`[SHIPPING] Processing address for order ${orderId}`);

    const message = userMessage.toLowerCase().trim();

    // Check for "same address" response
    if (message.includes('same') && message.includes('address')) {
      const { data: customer } = await dbClient
        .from('customer_profiles_new')
        .select('default_shipping_address, default_shipping_city, default_shipping_state, default_shipping_pincode')
        .eq('tenant_id', tenantId)
        .eq('phone', customerPhone)
        .single();

      if (customer?.default_shipping_address) {
        // Update order with default address
        await dbClient
          .from('orders_new')
          .update({
            shipping_address: customer.default_shipping_address,
            shipping_city: customer.default_shipping_city,
            shipping_state: customer.default_shipping_state,
            shipping_pincode: customer.default_shipping_pincode
          })
          .eq('id', orderId);

        // Move to transporter collection
        await dbClient
          .from('conversations_new')
          .update({
            state: 'collecting_transporter_details',
            metadata: { pending_order_id: orderId }
          })
          .eq('tenant_id', tenantId)
          .eq('end_user_phone', customerPhone);

        return {
          message: `✅ Address confirmed!\n\n🚚 *Transporter Details*\n\nPlease provide:\n1. Transporter name\n2. Contact number\n3. Vehicle number (if known)\n\nExample: "ABC Transport, 9876543210, MH01AB1234"`,
          requiresResponse: true
        };
      }
    }

    // Check for "new address" or actual address
    if (message.includes('new') && message.includes('address')) {
      return {
        message: `📍 Please provide your complete shipping address:\n\nInclude:\n• House/Building number\n• Street name\n• Landmark\n• Area/City\n• Pincode`,
        requiresResponse: true
      };
    }

    // Parse and store the address
    const addressData = parseAddress(userMessage);
    
    await dbClient
      .from('orders_new')
      .update({
        shipping_address: addressData.fullAddress,
        shipping_city: addressData.city,
        shipping_state: addressData.state,
        shipping_pincode: addressData.pincode,
        shipping_landmark: addressData.landmark
      })
      .eq('id', orderId);

    // Move to transporter collection
    await dbClient
      .from('conversations_new')
      .update({
        state: 'collecting_transporter_details',
        metadata: { pending_order_id: orderId }
      })
      .eq('tenant_id', tenantId)
      .eq('end_user_phone', customerPhone);

    return {
      message: `✅ Shipping address saved!\n\n🚚 *Transporter Details*\n\nPlease provide:\n1. Transporter name\n2. Contact number\n3. Vehicle number (optional)\n\nExample: "ABC Transport, 9876543210, MH01AB1234"\n\nOr reply *"Self pickup"* if collecting yourself`,
      requiresResponse: true
    };
  } catch (error) {
    console.error('[SHIPPING] Error processing address:', error);
    return null;
  }
}

/**
 * Process transporter details input
 */
async function processTransporterDetails(tenantId, customerPhone, userMessage, orderId) {
  try {
    console.log(`[SHIPPING] Processing transporter for order ${orderId}`);

    const message = userMessage.toLowerCase().trim();

    // Handle self pickup
    if (message.includes('self') && message.includes('pickup')) {
      await dbClient
        .from('orders_new')
        .update({
          transporter_name: 'Self Pickup',
          shipping_details_collected: true,
          shipping_details_collected_at: new Date().toISOString()
        })
        .eq('id', orderId);

      // Clear conversation state
      await dbClient
        .from('conversations_new')
        .update({
          state: 'active',
          metadata: {}
        })
        .eq('tenant_id', tenantId)
        .eq('end_user_phone', customerPhone);

      // Sync to Zoho
      await updateZohoWithShippingDetails(orderId);

      return {
        message: `✅ All details saved!\n\n📦 Order will be ready for pickup.\n\nWe'll notify you when it's ready.\n\nIs there anything else I can help you with?`,
        requiresResponse: false
      };
    }

    // Parse transporter details
    const transporterData = parseTransporterDetails(userMessage);

    await dbClient
      .from('orders_new')
      .update({
        transporter_name: transporterData.name,
        transporter_contact: transporterData.contact,
        transporter_vehicle_number: transporterData.vehicleNumber,
        shipping_details_collected: true,
        shipping_details_collected_at: new Date().toISOString()
      })
      .eq('id', orderId);

    // Save as default for future orders
    await dbClient
      .from('customer_profiles_new')
      .update({
        default_transporter_name: transporterData.name
      })
      .eq('tenant_id', tenantId)
      .eq('phone', customerPhone);

    // Clear conversation state
    await dbClient
      .from('conversations_new')
      .update({
        state: 'active',
        metadata: {}
      })
      .eq('tenant_id', tenantId)
      .eq('end_user_phone', customerPhone);

    // Sync to Zoho
    await updateZohoWithShippingDetails(orderId);

    return {
      message: `✅ Perfect! All shipping details saved.\n\n📦 *Summary:*\n• Transporter: ${transporterData.name}\n• Contact: ${transporterData.contact}\n${transporterData.vehicleNumber ? `• Vehicle: ${transporterData.vehicleNumber}\n` : ''}\n\nYour order will be dispatched soon!\n\nAnything else I can help with?`,
      requiresResponse: false
    };
  } catch (error) {
    console.error('[SHIPPING] Error processing transporter:', error);
    return null;
  }
}

/**
 * Parse address from user input
 */
function parseAddress(input) {
  const lines = input.split('\n').map(l => l.trim()).filter(l => l);
  
  // Try to extract pincode
  const pincodeMatch = input.match(/\b\d{6}\b/);
  const pincode = pincodeMatch ? pincodeMatch[0] : null;

  // Try to extract city (usually second last or last non-pincode element)
  let city = null;
  let state = null;

  const lastLine = lines[lines.length - 1];
  if (lastLine && !lastLine.match(/\d{6}/)) {
    // Check if it's state,city or just city
    if (lastLine.includes(',')) {
      const parts = lastLine.split(',');
      city = parts[parts.length - 2]?.trim();
      state = parts[parts.length - 1]?.trim();
    } else {
      city = lastLine;
    }
  }

  // Landmark - look for "near", "opposite", etc.
  const landmarkMatch = input.match(/(?:near|opposite|behind|next to)\s+([^,\n]+)/i);
  const landmark = landmarkMatch ? landmarkMatch[1].trim() : null;

  return {
    fullAddress: input,
    city,
    state,
    pincode,
    landmark
  };
}

/**
 * Parse transporter details from user input
 */
function parseTransporterDetails(input) {
  // Expected format: "Name, Contact, Vehicle"
  const parts = input.split(',').map(p => p.trim());

  // Extract phone number
  const phoneMatch = input.match(/\b\d{10}\b/);
  const contact = phoneMatch ? phoneMatch[0] : parts[1];

  // Extract vehicle number (alphanumeric with optional spaces)
  const vehicleMatch = input.match(/\b[A-Z]{2}\d{2}[A-Z]{0,2}\d{4}\b/i);
  const vehicleNumber = vehicleMatch ? vehicleMatch[0] : (parts[2] || null);

  // Name is first part or everything before contact
  let name = parts[0];
  if (phoneMatch) {
    name = input.substring(0, input.indexOf(phoneMatch[0])).replace(/,$/, '').trim();
  }

  return {
    name: name || 'Transport',
    contact: contact || '',
    vehicleNumber: vehicleNumber
  };
}

/**
 * Update Zoho Books sales order/invoice with shipping details
 */
async function updateZohoWithShippingDetails(orderId) {
  try {
    console.log(`[SHIPPING] Updating Zoho for order ${orderId}`);

    // Get order with shipping details
    const { data: order } = await dbClient
      .from('orders_new')
      .select('*, customer_profiles(first_name, last_name)')
      .eq('id', orderId)
      .single();

    if (!order || !order.zoho_salesorder_id) {
      console.log('[SHIPPING] No Zoho sales order ID found');
      return;
    }

    // Format notes
    let notes = '📦 SHIPPING DETAILS:\n\n';
    
    if (order.shipping_address) {
      notes += `📍 Delivery Address:\n${order.shipping_address}\n`;
      if (order.shipping_city) notes += `🏙️ City: ${order.shipping_city}\n`;
      if (order.shipping_state) notes += `📍 State: ${order.shipping_state}\n`;
      if (order.shipping_pincode) notes += `📮 Pincode: ${order.shipping_pincode}\n`;
      if (order.shipping_landmark) notes += `🏛️ Landmark: ${order.shipping_landmark}\n`;
      notes += '\n';
    }

    if (order.transporter_name) {
      notes += `🚚 Transporter Details:\n`;
      notes += `• Name: ${order.transporter_name}\n`;
      if (order.transporter_contact) notes += `• Contact: ${order.transporter_contact}\n`;
      if (order.transporter_vehicle_number) notes += `• Vehicle: ${order.transporter_vehicle_number}\n`;
      notes += '\n';
    }

    if (order.special_instructions) {
      notes += `📝 Special Instructions:\n${order.special_instructions}\n\n`;
    }

    notes += `✅ Collected on: ${new Date(order.shipping_details_collected_at).toLocaleString('en-IN')}`;

    // Update Zoho Books (you'll need to implement the Zoho API call)
    const zohoService = require('./zohoService');
    await zohoService.updateSalesOrderNotes(
      order.tenant_id,
      order.zoho_salesorder_id,
      notes
    );

    console.log(`[SHIPPING] Zoho updated successfully for order ${orderId}`);
  } catch (error) {
    console.error('[SHIPPING] Error updating Zoho:', error);
  }
}

module.exports = {
  shouldCollectShippingDetails,
  initiateShippingDetailsCollection,
  processShippingAddress,
  processTransporterDetails,
  updateZohoWithShippingDetails
};


