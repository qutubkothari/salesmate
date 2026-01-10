// routes/handlers/messageProcessors/processors/AudioProcessor.js
const BaseProcessor = require('./BaseProcessor');
const FormData = require('form-data');
const fetch = require('node-fetch');

class AudioProcessor extends BaseProcessor {
    constructor() {
        super('Audio');
    }

    async canHandle(context) {
        return context.message.type === 'audio';
    }

    async handle(context) {
        const { message, tenant, from } = context;

        try {
            const audioUrl = message.audio?.url;
            if (!audioUrl) {
                await this.sendAndLog(from, 
                    "Sorry, I couldn't access your voice message. Please try again.", 
                    tenant.id, 'audio_url_missing'
                );
                return { handled: true, type: 'audio_url_missing' };
            }

            const transcription = await this.transcribeAudio(audioUrl);
            if (transcription) {
                const { trackResponse } = require('../../../services/responseAnalytics');
                const { logMessage } = require('../../../services/historyService');
                
                await trackResponse(tenant.id, 'audio_transcription', 'ai', 0.006);
                await logMessage(tenant.id, from, 'user', transcription, 'audio_transcribed');
                
                // Create new context with transcribed text
                const newContext = {
                    ...context,
                    userQuery: transcription,
                    message: {
                        ...context.message,
                        text: { body: transcription },
                        type: 'text'
                    }
                };

                // Signal that transcription is complete, let other processors handle
                return { 
                    handled: false, // Let other processors handle the transcribed text
                    transcribed: true, 
                    newContext 
                };
            } else {
                await this.sendAndLog(from, 
                    "Sorry, I couldn't transcribe your voice message. Please try sending a text message.", 
                    tenant.id, 'transcription_failed'
                );
                return { handled: true, type: 'transcription_failed' };
            }
        } catch (error) {
            console.error('[AUDIO_PROCESSOR] Error:', error);
            await this.sendAndLog(from, 
                "Sorry, there was an error processing your voice message. Please try again with text.", 
                tenant.id, 'audio_processing_error'
            );
            return { handled: true, type: 'audio_processing_error' };
        }
    }

    async transcribeAudio(audioUrl) {
        try {
            const audioResponse = await fetch(audioUrl);
            if (!audioResponse.ok) {
                throw new Error(`Failed to download audio: ${audioResponse.statusText}`);
            }

            const audioBuffer = await audioResponse.buffer();
            
            const formData = new FormData();
            formData.append('file', audioBuffer, {
                filename: 'audio.ogg',
                contentType: 'audio/ogg'
            });
            formData.append('model', 'whisper-1');
            formData.append('language', 'en');

            const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                    ...formData.getHeaders()
                },
                body: formData
            });

            if (!response.ok) {
                throw new Error(`OpenAI API error: ${response.statusText}`);
            }

            const result = await response.json();
            return result.text || '';

        } catch (error) {
            console.error('[AUDIO_TRANSCRIPTION] Error:', error);
            return null;
        }
    }
}

module.exports = AudioProcessor;

// =======================================================

// routes/handlers/messageProcessors/processors/ConversationProcessor.js
const BaseProcessor = require('./BaseProcessor');
const gstVerificationService = require('../../../services/gstVerificationService');

class ConversationProcessor extends BaseProcessor {
    constructor() {
        super('Conversation');
    }

    async canHandle(context) {
        const { userQuery } = context;
        
        // Handle conversation state-based processing
        return (
            userQuery && /gst/i.test(userQuery) ||
            this.isFormResponse(context) ||
            this.isContextualQuery(context)
        );
    }

    async handle(context) {
        const { userQuery, from, tenant, conversation } = context;
        
        // GST Lookup Flow
        if (userQuery && /gst/i.test(userQuery)) {
            return await this.handleGSTLookup(tenant.id, from);
        }

        // Form Responses
        if (this.isFormResponse(context)) {
            return await this.handleFormResponse(context);
        }

        // Contextual Queries
        if (this.isContextualQuery(context)) {
            return await this.handleContextualQuery(context);
        }

        return { handled: false };
    }

