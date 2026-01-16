const gstVerificationService = require('./gstVerificationService');
// services/businessInfoCaptureService.js
const { dbClient } = require('./config');
const { aiService } = require('./aiService');
const { ocrService } = require('./ocrService');
const { imageUploadService } = require('./imageUploadService');
const { fetchGSTINInfo } = require('./gstScraperService');
const ErrorRecoveryService = require('./core/ErrorRecoveryService');

class BusinessInfoCaptureService {

    // QUICK FIX: Simple PDF handler using filename detection only
    static async processDocumentMessage(content) {
        console.log('[BusinessInfo] Processing document (QUICK FIX VERSION)');
        // Skip OCR/Vision attempts for now - they don't work with PDFs
        console.log('[BusinessInfo] PDF received:', content.filename);
        // Check if it's a GST certificate based on filename
        const filename = (content.filename || '').toLowerCase();
        const isGSTCert = filename.includes('gst') || 
                          filename.includes('certificate') || 
                          filename.includes('registration');
        if (isGSTCert) {
            console.log('[BusinessInfo] Detected GST certificate, flagging for manual processing');
            return {
                source_type: 'gst_certificate_pdf',
                raw_input: 'GST Certificate uploaded',
                extracted_fields: {
                    company_name: 'GST Certificate Received - Manual Review Required',
                    document_type: 'gst_certificate',
                    document_source: 'pdf_upload',
                    document_url: content.documentUrl,
                    filename: content.filename,
                    manual_review_required: true,
                    extraction_status: 'pending_manual_review'
                },
                confidence_score: 0.8
            };
        } else {
            return {
                source_type: 'business_document_pdf',
                raw_input: 'Business document uploaded',
                extracted_fields: {
                    company_name: 'Business Document Received',
                    document_source: 'pdf_upload',
                    document_url: content.documentUrl,
                    filename: content.filename,
                    manual_review_required: true
                },
                confidence_score: 0.6
            };
        }
    }
    
    /**
     * Main entry point for processing business information from WhatsApp
     */
    async processBusinessInfo(tenantId, conversationId, messageType, content, customerId = null) {
            console.log('[BusinessInfoCapture] processBusinessInfo called with messageType:', messageType, 'contentType:', typeof content);
        try {
            let extractionResult;
            
            switch (messageType) {
                case 'text':
                    extractionResult = await this.processTextBusinessInfo(content);
                    break;
                case 'image':
                    extractionResult = await this.processImageBusinessInfo(content);
                    break;
                case 'document':
                    extractionResult = await this.processDocumentBusinessInfo(content);
                    break;
                default:
                    throw new Error(`Unsupported message type: ${messageType}`);
            }

            // Get or create customer
            if (!customerId) {
                const { data: conversation } = await dbClient
                    .from('conversations_new')
                    .select('end_user_phone')
                    .eq('id', conversationId)
                    .single();
                
                if (!conversation) {
                    // Extract phone from conversationId if it's in WhatsApp format
                    const phone = conversationId.includes('@') ? 
                        conversationId.split('@')[0] : conversationId;
                    customerId = await this.getOrCreateCustomer(tenantId, phone);
                } else {
                    customerId = await this.getOrCreateCustomer(tenantId, conversation.end_user_phone);
                }
            }

            // If GST number found, verify it online
            if (extractionResult.extracted_fields?.gst_number) {
                console.log('[BusinessInfo] GST number found, verifying online...');
                                const gstVerification = await gstVerificationService.comprehensiveGSTVerification(extractionResult.extracted_fields.gst_number);
                                if (gstVerification.isValid) {
                                    extractionResult.extracted_fields = {
                                        ...extractionResult.extracted_fields,
                                        ...gstVerification.businessDetails,
                                        gst_verified: true,
                                        verification_source: 'comprehensive_verifier'
                                    };
                                    extractionResult.confidence_score = Math.max(extractionResult.confidence_score, 0.9);
                                    console.log('[BusinessInfo] GST verification successful via comprehensive verifier');
                                } else {
                                    console.warn('[BusinessInfo] GST verification failed (comprehensive):', gstVerification.errors || gstVerification.verificationMethods);
                                    extractionResult.extracted_fields.gst_verified = false;
                                    extractionResult.extracted_fields.verification_error = gstVerification.errors || gstVerification.verificationMethods;
                                    
                                    // Use intelligent error recovery instead of generic message
                                    if (messageType !== 'document') {
                                        const phone = conversationId?.includes('@') ? conversationId.split('@')[0] : conversationId;
                                        try {
                                            const whatsapp = require('./whatsappService');
                                            
                                            // Use ErrorRecoveryService for contextual recovery message
                                            const recovery = await ErrorRecoveryService.handleError({
                                                errorType: 'gst_verification',
                                                tenantId,
                                                conversationId,
                                                phoneNumber: phone,
                                                conversationState: { state: 'AWAITING_GST' },
                                                errorDetails: {
                                                    gstNumber: extractionResult.extracted_fields.gst_number,
                                                    verificationError: gstVerification.errors || gstVerification.verificationMethods
                                                },
                                                userInput: extractionResult.extracted_fields.gst_number
                                            });
                                            
                                            if (recovery && recovery.success) {
                                                await whatsapp.sendMessage(phone, recovery.message);
                                            } else {
                                                // Fallback message
                                                const fallbackMsg = `We couldn't verify the GST number you shared (${extractionResult.extracted_fields.gst_number || 'received'}). Please reply with a GST certificate PDF or re-type the 15-character GSTIN (example: 27AAAAA0000A1Z5).`;
                                                await whatsapp.sendMessage(phone, fallbackMsg);
                                            }
                                        } catch (e) {
                                            console.warn('[BUSINESSINFO] Failed to send recovery message to user:', e?.message || e);
                                        }
                                    } else {
                                        console.log('[BusinessInfo] PDF document uploaded - skipping online verification error message');
                                    }
                                }
            }

            // Save extraction results
            await this.saveExtractionResults(tenantId, customerId, extractionResult);

            // Update customer profile if high confidence
            if (extractionResult.confidence_score >= 0.8) {
                await this.updateCustomerProfile(customerId, extractionResult.extracted_fields);
            }

            return {
                success: true,
                customerId,
                extractedInfo: extractionResult.extracted_fields,
                confidence: extractionResult.confidence_score,
                needsVerification: extractionResult.confidence_score < 0.8,
                gstVerified: extractionResult.extracted_fields?.gst_verified || false
            };

        } catch (error) {
            console.error('Business info capture error:', error);
            return {
                success: false,
                error: error.message,
                needsManualReview: true
            };
        }
    }

