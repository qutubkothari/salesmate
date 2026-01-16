// services/gstValidationService.js
// Validates customer GST status before checkout and handles GST collection flow

const { dbClient } = require('./config');
const { sendMessage } = require('./whatsappService');
const { normalizePhone } = require('../utils/phoneUtils');

/**
 * Check if customer has GST preference set
 * Returns: { hasPreference: boolean, preference: 'with_gst'|'no_gst'|null, gst_number: string|null }
 */
const checkGSTStatus = async (tenantId, phoneNumber) => {
    try {
        // CRITICAL FIX: Ensure phone has @c.us suffix for database lookup
        const { toWhatsAppFormat } = require('../utils/phoneUtils');
        const normalizedPhone = toWhatsAppFormat(phoneNumber);
        console.log('[GST_VALIDATION] Checking GST status for:', normalizedPhone);

        const { data: profile, error } = await dbClient
            .from('customer_profiles_new')
            .select('id, gst_preference, gst_number')
            .eq('tenant_id', tenantId)
            .eq('phone', normalizedPhone)
            .maybeSingle();

        if (error) {
            console.error('[GST_VALIDATION] Error fetching customer profile:', error.message);
            return { hasPreference: false, preference: null, gst_number: null };
        }

        if (!profile) {
            console.log('[GST_VALIDATION] No customer profile found');
            return { hasPreference: false, preference: null, gst_number: null };
        }

        const hasPreference = !!profile.gst_preference;
        console.log('[GST_VALIDATION] Customer GST status:', {
            hasPreference,
            preference: profile.gst_preference,
            hasGSTNumber: !!profile.gst_number
        });

        return {
            hasPreference,
            preference: profile.gst_preference,
            gst_number: profile.gst_number,
            profileId: profile.id
        };

    } catch (error) {
        console.error('[GST_VALIDATION] Error in checkGSTStatus:', error.message);
        return { hasPreference: false, preference: null, gst_number: null };
    }
};

/**
 * Request GST details from customer before checkout
 */
const requestGSTDetails = async (phoneNumber, orderSummary = '') => {
    try {
        console.log('[GST_REQUEST] Requesting GST details from:', phoneNumber);

        const message = `📋 *GST Details Required*

Before we process your order${orderSummary ? ` of ${orderSummary}` : ''}, we need to know your GST preference:

*Option 1: WITH GST* 📄
• Upload your GST certificate PDF, OR
• Reply with your GST number (15 digits)
• You'll receive GST invoice

*Option 2: NO GST* 🏪
• Reply: "No GST" or "Retail customer"
• Standard billing without GST
• This preference will be saved for future orders

Please choose one option to proceed with your order.`;

        await sendMessage(phoneNumber, message);
        console.log('[GST_REQUEST] GST request message sent');

        return { success: true };

    } catch (error) {
        console.error('[GST_REQUEST] Error sending GST request:', error.message);
        return { success: false, error: error.message };
    }
};

/**
 * Save customer GST preference (with_gst or no_gst)
 */
const saveGSTPreference = async (tenantId, phoneNumber, preference) => {
    try {
        // CRITICAL FIX: Ensure phone has @c.us suffix for database lookup
        const { toWhatsAppFormat } = require('../utils/phoneUtils');
        const normalizedPhone = toWhatsAppFormat(phoneNumber);
        console.log('[GST_SAVE] Saving GST preference:', { phoneNumber: normalizedPhone, preference });

        if (!['with_gst', 'no_gst'].includes(preference)) {
            throw new Error('Invalid GST preference. Must be "with_gst" or "no_gst"');
        }

        // Get customer profile
        const { data: profile, error: fetchError } = await dbClient
            .from('customer_profiles_new')
            .select('id')
            .eq('tenant_id', tenantId)
            .eq('phone', normalizedPhone)
            .maybeSingle();

        if (fetchError) {
            console.error('[GST_SAVE] Error fetching profile:', fetchError.message);
            throw fetchError;
        }

        if (!profile) {
            console.log('[GST_SAVE] No profile found, cannot save preference');
            return { success: false, error: 'Customer profile not found' };
        }

        // Update GST preference
        const { error: updateError } = await dbClient
            .from('customer_profiles_new')
            .update({
                gst_preference: preference,
                updated_at: new Date().toISOString()
            })
            .eq('id', profile.id);

        if (updateError) {
            console.error('[GST_SAVE] Error updating preference:', updateError.message);
            throw updateError;
        }

        console.log('[GST_SAVE] GST preference saved successfully');
        return { success: true, preference };

    } catch (error) {
        console.error('[GST_SAVE] Error saving GST preference:', error.message);
        return { success: false, error: error.message };
    }
};

/**
 * Check if message indicates "NO GST" preference
 */
const isNoGSTResponse = (message) => {
    const normalized = message.toLowerCase().trim();

    const noGSTPatterns = [
        /\bno\s*gst\b/i,
        /\bnon[\s-]*gst\b/i,         // non-gst, non gst
        /\bwithout\s*gst\b/i,
        /\bretail\s*customer\b/i,
        /\bretail\s*client\b/i,       // retail client
        /\bno\s*bill\b/i,
        /\bdon'?t\s*need\s*gst\b/i,
        /\bdont\s*need\s*gst\b/i,
        /\bno\s*invoice\b/i,
        /\bno\s*tax\b/i,
        /\bi\s*am\s*retail\b/i,       // I am retail
        /\bretail\s*person\b/i,       // retail person
        /\bsmall\s*customer\b/i       // small customer
    ];

    return noGSTPatterns.some(pattern => pattern.test(normalized));
};