    async handleGSTLookup(tenantId, from) {
        try {
            const { dbClient } = require('../../../services/config');
            
            // Build phone variants for lookup
            const phoneVariants = [
                from,
                from.replace(/^91/, ''),
                '+' + from,
                from.replace(/@.*/, '')
            ].filter(Boolean).map(p => p.toString());

            const orClauses = phoneVariants.map(p => `phone.ilike.%${p}%`).join(',');
            
            // Check customer_profiles first
            const { data: rows, error } = await dbClient
                .from('customer_profiles')
                .select('*')
                .eq('tenant_id', tenantId)
                .or(orClauses)
                .limit(1);

            if (error) {
                console.warn('[GST_LOOKUP] Database error:', error.message);
            }

            const customer = Array.isArray(rows) && rows.length ? rows[0] : null;
            
            if (customer?.gst_number) {
                // Verify GST
                let verification = null;
                try {
                    verification = await gstVerificationService.comprehensiveGSTVerification(customer.gst_number);
                } catch (err) {
                    console.error('[GST_LOOKUP] Verification error:', err.message);
                }

                // Update verification status
                if (customer && verification) {
                    await dbClient.from('customer_profiles').update({
                        gst_verified: verification.isValid ? true : false,
                        gst_verified_at: verification.isValid ? new Date().toISOString() : null,
                        updated_at: new Date().toISOString()
                    }).eq('id', customer.id);
                }

                let responseMsg;
                if (verification && verification.isValid) {
                    responseMsg = `*GST Verified* âœ…\nGSTIN: ${customer.gst_number}\nName: ${verification.businessDetails?.legalName || verification.businessDetails?.tradeName || customer.company || 'Not available'}\nState: ${verification.businessDetails?.state || 'N/A'}`;
                } else {
                    responseMsg = `*Your GST Details:*\nðŸ“‹ *GST Number:* ${customer.gst_number}\nðŸ¢ *Company:* ${customer.company || 'Not provided'}\nðŸ‘¤ *Name:* ${customer.first_name || ''} ${customer.last_name || ''}\n\nâš ï¸ *Note:* Details from our records`;
                }

                await this.sendAndLog(from, responseMsg, tenantId, 'gst_lookup_response');
                return { handled: true, type: 'gst_lookup_verified' };
            } else {
                const fallbackMsg = "I couldn't find a GST number for you. Please reply with your 15-character GSTIN or upload a GST certificate PDF.";
                await this.sendAndLog(from, fallbackMsg, tenantId, 'gst_lookup_ask_for_pdf');
                return { handled: true, type: 'gst_lookup_ask_for_pdf' };
            }
        } catch (error) {
            console.error('[GST_LOOKUP] Error:', error);
            return { handled: true, type: 'gst_lookup_error' };
        }
    }

    isFormResponse(context) {
        const { conversation } = context;
        return conversation && conversation.state && (
            conversation.state.startsWith('awaiting_contact') ||
            conversation.state.startsWith('awaiting_feedback') ||
            conversation.state.startsWith('awaiting_appointment')
        );
    }

    async handleFormResponse(context) {
        const { tenant, conversation, userQuery } = context;
        const {
            handleContactForm, handleFeedbackForm, handleAppointmentBooking
        } = require('../../../services/contactFormService');

        if (conversation.state.startsWith('awaiting_contact')) {
            await handleContactForm(tenant, conversation, userQuery);
            return { handled: true, type: 'contact_form' };
        }
        if (conversation.state.startsWith('awaiting_feedback')) {
            await handleFeedbackForm(tenant, conversation, userQuery);
            return { handled: true, type: 'feedback_form' };
        }
        if (conversation.state.startsWith('awaiting_appointment')) {
            await handleAppointmentBooking(tenant, conversation, userQuery);
            return { handled: true, type: 'appointment_booking' };
        }

        return { handled: false };
    }

    isContextualQuery(context) {
        const { userQuery, conversation } = context;
        
        // Check for contextual price queries or quantity calculations
        return conversation && (
            /price|cost|rate/i.test(userQuery) ||
            /quantity|pieces|pcs|carton|box/i.test(userQuery)
        );
    }

    async handleContextualQuery(context) {
        const { userQuery, conversation, tenant, from } = context;
        const { 
            handleContextualPriceQuery, 
            handleQuantityQueries,
            saveConversationContext 
        } = require('../../../services/conversationContextService');

        // Handle contextual price queries
        const priceResult = await handleContextualPriceQuery(userQuery, conversation, tenant.id);
        if (priceResult.handled) {
            await this.sendAndLog(from, priceResult.response, tenant.id, 'contextual_price');
            
            await saveConversationContext(tenant.id, from, {
                lastProduct: priceResult.product.name,
                context: priceResult.context,
                lastAction: 'price_inquiry'
            });
            
            return { handled: true, type: 'contextual_price' };
        }
        
        // Handle quantity calculations
        const quantityResult = await handleQuantityQueries(userQuery, conversation, tenant.id);
        if (quantityResult.handled) {
            await this.sendAndLog(from, quantityResult.response, tenant.id, 'quantity_calculation');
            
            await saveConversationContext(tenant.id, from, {
                lastProduct: quantityResult.calculation.product.name,
                context: quantityResult.context,
                lastCalculation: quantityResult.calculation
            });
            
            return { handled: true, type: 'quantity_calculation' };
        }

        return { handled: false };
    }
}