    /**
     * Process text-based business information with GST verification
     */
    async processTextBusinessInfo(messageText) {
        const prompt = `
        Extract business information from this customer message. Look for:
        - Company/business name
        - GST number (15 characters: 2 state + 10 PAN + 1 entity + 1 check + 1 check)
        - Business registration numbers
        - Business type (individual, partnership, company, proprietorship)
        - Business address
        - Contact person names and roles
        
        Message: "${messageText}"
        
        Respond with JSON only:
        {
            "company_name": "extracted name or null",
            "gst_number": "15-digit GST or null",
            "business_registration_number": "extracted number or null", 
            "business_type": "type or null",
            "business_address": "address or null",
            "contact_person": "name or null",
            "contact_role": "role or null",
            "confidence_score": 0.0-1.0,
            "raw_text": "original message"
        }`;

        try {
            const aiResponse = await aiService.getAIResponse(prompt, 'system');
            const extracted = JSON.parse(aiResponse);
            
            // Validate GST number format if provided
            if (extracted.gst_number) {
                const gstPattern = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
                if (!gstPattern.test(extracted.gst_number)) {
                    extracted.gst_number = null;
                    extracted.confidence_score *= 0.7; // Reduce confidence
                }
            }

            return {
                source_type: 'text_message',
                raw_input: messageText,
                extracted_fields: extracted,
                confidence_score: extracted.confidence_score || 0.5
            };

        } catch (error) {
            console.error('Text extraction error:', error);
            return {
                source_type: 'text_message',
                raw_input: messageText,
                extracted_fields: { raw_text: messageText },
                confidence_score: 0.1,
                needs_verification: true
            };
        }
    }

    /**
     * Verify GST number using government portal scraping
     */
    async verifyGSTOnline(gstNumber) {
        try {
            console.log(`[GST Verification] Scraping GST: ${gstNumber}`);
            const scrapingResult = await fetchGSTINInfo(gstNumber);
            if (scrapingResult.ok && scrapingResult.legalName) {
                return {
                    success: true,
                    businessDetails: {
                        company_name: scrapingResult.tradeName || scrapingResult.legalName,
                        legal_name: scrapingResult.legalName,
                        trade_name: scrapingResult.tradeName,
                        gst_number: gstNumber,
                        business_address: scrapingResult.address,
                        business_state: scrapingResult.stateJurisdiction,
                        business_status: scrapingResult.status,
                        is_active: scrapingResult.status === 'Active',
                        center_jurisdiction: scrapingResult.centerJurisdiction,
                        verification_source: 'government_portal_scraping',
                        last_updated: new Date().toISOString()
                    },
                    verificationSource: 'government_portal'
                };
            } else {
                return {
                    success: false,
                    error: scrapingResult.error || 'GST not found in government records',
                    gstNumber: gstNumber
                };
            }
        } catch (error) {
            console.error('GST scraping verification error:', error);
            return {
                success: false,
                error: 'GST verification service temporarily unavailable',
                gstNumber: gstNumber
            };
        }
    }

    /**
     * Process GST number only (when customer provides just GST number)
     */
    async processGSTNumberOnly(tenantId, conversationId, gstNumber, customerId = null) {
        console.log('[BusinessInfoCapture] processGSTNumberOnly called for GST:', gstNumber);
        try {
            console.log(`[GST Only] Processing GST number: ${gstNumber}`);
            
            // Clean and validate GST format
            const cleanGST = gstNumber.replace(/\s+/g, '').toUpperCase();
            const gstPattern = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
            
            if (!gstPattern.test(cleanGST)) {
                return {
                    success: false,
                    error: 'Invalid GST number format. Please provide a valid 15-digit GST number.'
                };
            }

            // Verify GST online - MUST verify to ensure valid GST numbers
            let gstVerification = null;
            let gstVerified = false;
            try {
                gstVerification = await this.verifyGSTOnline(cleanGST);
                gstVerified = !!(gstVerification && gstVerification.success);
                
                // If verification failed, reject the GST number
                if (!gstVerified) {
                    console.warn('[BusinessInfo] GST verification failed:', gstVerification?.error);
                    return {
                        success: false,
                        error: `❌ Invalid GST Number\n\nThe GST number ${cleanGST} could not be verified in government records.\n\nPlease check and provide a valid GST number, or reply "No GST" if you don't have GST registration.`
                    };
                }
            } catch (vErr) {
                console.warn('[BusinessInfo] GST verification check failed:', vErr?.message || vErr);
                return {
                    success: false,
                    error: `❌ GST Verification Failed\n\nUnable to verify GST number ${cleanGST}. Please ensure:\n• The GST number is correct (15 characters)\n• Your GST registration is active\n\nOr reply "No GST" to proceed without GST billing.`
                };
            }

            // Get or create customer
            if (!customerId) {
                // Skip database lookup for now and extract phone directly
                const phone = conversationId.includes('@') ? 
                    conversationId.split('@')[0] : conversationId;
                customerId = await this.getOrCreateCustomer(tenantId, phone);
            }

            // Save extraction results - GST is now verified
            const extractedFields = {
                gst_number: cleanGST,
                gst_verified: true,
                verification_source: 'government_portal_scraping'
            };

            if (gstVerification.businessDetails) {
                // Merge verified business details into extracted fields
                Object.assign(extractedFields, gstVerification.businessDetails);
            }

            const extractionResult = {
                source_type: 'gst_number_only',
                raw_input: gstNumber,
                extracted_fields: extractedFields,
                confidence_score: 1.0  // Always 1.0 since we only reach here if verified
            };

            await this.saveExtractionResults(tenantId, customerId, extractionResult);
            // Update profile with verified GST information
            await this.updateCustomerProfile(customerId, extractionResult.extracted_fields, conversationId);

            return {
                success: true,
                customerId,
                extractedInfo: extractionResult.extracted_fields,
                confidence: extractionResult.confidence_score,
                needsVerification: false,  // No longer needs verification
                gstVerified: true,  // Always true here
                businessName: gstVerification.businessDetails ? (gstVerification.businessDetails.legalName || gstVerification.businessDetails.tradeName) : null
            };

        } catch (error) {
            console.error('GST number only processing error:', error);
            return {
                success: false,
                error: 'Failed to process GST number. Please try again.'
            };
        }
    }

