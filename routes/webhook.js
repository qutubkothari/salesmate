// Add AI integration
const aiHandlerHelper = require('../services/aiHandlerHelper');
// routes/webhook.js - Complete webhook router with fixed business info integration
const express = require('express');
const debug = require('../services/debug');

// CRITICAL: Initialize compatibility layer first
const { initCompatibilityLayer } = require('./middleware/compatibilityLayer');
initCompatibilityLayer().catch(console.error);

// Import handlers
const { handleCustomer } = require('./handlers/customerHandler');
const { handleDocument } = require('./handlers/documentHandler');
const { handleCompleteAdminCommands } = require('./handlers/completeAdminHandler');
const BusinessInfoHandler = require('./handlers/businessInfoHandler');
const { handleShipmentTracking, isShipmentTrackingIntent } = require('../handlers/shipmentTrackingHandler');
const { sendMessage } = require('../services/whatsappService');

// Import middleware
const messageNormalizer = require('./middleware/messageNormalizer');
const adminDetector = require('./middleware/adminDetector');
const tenantResolver = require('./middleware/tenantResolver');
const zohoSyncMiddleware = require('../middleware/zohoSyncMiddleware');

// Import utilities
const { validateWebhookRequest } = require('./utils/validators');
const { isImageFile, isSpreadsheetFile } = require('./utils/fileExtractors');


// Import services for admin handling
const { checkSubscriptionStatus, activateSubscription } = require('../services/subscriptionService');
const { generateLoginLink } = require('../services/webAuthService');
const broadcastCommands = require('../commands/broadcast');
const menuService = require('../services/menuService');
const { dbClient } = require('../services/config');
const zohoMatching = require('../services/zohoCustomerMatchingService');
// FIX: Correct import path for enhancedOrderProcessingWithZoho
const enhancedOrderWithZoho = require('../services/enhancedOrderProcessingWithZoho');

const router = express.Router();

// Debug middleware
router.use((req, res, next) => {
  req._rid = req._rid || debug.rid();
  debug.traceStart(req._rid, 'webhook', { ct: req.get('content-type') });
  res.on('finish', () => debug.traceEnd(req._rid, 'webhook', { status: res.statusCode }));
  next();
});

// Core middleware pipeline
router.use((req, res, next) => {
  console.log('[MIDDLEWARE_START] Before messageNormalizer', { type: req.body?.message?.type });
  next();
});
router.use(messageNormalizer);
router.use((req, res, next) => {
  console.log('[MIDDLEWARE_AFTER_NORMALIZER] After messageNormalizer', { hasMessage: !!req.message });
  next();
});
router.use(tenantResolver);
router.use((req, res, next) => {
  console.log('[MIDDLEWARE_AFTER_TENANT] After tenantResolver', { hasTenant: !!req.tenant });
  next();
});
router.use(adminDetector);
router.use((req, res, next) => {
  console.log('[MIDDLEWARE_AFTER_ADMIN] After adminDetector', { isAdmin: req.isAdmin });
  next();
});
router.use(zohoSyncMiddleware); // Add Zoho sync middleware
router.use((req, res, next) => {
  console.log('[MIDDLEWARE_AFTER_ZOHO] After zohoSyncMiddleware');
  next();
});

// Request validation middleware
router.use((req, res, next) => {
  console.log('[MIDDLEWARE_VALIDATION] Entering validation', { hasMessage: !!req.message });
  const validation = validateWebhookRequest(req);
  if (!validation.isValid) {
    console.error('[WEBHOOK] Validation failed:', validation.errors);
    return res.status(200).json({ ok: false, error: 'validation-failed', details: validation.errors });
  }
  console.log('[MIDDLEWARE_VALIDATION] Validation passed, calling next()');
  next();
});

// Safe endpoint for testing
router.post('/safe', (req, res) => {
  return res.status(200).json({ ok: true, mode: 'safe', echo: req.body });
});

/**
 * Simplified admin/tenant handler (integrated into main router)
 * This handles the basic admin commands directly
 */
