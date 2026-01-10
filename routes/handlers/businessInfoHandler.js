// routes/handlers/businessInfoHandler.js
const BusinessInfoCaptureService = require('../../services/businessInfoCaptureService');
const { dbClient } = require('../../services/config');
const { toWhatsAppFormat } = require('../../utils/phoneUtils');

/**
 * Check if a GST number already exists in the database
 */
async function checkExistingGST(tenantId, gstNumber, phoneNumber) {
    try {
        const { data: existingProfile, error } = await dbClient
            .from('customer_profiles')
            .select('gst_number, company, phone')
            .eq('tenant_id', tenantId)
            .eq('phone', phoneNumber)
            .single();

        if (error && error.code !== 'PGRST116') {
            console.error('[checkExistingGST] Error:', error);
            return { exists: false };
        }

        if (existingProfile && existingProfile.gst_number) {
            const isSameGST = existingProfile.gst_number === gstNumber;
            return {
                exists: true,
                isSameGST: isSameGST,
                existingData: existingProfile,
                message: isSameGST 
                    ? 'Same GST number already on file' 
                    : 'Different GST number already registered'
            };
        }

        return { exists: false };
    } catch (error) {
        console.error('[checkExistingGST] Exception:', error);
        return { exists: false };
    }
}

/**
 * Detect if an incoming message likely contains business info (GST certificate, invoice, etc.)
 */
function detectBusinessInfo(messagePayload = {}) {
    try {
        // messagePayload might be the whole request body or the message object itself
        const msg = messagePayload.message || messagePayload || {};
        const doc = msg.document || msg.media || msg.attachment || null;
    const caption = (msg.caption || msg.fileName || msg.filename || (msg.text && msg.text.body) || msg.body || '').toString();
        const filename = (doc && (doc.filename || doc.fileName || doc.title)) ? (doc.filename || doc.fileName || doc.title) : '';
        const combined = `${filename} ${caption}`.toLowerCase();

        // Keywords commonly indicating GST cert / registration / tax doc
        const gstKeywords = [
            'gst', 'gstin', 'registration certificate', 'registration number',
            'form gst', 'reg-06', 'tax invoice', 'registration no', 'gst certificate'
        ];

        const filenameHasGST = gstKeywords.some(k => filename.toLowerCase().includes(k));
        const textHasGST = gstKeywords.some(k => combined.includes(k));
        const hasDocumentUrl = !!(doc && (doc.url || doc.link || doc.fileUrl || doc.mediaUrl));

        // Heuristic: if it's a PDF or has GST keywords -> treat as business info
        const isPdf = filename.toLowerCase().endsWith('.pdf') || (doc && (doc.mimeType === 'application/pdf' || (doc.type && doc.type === 'document')));

        // Detect GST pattern in plain text as well (15-char GSTIN)
        const gstPattern = /\b[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}\b/i;
        const hasGSTNumber = gstPattern.test(caption);
        // Heuristic: either a relevant document (PDF/url) mentioning GST OR plaintext with GST keywords/number
        const isBusinessInfo = ((hasDocumentUrl || isPdf) && (filenameHasGST || textHasGST || isPdf)) || (hasGSTNumber || textHasGST);

        return {
            isBusinessInfo: !!isBusinessInfo,
            detection: {
                filename: filename || null,
                caption: caption || null,
                filenameHasGST,
                textHasGST,
                hasDocumentUrl
            }
        };
    } catch (error) {
        console.error('[BusinessInfo] detectBusinessInfo error:', error);
        return { isBusinessInfo: false, detection: {} };
    }
}

/**
 * Main handler for business information processing
 * Processes GST certificates, business documents, and returns formatted responses
 */