    /**
     * Process image-based business information (business cards, GST certificates)
     */
    async processImageBusinessInfo(imageData) {
        try {
            // Upload image to GCS
            const uploadResult = await imageUploadService.uploadImage(imageData, 'business_docs');
            
            // Perform OCR
            const ocrText = await ocrService.extractTextFromImage(uploadResult.url);
            
            // Classify document type
            const docType = await this.classifyBusinessDocument(ocrText);
            
            // Extract structured data based on document type
            let extractionPrompt;
            
            if (docType === 'gst_certificate') {
                extractionPrompt = `
                Extract information from this GST certificate OCR text:
                "${ocrText}"
                
                Extract JSON:
                {
                    "company_name": "legal business name",
                    "gst_number": "15-digit GST number",
                    "business_address": "principal place of business",
                    "business_type": "nature of business",
                    "registration_date": "date if available",
                    "confidence_score": 0.0-1.0
                }`;
            } else if (docType === 'business_card') {
                extractionPrompt = `
                Extract information from this business card OCR text:
                "${ocrText}"
                
                Extract JSON:
                {
                    "company_name": "company name",
                    "contact_person": "person name",
                    "contact_role": "designation/title",
                    "phone": "phone number",
                    "email": "email address",
                    "business_address": "address if available",
                    "website": "website if available",
                    "confidence_score": 0.0-1.0
                }`;
            } else {
                extractionPrompt = `
                Extract any business information from this document OCR text:
                "${ocrText}"
                
                Extract JSON with any available fields and confidence_score 0.0-1.0`;
            }

            const aiResponse = await aiService.getAIResponse(extractionPrompt, 'system');
            const extracted = JSON.parse(aiResponse);

            return {
                source_type: docType,
                raw_input: ocrText,
                extracted_fields: extracted,
                confidence_score: extracted.confidence_score || 0.7,
                file_url: uploadResult.url
            };

        } catch (error) {
            console.error('Image extraction error:', error);
            return {
                source_type: 'image_unknown',
                raw_input: 'Image processing failed',
                extracted_fields: {},
                confidence_score: 0.1,
                needs_verification: true
            };
        }
    }

