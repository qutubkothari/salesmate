// routes/handlers/modules/mainHandler.js
// Main orchestrator for customer message handling - refactored and modular

const { processIntentAndContext } = require('./intentHandler');
// const { handleSmartResponse } = require('./smartResponseHandler');  // DEPRECATED: No longer used, all queries go through AI
const { handleDiscountRequests } = require('./discountHandler');
const { handleAddProduct } = require('./addProductHandler');
const { sendMessage } = require('../../../services/whatsappService');
const { dbClient } = require('../../../services/config');

// Import Enhanced AI Intelligence system
const ConversationMemory = require('../../../services/core/ConversationMemory');
const EnhancedIntentClassifier = require('../../../services/core/EnhancedIntentClassifier');
const ErrorRecoveryService = require('../../../services/core/ErrorRecoveryService');
const ProactiveClarificationService = require('../../../services/core/ProactiveClarificationService');
const ResponseVariationService = require('../../../services/core/ResponseVariationService');
const ConversationLearningService = require('../../../services/conversationLearningService');

console.log('[MAIN_HANDLER] Enhanced AI Intelligence System loaded with human-like capabilities + Learning');

// Helper function to send message and save to database
async function sendAndSaveMessage(to, messageBody, conversationId, tenantId) {
    try {
        // Send message via configured provider (Maytapi for paid tiers; WhatsApp Web otherwise)
        const messageId = await sendMessage(to, messageBody, tenantId);
        if (!messageId) {
            throw new Error('Failed to send WhatsApp message');
        }
        
        // Save bot message to database
        try {
            if (conversationId) {
                await dbClient.from('messages').insert({
                    tenant_id: tenantId,
                    conversation_id: conversationId,
                    message_body: messageBody,
                    sender: 'bot',
                    message_type: 'bot_response',
                    whatsapp_message_id: messageId,
                    created_at: new Date().toISOString()
                });
                console.log('[MAIN_HANDLER] Bot message saved to database');
            } else {
                console.warn('[MAIN_HANDLER] No conversationId; skipping bot message save');
            }
        } catch (dbError) {
            console.error('[MAIN_HANDLER] Failed to save bot message:', dbError.message, dbError);
        }
        
        return messageId;
    } catch (error) {
        console.error('[MAIN_HANDLER] Error sending/saving message:', error.message);
        throw error;
    }
}