module.exports = ConversationProcessor;

// =======================================================

// routes/handlers/messageProcessors/processors/CommandProcessor.js
const BaseProcessor = require('./BaseProcessor');

class CommandProcessor extends BaseProcessor {
    constructor() {
        super('Command');
    }

    async canHandle(context) {
        const { userQuery } = context;
        return userQuery && (
            userQuery.startsWith('/') ||
            /clear\s*cart|empty\s*cart|reset\s*cart/i.test(userQuery) ||
            userQuery.toLowerCase().trim() === 'stop'
        );
    }

    async handle(context) {
        const { userQuery, from, tenant } = context;
        const {
            addProductToCart, viewCartWithDiscounts, clearCart, 
            checkoutWithDiscounts, getOrderStatus
        } = require('../../../services/cartService');
        const {
            applyDiscount, removeDiscount
        } = require('../../../services/discountService');
        const {
            addCartonProductToCart, viewCartonCart
        } = require('../../../services/cartonPricingService');
        const {
            searchProductsAndVariants, formatProductDisplay, findProductOrVariant
        } = require('../../../services/enhancedProductService');
        const {
            startContactForm, startFeedbackForm, startAppointmentBooking
        } = require('../../../services/contactFormService');

        // Cart Operations
        if (userQuery.toLowerCase().startsWith('/add_to_cart ')) {
            const productName = userQuery.substring('/add_to_cart '.length).trim();
            const result = await addProductToCart(tenant.id, from, productName);
            await this.sendAndLog(from, result, tenant.id, 'cart_update');
            return { handled: true, type: 'cart_add' };
        }

        if (userQuery.toLowerCase().trim() === '/view_cart') {
            const result = await viewCartWithDiscounts(tenant.id, from);
            await this.sendAndLog(from, result, tenant.id, 'cart_view');
            return { handled: true, type: 'cart_view' };
        }

        if (userQuery.toLowerCase().trim() === '/clearcart' || 
            /clear\s*cart|empty\s*cart|reset\s*cart/i.test(userQuery)) {
            const result = await clearCart(tenant.id, from);
            await this.sendAndLog(from, result, tenant.id, 'cart_clear');
            return { handled: true, type: 'cart_clear' };
        }

        if (userQuery.toLowerCase().trim() === '/checkout') {
            const result = await checkoutWithDiscounts(tenant, from);
            await this.sendAndLog(from, result, tenant.id, 'checkout');
            
            if (tenant.payment_qr_code_url) {
                const qrMessage = "QR code available for payment. Please contact us for the QR code image.";
                await this.sendAndLog(from, qrMessage, tenant.id, 'qr_code_available');
            }
            
            return { handled: true, type: 'checkout' };
        }

        if (userQuery.toLowerCase().trim() === '/order_status') {
            const result = await getOrderStatus(tenant.id, from);
            await this.sendAndLog(from, result, tenant.id, 'order_status_check');
            return { handled: true, type: 'order_status' };
        }

        // Discount Commands
        if (userQuery.toLowerCase().startsWith('/apply_discount ') || 
            userQuery.toLowerCase().startsWith('/use_coupon ')) {
            const discountCode = userQuery.split(' ')[1];
            if (!discountCode) {
                await this.sendAndLog(from, 'Please provide a discount code.\nUsage: /apply_discount CODE', tenant.id, 'discount_help');
                return { handled: true, type: 'discount_help' };
            }
            
            const result = await applyDiscount(tenant.id, from, discountCode);
            await this.sendAndLog(from, result.message, tenant.id, 'discount_applied');
            return { handled: true, type: 'discount_applied' };
        }

        if (userQuery.toLowerCase().trim() === '/remove_discount') {
            const result = await removeDiscount(tenant.id, from);
            await this.sendAndLog(from, result.message, tenant.id, 'discount_removed');
            return { handled: true, type: 'discount_removed' };
        }

        // Carton Commands
        if (userQuery.toLowerCase().startsWith('/add_carton ')) {
            const parts = userQuery.substring('/add_carton '.length).trim().split(' ');
            const quantity = parseInt(parts[0]) || 1;
            const productName = parts.slice(1).join(' ');
            
            if (!productName) {
                await this.sendAndLog(from, 'Usage: /add_carton <quantity> <product_name>', tenant.id, 'cart_help');
                return { handled: true, type: 'cart_help' };
            }
            
            const result = await addCartonProductToCart(tenant.id, from, productName, quantity);
            await this.sendAndLog(from, result, tenant.id, 'carton_cart_update');
            return { handled: true, type: 'carton_cart_add' };
        }

        if (userQuery.toLowerCase().trim() === '/view_carton_cart') {
            const result = await viewCartonCart(tenant.id, from);
            await this.sendAndLog(from, result, tenant.id, 'carton_cart_view');
            return { handled: true, type: 'carton_cart_view' };
        }

        // Product Search Commands
        if (userQuery.toLowerCase().startsWith('/search_products ')) {
            const searchTerm = userQuery.substring('/search_products '.length).trim();
            if (!searchTerm) {
                await this.sendAndLog(from, 'Usage: /search_products <search_term>', tenant.id, 'search_help');
                return { handled: true, type: 'search_help' };
            }

            try {
                const results = await searchProductsAndVariants(tenant.id, searchTerm, 10);
                
                if (results.length === 0) {
                    await this.sendAndLog(from, `No products found for "${searchTerm}".`, tenant.id, 'search_no_results');
                    return { handled: true, type: 'search_no_results' };
                }

                let message = `ðŸ” **Search Results for "${searchTerm}":**\n\n`;
                results.forEach((product, index) => {
                    message += `${index + 1}. ${formatProductDisplay(product)}\n---\n`;
                });

                await this.sendAndLog(from, message, tenant.id, 'search_results');
                return { handled: true, type: 'search_results' };
            } catch (error) {
                console.error('Product search error:', error);
                await this.sendAndLog(from, 'An error occurred while searching products.', tenant.id, 'search_error');
                return { handled: true, type: 'search_error' };
            }
        }

        // Product Details Command
        if (userQuery.toLowerCase().startsWith('/product_details ')) {
            const productName = userQuery.substring('/product_details '.length).trim();
            if (!productName) {
                await this.sendAndLog(from, 'Usage: /product_details <product_name>', tenant.id, 'details_help');
                return { handled: true, type: 'details_help' };
            }

            try {
                const product = await findProductOrVariant(tenant.id, productName);
                
                if (!product) {
                    await this.sendAndLog(from, `Product "${productName}" not found.`, tenant.id, 'details_not_found');
                    return { handled: true, type: 'details_not_found' };
                }

                const display = formatProductDisplay(product);
                await this.sendAndLog(from, display, tenant.id, 'product_details');
                return { handled: true, type: 'product_details' };
            } catch (error) {
                console.error('Product details error:', error);
                await this.sendAndLog(from, 'An error occurred while fetching product details.', tenant.id, 'details_error');
                return { handled: true, type: 'details_error' };
            }
        }

        // Form Starter Commands
        if (userQuery.toLowerCase().trim() === '/contact') {
            await startContactForm(tenant.id, from);
            return { handled: true, type: 'contact_form_start' };
        }

        if (userQuery.toLowerCase().trim() === '/feedback') {
            await startFeedbackForm(tenant.id, from);
            return { handled: true, type: 'feedback_form_start' };
        }

        if (userQuery.toLowerCase().trim() === '/book_appointment') {
            await startAppointmentBooking(tenant.id, from);
            return { handled: true, type: 'appointment_booking_start' };
        }

        return { handled: false };
    }
}