    /**
     * Process document files (PDF certificates, etc.) - FIXED VERSION
     */
        async processDocumentBusinessInfo(documentData = {}) {
                        console.log('[BusinessInfo] processDocumentBusinessInfo (robust GST flow) called');
                        const stack = (new Error().stack || '').split('\n');
                        console.log('[BusinessInfo] processDocumentBusinessInfo called by:', stack[2] || stack.join(' | '));
                        const tenantId = documentData.tenantId || documentData.tenant || null;
                        // Right where you extract phone
                        const phoneNumber = documentData.sender || documentData.from || null;
                        console.log('[DEBUG_PHONE] ==========================================');
                        console.log('[DEBUG_PHONE] Phone from documentData.sender:', documentData.sender);
                        console.log('[DEBUG_PHONE] Phone from documentData.from:', documentData.from);
                        console.log('[DEBUG_PHONE] Final phoneNumber:', phoneNumber);
                        console.log('[DEBUG_PHONE] tenantId:', tenantId);
                        // Before getOrCreateCustomer
                        console.log('[DEBUG_PHONE] Calling getOrCreateCustomer with phone:', phoneNumber);
                        let customerId = null;
                        try {
                            customerId = await this.getOrCreateCustomer(tenantId, phoneNumber || 'unknown');
                            console.log('[DEBUG_PHONE] getOrCreateCustomer returned customerId:', customerId);
                        } catch (err) {
                            console.warn('[DEBUG_PHONE] getOrCreateCustomer failed:', err && err.message);
                            customerId = null;
                        }
            try {
                const pdfUrl = documentData.media_url || documentData.documentUrl || documentData.pdfUrl;
                const filename = documentData.media_filename || documentData.filename || 'document.pdf';
                if (!pdfUrl) {
                    return { success: false, error: 'no_pdf_url', business_info: null, dbRecord: null };
                }

                const PDFTextExtractionService = require('./pdfTextExtractionService');
                const gstFlowResult = await PDFTextExtractionService.extractGSTFromPDF(pdfUrl, filename);

                if (!gstFlowResult || gstFlowResult.success !== true) {
                    // return consistent object (no crash downstream)
                    return {
                        success: false,
                        reason: 'not_gst_or_parsing_failed',
                        detection: gstFlowResult && gstFlowResult.detection,
                        extractionResult: gstFlowResult && gstFlowResult.extractionResult,
                        business_info: null,
                        dbRecord: null
                    };
                }

                const gstDetails = gstFlowResult.gstDetails || {};
                
                // Clean up trade_name - if it contains field labels or is same as legal name, set to null
                let tradeName = gstDetails.trade_name;
                console.log('[TRADE_NAME_CLEAN] Raw trade_name:', tradeName);
                
                if (tradeName && tradeName.trim()) {
                    // Remove common field label patterns that get confused with actual trade names
                    const invalidPatterns = [
                        /constitution.*of.*business/i,  // Matches any variation with "constitution" and "business"
                        /^\d+\.\s*constitution/i,       // Matches numbered field labels like "3.Constitution"
                        /field\s*\d+/i,
                        /trade\s+name:/i
                    ];
                    
                    for (const pattern of invalidPatterns) {
                        if (pattern.test(tradeName)) {
                            console.log('[TRADE_NAME_CLEAN] Matched invalid pattern, setting to null:', pattern.toString());
                            tradeName = null;
                            break;
                        }
                    }
                    
                    // If trade name is same as legal name (case insensitive), set to null
                    if (tradeName && gstDetails.legal_name) {
                        const normalizedTrade = tradeName.toLowerCase().trim();
                        const normalizedLegal = gstDetails.legal_name.toLowerCase().trim();
                        if (normalizedTrade === normalizedLegal) {
                            console.log('[TRADE_NAME_CLEAN] Trade name same as legal name, setting to null');
                            tradeName = null;
                        }
                    }
                }
                
                // If trade_name is empty or cleaned to null, use legal_name as fallback
                if (!tradeName || !tradeName.trim()) {
                    tradeName = gstDetails.legal_name || null;
                    console.log('[TRADE_NAME_CLEAN] Using legal_name as fallback:', tradeName);
                }
                
                console.log('[TRADE_NAME_CLEAN] Final trade_name:', tradeName);
                
                const extractedFields = {
                    gst_number: gstDetails.gst_number || null,
                    legal_name: gstDetails.legal_name || null,
                    trade_name: tradeName,
                    company_name: tradeName || null,  // Always prioritize trade_name (now fallback to legal_name)
                    business_address: gstDetails.business_address || null,
                    registration_date: gstDetails.registration_date || null,
                    proprietor_name: gstDetails.proprietor_name || null,
                    business_state: gstDetails.business_state || null,
                    document_url: pdfUrl,
                    filename
                };

                // Ensure we have a customer id (safe fallback to null)
                let customerPhone = documentData.sender || documentData.from || null;
                const tenantId = documentData.tenantId || documentData.tenant || null;
                let customerId = null;
                try {
                    customerId = await this.getOrCreateCustomer(tenantId, customerPhone || 'unknown');
                } catch (err) {
                    console.warn('[BusinessInfo] getOrCreateCustomer failed, continuing with null customerId:', err && err.message);
                    customerId = null;
                }

                // Save extraction results - wrap in try/catch and ensure we return a stable dbRecord
                let savedRecord = null;
                try {
                    const extractionResult = {
                        source_type: 'gst_certificate_pdf',
                        raw_input: gstFlowResult.extractionResult?.final_text || '',
                        extracted_fields: extractedFields,
                        confidence_score: gstDetails.confidence_score || gstFlowResult.detection?.confidence || 0.5,
                        file_url: pdfUrl
                    };
                    savedRecord = await this.saveExtractionResults(tenantId, customerId, extractionResult);
                    if (savedRecord) {
                      console.log('[BUSINESS_SAVE] saveExtractionResults returned:', JSON.stringify(savedRecord, null, 2));
                      console.log('[BUSINESS_SAVE] savedRecord.id ->', savedRecord.id || (savedRecord.data && savedRecord.data.id) || null);
                    } else {
                      console.log('[BUSINESS_SAVE] saveExtractionResults returned null/undefined');
                    }
                } catch (err) {
                    console.error('[BusinessInfo] saveExtractionResults failed:', err && err.message);
                    savedRecord = null;
                }

                // If confident, update customer profile (guarded)
                try {
                    const confidence = gstDetails.confidence_score || 0;
                    console.log('[PROFILE_UPDATE] Confidence score:', confidence);
                    console.log('[PROFILE_UPDATE] Has customerId:', !!customerId);
                    console.log('[PROFILE_UPDATE] Has GST number:', !!extractedFields.gst_number);
                    
                    // CRITICAL: Update profile if we have a valid GST number, regardless of confidence
                    if (customerId && extractedFields.gst_number && typeof this.updateCustomerProfile === 'function') {
                        console.log('[DEBUG_PHONE] Calling updateCustomerProfile with:');
                        console.log('[DEBUG_PHONE]   customerId:', customerId);
                        console.log('[DEBUG_PHONE]   phoneNumber:', phoneNumber);
                        console.log('[DEBUG_PHONE]   extractedFields:', extractedFields);
                        
                        let customerPhone = documentData.sender || documentData.from || null;
                        console.log('🔍 [PHONE_DEBUG] Extracted customerPhone:', customerPhone);
                        
                        await this.updateCustomerProfile(customerId, extractedFields, customerPhone);
                        console.log('[PROFILE_UPDATE] ✅ Customer profile updated successfully');
                    } else {
                        console.warn('[PROFILE_UPDATE] ❌ Skipping profile update:', {
                            hasCustomerId: !!customerId,
                            hasGST: !!extractedFields.gst_number,
                            hasUpdateFunction: typeof this.updateCustomerProfile === 'function'
                        });
                    }
                } catch (err) {
                    console.error('[BusinessInfo] updateCustomerProfile failed:', err && err.message);
                }

                // Sync to Zoho Books
                if (extractedFields.gst_number) {
                    try {
                        const zoho = require('./zohoIntegrationService');
                        const zohoResult = await zoho.syncCustomer(tenantId, {
                            display_name: extractedFields.legal_name || extractedFields.company_name,
                            company_name: extractedFields.company_name,
                            gst_no: extractedFields.gst_number,
                            phone: phoneNumber.replace(/\D/g, ''),
                            first_name: extractedFields.first_name || 'Contact',
                            last_name: extractedFields.last_name || 'Person',
                            place_of_supply: extractedFields.business_state || 'MH',
                            billing_address: {
                                address: extractedFields.business_address,
                                state: extractedFields.business_state
                            },
                            notes: `Synced from WhatsApp - ${new Date().toISOString()}`
                        });
                        
                        if (zohoResult.success) {
                            console.log('[Zoho] Customer synced successfully:', zohoResult.customerId);
                            
                            // Save Zoho customer ID to database
                            await dbClient
                                .from('customer_profiles_new')
                                .update({ zoho_customer_id: zohoResult.customerId })
                                .eq('id', customerId);
                            
                            console.log('[Zoho] Zoho customer ID saved to database');
                        } else {
                            console.error('[Zoho] Customer sync failed:', zohoResult.error);
                        }
                    } catch (error) {
                        console.error('[Zoho] Customer sync error:', error.message);
                        // Don't fail the whole process if Zoho sync fails
                    }
                }

                // Return consistent structured result (no undefined)
                return {
                    success: true,
                    extracted_fields: extractedFields, // ✅ Add this
                    confidence_score: gstDetails.confidence_score || gstFlowResult.detection?.confidence || 0,
                    customer_id: customerId,
                    dbRecord: savedRecord,
                    needs_verification: savedRecord?.needs_verification
                };
            } catch (err) {
                console.error('[BusinessInfo] document processing failed:', err && err.message);
                return { success: false, error: err && err.message, business_info: null, dbRecord: null };
            }
        }