const handleTenantMessage = async (req, res) => {
  const { message, tenant } = req;
  const phone = message.from;
  const tenantId = tenant.id;
  const messageText = message?.text?.body || '';
  const raw = messageText.trim();
  const txt = raw.toLowerCase();

  debug.trace(req._rid, 'admin.command', { command: txt.split(' ')[0] });

  try {
    // Basic status and login commands (no subscription required)
    if (txt === '/status') {
      console.log('[WEBHOOK_LOGIN] /status command received', { tenantId, phone });
      const statusResult = await checkSubscriptionStatus(tenant.id);
      await sendMessage(phone, statusResult.message);
      console.log('[WEBHOOK_LOGIN] Status message sent to WhatsApp:', phone);
      return res.status(200).json({ ok: true, type: 'status' });
    }

    if (txt === '/login') {
      console.log('[WEBHOOK_LOGIN] /login command received', { tenantId, phone });
      
      // Robust admin phone matching: compare only digits, strip @c.us and non-digits
      const adminPhones = tenant.admin_phones || [];
      const cleanUser = String(phone).replace(/@c\.us$/, '').replace(/\D/g, '');
      const isAdmin = adminPhones.some(adminPhone => {
        const cleanAdmin = String(adminPhone).replace(/@c\.us$/, '').replace(/\D/g, '');
        return cleanAdmin === cleanUser;
      });
      
      if (!isAdmin) {
        console.log('[WEBHOOK_LOGIN] Access denied - not an admin phone', { phone, adminPhones });
        await sendMessage(phone, '❌ Access denied. Only authorized admin numbers can access the dashboard.\n\nPlease contact your system administrator.');
        return res.status(200).json({ ok: true, type: 'login_denied', reason: 'not_admin' });
      }
      
      console.log('[WEBHOOK_LOGIN] Admin phone verified, generating login link');
      const loginMessage = await generateLoginLink(tenant.id);
      console.log('[WEBHOOK_LOGIN] Generated login message:', loginMessage);
      await sendMessage(phone, loginMessage);
      console.log('[WEBHOOK_LOGIN] Login message sent to WhatsApp:', phone);
      return res.status(200).json({ ok: true, type: 'login' });
    }

    // Broadcast commands (handle directly via broadcastCommands module)
    if (txt.startsWith('/broadcast_image_now ')) {
      const result = await broadcastCommands.handleImageNow({ from: phone, raw, tenantId: tenant.id });
      return res.status(200).json({ ok: true, type: 'broadcast_image_now', result });
    }

    if (txt.startsWith('/broadcast_image ')) {
      const result = await broadcastCommands.handleImage({ from: phone, raw, tenantId: tenant.id });
      return res.status(200).json({ ok: true, type: 'broadcast_image', result });
    }

    if (txt.startsWith('/broadcast_now ')) {
      const result = await broadcastCommands.handleNow({ from: phone, raw, tenantId: tenant.id });
      return res.status(200).json({ ok: true, type: 'broadcast_now', result });
    }

    if (txt.startsWith('/broadcast ')) {
      const result = await broadcastCommands.handle({ from: phone, raw, tenantId: tenant.id });
      return res.status(200).json({ ok: true, type: 'broadcast', result });
    }

    // Subscription management
    if (txt.startsWith('/activate ')) {
      const key = txt.split(' ')[1];
      if (!key) {
        await sendMessage(phone, 'Please provide an activation key. Usage: /activate YOUR_KEY_HERE');
        return res.status(200).json({ ok: false, error: 'missing_key' });
      }
      const activationResult = await activateSubscription(tenant.id, key);
      await sendMessage(phone, activationResult.message);
      return res.status(200).json({ ok: true, type: 'activation' });
    }

    if (txt === '/billing') {
      const message = tenant.billing_url 
        ? `You can manage your subscription and purchase new keys here:\n${tenant.billing_url}`
        : 'Your billing portal is not yet set up. Please contact support to purchase an activation key.';
      await sendMessage(phone, message);
      return res.status(200).json({ ok: true, type: 'billing' });
    }

    // Feature protection check
    const subscription = await checkSubscriptionStatus(tenant.id);
    if (subscription.status !== 'active' && subscription.status !== 'trial') {
      await sendMessage(phone, subscription.message);
      return res.status(200).json({ ok: false, error: 'subscription_required' });
    }

    // Route to complete admin handler for all other commands
    const result = await handleCompleteAdminCommands(tenant, phone, txt, raw);
    if (result !== null) {
      return res.status(200).json({ ok: true, type: 'admin_command_processed' });
    }

    // Default help message - use dynamic menu
    const menuResponse = await menuService.handleMenuRequest(phone, tenant.id, true);
    await sendMessage(phone, menuResponse);
    return res.status(200).json({ ok: true, type: 'menu' });

  } catch (error) {
    console.error('[ADMIN_HANDLER] Error:', error);
    debug.traceErr(req._rid, 'admin.handler', error);
    await sendMessage(phone, 'An error occurred processing your command. Please try again.');
    return res.status(200).json({ ok: false, error: 'command_failed' });
  }
};

