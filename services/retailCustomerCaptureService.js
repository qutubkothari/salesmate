// services/retailCustomerCaptureService.js
const { dbClient } = require('./config');
const { sendMessage } = require('./whatsappService');

/**
 * Handle retail counter customer connection via QR code scan
 * @param {string} tenantId - Tenant ID
 * @param {string} phoneNumber - Customer phone number (from WhatsApp)
 * @param {string|null} billNumber - Optional bill number if provided
 * @param {object|null} purchaseData - Optional purchase data from POS
 * @returns {Promise<object>} - Result with isNew flag and welcome message
 */
const handleRetailConnection = async (tenantId, phoneNumber, billNumber = null, purchaseData = null) => {
  try {
    console.log('[RETAIL_CAPTURE] Processing retail connection:', { phoneNumber, billNumber });

    // 1. Check if customer already exists
    const { data: existingCustomer, error: fetchError} = await dbClient
      .from('customer_profiles_new')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('phone', phoneNumber)
      .maybeSingle();

    if (fetchError && fetchError.code !== 'PGRST116') {
      // PGRST116 = no rows returned (expected for new customers)
      console.error('[RETAIL_CAPTURE] Error fetching customer:', fetchError);
      throw fetchError;
    }

    if (existingCustomer) {
      // Existing customer - update last visit
      const newVisitCount = (existingCustomer.retail_visit_count || 0) + 1;

      await dbClient
        .from('customer_profiles_new')
        .update({
          last_retail_visit: new Date().toISOString(),
          retail_visit_count: newVisitCount,
          customer_source: existingCustomer.customer_source || 'retail_counter',
          updated_at: new Date().toISOString()
        })
        .eq('id', existingCustomer.id);

      console.log('[RETAIL_CAPTURE] Updated existing customer:', {
        customerId: existingCustomer.id,
        visitCount: newVisitCount
      });

      // If bill number provided, link it
      if (billNumber && purchaseData) {
        await linkBillToCustomer(tenantId, phoneNumber, billNumber, purchaseData);
      }

      return {
        success: true,
        isNew: false,
        customerId: existingCustomer.id,
        visitCount: newVisitCount,
        message: `Welcome back! 🎉 This is your visit #${newVisitCount}.\n\nI'll keep you updated on:\n✅ Restock reminders\n✅ Exclusive deals\n✅ New arrivals\n\nReply STOP anytime to unsubscribe.`
      };
    } else {
      // New customer - create profile
      const { data: newCustomer, error: insertError } = await dbClient
        .from('customer_profiles_new')
        .insert({
          tenant_id: tenantId,
          phone: phoneNumber,
          customer_source: 'retail_counter',
          retail_visit_count: 1,
          last_retail_visit: new Date().toISOString(),
          first_contact_date: new Date().toISOString(),
          created_at: new Date().toISOString()
        })
        .select()
        .single();

      if (insertError) {
        console.error('[RETAIL_CAPTURE] Error creating customer:', insertError);
        throw insertError;
      }

      console.log('[RETAIL_CAPTURE] Created new customer:', { customerId: newCustomer.id });

      // If bill number provided, link it
      if (billNumber && purchaseData) {
        await linkBillToCustomer(tenantId, phoneNumber, billNumber, purchaseData);
      }

      return {
        success: true,
        isNew: true,
        customerId: newCustomer.id,
        visitCount: 1,
        message: `Welcome! 👋 Great to have you connected.\n\n✅ You'll get:\n• Restock reminders when you need supplies\n• Exclusive deals & offers\n• Quick reorders via WhatsApp\n• New product alerts\n\nReply STOP anytime to unsubscribe.`
      };
    }
  } catch (error) {
    console.error('[RETAIL_CAPTURE] Failed to handle retail connection:', error);
    return {
      success: false,
      error: error.message,
      message: `Thanks for connecting! We've saved your details and will send you updates soon. 😊`
    };
  }
};