module.exports = CommandProcessor;

// =======================================================

// routes/handlers/messageProcessors/processors/AIProcessor.js
const BaseProcessor = require('./BaseProcessor');

class AIProcessor extends BaseProcessor {
    constructor() {
        super('AI');
    }

    async canHandle(context) {
        // AI processor handles everything as fallback
        return true;
    }

    async handle(context) {
        const { userQuery, from, tenant, conversation } = context;
        const { getSmartResponse } = require('../../../services/smartResponseRouter');
        const { findQuickReplyResponse } = require('../../../services/quickReplyService');
        const { findFaqResponse } = require('../../../services/faqService');
        const { findKeywordResponse } = require('../../../services/keywordService');
        const { getProductRecommendations } = require('../../../services/recommendationService');
        const { isHandoverRequest, flagAndNotifyForHandover } = require('../../../services/handoverService');
        const { detectHandoverTriggers, notifySalesTeam, sendHandoverResponse } = require('../../../services/humanHandoverService');
        const { getAIResponse, getAIResponseV2 } = require('../../../services/aiService');
        const { trackResponse } = require('../../../services/responseAnalytics');
        const { trackCustomerMessage, trackBotMessage } = require('../../../services/realtimeTestingService');
        const { detectLanguage } = require('../../../services/multiLanguageService');

        try {
            await trackCustomerMessage(tenant.id, from, userQuery);

            // Priority 1: Smart Response Router
            const smartResponse = await getSmartResponse(userQuery, tenant.id);
            if (smartResponse) {
                await trackResponse(tenant.id, userQuery, 'database', 0.0002);
                await this.sendAndLog(from, smartResponse.response, tenant.id, smartResponse.source);
                return { handled: true, type: smartResponse.source };
            }

            // Priority 2: Quick Replies
            const quickReplyResponse = await findQuickReplyResponse(tenant.id, userQuery);
            if (quickReplyResponse) {
                await trackResponse(tenant.id, userQuery, 'database', 0.0001);
                await this.sendAndLog(from, quickReplyResponse, tenant.id, 'quick_reply_response');
                return { handled: true, type: 'quick_reply' };
            }

            // Priority 3: FAQ
            const faqResponse = await findFaqResponse(tenant.id, userQuery);
            if (faqResponse) {
                await trackResponse(tenant.id, userQuery, 'database', 0.0001);
                await this.sendAndLog(from, faqResponse, tenant.id, 'faq_response');
                return { handled: true, type: 'faq_response' };
            }

            // Priority 4: Keywords
            const keywordResponse = await findKeywordResponse(tenant.id, userQuery);
            if (keywordResponse) {
                const replyText = typeof keywordResponse === 'string' 
                    ? keywordResponse 
                    : (keywordResponse.reply || keywordResponse.text);
                if (replyText) {
                    await trackResponse(tenant.id, userQuery, 'database', 0.0001);
                    await this.sendAndLog(from, replyText, tenant.id, 'keyword_response');
                    return { handled: true, type: 'keyword_response' };
                }
            }

            // Priority 5: Product Recommendations
            const recommendation = await getProductRecommendations(tenant.id, userQuery);
            if (recommendation && !recommendation.startsWith("I'm sorry")) {
                await trackResponse(tenant.id, userQuery, 'ai', 0.015);
                await this.sendAndLog(from, recommendation, tenant.id, 'recommendation_response');
                return { handled: true, type: 'product_recommendation' };
            }

            // Priority 6: Human Handover Check
            const isHandover = await isHandoverRequest(userQuery);
            if (isHandover) {
                await flagAndNotifyForHandover(tenant, from);
                const handoverReply = "I've notified a team member. They will get back to you as soon as possible.";
                await this.sendAndLog(from, handoverReply, tenant.id, 'handover_notice');
                return { handled: true, type: 'handover_request' };
            }

            // Priority 7: Advanced Handover Detection
            const hasHandoverTriggers = detectHandoverTriggers(userQuery);
            if (hasHandoverTriggers) {
                const handoverContext = {
                    lastProduct: conversation?.last_product_discussed,
                    cartItems: null,
                    orderValue: null
                };

                // Flag for attention + triage (best-effort)
                try {
                    const { getConversationId } = require('../../../services/historyService');
                    const { upsertTriageForConversation } = require('../../../services/triageService');
                    const conversationId = conversation?.id || await getConversationId(tenant.id, from);

                    if (conversationId) {
                        try {
                            const { dbClient } = require('../../../services/config');
                            await dbClient
                                .from('conversations')
                                .update({ requires_human_attention: true, updated_at: new Date().toISOString() })
                                .eq('id', conversationId);

                            await upsertTriageForConversation(dbClient, {
                                tenantId: tenant.id,
                                conversationId,
                                endUserPhone: from,
                                type: 'HUMAN_ATTENTION',
                                messagePreview: 'Auto-triage: customer requested human',
                                metadata: { source: 'AudioProcessor', trigger: 'detectHandoverTriggers' }
                            });
                        } catch (_) {
                            // best-effort
                        }
                    }
                } catch (_) {
                    // best-effort
                }
                
                const handoverSuccess = await notifySalesTeam(tenant, from, userQuery, handoverContext);
                
                if (handoverSuccess) {
                    const userLanguage = await detectLanguage(userQuery);
                    const handoverMsg = await sendHandoverResponse(from, tenant.id, userLanguage);
                    await this.sendAndLog(from, handoverMsg, tenant.id, 'human_handover');
                    return { handled: true, type: 'human_handover' };
                }
            }

            // Final: AI Response
            const userLanguage = await detectLanguage(userQuery);
            const aiPrompt = await this.createDynamicAIPrompt(userQuery, userLanguage, tenant.id, conversation, from);

            let aiResponse;
            try {
                aiResponse = await getAIResponseV2(tenant.id, aiPrompt, {
                    mode: 'fast',
                    temperature: 0.7,
                    originalUserQuery: userQuery,
                    conversationId: conversation?.id || null
                });
            } catch (error) {
                console.error('[AI] V2 failed, using fallback:', error.message);
                aiResponse = await getAIResponse(tenant.id, aiPrompt);
            }

            await trackResponse(tenant.id, userQuery, 'ai', 0.03);
            await this.sendAndLog(from, aiResponse, tenant.id, 'ai_response');
            await trackBotMessage(tenant.id, from, aiResponse);

            // Background processing
            this.backgroundProcessing(tenant.id, from, userQuery);

            return { handled: true, type: 'ai_response' };

        } catch (error) {
            console.error('[AI_PROCESSOR] Error:', error);
            await this.sendAndLog(from, 
                "I'm sorry, I'm having trouble processing your message right now. Please try again in a moment.",
                tenant.id, 'ai_error'
            );
            return { handled: true, type: 'ai_error' };
        }
    }