async function handleCustomerMessage(req, res, tenant, from, userQuery, conversation) {
    console.log('[MAIN_HANDLER] ===== STARTING MODULAR CUSTOMER HANDLER =====');
    console.log('[MAIN_HANDLER] Query:', userQuery, 'From:', from);
    // Debug: Log conversation state and metadata for every message
    console.log('[MAIN_HANDLER][DEBUG] Conversation state:', conversation?.state);
    console.log('[MAIN_HANDLER][DEBUG] Conversation metadata:', JSON.stringify(conversation?.metadata));

    try {
        // CRITICAL: Save incoming user message to database FIRST
        // This ensures every message is persisted regardless of processing outcome
        if (conversation && conversation.id) {
            try {
                const createdAt = new Date().toISOString();
                let insertedMessageId = null;

                try {
                    const { data: insertedRow } = await dbClient
                        .from('messages')
                        .insert({
                            tenant_id: tenant.id,
                            conversation_id: conversation.id,
                            message_body: userQuery,
                            sender: 'user',
                            message_type: 'user_input',
                            created_at: createdAt
                        })
                        .select('id')
                        .maybeSingle();
                    insertedMessageId = insertedRow?.id || null;
                } catch (_) {
                    // Fallback for DB wrappers that don't support select/maybeSingle on insert
                    await dbClient.from('messages').insert({
                        tenant_id: tenant.id,
                        conversation_id: conversation.id,
                        message_body: userQuery,
                        sender: 'user',
                        message_type: 'user_input',
                        created_at: createdAt
                    });
                }
                
                // Update conversation's last_message_at and last_activity_at timestamps
                await dbClient.from('conversations_new')
                    .update({ 
                        last_message_at: new Date().toISOString(),
                        last_activity_at: new Date().toISOString(),
                        updated_at: new Date().toISOString()
                    })
                    .eq('id', conversation.id);
                    
                console.log('[MAIN_HANDLER] User message saved to database');
                
                // ===== SALESMATE INTELLIGENCE: AUTO HEAT SCORING =====
                try {
                    const { analyzeAndUpdateHeat, escalateHighHeatLead } = require('../../../services/heatScoringService');
                    
                    console.log('[HEAT_SCORING] Analyzing message urgency for conversation', conversation.id);
                    const heatAnalysis = await analyzeAndUpdateHeat(
                        tenant.id,
                        conversation.id,
                        userQuery,
                        { useAI: true, conversationContext: {} }
                    );
                    
                    console.log(`[HEAT_SCORING] Updated heat: ${heatAnalysis.heat} (confidence: ${heatAnalysis.confidence?.toFixed(2)})`);
                    
                    // Auto-escalate very hot leads to triage
                    await escalateHighHeatLead(tenant.id, conversation.id, heatAnalysis.heat);
                } catch (heatError) {
                    console.error('[HEAT_SCORING] Error:', heatError.message);
                    // Continue processing even if heat scoring fails
                }
                
                // ===== SALESMATE INTELLIGENCE: AUTO ASSIGNMENT =====
                try {
                    const { assignConversation } = require('../../../services/assignmentService');
                    
                    // Check if conversation is not already assigned
                    const { data: convCheck } = await dbClient
                        .from('conversations_new')
                        .select('assigned_to')
                        .eq('id', conversation.id)
                        .single();
                    
                    if (!convCheck?.assigned_to) {
                        console.log('[AUTO_ASSIGNMENT] Attempting to assign conversation', conversation.id);
                        const assignResult = await assignConversation(tenant.id, conversation.id);
                        
                        if (assignResult.success) {
                            console.log(`[AUTO_ASSIGNMENT] ✅ Assigned to salesman: ${assignResult.salesman?.name} (strategy: ${assignResult.strategy})`);
                        } else {
                            console.log(`[AUTO_ASSIGNMENT] Not assigned: ${assignResult.reason}`);
                        }
                    }
                } catch (assignError) {
                    console.error('[AUTO_ASSIGNMENT] Error:', assignError.message);
                    // Continue processing even if assignment fails
                }
            } catch (dbError) {
                console.error('[MAIN_HANDLER] Failed to save user message:', dbError.message, dbError);
                // Continue processing even if save fails
            }
        } else {
            console.log('[MAIN_HANDLER] No conversation found, skipping message save - conversation will be created');
        }

        // ===== ENHANCED AI INTELLIGENCE SYSTEM =====
        // Save message to conversation memory for context tracking
        if (conversation?.id) {
            console.log('[ENHANCED_AI] Saving message to conversation memory');
            await ConversationMemory.saveMessage(
                conversation.id,
                userQuery,
                'user',
                { intent: null, entities: null } // Will be filled after classification
            );
        }

        // Get conversation context and memory
        const conversationMemory = conversation?.id 
            ? await ConversationMemory.getMemory(tenant.id, from)
            : null;
        
        console.log('[ENHANCED_AI] Conversation memory:', {
            messageCount: conversationMemory?.recentMessages?.length || 0,
            cartActive: conversationMemory?.cartActive,
            lastIntent: conversationMemory?.lastIntent
        });

        // STEP 0: Check for self-registration requests (customers wanting to become tenants)
        const { isRegistrationRequest, getRegistrationState, handleSelfRegistration } = require('../../../services/selfRegistrationService');
        
        if (isRegistrationRequest(userQuery)) {
            console.log('[MAIN_HANDLER] Self-registration request detected from customer');
            try {
                const result = await handleSelfRegistration(
                    from,
                    userQuery,
                    async (to, msg) => await sendAndSaveMessage(to, msg, conversation?.id, tenant.id),
                    tenant.id
                );
                
                if (result) {
                    console.log('[MAIN_HANDLER] Self-registration handled:', result.action);
                    return res.status(200).json({ ok: true, type: 'self_registration', result });
                }
            } catch (error) {
                console.error('[MAIN_HANDLER] Self-registration error:', error);
            }
        }

        // Check if customer is in registration confirmation state
        if (conversation && conversation.state === 'pending_registration_confirmation') {
            console.log('[MAIN_HANDLER] Customer in registration confirmation state');
            try {
                const result = await handleSelfRegistration(
                    from,
                    userQuery,
                    async (to, msg) => await sendAndSaveMessage(to, msg, conversation?.id, tenant.id),
                    tenant.id
                );
                
                if (result) {
                    console.log('[MAIN_HANDLER] Registration confirmation handled:', result.action);
                    return res.status(200).json({ ok: true, type: 'registration_confirmation', result });
                }
            } catch (error) {
                console.error('[MAIN_HANDLER] Registration confirmation error:', error);
            }
        }


        // STEP 0.1: Check for cart commands FIRST (before any other processing)
        const { clearCart, viewCartWithDiscounts, checkoutWithDiscounts } = require('../../../services/cartService');
        const intentClassifier = require('../../../services/ai/intentClassifier');
        
        // Use AI intent detection for cart operations (no more brittle regex!)
        // Check if conversation exists before accessing state
        const inOrderDiscussion = conversation && conversation.state === 'multi_product_order_discussion';
        const cartIntent = intentClassifier.quickClassify(userQuery, { inOrderDiscussion });
        
        if (userQuery.toLowerCase().trim() === '/clearcart' || cartIntent.intent === 'cart_clear') {
            console.log('[MAIN_HANDLER] Clear cart command detected');
            const result = await clearCart(tenant.id, from);
            await sendAndSaveMessage(from, result, conversation?.id, tenant.id);
            return res.status(200).json({ ok: true, type: 'cart_clear' });
        }

        if (userQuery.toLowerCase().trim() === '/view_cart' || cartIntent.intent === 'cart_view') {
            console.log('[MAIN_HANDLER] View cart command detected');
            const result = await viewCartWithDiscounts(tenant.id, from);
            await sendAndSaveMessage(from, result, conversation?.id, tenant.id);
            return res.status(200).json({ ok: true, type: 'cart_view' });
        }

        if (userQuery.toLowerCase().trim() === '/checkout' || cartIntent.intent === 'checkout') {
            console.log('[MAIN_HANDLER] Checkout command detected');
            const result = await checkoutWithDiscounts(tenant, from);
            await sendAndSaveMessage(from, result, conversation?.id, tenant.id);
            return res.status(200).json({ ok: true, type: 'checkout' });
        }

        // STEP 0.4: Check for retail counter connection (QR code scan)
        const { parseRetailMessage, handleRetailConnection, sendRetailWelcome } = require('../../../services/retailCustomerCaptureService');
        const retailCheck = parseRetailMessage(userQuery);

        if (retailCheck.isRetailConnect) {
            console.log('[MAIN_HANDLER] Retail counter connection detected:', retailCheck);
            const result = await handleRetailConnection(tenant.id, from, retailCheck.billNumber);
            await sendRetailWelcome(from, result);
            return res.status(200).json({
                ok: true,
                type: 'retail_connect',
                isNew: result.isNew,
                visitCount: result.visitCount
            });
        }

        // STEP 0.8: Multi-step shipping info collection
        if (conversation?.state === 'awaiting_shipping_info' && conversation?.metadata?.pending_shipping_order_id) {
            console.log('[MAIN_HANDLER] Awaiting shipping info - parsing user reply');
            const { parseShippingInfo, saveShippingInfo } = require('../../../services/shippingInfoService');
            const shippingInfo = parseShippingInfo(userQuery);
            const orderId = conversation.metadata.pending_shipping_order_id;
            try {
                await saveShippingInfo(orderId, shippingInfo, tenant.id, from);
                // Update conversation state
                const { dbClient } = require('../../../services/config');
                await dbClient
                .from('conversations_new')
                .update({ state: 'active', metadata: { ...conversation.metadata, pending_shipping_order_id: null } })
                .eq('id', conversation.id);
                // Confirmation message
                let confirmationMsg = `âœ… *Your shipping details have been updated!*\n\nHere's what we've saved for your future orders:\n\nðŸ“ *Address:* ${shippingInfo.shippingAddress}\nðŸ™ï¸ *City:* ${shippingInfo.shippingCity || ''}\nðŸŒ *State:* ${shippingInfo.shippingState || ''}\nðŸ”¢ *Pincode:* ${shippingInfo.shippingPincode || ''}\nðŸš› *Transporter:* ${shippingInfo.transporterName}\nðŸ“ž *Transporter Contact:* ${shippingInfo.transporterContact}\n\nThank you! Your details are now saved and will be used for all upcoming deliveries. If you need to make any changes, just let us know!`;
                await sendAndSaveMessage(from, confirmationMsg, conversation?.id, tenant.id);
                return res.status(200).json({ ok: true, type: 'shipping_info_saved', details: shippingInfo });
            } catch (err) {
                console.error('[MAIN_HANDLER] Error saving shipping info:', err.message);
                await sendAndSaveMessage(from, 'Failed to save shipping details. Please try again.', conversation?.id, tenant.id);
                return res.status(200).json({ ok: false, type: 'shipping_info_save_failed' });
            }
        }

        // STEP 0.85: Check for explicit shipping address update request (BEFORE AI)
        const updateShippingPatterns = [
            /update.*shipping.*address/i,
            /update.*shipping.*details/i,
            /change.*shipping.*address/i,
            /change.*shipping.*details/i,
            /modify.*shipping.*address/i,
            /update.*delivery.*address/i,
            /change.*delivery.*address/i,
            /update.*my.*shipping/i,
            /change.*my.*shipping/i
        ];
        
        if (updateShippingPatterns.some(pattern => pattern.test(userQuery))) {
            console.log('[MAIN_HANDLER] Shipping address update request detected (pattern match) - triggering flow');
            const { handleShippingAddressUpdate } = require('../../../services/shippingInfoService');
            await handleShippingAddressUpdate(tenant.id, from);
            return res.status(200).json({ ok: true, type: 'shipping_address_update_prompted' });
        }

        // STEP 0.9: Handle shipping address update (awaiting_address_update state)
        if (conversation?.state === 'awaiting_address_update') {
            console.log('[MAIN_HANDLER] Awaiting address update - processing customer reply');
            const { processAddressUpdate } = require('../../../services/shippingInfoService');
            const result = await processAddressUpdate(tenant.id, from, userQuery);
            if (result.success) {
                await sendAndSaveMessage(from, result.message, conversation?.id, tenant.id);
                return res.status(200).json({ ok: true, type: 'address_updated', details: result.shippingInfo });
            } else {
                await sendAndSaveMessage(from, result.message, conversation?.id, tenant.id);
                return res.status(200).json({ ok: false, type: 'address_update_failed', error: result.error });
            }
        }

        // STEP 0.95: Human handover detection (text) + triage
        // If the user explicitly asks for a human, short-circuit and create a triage item.
        try {
            const { detectHandoverTriggers, notifySalesTeam, sendHandoverResponse } = require('../../../services/humanHandoverService');
            if (detectHandoverTriggers(userQuery)) {
                const { getConversationId } = require('../../../services/historyService');
                const { upsertTriageForConversation } = require('../../../services/triageService');

                const conversationId = conversation?.id || await getConversationId(tenant.id, from);

                if (conversationId) {
                    try {
                        await dbClient
                            .from('conversations_new')
                            .update({ requires_human_attention: true, updated_at: new Date().toISOString() })
                            .eq('id', conversationId);
                    } catch (_) {
                        // best-effort
                    }

                    try {
                        await upsertTriageForConversation(dbClient, {
                            tenantId: tenant.id,
                            conversationId,
                            endUserPhone: from,
                            type: 'HUMAN_ATTENTION',
                            messagePreview: 'Auto-triage: customer requested human',
                            metadata: { source: 'mainHandler', trigger: 'detectHandoverTriggers' }
                        });
                    } catch (_) {
                        // best-effort
                    }
                }

                try {
                    await notifySalesTeam(tenant, from, userQuery, {
                        lastProduct: conversation?.last_product_discussed || null,
                        cartItems: null,
                        orderValue: null
                    });
                } catch (_) {
                    // best-effort
                }

                const handoverMsg = await sendHandoverResponse(from, tenant.id, 'english');
                await sendAndSaveMessage(from, handoverMsg, conversationId || conversation?.id, tenant.id);
                return res.status(200).json({ ok: true, type: 'human_handover' });
            }
        } catch (e) {
            console.error('[MAIN_HANDLER] Handover detection error:', e?.message || e);
        }

        // ===== ENHANCED AI CLASSIFICATION =====
        console.log('[MAIN_HANDLER] STEP 1: Enhanced AI Intent Classification');
        
        // Use Enhanced AI to classify intent with conversation context
        let enhancedIntent = null;
        console.log('[ENHANCED_AI] Classifying with context...');
        enhancedIntent = await EnhancedIntentClassifier.classifyWithContext(
            userQuery,
            tenant.id,
            from,
            { conversationMemory }
        );
        
        console.log('[ENHANCED_AI] Classification result:', {
            intent: enhancedIntent.intent,
            confidence: enhancedIntent.confidence,
            entities: Object.keys(enhancedIntent.entities || {}).length
        });
        
        // Save the classified intent back to memory
        if (conversation?.id) {
            await ConversationMemory.saveMessage(
                conversation.id,
                userQuery,
                'user',
                { intent: enhancedIntent.intent, entities: enhancedIntent.entities }
            );
        }
        
        // Fallback to old intent processing if Enhanced AI not available
        console.log('[MAIN_HANDLER] STEP 1.5: Legacy Intent Processing (fallback)');
        const { intentResult, conversationContext } = await processIntentAndContext(userQuery, tenant, from, conversation);

        // Use Enhanced AI intent if available and confident, otherwise use legacy
        const finalIntent = (enhancedIntent && enhancedIntent.confidence > 0.7) 
            ? enhancedIntent.intent 
            : intentResult?.intent;
        
        console.log('[MAIN_HANDLER] Final intent decision:', finalIntent, 
            enhancedIntent ? `(Enhanced AI: ${enhancedIntent.confidence})` : '(Legacy)');

        // STEP 2: Smart routing based on Enhanced AI classification
        console.log('[MAIN_HANDLER] STEP 2: Smart Intent Routing');
        
        // STEP 2.0: AI-powered invoice request detection (NO REGEX)
        if (finalIntent === 'INVOICE_REQUEST' || finalIntent === 'invoice_request') {
            console.log('[ENHANCED_AI] Invoice request detected via AI');
            const { handleInvoiceRequest } = require('../zohoOperationsHandler');
            const invoiceResult = await handleInvoiceRequest(tenant, from, conversation, userQuery);
            if (invoiceResult && invoiceResult.response) {
                await sendAndSaveMessage(from, invoiceResult.response, conversation?.id, tenant.id);
                return res.status(200).json({ ok: true, type: 'invoice_request_ai' });
            }
        }
        
        // STEP 2.1: AI-powered shipping address update detection (NO REGEX)
        if (finalIntent === 'SHIPPING_ADDRESS_UPDATE' || finalIntent === 'shipping_update') {
            console.log('[ENHANCED_AI] Shipping address update request detected via AI');
            const { handleShippingAddressUpdate } = require('../../../services/shippingInfoService');
            await handleShippingAddressUpdate(tenant.id, from);
            return res.status(200).json({ ok: true, type: 'shipping_address_update_prompted_ai' });
        }
        
        // STEP 2.2: Quantity update via Enhanced AI
        if (finalIntent === 'QUANTITY_UPDATE' || finalIntent === 'quantity_update') {
            console.log('[ENHANCED_AI] Quantity update intent detected via AI');
            const { handleQuantityUpdate } = require('./quantityUpdateHandler');
            const quantityResponse = await handleQuantityUpdate(req, res, tenant, from, userQuery, conversation, enhancedIntent || intentResult);
            
            if (quantityResponse) {
                console.log('[MAIN_HANDLER] Quantity update handler processed request');
                await sendAndSaveMessage(from, quantityResponse.response, conversation?.id, tenant.id);
                return res.status(200).json({ ok: true, type: 'quantity_update_ai' });
            }
        }

        // STEP 2.3: Check for ADD_PRODUCT intent via Enhanced AI
        if (finalIntent === 'ADD_PRODUCT' || finalIntent === 'add_product' || finalIntent === 'ORDER') {
            console.log('[ENHANCED_AI] Add product intent detected via AI');
            const addProductResponse = await handleAddProduct(req, res, tenant, from, userQuery, enhancedIntent || intentResult, conversation);

            if (addProductResponse) {
                console.log('[MAIN_HANDLER] Add product handler processed request (AI-routed)');
                await sendAndSaveMessage(from, addProductResponse.response, conversation?.id || null, tenant.id);
                return res.status(200).json({ ok: true, type: 'add_product_ai' });
            }
        }

        // STEP 2.4: Check for PRODUCT_INQUIRY intent via Enhanced AI
        if (finalIntent === 'PRODUCT_INQUIRY' || finalIntent === 'product_inquiry' || finalIntent === 'INQUIRY') {
            console.log('[ENHANCED_AI] Product inquiry intent detected via AI');
            // Let it continue to Smart Router which handles inquiries
        }

        console.log('[MAIN_HANDLER] STEP 2.5: Checking for discount requests');
        // STEP 2.5: Check for discount requests BEFORE Smart Router
        const discountResponse = await handleDiscountRequests(req, res, tenant, from, userQuery, intentResult, conversation);

        if (discountResponse) {
            console.log('[MAIN_HANDLER] Discount handler processed request');
            await sendAndSaveMessage(from, discountResponse.response, conversation?.id, tenant.id);
            return res.status(200).json({ ok: true, type: discountResponse.source, discountPercent: discountResponse.discountPercent });
        }

        console.log('[MAIN_HANDLER] STEP 2.2: Checking for document requests');
        // STEP 2.2: Handle document requests (catalog, price list, technical docs, images)
        const documentIntents = ['REQUEST_CATALOG', 'REQUEST_PRICE_LIST', 'REQUEST_TECHNICAL_DOC', 'REQUEST_PRODUCT_IMAGE'];
        if (documentIntents.includes(intentResult?.intent)) {
            console.log('[MAIN_HANDLER] Document request detected:', intentResult.intent);
            const { handleDocumentRequest } = require('../../../services/documentRetrievalService');

            let requestType = null;
            let productCode = intentResult?.extractedData?.productCode || null;

            // Map intent to request type
            if (intentResult.intent === 'REQUEST_CATALOG') requestType = 'CATALOG';
            else if (intentResult.intent === 'REQUEST_PRICE_LIST') requestType = 'PRICE_LIST';
            else if (intentResult.intent === 'REQUEST_TECHNICAL_DOC') requestType = 'TECHNICAL';
            else if (intentResult.intent === 'REQUEST_PRODUCT_IMAGE') requestType = 'PRODUCT_IMAGE';

            const documentResult = await handleDocumentRequest(requestType, productCode, tenant.id);
            await sendAndSaveMessage(from, documentResult.message, conversation?.id, tenant.id);
            return res.status(200).json({ ok: true, type: 'document_request', documentType: requestType });
        }

        console.log('[MAIN_HANDLER] STEP 2.3: Checking for ADD_PRODUCT intent');
        // STEP 2.3: Check for ADD_PRODUCT intent (direct add to cart)
        const addProductResponse = await handleAddProduct(req, res, tenant, from, userQuery, intentResult, conversation);

        if (addProductResponse) {
            console.log('[MAIN_HANDLER] Add product handler processed request');
            await sendAndSaveMessage(from, addProductResponse.response, conversation?.id || null, tenant.id);
            return res.status(200).json({ ok: true, type: addProductResponse.source });
        }

        // STEP 2.4: Check for discount acceptance intent
        if (intentResult?.intent === 'DISCOUNT_ACCEPTANCE') {
            console.log('[MAIN_HANDLER] Discount acceptance detected - showing cart with discount');
            const { viewCartWithDiscounts } = require('../../../services/cartService');
            const cartView = await viewCartWithDiscounts(tenant.id, from);
            const confirmationMsg = `Great! I've applied the discount to your cart.\n\n${cartView}\n\nTo proceed with your order, please reply "yes" or "checkout".`;
            await sendAndSaveMessage(from, confirmationMsg, conversation.id, tenant.id);
            return res.status(200).json({ ok: true, type: 'discount_accepted' });
        }

        // STEP 2.5: Check for order confirmation intent
        // HOTFIX: Lower confidence threshold from 0.7 to 0.5 for "yes" detection
        // Also add pattern matching for common confirmation words
        const isOrderConfirmation = (intentResult?.intent === 'ORDER_CONFIRMATION' && intentResult?.confidence > 0.5) ||
                                    /^(yes|yeah|ok|okay|sure|confirm|proceed|go ahead|add|add to cart|haan|ha|thik hai)$/i.test(userQuery.trim());

        if (isOrderConfirmation && conversation?.last_quoted_products) {
            console.log('[MAIN_HANDLER] Order confirmation intent detected - adding to cart');
        } else if (isOrderConfirmation && !conversation?.last_quoted_products) {
            // User confirmed but no quoted products - check if they want to checkout cart
            console.log('[MAIN_HANDLER] Order confirmation detected but no quoted products - checking cart for checkout');
            const { checkoutWithDiscounts } = require('../../../services/cartService');
            const result = await checkoutWithDiscounts(tenant, from);
            await sendAndSaveMessage(from, result, conversation.id, tenant.id);
            return res.status(200).json({ ok: true, type: 'checkout' });
        }

        if (isOrderConfirmation && conversation?.last_quoted_products) {
            console.log('[MAIN_HANDLER] Processing quoted products - adding to cart');
            try {
                // First, add quoted products to cart if they exist
                if (conversation && conversation.last_quoted_products) {
                    const { addProductToCartEnhanced, viewCartWithDiscounts } = require('../../../services/cartService');
                    let quotedProducts = [];

                    try {
                        quotedProducts = typeof conversation.last_quoted_products === 'string'
                            ? JSON.parse(conversation.last_quoted_products)
                            : conversation.last_quoted_products;
                    } catch (parseError) {
                        console.error('[MAIN_HANDLER] Error parsing quoted products:', parseError.message);
                    }

                    if (quotedProducts && quotedProducts.length > 0) {
                        console.log('[MAIN_HANDLER] Adding', quotedProducts.length, 'quoted products to cart with REPLACE mode');

                        for (const product of quotedProducts) {
                            try {
                                await addProductToCartEnhanced(
                                    tenant.id,
                                    from,
                                    {
                                        id: product.productId,
                                        name: product.productName,
                                        price: parseFloat(product.price),
                                        units_per_carton: product.unitsPerCarton || 1500
                                    },
                                    parseInt(product.quantity) || 1,
                                    { replace: true } // CRITICAL: Replace quantity instead of adding to prevent cart accumulation
                                );
                            } catch (addError) {
                                console.error('[MAIN_HANDLER] Error adding product to cart:', addError.message);
                            }
                        }

                        // Clear quoted products after adding
                        await dbClient
                            .from('conversations_new')
                            .update({ last_quoted_products: null })
                            .eq('id', conversation.id);

                        // SKIP cart message here to avoid double prompt
                        // Directly proceed to checkout after adding products
                        // Only show cart if user explicitly requests it
                    } else {
                        console.log('[MAIN_HANDLER] No quoted products to add');
                    }
                }

                // Directly proceed to checkout after adding quoted products
                const { checkoutWithDiscounts } = require('../../../services/cartService');
                const checkoutResult = await checkoutWithDiscounts(tenant, from);
                if (checkoutResult && typeof checkoutResult === 'string') {
                    await sendAndSaveMessage(from, checkoutResult, conversation.id, tenant.id);
                    return res.status(200).json({ ok: true, type: 'order_confirmation' });
                } else if (checkoutResult && checkoutResult.message) {
                    await sendAndSaveMessage(from, checkoutResult.message, conversation.id, tenant.id);
                    return res.status(200).json({ ok: true, type: 'order_confirmation' });
                }
            } catch (err) {
                console.error('[MAIN_HANDLER] Error in order confirmation:', err);
                console.error('[MAIN_HANDLER] Stack:', err.stack);
            }
        }

        // STEP 3: SKIPPED - Smart Response Router deprecated in favor of AI
        // Use AI for all general queries instead of hardcoded smart responses
        console.log('[MAIN_HANDLER] STEP 3: Skipping Smart Response Router (deprecated), moving directly to AI');
        
        // STEP 3.5: Check if we need clarification (low confidence or ambiguous input)
        console.log('[MAIN_HANDLER] STEP 3.5: Proactive Clarification Check');
        if (enhancedIntent && enhancedIntent.confidence < 0.6) {
            console.log('[PROACTIVE_CLARIFICATION] Low confidence detected, asking for clarification');
            
            const clarification = await ProactiveClarificationService.analyzeAndClarify({
                userInput: userQuery,
                intent: enhancedIntent,
                entities: enhancedIntent.entities,
                conversationState: conversation,
                recentMessages: conversationMemory?.recentMessages || []
            });
            
            if (clarification && clarification.needsClarification) {
                console.log('[PROACTIVE_CLARIFICATION] Sending clarifying question');
                await sendAndSaveMessage(from, clarification.question, conversation?.id, tenant.id);
                
                // Save clarification context for next message
                if (conversation?.id) {
                    await dbClient.from('conversations_new')
                        .update({
                            metadata: {
                                ...conversation.metadata,
                                pending_clarification: {
                                    originalInput: userQuery,
                                    suggestedResponses: clarification.suggestedResponses,
                                    timestamp: new Date().toISOString()
                                }
                            }
                        })
                        .eq('id', conversation.id);
                }
                
                return res.status(200).json({ ok: true, type: 'clarification_requested' });
            }
        }

        // STEP 4: Fallback to AI response WITH WEBSITE CONTEXT
        console.log('[MAIN_HANDLER] STEP 4: AI Fallback with website context');
        const { getAIResponseV2 } = require('../../../services/aiService');

        // Build AI prompt with conversation history (use existing conversationContext from intent processing)
        const aiPrompt = conversationContext ? 
            `Previous messages:\n${conversationContext}\n\nCustomer just said: ${userQuery}` :
            userQuery;

        console.log('[MAIN_HANDLER] Calling getAIResponseV2 for tenant:', tenant.id);
        const aiResponse = await getAIResponseV2(tenant.id, aiPrompt, {
            phoneNumber: from,
            tenantId: tenant.id,
            conversationId: conversation?.id,
            rawQuery: userQuery,          // exact last user message for website search
            userQuery: userQuery,         // pass through for embedding prompt
            originalUserQuery: userQuery  // backward compatibility
        });

        console.log('[MAIN_HANDLER] AI Response generated:', aiResponse ? 'SUCCESS' : 'FAILED');
        await sendAndSaveMessage(from, aiResponse, conversation?.id, tenant.id);
        return res.status(200).json({ ok: true, type: 'ai_response_v2' });

    } catch (error) {
        console.error('[MAIN_HANDLER] CRITICAL ERROR in modular handler:', error.message);
        console.error('[MAIN_HANDLER] Stack trace:', error.stack);
        
        // HUMAN-LIKE ERROR RECOVERY
        console.log('[ERROR_RECOVERY] Attempting intelligent error recovery');
        try {
            const errorType = error.message?.includes('GST') ? 'gst_verification' :
                            error.message?.includes('product') ? 'product_search' :
                            error.message?.includes('checkout') ? 'checkout' :
                            error.message?.includes('cart') ? 'cart_update' :
                            error.message?.includes('API') || error.code === 'ECONNREFUSED' ? 'api_failure' :
                            'generic';
            
            const recovery = await ErrorRecoveryService.handleError({
                errorType,
                tenantId: tenant.id,
                conversationId: conversation?.id,
                phoneNumber: from,
                conversationState: conversation,
                errorDetails: {
                    message: error.message,
                    stack: error.stack
                },
                userInput: userQuery
            });
            
            if (recovery && recovery.success) {
                console.log('[ERROR_RECOVERY] Sending recovery message to user');
                await sendAndSaveMessage(from, recovery.message, conversation?.id, tenant.id);
                return res.status(200).json({ 
                    ok: true, 
                    type: 'error_recovered',
                    recovery: recovery.suggestedActions
                });
            }
        } catch (recoveryError) {
            console.error('[ERROR_RECOVERY] Recovery failed:', recoveryError);
        }
        
        // Final fallback - use varied response
        const errorResponse = ResponseVariationService.getResponse('error_acknowledgment', {
            conversationId: conversation?.id,
            retryCount: 0
        });
        
        try {
            await sendAndSaveMessage(from, errorResponse, conversation?.id, tenant.id);
        } catch (sendError) {
            console.error('[MAIN_HANDLER] Failed to send error message:', sendError);
        }
        
        // Re-throw to let customerHandler catch it
        throw error;
    }
}


module.exports = { handleCustomerMessage };