    // Add this method inside the BusinessInfoCaptureService class
    async extractPDFTextWithVision(pdfUrl) {
        try {
            console.log('[PDF_VISION] Processing PDF with OpenAI Vision:', pdfUrl);
            const { openai } = require('./config');
            const response = await openai.chat.completions.create({
                model: "gpt-4o",
                messages: [{
                    role: "user",
                    content: [
                        {
                            type: "text", 
                            text: "Extract all visible text from this GST certificate PDF. Focus on: Legal Name, Trade Name, GST Number, Address, Constitution of Business, Registration Date."
                        },
                        {
                            type: "image_url",
                            image_url: { url: pdfUrl }
                        }
                    ]
                }],
                max_tokens: 1500
            });
            return response.choices[0].message.content;
        } catch (error) {
            console.error('[PDF_VISION] Failed:', error.message);
            return null;
        }
    }

    /**
     * Extract data specifically from GST certificate PDF text
     */
    async extractGSTCertificateFromPDF(pdfText) {
        const prompt = `
        Extract business information from this GST Registration Certificate text:
        "${pdfText}"
        
        This is a Form GST REG-06 Registration Certificate. Extract these exact fields:
        - Registration Number/GSTIN (15-digit, field 8)
        - Legal Name (field 1) - The official business name
        - Trade Name (field 2) - May be empty/blank if not provided. DO NOT use "Constitution of Business" as trade name.
        - Constitution of Business (field 3) - Business type like "Private Limited Company", "Proprietorship" etc
        - Address of Principal Place of Business (field 4)
        - Date of Validity From (field 6)
        - Any proprietor/director details
        
        IMPORTANT: 
        - If Trade Name field is empty or same as Legal Name, set "trade_name" to null
        - DO NOT confuse "Constitution of Business" label with trade name
        - Constitution of Business is a separate field indicating business type
        
        Respond with JSON only:
        {
            "gst_number": "15-digit GSTIN",
            "legal_name": "exact legal business name",
            "trade_name": "actual trade name or null if not provided/blank",
            "business_type": "constitution type (Private Limited/Proprietorship/etc)",
            "business_address": "complete principal business address",
            "registration_date": "validity from date",
            "proprietor_name": "proprietor name if proprietorship",
            "state": "state from address",
            "confidence_score": 0.0-1.0
        }`;

        try {
            const aiResponse = await aiService.getAIResponse({
                system: "You are extracting data from an official GST Registration Certificate. Be precise and extract exact text as shown in the certificate. Do not confuse field labels with field values.",
                user: prompt
            });
            
            const extracted = JSON.parse(aiResponse);
            
            console.log('[GST_EXTRACTION] Raw extracted trade_name:', extracted.trade_name);
            
            // Clean up trade_name - if it contains field labels or is same as legal name, set to null
            let cleanedTradeName = extracted.trade_name;
            if (cleanedTradeName) {
                console.log('[GST_EXTRACTION] Cleaning trade_name:', cleanedTradeName);
                // Remove common field label patterns
                const invalidPatterns = [
                    /constitution.*of.*business/i,  // Matches any variation with "constitution" and "business"
                    /^\d+\.\s*constitution/i,       // Matches numbered field labels like "3.Constitution"
                    /field\s*\d+/i,
                    /trade\s+name:/i
                ];
                
                for (const pattern of invalidPatterns) {
                    if (pattern.test(cleanedTradeName)) {
                        console.log('[GST_EXTRACTION] Matched invalid pattern:', pattern.toString());
                        cleanedTradeName = null;
                        break;
                    }
                }
                
                // If trade name is same as legal name (case insensitive), set to null
                if (cleanedTradeName && extracted.legal_name) {
                    const normalizedTrade = cleanedTradeName.toLowerCase().trim();
                    const normalizedLegal = extracted.legal_name.toLowerCase().trim();
                    if (normalizedTrade === normalizedLegal) {
                        console.log('[GST_EXTRACTION] Trade name same as legal name, setting to null');
                        cleanedTradeName = null;
                    }
                }
            }
            
            console.log('[GST_EXTRACTION] Final cleaned trade_name:', cleanedTradeName);
            
            // Clean up business_address - remove field label prefixes
            let cleanedAddress = extracted.business_address;
            if (cleanedAddress) {
                console.log('[GST_EXTRACTION] Cleaning business_address:', cleanedAddress);
                // Remove common address field label patterns
                cleanedAddress = cleanedAddress.replace(/^of\s+Principal\s+Place\s+of,?\s*Business,?\s*/i, '');
                cleanedAddress = cleanedAddress.replace(/^Principal\s+Place\s+of\s+Business,?\s*/i, '');
                cleanedAddress = cleanedAddress.replace(/^Address\s+of\s+Principal\s+Place\s+of\s+Business,?\s*/i, '');
                cleanedAddress = cleanedAddress.trim();
                console.log('[GST_EXTRACTION] Cleaned business_address:', cleanedAddress);
            }
            
            return {
                company_name: cleanedTradeName || extracted.legal_name,
                legal_name: extracted.legal_name,
                trade_name: cleanedTradeName,
                gst_number: extracted.gst_number,
                business_address: cleanedAddress,
                business_state: extracted.state,
                business_type: extracted.business_type,
                proprietor_name: extracted.proprietor_name,
                registration_date: extracted.registration_date,
                gst_verified: true,
                verification_source: 'gst_certificate_pdf',
                confidence_score: extracted.confidence_score || 0.9,
                document_type: 'GST_REG_06'
            };

        } catch (error) {
            console.error('GST PDF AI extraction error:', error);
            return {
                raw_text: pdfText,
                confidence_score: 0.4,
                extraction_error: 'AI parsing failed'
            };
        }
    }