// Main webhook endpoint
router.post('/', async (req, res) => {
  console.log('[WEBHOOK_POST] ===== WEBHOOK HANDLER CALLED =====', {
    messageType: req.body?.message?.type,
    hasMessage: !!req.body?.message,
    timestamp: new Date().toISOString()
  });
  debug.trace(req._rid, 'handler.enter');
  try {
    const { message, tenant, isAdmin } = req;
    
    // STEP 1: Handle self-registration for users without a tenant OR users who want to register as new tenants
    if (!message) {
      return res.status(200).json({ ok: false, error: 'invalid-request' });
    }

    // Check if this is a registration request (even if tenant exists)
    if (message.type === 'text') {
      const { handleSelfRegistration, isRegistrationRequest, getRegistrationData, getRegistrationState } = require('../services/selfRegistrationService');
      const phoneNumber = message.from;
      const messageText = message.text?.body || message.body || '';

      // Check if user is trying to register or is in a registration flow
      const isRegisteringRequest = isRegistrationRequest(messageText);
      const regData = getRegistrationData(phoneNumber);
      const conversationState = tenant?.id ? await getRegistrationState(phoneNumber, tenant.id) : null;

      // Handle registration if:
      // 1. No tenant found (new bot number)
      // 2. User explicitly types "register" (wants to create their own tenant)
      // 3. User is in active registration flow (has registration data in memory)
      // 4. User's conversation state indicates registration pending
      const isInRegistrationFlow = !!regData || conversationState === 'pending_registration_confirmation';

      // ALWAYS check registration handler if user is in a registration flow OR types register
      if (!tenant || isRegisteringRequest || isInRegistrationFlow) {
        console.log('[WEBHOOK] Checking for self-registration:', {
          phoneNumber,
          isRegisteringRequest,
          isInRegistrationFlow,
          hasRegData: !!regData,
          conversationState,
          hasTenant: !!tenant
        });

        try {
          const registrationResult = await handleSelfRegistration(
            phoneNumber,
            messageText,
            async (to, msg) => await sendMessage(to, msg),
            tenant?.id || null
          );

          if (registrationResult) {
            console.log('[WEBHOOK] Self-registration handled:', registrationResult.action);
            return res.status(200).json({
              ok: true,
              action: 'self_registration',
              result: registrationResult
            });
          }
        } catch (error) {
          console.error('[WEBHOOK] Self-registration error:', error);
        }
      }

      // If no tenant and not a registration message, inform user
      if (!tenant) {
        const noTenantMessage = `Welcome! 👋

It looks like you don't have an account yet.

Would you like to create one? Just send *"register"* to get started with your FREE 7-day trial! 🚀`;

        await sendMessage(phoneNumber, noTenantMessage);
        return res.status(200).json({ ok: true, action: 'no_tenant_prompt' });
      }
    }

    if (!tenant) {
      return res.status(200).json({ ok: false, error: 'no-tenant' });
    }
    debug.trace(req._rid, 'routing', {
      isAdmin,
      messageType: message.type,
      tenantId: tenant.id,
      isImage: isImageFile(message),
      isSpreadsheet: isSpreadsheetFile(message)
    });

    // --- BUSINESS INFO HANDLING --- (SELECTIVE VERSION)
    // Only for specific business info scenarios, not all customer messages
    if (!isAdmin && (message.type === 'text' || message.type === 'image' || message.type === 'document')) {
      const messageBody = message.type === 'text' ? (message.text?.body || message.body || '') : (message.caption || message.body || '');

      // FIXED: More selective business info detection
      let shouldProcessBusinessInfo = false;

      if (message.type === 'document') {
        // Only process documents that are likely business documents
        const filename = (message.document?.filename || '').toLowerCase();
        const isBusinessDoc = filename.includes('gst') || 
                             filename.includes('certificate') || 
                             filename.includes('registration') ||
                             filename.includes('license');
        shouldProcessBusinessInfo = isBusinessDoc;
        console.log('[Webhook] Document business check:', { filename, isBusinessDoc });
      } else if (message.type === 'image') {
        // Only process images with business-related captions
        const hasBusinessCaption = messageBody.toLowerCase().includes('gst') ||
                                  messageBody.toLowerCase().includes('certificate') ||
                                  messageBody.toLowerCase().includes('business card');
        shouldProcessBusinessInfo = hasBusinessCaption;
        console.log('[Webhook] Image business check:', { hasCaption: !!messageBody, hasBusinessCaption });
      } else if (message.type === 'text') {
        // Only process text that contains GST numbers or explicit business info requests
        const gstPattern = /\b[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}\b/;
        const hasGSTNumber = gstPattern.test(messageBody);
        const isBusinessInfoRequest = messageBody.toLowerCase().includes('my company') ||
                                     messageBody.toLowerCase().includes('business details') ||
                                     messageBody.toLowerCase().includes('gst number');
        shouldProcessBusinessInfo = hasGSTNumber || isBusinessInfoRequest;
        console.log('[Webhook] Text business check:', { hasGSTNumber, isBusinessInfoRequest });
      }

      if (shouldProcessBusinessInfo) {
        console.log('[Webhook] Detected specific business information - processing...');
        console.log('[Webhook] Message type:', message.type);

        // Always use normalized phone for conversation creation
        const phoneForConv = message.from;
        console.log('[Webhook] About to call ensureConversationByPhone with:', phoneForConv, 'tenant:', tenant.id);
        const conversationId = await ensureConversationByPhone(phoneForConv, tenant.id);
        console.log('[Webhook] ensureConversationByPhone returned conversationId:', conversationId);
        
        // IMPORTANT: Keep phoneForConv separate for messaging - conversationId is a UUID!
        const phoneNumber = phoneForConv;  // This is the actual WhatsApp number like 96567709452@c.us

        // Proper URL extraction based on message type
        let mediaUrl = null;
        let filename = null;
        let mimeType = null;

        if (message.type === 'document') {
          mediaUrl = message.document?.url || message.url;
          filename = message.document?.filename;
          mimeType = message.document?.mimetype || 'application/pdf';
          console.log('[Webhook] Document URL extracted:', mediaUrl);
          console.log('[Webhook] Document filename:', filename);
        } else if (message.type === 'image') {
          mediaUrl = message.image?.url || message.media?.url;
          filename = message.image?.filename || 'image';
          mimeType = message.image?.mimetype || 'image/jpeg';
          console.log('[Webhook] Image URL extracted:', mediaUrl);
        }

        // Create a proper message object with correct structure
        const messageForBusinessInfo = {
          message_type: message.type,
          message_body: messageBody,
          media_url: mediaUrl,
          media_filename: filename,
          media_mime_type: mimeType
        };

        console.log('[Webhook] Calling BusinessInfoHandler with:', {
          tenantId: tenant.id,
          conversationId,
          messageType: messageForBusinessInfo.message_type,
          hasMediaUrl: !!messageForBusinessInfo.media_url,
          filename: messageForBusinessInfo.media_filename
        });

        try {
          const businessResult = await BusinessInfoHandler.handleBusinessInfo(
            tenant.id,
            phoneNumber,  // ✅ FIX: Pass phoneNumber instead of conversationId UUID
            messageForBusinessInfo
          );

          console.log('[Webhook] Business info result:', {
            success: businessResult.success,
            hasResponse: !!(businessResult.response || businessResult.reply)
          });

          if (businessResult.success) {
            // Prefer response, fallback to reply
            const replyText = businessResult.response || businessResult.reply;
            if (replyText) {
              // FIXED: Use phoneNumber (WhatsApp ID), not conversationId (UUID)
              await sendMessage(phoneNumber, replyText);
            }

            return res.status(200).json({
              ok: true,
              handled: true,
              type: 'business_info',
              extracted: businessResult.extractedData || null
            });
          } else {
            console.log('[Webhook] Business info extraction failed, continuing to regular flow');
            // Continue to regular processing if business info fails
          }

        } catch (businessError) {
          console.error('[Webhook] Business info handler error:', businessError);
          // Continue to regular processing on error
        }
      }
    }

    // Route to appropriate handler based on message type and user role
    // ...existing code...
    // Example: Enhanced order/checkout handler with Zoho sync (insert in your actual order/checkout logic)
    /*
    const result = await enhancedOrderWithZoho.processOrderWithZohoSync(
      tenantId,              // your resolved tenant id
      endUserPhone,          // the WhatsApp phone number
      {
        // keep your existing structure here:
        subtotal: cart.subtotal,
        gstAmount: cart.gstAmount,
        gstRate: cart.gstRate,
        cgstAmount: cart.cgstAmount,
        sgstAmount: cart.sgstAmount,
        igstAmount: cart.igstAmount,
        shippingCharges: cart.shippingCharges,
        discountAmount: cart.discountAmount,
        total: cart.total,
        items: cart.items.map(i => ({
          productId: i.product_id,
          quantity: i.quantity,
          price: i.price
        }))
      }
    );

    // immediate user reply (non-blocking Zoho)
    await sendMessage(endUserPhone, result.message);
    */
    // ...existing code...
    console.log('[WEBHOOK_ROUTING] Message type:', message.type, '| Is admin:', req.isAdmin);
    if (message.type === 'document' || message.type === 'image' || message.type === 'media') {
      console.log('[WEBHOOK_ROUTING] Calling handleDocument for', message.type);
      return await handleDocument(req, res);  // CRITICAL: Return to prevent fall-through
    } else if (message.type === 'text') {
      console.log('[DEBUG][WEBHOOK] Text message handler entered for:', message.from, '| text:', message.text?.body);
      console.log('[DEBUG][WEBHOOK] ========== MESSAGE TEXT:', JSON.stringify(message.text?.body), '==========');
      // Price queries are now handled by smart router in customerHandler
      // No need for old patch code here
      // Always route /login and /status to handleTenantMessage, regardless of admin status
      const txt = (message.text?.body || '').trim().toLowerCase();
      if (txt === '/login' || txt === '/status') {
        await handleTenantMessage(req, res);
      } else if (req.isAdmin) {
        await handleTenantMessage(req, res);
      } else {
        // CUSTOMER MESSAGE HANDLING WITH AI INTEGRATION
        const messageText = message.text?.body || '';
        console.log('[CUSTOMER] ========================================');
        console.log('[CUSTOMER] Message received:', messageText);
        console.log('[CUSTOMER] Message text JSON:', JSON.stringify(messageText));
        console.log('[CUSTOMER] Starting AI routing for:', message.from);
        console.log('[CUSTOMER] ========================================');

        // CRITICAL: Ensure customer profile exists on EVERY message (using core service)
        const CustomerService = require('../services/core/CustomerService');
        try {
          const { profile, created } = await CustomerService.ensureCustomerProfile(tenant.id, message.from);
          console.log(`[WEBHOOK] Customer profile ${created ? 'created' : 'verified'} for: ${message.from}`);
        } catch (syncError) {
          console.error('[WEBHOOK] Error ensuring customer profile:', syncError.message);
          // Don't fail the webhook - continue processing
        }

        // PRIORITY 1: Check for shipment tracking intent (VRL LR numbers)
        if (isShipmentTrackingIntent(messageText)) {
          console.log('[WEBHOOK] Shipment tracking intent detected');
          try {
            const conversationContext = {}; // Basic context
            const handled = await handleShipmentTracking(
              null, // sessionId not needed
              messageText,
              message.from,
              conversationContext,
              sendMessage
            );
            
            if (handled) {
              return res.status(200).json({ ok: true, type: 'shipment_tracking' });
            }
          } catch (trackingError) {
            console.error('[WEBHOOK] Shipment tracking error:', trackingError);
            // Fall through to regular handling if tracking fails
          }
        }

        // CRITICAL: Check conversation state using StateManager
        const StateManager = require('../services/core/ConversationStateManager');
        const GSTService = require('../services/core/GSTService');
        
        // Check for escape keywords that reset state
        if (StateManager.isEscapeKeyword(messageText)) {
          console.log('[WEBHOOK] Escape keyword detected, resetting state');
          await StateManager.resetState(tenant.id, message.from);
          const escapeMsg = '✓ Okay, starting fresh. How can I help you today?';
          await sendMessage(message.from, escapeMsg);
          return res.status(200).json({ ok: true, type: 'state_reset' });
        }
        
        const { state: currentState } = await StateManager.getState(tenant.id, message.from);
        console.log('[WEBHOOK] Current conversation state:', currentState);

        // Handle state-specific flows
        if (currentState === 'awaiting_address_update' || currentState === 'awaiting_shipping_info') {
          console.log(`[WEBHOOK] User in state: ${currentState} - checking if this is a new product request`);
          
          // Check if this looks like a product request instead of address
          const productPatterns = /\d+[xX]\d+|carton|ctns|ctn|box|packet|pcs|pieces|kg|liter|price|rate|quote/i;
          const addressKeywords = /address|deliver|ship|location|city|state|pincode|pin|area|road|street/i;
          
          const hasProductPattern = productPatterns.test(messageText);
          const hasAddressKeyword = addressKeywords.test(messageText);
          
          // If it looks like a product request (has product patterns, no address keywords), reset state
          if (hasProductPattern && !hasAddressKeyword) {
            console.log('[WEBHOOK] Detected new product request while awaiting shipping - resetting state');
            await StateManager.clearState(tenant.id, message.from);
            // Fall through to normal product handling
          } else {
            // Process as shipping/address input
            console.log('[WEBHOOK] Processing as shipping/address input');
            return handleCustomer(req, res);
          }
        }

        // PRIORITY: GST response handling (with pattern matching BEFORE AI)
        if (currentState === StateManager.STATES.AWAITING_GST) {
          console.log('[WEBHOOK] User in awaiting GST state, checking response');
          
          // Check if this is a business details submission first
          const ManualBusinessDetails = require('../services/manualBusinessDetailsService');
          if (ManualBusinessDetails.isBusinessDetailsMessage(messageText)) {
            console.log('[WEBHOOK] Business details submission detected');
            const detailsResult = await ManualBusinessDetails.handleBusinessDetailsSubmission(
              tenant.id,
              message.from,
              messageText
            );
            
            if (detailsResult.handled && detailsResult.success) {
              console.log('[WEBHOOK] Business details saved, proceeding to checkout');
              // Business details saved - proceed with checkout
              await handleCustomer(req, res);
              return;
            } else if (detailsResult.handled) {
              // Incomplete details - message already sent
              return res.status(200).json({ ok: true, type: 'business_details_incomplete' });
            }
          }
          
          // Try GST response handling
          const gstResult = await GSTService.handleGSTResponse(tenant.id, message.from, messageText);
          
          if (gstResult.handled) {
            console.log('[WEBHOOK] GST response handled:', {
              type: gstResult.type,
              hasGSTNumber: !!gstResult.gstNumber
            });
            
            // If GST verified successfully, proceed to checkout
            if (gstResult.type === 'gst_verified') {
              await handleCustomer(req, res);
              return;
            }
            
            // If NO GST preference set, proceed to checkout
            if (gstResult.type === 'no_gst') {
              await handleCustomer(req, res);
              return;
            }
            
            // Other cases (verification failed, needs info) - message already sent
            return res.status(200).json({ ok: true, type: 'gst_response' });
          }
        }

        // CRITICAL: Check for shipping update request FIRST (before any AI routing)
        const updateShippingPatterns = [
          /update.*shipping.*address/i,
          /update.*shipping.*details/i,
          /change.*shipping.*address/i,
          /change.*shipping.*details/i,
          /modify.*shipping.*address/i,
          /modify.*shipping.*details/i,
          /new.*shipping.*address/i,
          /update.*delivery.*address/i,
          /change.*delivery.*address/i
        ];

        if (updateShippingPatterns.some(pattern => pattern.test(messageText))) {
          console.log('[WEBHOOK] Shipping update request detected - delegating to customer handler');
          return handleCustomer(req, res); // Let customer handler take care of it
        }

        // PRIORITY CHECK: Cart commands (clear, view, checkout) - handle BEFORE any pattern detection
        if (messageText.toLowerCase().trim() === '/clearcart' || 
            /^(clear|empty|reset)\s*(my\s*)?(cart|basket)$/i.test(messageText.trim())) {
          console.log('[CUSTOMER] 🛒 Clear cart command detected - routing to handler');
          await handleCustomer(req, res);
          return;
        }

        if (messageText.toLowerCase().trim() === '/view_cart' || 
            /^(view|show|check)\s*(my\s*)?(cart|basket)$/i.test(messageText.trim())) {
          console.log('[CUSTOMER] 🛒 View cart command detected - routing to handler');
          await handleCustomer(req, res);
          return;
        }

        if (messageText.toLowerCase().trim() === '/checkout') {
          console.log('[CUSTOMER] 🛒 Checkout command detected - routing to handler');
          await handleCustomer(req, res);
          return;
        }

        // RETAIL COUNTER CONNECTION CHECK (QR code scan)
        const { parseRetailMessage, handleRetailConnection, sendRetailWelcome } = require('../services/retailCustomerCaptureService');
        const retailCheck = parseRetailMessage(messageText);

        if (retailCheck.isRetailConnect) {
          console.log('[RETAIL_CAPTURE] Retail counter connection detected:', retailCheck);
          const result = await handleRetailConnection(tenant.id, message.from, retailCheck.billNumber);
          await sendRetailWelcome(message.from, result);
          return res.status(200).json({
            ok: true,
            type: 'retail_connect',
            isNew: result.isNew,
            visitCount: result.visitCount
          });
        }

        // EARLY CHECK: Detect simple quantity patterns and discount requests that should skip AI
        console.log('[CUSTOMER] 🔍 Testing patterns for:', messageText);
        const hasLacPattern = /\d+\s*(?:lac|lakh)\s*(?:ctns?|cartons?|pcs?|pieces?)/i.test(messageText);
        console.log('[CUSTOMER] hasLacPattern result:', hasLacPattern);
        const hasQuantityOnly = /^\d+\s*(?:ctns?|cartons?|pcs?|pieces?)$/i.test(messageText);
        const hasEachPattern = /\b(each|har(?:\s*ek)?)\s+\d+\s*(?:ctns?|cartons?|pcs?|pieces?)/i.test(messageText) ||
                               /\d+\s*(?:ctns?|cartons?|pcs?|pieces?)\s+(?:each|per)/i.test(messageText);
        
        // CRITICAL: Check for cart operations early (before AI routing) to escape stuck states
        const intentClassifier = require('../services/ai/intentClassifier');
        const quickIntent = intentClassifier.quickClassify(messageText, { 
          inOrderDiscussion: currentState === 'multi_product_order_discussion' 
        });
        
        const isCartOperation = quickIntent.intent === 'cart_clear' || 
                                quickIntent.intent === 'cart_view' || 
                                quickIntent.intent === 'checkout';
        
        if (isCartOperation) {
          console.log('[CUSTOMER] ✅ Cart operation detected:', quickIntent.intent, '- routing directly to handler');
          await handleCustomer(req, res);
          return;
        }
        
        // Check for discount negotiation requests
        const hasDiscountRequest = /\b(?:give|can|discount|reduce|lower|best|final|last|kam|any)\s*(?:me|you|us|i|we)?\s*(?:get|have|give)?\s*(?:some|a|any)?\s*(?:discount|price|rate|better\s+price)/i.test(messageText) ||
                                   /^discount\??$/i.test(messageText) ||
                                   /\d+\s*(?:%|percent|percentage)/i.test(messageText) ||
                                   /^(?:give\s*me\s*)?more$/i.test(messageText) || // "more" or "give me more"
                                   /^(?:aur|zyada)$/i.test(messageText) || // Hindi: more
                                   /(?:give|make|can you do|do)\s*(?:me|it|for)?\s*(?:at|for|@)?\s*(?:₹|rs\.?)?\s*\d+(?:\.\d+)?/i.test(messageText) || // "give me for 2.90"
                                   /\d+(?:\.\d+)?\s*(?:₹|rs\.?|rupees?)/i.test(messageText) || // "2.90 rupees"
                                   /can\s+(?:i|we|you)\s+(?:get|have|give\s+me)\s+(?:a|any|some)?\s*discount/i.test(messageText) || // "can i get a discount"
                                   /\b(?:any|koi|some)\s+discount/i.test(messageText) || // "any discount?" or "koi discount?"
                                   /discount\s+(?:milega|chahiye|do|dena|de\s+do)/i.test(messageText); // "discount milega?" "discount chahiye" "discount do"
        
        // Check for price inquiry patterns (how much, what's the price, etc.)
        const hasPriceInquiry = /(?:how\s+much|what'?s?\s+(?:the\s+)?price|price\s+(?:of|for)|rate|cost|kitna|batao|chahiye|best\s+price)/i.test(messageText) &&
                                /\d+[x*]\d+/i.test(messageText); // Must have product code
        
        // NEW: Check for product code with quantity (e.g., "10x140 10 ctns" or "10X140 1000PCS")
        // This catches cases where user provides product code and quantity without explicit price/order keywords
        const hasProductCodeWithQuantity = /\d+[x*]\d+/i.test(messageText) && 
                                          /\d+\s*(?:ctns?|cartons?|pcs?|pieces?)/i.test(messageText);
        
        console.log('[CUSTOMER] Pattern detection:', {
          hasLacPattern,
          hasQuantityOnly,
          hasEachPattern,
          hasDiscountRequest,
          hasPriceInquiry,
          hasProductCodeWithQuantity,
          messageText
        });
        
        // If it's a clear quantity pattern, discount request, price inquiry, or product code with quantity, skip AI and go straight to customer handler
        if (hasLacPattern || hasQuantityOnly || hasEachPattern || hasDiscountRequest || hasPriceInquiry || hasProductCodeWithQuantity) {
          const patternType = hasLacPattern ? 'lac_pattern' : 
                             hasQuantityOnly ? 'quantity_only' : 
                             hasEachPattern ? 'each_pattern' : 
                             hasDiscountRequest ? 'discount_request' : 
                             hasPriceInquiry ? 'price_inquiry' : 'product_code_with_quantity';
          console.log('[CUSTOMER] ✅ Detected', patternType, '- skipping AI, routing directly to handler');
          await handleCustomer(req, res);
          return;
        }

        console.log('[CUSTOMER] No early patterns matched, proceeding with AI');

        try {
          // AI processes and understands the intent
          const aiResult = await aiHandlerHelper.processAndRoute(
            message.from,
            message.text?.body || '',
            tenant.id
          );

          console.log('[CUSTOMER] AI Routing Decision:', JSON.stringify({
            action: aiResult.action,
            intent: aiResult.intent,
            confidence: aiResult.confidence,
            hasAIResponse: !!aiResult.response
          }));

          // Route based on intent, not action
          // CRITICAL: Check for patterns that need context-based order handling
          const messageText = message.text?.body || '';
          
          const hasEachPattern = /\b(each|har(?:\s*ek)?)\s+\d+\s*(?:ctns?|cartons?|pcs?|pieces?)/i.test(messageText) ||
                                 /\d+\s*(?:ctns?|cartons?|pcs?|pieces?)\s+(?:each|per)/i.test(messageText);
          
          // Check for lac/lakh patterns (Indian numbering)
          const hasLacPattern = /\d+\s*(?:lac|lakh)\s*(?:ctns?|cartons?|pcs?|pieces?)/i.test(messageText);
          
          // Check for simple quantity patterns (for context-based ordering)
          const hasQuantityOnly = /^\d+\s*(?:ctns?|cartons?|pcs?|pieces?)$/i.test(messageText);
          
          // Use AI intent detection for cart operations (no more brittle regex!)
          const isCartOperation = aiResult.intent === 'cart_clear' || 
                                  aiResult.intent === 'cart_view' || 
                                  aiResult.intent === 'checkout';
          
          if (
            isCartOperation ||   // AI-detected cart operations
            aiResult.intent === 'price_inquiry' ||
            aiResult.intent === 'order' ||
            aiResult.intent === 'order_status' ||
            hasEachPattern ||  // Route "2 ctns each" to customer handler
            hasLacPattern ||   // Route "1lac pcs" to customer handler
            hasQuantityOnly || // Route "5 ctns" to customer handler (context-based)
            /\b(send|give|get|show|provide)?\s*(me|us|the)?\s*(invoice|bill)\b/i.test(messageText)
          ) {
            // Let specialized handlers process prices, orders, and invoices for accuracy
            const routeReason = isCartOperation ? aiResult.intent :
                               aiResult.intent || 
                               (hasEachPattern ? 'each_pattern' : 
                                hasLacPattern ? 'lac_pattern' :
                                hasQuantityOnly ? 'quantity_only' : 'invoice request');
            console.log('[CUSTOMER] Routing to specialized handler for:', routeReason);
            await handleCustomer(req, res);
          } else if (aiResult.action === 'use_rules') {
            // AI says: use traditional rules
            console.log('[CUSTOMER] AI suggests using rules-based handler');
            await handleCustomer(req, res);
          } else if (aiResult.response) {
            // AI generated a human-like response - send it
            console.log('[CUSTOMER] Sending AI response');
            
            // CRITICAL: Save messages to database
            try {
              // Get or create conversation
              const { data: conversations } = await dbClient
                .from('conversations_new')
                .select('*')
                .eq('tenant_id', tenant.id)
                .eq('end_user_phone', message.from)
                .order('created_at', { ascending: false })
                .limit(1);
              
              let conversationId = null;
              if (conversations && conversations.length > 0) {
                conversationId = conversations[0].id;
              } else {
                // Create new conversation
                const { data: newConv } = await dbClient
                  .from('conversations_new')
                  .insert({
                    tenant_id: tenant.id,
                    phone_number: message.from,
                    end_user_phone: message.from,
                    state: 'active',
                    created_at: new Date().toISOString()
                  })
                  .select()
                  .single();
                conversationId = newConv?.id;
              }
              
              if (conversationId) {
                // Save user message
                await dbClient.from('messages').insert({
                  conversation_id: conversationId,
                  message_body: messageText,
                  sender: 'user',
                  message_type: 'user_input',
                  created_at: new Date().toISOString()
                });
                
                // Send AI response
                await sendMessage(message.from, aiResult.response);
                
                // Save bot response
                await dbClient.from('messages').insert({
                  conversation_id: conversationId,
                  message_body: aiResult.response,
                  sender: 'bot',
                  message_type: 'ai_response',
                  created_at: new Date().toISOString()
                });
                
                // Update conversation timestamp
                await dbClient.from('conversations_new')
                  .update({ 
                    last_message_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                  })
                  .eq('id', conversationId);
                
                console.log('[CUSTOMER] Messages saved to database');
              }
            } catch (dbError) {
              console.error('[CUSTOMER] Failed to save messages:', dbError.message);
            }
            
            return res.status(200).json({ ok: true, type: 'ai_response' });
          } else {
            // Fallback to traditional handler
            console.log('[CUSTOMER] No AI response, using traditional handler');
            await handleCustomer(req, res);
          }

        } catch (aiError) {
          console.error('[CUSTOMER] AI routing error:', aiError.message);
          // Always fallback to traditional handler on error
          await handleCustomer(req, res);
        }
      }
    } else {
      await sendMessage(message.from, "I can only process text messages and file uploads at the moment.");
      res.status(200).json({ ok: true, type: 'unsupported_message_type' });
    }

    if (!res.headersSent) {
      res.status(200).json({ ok: true, processed: true });
    }
  } catch (error) {
    debug.traceErr(req._rid, 'webhook.handler', error);
    console.error('[WEBHOOK] Processing error:', error);
    if (!res.headersSent) {
      res.status(200).json({
        ok: false,
        error: 'processing-failed',
        hint: error.message
      });
    }
  }
});

// Error handling middleware
router.use((err, req, res, next) => {
  console.error('[WEBHOOK_ERR]', err.stack || err);
  debug.traceErr(req._rid, 'webhook.error', err);
  
  if (!res.headersSent) {
    res.status(200).json({ 
      ok: false, 
      error: 'internal', 
      hint: err.message 
    });
  }
});

/**
 * Ensure a conversation record exists for the given phone number and tenant.
 * If a conversation exists, returns its ID. If not, creates a new conversation and returns the new ID.
 */
/**
 * Ensure a conversation record exists for the given phone number and tenant.
 * If a conversation exists, returns its ID. If not, creates a new conversation and returns the new ID.
 */
async function ensureConversationByPhone(phone, tenantId) {
  // CRITICAL DEBUG
  console.log('[ensureConversationByPhone] CALLED WITH:', {
    phone: phone,
    phoneType: typeof phone,
    phoneValue: JSON.stringify(phone),
    tenantId: tenantId,
    tenantIdType: typeof tenantId
  });

  if (!phone) {
    console.error('[ensureConversationByPhone] REJECTED - No phone provided:', phone);
    return null;
  }

  if (!tenantId) {
    console.error('[ensureConversationByPhone] REJECTED - No tenantId provided:', tenantId);
    return null;
  }

  const phoneToUse = String(phone);
  console.log('[ensureConversationByPhone] Processing phone:', phoneToUse, 'tenant:', tenantId);

  // ... rest of your function
  try {
    // First, try exact match
    const { data: conv, error: convErr } = await dbClient
      .from('conversations_new')
      .select('id, end_user_phone')
      .eq('tenant_id', tenantId)
      .eq('end_user_phone', phoneToUse)  // Exact match with @c.us
      .maybeSingle();
    
    if (convErr) {
      console.error('[ensureConversationByPhone] Query error:', convErr);
    }
    
    if (conv && conv.id) {
      console.log('[ensureConversationByPhone] ✅ Found existing conversation:', conv.id);
      return conv.id;
    }
    
    // Not found - create new conversation
    console.log('[ensureConversationByPhone] Creating new conversation');
    
    const { data: newConv, error: insertErr } = await dbClient
      .from('conversations_new')
      .insert({
        tenant_id: tenantId,
        phone_number: phoneToUse,
        end_user_phone: phoneToUse,  // Keep @c.us format
        status: 'active',
        state: 'new',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .select('id, end_user_phone')
      .single();
    
    if (insertErr) {
      console.error('[ensureConversationByPhone] Create error:', insertErr);
      console.error('[ensureConversationByPhone] Attempted to insert:', {
        tenant_id: tenantId,
        end_user_phone: phoneToUse
      });
      return null;
    }
    
    console.log('[ensureConversationByPhone] ✅ Created conversation:', newConv.id);
    return newConv.id;
    
  } catch (err) {
    console.error('[ensureConversationByPhone] Exception:', err);
    return null;
  }
}

/**
 * Persist an inbound message to the database.
 * Associates the message with a conversation ID and records the message details.
 */
async function persistInboundMessage(conversationId, text, messageType = 'text', sender = 'user') {
  if (!conversationId) return null;
  try {
    const payload = {
      conversation_id: conversationId,
      sender,
      message_body: text ?? null,
      message_type: messageType ?? 'text',
      created_at: new Date().toISOString()
    };
    const { data, error } = await dbClient.from('messages').insert([payload]).select('id').maybeSingle();
    if (error) {
      console.error('[persistInboundMessage] insert error', error);
      return null;
    }
    return data?.id || null;
  } catch (err) {
    console.error('[persistInboundMessage] exception', err);
    return null;
  }
}

module.exports = router;