    async createDynamicAIPrompt(userQuery, userLanguage, tenantId, conversation, from) {
        try {
            const { dbClient } = require('../../../services/config');
            const customerPersonalizationService = require('../../../services/customerPersonalizationService');

            const { data: tenant } = await dbClient
                .from('tenants')
                .select('business_name, bot_personality, bot_language, industry_type')
                .eq('id', tenantId)
                .single();

            const { data: products } = await dbClient
                .from('products')
                .select('name, description, price, packaging_unit, units_per_carton, technical_details')
                .eq('tenant_id', tenantId)
                .limit(20);

            const productContext = products?.length > 0 ? 
                `Available Products:\n${products.map(p => 
                    `- ${p.name}: ${p.description} (â‚¹${p.price}${p.packaging_unit === 'carton' ? '/carton' : ''})${p.units_per_carton ? ` [${p.units_per_carton} pcs/carton]` : ''}`
                ).join('\n')}` : 
                'No products configured yet.';

            const languageInstructions = {
                'hi': 'Respond in Hindi (à¤¹à¤¿à¤‚à¤¦à¥€ à¤®à¥‡à¤‚ à¤œà¤µà¤¾à¤¬ à¤¦à¥‡à¤‚)',
                'hinglish': 'Respond in Hinglish (Hindi-English mix). Use words like: hai, hain, kya, aapke paas, chahiye, kar do, thik hai.',
                'en': 'Respond in English'
            };

            const selectedLanguage = userLanguage || tenant?.bot_language?.toLowerCase() || 'en';
            const greeting = await customerPersonalizationService.getPersonalizedGreeting(tenantId, from);

            return `${greeting?.greeting || ''}

You are a helpful sales assistant for ${tenant?.business_name || 'this business'}${tenant?.industry_type ? ` in the ${tenant.industry_type} industry` : ''}.

${productContext}

INSTRUCTIONS:
1. PRODUCT DETAILS: Answer questions about products using the available information above
2. PRICING: Always provide exact prices from the product list when available
3. ORDER PROCESSING: Help customers place orders for any quantities
4. CONFIRMATION: Recognize order confirmations and help complete purchases

${tenant?.bot_personality ? `PERSONALITY: ${tenant.bot_personality}` : ''}

Customer message: ${userQuery}

${languageInstructions[selectedLanguage] || languageInstructions['en']}. Help customers complete their purchases efficiently.`;

        } catch (error) {
            console.error('Error creating AI prompt:', error);
            return `You are a helpful sales assistant. Customer message: ${userQuery}`;
        }
    }

    backgroundProcessing(tenantId, from, userQuery) {
        // Fire and forget background processing
        Promise.all([
            require('../../../services/leadScoringService').scoreLead(tenantId, from),
            require('../../../services/processFollowUpResponse').processFollowUpResponse(tenantId, from, userQuery)
        ]).catch(err => console.error("Background processing error:", err));
    }
}

module.exports = AIProcessor;