    /**
     * Classify the type of business document
     */
    async classifyBusinessDocument(ocrText) {
        const lowerText = ocrText.toLowerCase();
        
        if (lowerText.includes('gstin') || lowerText.includes('goods and services tax') || 
            lowerText.includes('certificate of registration')) {
            return 'gst_certificate';
        }
        
        if (lowerText.includes('designation') || lowerText.includes('mobile') || 
            lowerText.includes('@') || lowerText.includes('www.')) {
            return 'business_card';
        }
        
        if (lowerText.includes('incorporation') || lowerText.includes('registration') ||
            lowerText.includes('certificate')) {
            return 'registration_document';
        }
        
        return 'business_document';
    }

    /**
     * Save extraction results to database
     */
    async saveExtractionResults(tenantId, customerId, extractionResult) {
        // Save to business_info_extractions table
        const { data: extraction, error: extractionError } = await dbClient
            .from('business_info_extractions')
            .insert({
                customer_id: customerId || null, // explicit null
                tenant_id: tenantId,
                source_type: extractionResult.source_type,
                raw_input: extractionResult.raw_input,
                extracted_fields: extractionResult.extracted_fields,
                confidence_score: extractionResult.confidence_score,
                needs_verification: extractionResult.confidence_score < 0.8
            })
            .select()
            .single();

        // Save document if file was uploaded
        if (extractionResult.file_url) {
            await dbClient
                .from('customer_business_documents')
                .insert({
                    customer_id: customerId || null, // explicit null
                    tenant_id: tenantId,
                    document_type: extractionResult.source_type,
                    file_url: extractionResult.file_url,
                    extracted_data: extractionResult.extracted_fields,
                    verification_status: extractionResult.confidence_score >= 0.8 ? 'verified' : 'pending'
                });
        }

        return extraction;
    }