/**
 * Link retail bill to customer for purchase history tracking
 * @param {string} tenantId - Tenant ID
 * @param {string} phoneNumber - Customer phone number
 * @param {string} billNumber - Bill/invoice number
 * @param {object} purchaseData - Purchase details (items, amount, etc.)
 * @returns {Promise<object>} - Result
 */
const linkBillToCustomer = async (tenantId, phoneNumber, billNumber, purchaseData) => {
  try {
    console.log('[RETAIL_CAPTURE] Linking bill to customer:', { billNumber, phoneNumber });

    // Create order record from retail purchase
    const { data: order, error } = await dbClient
      .from('orders_new')
      .insert({
        tenant_id: tenantId,
        customer_phone: phoneNumber,
        source: 'retail_counter',
        bill_number: billNumber,
        items: purchaseData.items || [],
        total_amount: purchaseData.amount || 0,
        status: 'completed',
        created_at: new Date().toISOString()
      })
      .select()
      .single();

    if (error) {
      console.error('[RETAIL_CAPTURE] Error linking bill:', error);
      throw error;
    }

    console.log('[RETAIL_CAPTURE] Bill linked successfully:', { orderId: order.id });

    return {
      success: true,
      orderId: order.id
    };
  } catch (error) {
    console.error('[RETAIL_CAPTURE] Failed to link bill:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

/**
 * Send retail welcome message to customer
 * @param {string} phoneNumber - Customer phone number
 * @param {object} result - Result from handleRetailConnection
 * @returns {Promise<void>}
 */
const sendRetailWelcome = async (phoneNumber, result) => {
  try {
    await sendMessage(phoneNumber, result.message);
    console.log('[RETAIL_CAPTURE] Welcome message sent to:', phoneNumber);
  } catch (error) {
    console.error('[RETAIL_CAPTURE] Failed to send welcome message:', error);
  }
};

/**
 * Parse retail connection message for bill number
 * Supports formats:
 * - "CONNECT_RETAIL_CUSTOMER"
 * - "RETAIL_QR"
 * - "CONNECT_BILL_12345"
 * - "RETAIL_12345"
 * @param {string} message - User message
 * @returns {object} - Parsed data with billNumber if found
 */
const parseRetailMessage = (message) => {
  const normalized = message.trim().toUpperCase();

  // Check for bill number patterns
  const billPatterns = [
    /CONNECT_BILL[_\s]?(\d+)/i,
    /RETAIL[_\s]?(\d+)/i,
    /BILL[_\s]?(\d+)/i
  ];

  for (const pattern of billPatterns) {
    const match = normalized.match(pattern);
    if (match && match[1]) {
      return {
        isRetailConnect: true,
        billNumber: match[1]
      };
    }
  }

  // Check for basic retail connection triggers
  const retailTriggers = [
    'CONNECT_RETAIL_CUSTOMER',
    'RETAIL_QR',
    'COUNTER_SCAN',
    'RETAIL_CONNECT'
  ];

  if (retailTriggers.some(trigger => normalized.includes(trigger))) {
    return {
      isRetailConnect: true,
      billNumber: null
    };
  }

  return {
    isRetailConnect: false,
    billNumber: null
  };
};

/**
 * Generate WhatsApp link for QR code
 * @param {string} phoneNumber - Business WhatsApp number (without @c.us)
 * @param {string|null} billNumber - Optional bill number to include
 * @returns {string} - WhatsApp web link
 */
const generateRetailQRLink = (phoneNumber, billNumber = null) => {
  // Remove any non-numeric characters
  const cleanNumber = phoneNumber.replace(/[^\d]/g, '');

  // Create pre-filled message
  const message = billNumber
    ? `CONNECT_BILL_${billNumber}`
    : 'CONNECT_RETAIL_CUSTOMER';

  // Generate WhatsApp web link
  const link = `https://wa.me/${cleanNumber}?text=${encodeURIComponent(message)}`;

  console.log('[RETAIL_CAPTURE] Generated QR link:', link);

  return link;
};

module.exports = {
  handleRetailConnection,
  linkBillToCustomer,
  sendRetailWelcome,
  parseRetailMessage,
  generateRetailQRLink
};