async function handleBusinessInfo(tenantId, phoneNumber, message) {
    try {
        console.log(`[BusinessInfo] Processing ${message.message_type} for phone: ${phoneNumber}`);
        console.log('[BusinessInfo] Incoming message object:', JSON.stringify(message).slice(0,1000));
        // ðŸ”§ CRITICAL FIX: Keep phone in WhatsApp format to match database
        const formattedPhone = toWhatsAppFormat(phoneNumber);
        console.log('[BusinessInfo] Formatted phone number:', formattedPhone);
        // Call the business info capture service depending on message type
        let result = null;
        if (message.message_type === 'text') {
            console.log('[BusinessInfo] Text body:', (message.message_body || '').slice(0, 200));
            // If text contains a GST number directly, use the dedicated path
            const gstPattern = /\b[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}\b/i;
            const gstMatch = (message.message_body || '').match(gstPattern);
            console.log('[BusinessInfo] GST match:', !!gstMatch);
            if (gstMatch) {
                result = await BusinessInfoCaptureService.processGSTNumberOnly(tenantId, phoneNumber, gstMatch[0]);
                console.log('[BusinessInfo] processGSTNumberOnly result:', result);
            }
        } else if (message.message_type === 'document' || message.document || message.media) {
            // Handle document/PDF uploads
            console.log('[BusinessInfo] Document detected, processing...');
            const pdfUrl = message.media_url || message.document_url || message.fileUrl;
            const filename = message.media_filename || message.filename || message.document?.filename || 'document.pdf';
            result = await BusinessInfoCaptureService.processBusinessInfo(
                tenantId,
                phoneNumber,
                'document',  // messageType
                { pdfUrl, filename },  // content
                phoneNumber  // conversationId
            );
            console.log('[BusinessInfo] processBusinessInfo result:', result);
        }

        if (!result || !result.success) {
            console.log('[BusinessInfo] No valid result, returning error');
            return {
                success: false,
                response: "I couldn't process that. Please send a valid GST certificate PDF or GST number."
            };
        }

        if (result.success) {
            const extractedData = result.extracted_fields || result.extractedInfo || {};
            console.log(`[BusinessInfo] Extracted:`, extractedData);
            
            // Check for existing GST information
            let isDuplicate = false;
            let duplicateMessage = '';
            
            if (extractedData.gst_number) {
                const existingCheck = await checkExistingGST(tenantId, extractedData.gst_number, formattedPhone);
                
                if (existingCheck.exists) {
                    isDuplicate = true;
                    console.log(`[BusinessInfo] Duplicate GST detected:`, existingCheck.message);
                    
                    if (existingCheck.isSameGST) {
                        duplicateMessage = `\n\nðŸ“ Note: This GST number is already registered in your profile.`;
                    } else {
                        duplicateMessage = `\n\nâš ï¸ Note: You have a different GST number on file (${existingCheck.existingData.gst_number}). This new GST has been added as an alternate registration.`;
                    }
                }
            }
            
            // Generate proper customer response
            let responseText = '';
            
            if (extractedData.gst_number) {
                // GST certificate processed successfully
                const businessName = extractedData.legal_name || 
                                   extractedData.trade_name || 
                                   extractedData.company_name || 
                                   'your business';
                
                if (isDuplicate) {
                    // Different response for duplicates
                    responseText = `âœ… GST Certificate Received!\n\n` +
                                 `ðŸ“‹ Business Details:\n` +
                                 `â€¢ Legal Name: ${extractedData.legal_name}\n` +
                                 (extractedData.trade_name && extractedData.trade_name !== extractedData.legal_name ? 
                                    `â€¢ Trade Name: ${extractedData.trade_name}\n` : '') +
                                 `â€¢ GST Number: ${extractedData.gst_number}\n` +
                                 (extractedData.business_state ? `â€¢ State: ${extractedData.business_state}\n` : '') +
                                 duplicateMessage;
                } else {
                    // New GST registration
                    responseText = `âœ… GST Certificate Verified!\n\n` +
                                 `ðŸ“‹ Business Details:\n` +
                                 `â€¢ Legal Name: ${extractedData.legal_name}\n` +
                                 (extractedData.trade_name && extractedData.trade_name !== extractedData.legal_name ? 
                                    `â€¢ Trade Name: ${extractedData.trade_name}\n` : '') +
                                 `â€¢ GST Number: ${extractedData.gst_number}\n` +
                                 (extractedData.business_state ? `â€¢ State: ${extractedData.business_state}\n` : '') +
                                 (extractedData.business_address ? `â€¢ Address: ${extractedData.business_address}\n` : '') +
                                 `\nâœ¨ Your business information has been saved successfully!\n` +
                                 `You're now eligible for business rates and GST billing.`;
                }
            } else if (extractedData.company_name) {
                // General business info
                responseText = `Thank you! I've recorded your business information:\n\n` +
                             `â€¢ Company: ${extractedData.company_name}\n\n` +
                             `Our team will verify this information and update your profile.`;
            } else {
                // Fallback
                responseText = `Thank you for sharing your business information. ` +
                             `Our team will review it and update your profile shortly.`;
            }
            
            // CRITICAL: Reset conversation state after successful GST extraction
            // If GST is present, check for awaiting_gst_info state and proceed with pending checkout if needed
            if (extractedData.gst_number) {
                try {
                    // Look up the conversation state
                    const { data: conversation } = await dbClient
                        .from('conversations')
                        .select('id, state, context_data')
                        .eq('tenant_id', tenantId)
                        .eq('end_user_phone', phoneNumber)
                        .single();

                    if (conversation && conversation.state === 'awaiting_gst_info') {
                        // Parse context data to see if there's a pending checkout
                        let contextData = {};
                        try {
                            contextData = conversation.context_data ? JSON.parse(conversation.context_data) : {};
                        } catch (e) {
                            contextData = {};
                        }

                        if (contextData.pendingCheckout) {
                            // Move to discount approved so checkoutWithDiscounts will run
                            await dbClient
                                .from('conversations')
                                .update({
                                    state: 'discount_approved',
                                    context_data: JSON.stringify({ approvedDiscount: contextData.approvedDiscount || 0 })
                                })
                                .eq('id', conversation.id);

                            // Notify customer and proceed with checkout
                            const { sendMessage } = require('../../services/whatsappService');
                            await sendMessage(phoneNumber, (result.response || '') + "\n\nâœ… Processing your order now...");

                            const { checkoutWithDiscounts } = require('../../services/cartService');
                            try {
                                const checkoutResult = await checkoutWithDiscounts({ id: tenantId }, phoneNumber);
                                await sendMessage(phoneNumber, checkoutResult);
                            } catch (checkoutError) {
                                console.error('[BusinessInfo] Checkout error after GST:', checkoutError.message);
                            }
                        } else {
                            // No pending checkout - clear the state
                            await dbClient
                                .from('conversations')
                                .update({ state: null, context_data: null })
                                .eq('id', conversation.id);
                        }
                    } else {
                        // Reset state as a safe default
                        if (conversation && conversation.id) {
                            await dbClient
                                .from('conversations')
                                .update({ state: null, context_data: null })
                                .eq('id', conversation.id);
                        }
                    }
                } catch (stateError) {
                    console.error('[BusinessInfo] Failed to reset conversation state:', stateError.message);
                    // Non-blocking - don't fail the whole process
                }
            }
            
            return {
                success: true,
                response: responseText,
                business_info: extractedData,
                dbRecord: result.dbRecord,
                confidence: result.confidence_score || result.confidence || 1,
                tenantId: tenantId,
                customerId: result.customerId || result.customer_id,
                isDuplicate: isDuplicate
            };
        } else {
            console.error(`[BusinessInfo] Processing failed:`, result.error);
            return {
                success: false,
                response: "I had trouble processing your business information. Could you please try again or contact our support team?"
            };
        }
    } catch (error) {
        console.error('[BusinessInfo] Handler error:', error);
        return {
            success: false,
            response: "Sorry, I couldn't process your business information right now. Please try again later."
        };
    }
}

module.exports = {
    handleBusinessInfo,
    detectBusinessInfo
};