    /**
     * Update customer profile with extracted information
     */
    async updateCustomerProfile(customerId, extractedFields, phoneNumber = null) {
        console.log('🔍 [PHONE_DEBUG_3] updateCustomerProfile received:');
        console.log('🔍 [PHONE_DEBUG_3] customerId:', customerId);
        console.log('🔍 [PHONE_DEBUG_3] phoneNumber param:', phoneNumber);
        console.log('🔍 [PHONE_DEBUG_3] typeof phoneNumber:', typeof phoneNumber);
        const updateData = {};
        // ADD THIS DEBUG BEFORE THE IF:
        console.log('🔍 [PHONE_DEBUG_3] Checking phoneNumber...');
        console.log('🔍 [PHONE_DEBUG_3] phoneNumber truthy?:', !!phoneNumber);
        console.log('🔍 [PHONE_DEBUG_3] phoneNumber === null?:', phoneNumber === null);
        console.log('🔍 [PHONE_DEBUG_3] phoneNumber === undefined?:', phoneNumber === undefined);
        if (phoneNumber) {
            const normalizedPhone = phoneNumber.replace('@c.us', '').replace(/\D/g, '');
            console.log('🔍 [PHONE_DEBUG_3] Normalized to:', normalizedPhone);
            if (normalizedPhone) {
                updateData.phone = normalizedPhone;
                console.log('🔍 [PHONE_DEBUG_3] ✅ Set updateData.phone =', normalizedPhone);
            }
        } else {
            console.log('🔍 [PHONE_DEBUG_3] ❌ phoneNumber is falsy!');
        }
        // Company/Business information
        if (extractedFields.company_name) {
            updateData.company = extractedFields.company_name;
            console.log('[PROFILE_UPDATE] Added company:', extractedFields.company_name);
        }
        if (extractedFields.gst_number) {
            // Only persist GST to profile if it was explicitly verified
            if (extractedFields.gst_verified) {
                updateData.gst_number = extractedFields.gst_number;
                updateData.business_verified = true;
                updateData.onboarding_completed = true; // Mark onboarding complete when GST is verified
                console.log('[PROFILE_UPDATE] Added gst_number (verified):', extractedFields.gst_number);
            } else {
                console.log('[PROFILE_UPDATE] Skipping GST update because gst_verified is false or missing for:', extractedFields.gst_number);
            }
        }
        if (extractedFields.business_registration_number) {
            updateData.business_registration_number = extractedFields.business_registration_number;
        }
        if (extractedFields.business_type) {
            updateData.business_type = extractedFields.business_type;
        }
        if (extractedFields.business_address) {
            updateData.business_address = extractedFields.business_address;
        }
        if (extractedFields.proprietor_name) {
            const propName = extractedFields.proprietor_name;
            const isCompanyName = propName === extractedFields.legal_name || 
                                 propName === extractedFields.trade_name ||
                                 propName === extractedFields.company_name;
            const hasBusinessWords = ['SOLUTIONS', 'ENTERPRISES', 'PVT', 'LTD', 'LIMITED'].some(word => 
                propName.toUpperCase().includes(word));
            const isValidPersonName = !propName.toLowerCase().includes('proprietor') &&
                                     !isCompanyName &&
                                     !hasBusinessWords &&
                                     propName.length > 3;
            if (isValidPersonName) {
                const nameParts = propName.trim().split(/\s+/);
                if (nameParts.length >= 1) {
                    updateData.first_name = nameParts[0];
                    if (nameParts.length > 1) {
                        updateData.last_name = nameParts.slice(1).join(' ');
                    }
                    console.log('[PROFILE_UPDATE] Set name:', updateData.first_name, updateData.last_name || '');
                }
            }
        }
        if (extractedFields.contact_person && !updateData.first_name) {
            const nameParts = extractedFields.contact_person.trim().split(/\s+/);
            if (nameParts.length >= 1) {
                updateData.first_name = nameParts[0];
                if (nameParts.length > 1) {
                    updateData.last_name = nameParts.slice(1).join(' ');
                }
            }
        }
        updateData.updated_at = new Date().toISOString();
        console.log('[DEBUG_PHONE_UPDATE] Final updateData:', JSON.stringify(updateData, null, 2));
        console.log('[DEBUG_PHONE_UPDATE] updateData.phone:', updateData.phone);
        
        // Check if customerId is a UUID or a phone number
        const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(customerId);
        
        // If customerId is phone-based and updateData doesn't have phone, extract and add it
        if (!isUUID && !updateData.phone) {
            const phoneForQuery = customerId.replace('@c.us', '').replace(/\D/g, '');
            console.log('[DEBUG_PHONE_UPDATE] Extracted phone from customerId:', phoneForQuery);
            // Don't add to updateData.phone - we'll use it only for querying
        }
        
        if (Object.keys(updateData).length > 1) {
            console.log('[DEBUG_PHONE_UPDATE] Executing database update...');
            
            let updateQuery;
            if (isUUID) {
                // If it's a UUID, query by ID or phone
                updateQuery = dbClient
                    .from('customer_profiles_new')
                    .update(updateData)
                    .or(`id.eq.${customerId},phone.eq.${updateData.phone || customerId}`)
                    .select();
            } else {
                // If it's a phone number (e.g., "96567709452@c.us"), query with full format as stored in DB
                console.log('[DEBUG_PHONE_UPDATE] Querying by phone (full format):', customerId);
                updateQuery = dbClient
                    .from('customer_profiles_new')
                    .update(updateData)
                    .eq('phone', customerId)  // Use customerId directly - it already has @c.us format
                    .select();
            }
            
            const { data, error } = await updateQuery;
            if (error) {
                console.error('[DEBUG_PHONE_UPDATE] ❌ Update failed:', error);
            } else {
                console.log('[DEBUG_PHONE_UPDATE] ✅ Update succeeded');
                console.log('[DEBUG_PHONE_UPDATE] Updated record:', data);
            }
        }
        console.log('[DEBUG_PHONE_UPDATE] ==========================================');
    }

        /**
         * Get or create customer profile
         * Returns a string id or null (never throws when row not found)
         */
    async getOrCreateCustomer(tenantId, phoneNumber, gstNumber = null) {
        try {
            if (!tenantId) {
                console.warn('[BusinessInfo] getOrCreateCustomer called without tenantId');
                return null;
            }

            // 🔧 CRITICAL FIX: Use toWhatsAppFormat to ensure @c.us suffix matches database
            const { toWhatsAppFormat } = require('../utils/phoneUtils');
            const formattedPhone = toWhatsAppFormat(phoneNumber);

            if (!formattedPhone) {
                console.warn('[BusinessInfo] getOrCreateCustomer called without phone');
                return null;
            }
            console.log('[BusinessInfo] Looking for customer with phone:', formattedPhone);
            // Method 1: Find by phone number
            const findByPhone = await dbClient
                .from('customer_profiles_new')
                .select('id, phone, gst_number')
                .eq('tenant_id', tenantId)
                .eq('phone', formattedPhone)
                .limit(1)
                .maybeSingle();
            if (findByPhone && findByPhone.data && findByPhone.data.id) {
                console.log('[BusinessInfo] Found existing customer by phone:', findByPhone.data.id);
                return findByPhone.data.id;
            }
            // Method 2: If GST provided and phone lookup failed, try finding by GST
            // This handles the case where old record has phone='unknown'
            if (gstNumber) {
                console.log('[BusinessInfo] Phone lookup failed, trying GST:', gstNumber);
                const findByGST = await dbClient
                    .from('customer_profiles_new')
                    .select('id, phone, gst_number')
                    .eq('tenant_id', tenantId)
                    .eq('gst_number', gstNumber)
                    .limit(1)
                    .maybeSingle();
                if (findByGST && findByGST.data && findByGST.data.id) {
                    console.log('[BusinessInfo] Found existing customer by GST:', findByGST.data.id);
                    // UPDATE the phone number on this record if it was 'unknown'
                    if (findByGST.data.phone === 'unknown' || !findByGST.data.phone) {
                        console.log('[BusinessInfo] Updating phone from "unknown" to', formattedPhone);
                        await dbClient
                            .from('customer_profiles_new')
                            .update({ phone: formattedPhone, updated_at: new Date().toISOString() })
                            .eq('id', findByGST.data.id);
                    }
                    return findByGST.data.id;
                }
            }
            // Method 3: Create new customer
            console.log('[BusinessInfo] Creating new customer with phone:', formattedPhone);
            const insertResp = await dbClient
                .from('customer_profiles_new')
                .insert({
                    tenant_id: tenantId,
                    phone: formattedPhone,
                    gst_number: gstNumber || null,
                    customer_tier: 'standard',
                    created_at: new Date().toISOString()
                })
                .select('id')
                .limit(1)
                .maybeSingle();
            if (insertResp && insertResp.error) {
                console.warn('[BusinessInfo] dbClient create customer error:', insertResp.error.message);
                return null;
            }
            if (insertResp && insertResp.data && insertResp.data.id) {
                console.log('[BusinessInfo] Created new customer:', insertResp.data.id);
                return insertResp.data.id;
            }
            return null;
        } catch (err) {
            console.error('[BusinessInfo] getOrCreateCustomer unexpected error:', err && err.message);
            return null;
        }
    }