/**
 * Check if message contains GST number (15-digit format)
 */
const extractGSTNumber = (message) => {
    // GST number format: 27ACQFS1175A1Z4 (15 characters)
    // 2 digits + 5 letters + 4 digits + 1 letter + 1 alphanumeric + Z + 1 alphanumeric
    const gstPattern = /\b[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}\b/i;
    const match = message.toUpperCase().match(gstPattern);

    return match ? match[0] : null;
};

/**
 * Send confirmation message after GST preference is saved
 */
const sendGSTConfirmation = async (phoneNumber, preference) => {
    try {
        let message = '';

        if (preference === 'no_gst') {
            message = `✅ *Preference Saved*

You've been marked as a *retail customer without GST*.

• All future orders will be processed without GST invoice
• Standard billing will apply
• You can update this anytime by uploading your GST certificate

Your order will now proceed. Thank you! 🎉`;
        } else if (preference === 'with_gst') {
            message = `✅ *GST Details Saved*

Your GST information has been saved successfully!

• Future orders will include GST invoice
• GST billing will be applied
• You'll receive tax-compliant invoices

Your order will now proceed. Thank you! 🎉`;
        }

        await sendMessage(phoneNumber, message);
        console.log('[GST_CONFIRM] Confirmation message sent');

        return { success: true };

    } catch (error) {
        console.error('[GST_CONFIRM] Error sending confirmation:', error.message);
        return { success: false, error: error.message };
    }
};

/**
 * Main handler for GST response messages
 * Detects NO GST or GST number in customer message
 */
const handleGSTResponse = async (tenantId, phoneNumber, message) => {
    try {
        console.log('[GST_HANDLER] Processing GST response:', message.substring(0, 50));

        // Check for NO GST response
        if (isNoGSTResponse(message)) {
            console.log('[GST_HANDLER] NO GST response detected');

            await saveGSTPreference(tenantId, phoneNumber, 'no_gst');
            await sendGSTConfirmation(phoneNumber, 'no_gst');

            return {
                handled: true,
                type: 'no_gst',
                message: 'GST preference saved as NO GST'
            };
        }

        // Check for GST number
        const gstNumber = extractGSTNumber(message);
        if (gstNumber) {
            console.log('[GST_HANDLER] GST number detected, verifying:', gstNumber);

            // Use BusinessInfoCaptureService for proper verification and detail extraction
            const BusinessInfoCapture = require('./businessInfoCaptureService');
            const service = new BusinessInfoCapture();
            
            const verificationResult = await service.processGSTNumberOnly(
                tenantId,
                phoneNumber,
                gstNumber
            );

            if (verificationResult.success) {
                console.log('[GST_HANDLER] GST verified successfully:', verificationResult.businessDetails?.company_name);
                
                // Send detailed confirmation with extracted company details
                const details = verificationResult.businessDetails;
                let confirmMsg = `✅ *GST Details Verified & Saved*\n\n`;
                confirmMsg += `*Company Name:* ${details.company_name}\n`;
                if (details.legal_name && details.legal_name !== details.company_name) {
                    confirmMsg += `*Legal Name:* ${details.legal_name}\n`;
                }
                confirmMsg += `*GST Number:* ${gstNumber}\n`;
                if (details.business_state) {
                    confirmMsg += `*State:* ${details.business_state}\n`;
                }
                confirmMsg += `*Status:* ${details.business_status || 'Active'}\n\n`;
                confirmMsg += `Your GST information has been saved for all future orders.\n\n`;
                confirmMsg += `📄 *Available option:* You can also upload your GST certificate PDF anytime for instant verification.`;
                
                await sendMessage(phoneNumber, confirmMsg);

                return {
                    handled: true,
                    type: 'gst_verified',
                    gstNumber: gstNumber,
                    businessDetails: details,
                    message: 'GST verified and details extracted'
                };
            } else {
                // Verification failed - request business details or GST certificate
                console.log('[GST_HANDLER] GST verification failed, requesting alternative options');
                
                const alternativeMsg = `❌ *GST Verification Failed*\n\n` +
                    `The GST number ${gstNumber} could not be verified in government records.\n\n` +
                    `*Please choose one of these options:*\n\n` +
                    `*Option 1: Upload GST Certificate* 📎\n` +
                    `• Send your GST certificate PDF\n` +
                    `• Instant verification from document\n\n` +
                    `*Option 2: Provide Business Details* 📝\n` +
                    `Reply with your business information in this format:\n` +
                    `Company Name: [Your Company]\n` +
                    `Contact Person: [Name]\n` +
                    `Mobile: [Number]\n` +
                    `Address: [Full Address]\n` +
                    `Shipping Address: [If different]\n\n` +
                    `*Option 3: No GST*\n` +
                    `Reply "No GST" if you're a retail customer without GST registration.`;
                
                await sendMessage(phoneNumber, alternativeMsg);
                
                return {
                    handled: true,
                    type: 'gst_verification_failed_needs_info',
                    error: verificationResult.error,
                    message: 'GST verification failed - business info or certificate required'
                };
            }
        }

        // Not a GST response
        return { handled: false };

    } catch (error) {
        console.error('[GST_HANDLER] Error handling GST response:', error.message);
        return { handled: false, error: error.message };
    }
};

module.exports = {
    checkGSTStatus,
    requestGSTDetails,
    saveGSTPreference,
    isNoGSTResponse,
    extractGSTNumber,
    sendGSTConfirmation,
    handleGSTResponse
};