    /**
     * Extract text from PDF documents
     */
    async extractTextFromPDF(pdfUrl) {
        // Implementation depends on your PDF processing service
        // Could use Google Document AI, Adobe PDF Services, or pdf2pic + OCR
        try {
            // Placeholder - implement based on your infrastructure
            return "PDF text extraction not implemented yet";
        } catch (error) {
            console.error('PDF extraction error:', error);
            return '';
        }
    }

    /**
     * Verify business information manually
     */
    async verifyBusinessInfo(tenantId, customerId, extractionId, verifiedData, verifiedBy) {
        // Update extraction record
        await dbClient
            .from('business_info_extractions')
            .update({
                extracted_fields: verifiedData,
                confidence_score: 1.0,
                needs_verification: false
            })
            .eq('id', extractionId);

        // Update customer profile
        await this.updateCustomerProfile(customerId, verifiedData);

        // Mark documents as verified
        await dbClient
            .from('customer_business_documents')
            .update({
                verification_status: 'verified',
                verified_at: new Date().toISOString(),
                verified_by: verifiedBy
            })
            .eq('customer_id', customerId);

        return { success: true };
    }

    /**
     * Create pending Zoho sync record for admin approval
     */
    async createPendingZohoSync(customerId, extractedFields, phoneNumber) {
        try {
            const { data, error } = await dbClient
                .from('pending_zoho_syncs')
                .insert({
                    customer_id: customerId,
                    sync_data: {
                        display_name: extractedFields.legal_name || extractedFields.company_name,
                        company_name: extractedFields.company_name,
                        gst_no: extractedFields.gst_number,
                        phone: phoneNumber.replace(/\D/g, ''),
                        first_name: extractedFields.first_name,
                        last_name: extractedFields.last_name,
                        place_of_supply: extractedFields.business_state || 'MH',
                        billing_address: {
                            address: extractedFields.business_address,
                            state: extractedFields.business_state
                        }
                    },
                    status: 'pending',
                    created_at: new Date().toISOString()
                })
                .select()
                .single();
            if (error) throw error;
            console.log('[Zoho] Pending sync created for admin approval:', data.id);
            // Notify admin via WhatsApp (optional)
            await this.notifyAdminForApproval(data);
            return { success: true, pendingId: data.id };
        } catch (error) {
            console.error('[Zoho] Failed to create pending sync:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Admin approves and syncs to Zoho
     */
    async approvePendingZohoSync(pendingId, adminId) {
        try {
            // Get pending sync
            const { data: pending } = await dbClient
                .from('pending_zoho_syncs')
                .select('*')
                .eq('id', pendingId)
                .single();
            if (!pending) {
                return { success: false, error: 'Pending sync not found' };
            }
            // Sync to Zoho
            const zoho = require('./zohoIntegrationService');
            const zohoResult = await zoho.syncCustomer(pending.sync_data);
            if (zohoResult.success) {
                // Update customer with Zoho ID
                await dbClient
                    .from('customer_profiles_new')
                    .update({ zoho_customer_id: zohoResult.customerId })
                    .eq('id', pending.customer_id);
                // Mark as approved
                await dbClient
                    .from('pending_zoho_syncs')
                    .update({
                        status: 'approved',
                        zoho_customer_id: zohoResult.customerId,
                        approved_by: adminId,
                        approved_at: new Date().toISOString()
                    })
                    .eq('id', pendingId);
                return { 
                    success: true, 
                    zohoCustomerId: zohoResult.customerId,
                    action: zohoResult.action 
                };
            } else {
                return { success: false, error: zohoResult.error };
            }
        } catch (error) {
            console.error('[Zoho] Approval failed:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Notify admin for approval (WhatsApp or other channel)
     */
    async notifyAdminForApproval(pendingSync) {
        // Send WhatsApp message to admin
        const adminPhone = process.env.ADMIN_PHONE;
        if (!adminPhone) return;
        const message = `🔔 New Zoho Sync Approval Required\n\n` +
            `Customer: ${pendingSync.sync_data.company_name}\n` +
            `GST: ${pendingSync.sync_data.gst_no}\n` +
            `Phone: ${pendingSync.sync_data.phone}\n\n` +
            `Reply "approve ${pendingSync.id}" to sync to Zoho`;
        // Use your WhatsApp service to send
        // await whatsappService.sendMessage(adminPhone, message);
    }
}

module.exports = new BusinessInfoCaptureService();

