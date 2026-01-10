/**
 * Manual Business Details Collection Service
 * Handles conversational collection of business information when GST verification fails
 */

const { dbClient } = require('./config');
const { sendMessage } = require('./whatsappService');

/**
 * Parse manually provided business details from message
 * Format expected:
 * Company Name: ABC Corp
 * Contact Person: John Doe
 * Mobile: 9876543210
 * Address: 123 Street, City
 * Shipping Address: Same as above (optional)
 */
async function parseManualBusinessDetails(message) {
    const details = {
        company_name: null,
        contact_person: null,
        mobile: null,
        address: null,
        shipping_address: null
    };

    // Extract fields using flexible patterns
    const companyMatch = message.match(/company\s*name\s*:?\s*(.+?)(?:\n|$)/i);
    if (companyMatch) details.company_name = companyMatch[1].trim();

    const contactMatch = message.match(/contact\s*person\s*:?\s*(.+?)(?:\n|$)/i);
    if (contactMatch) details.contact_person = contactMatch[1].trim();

    const mobileMatch = message.match(/mobile\s*:?\s*([0-9+\s\-()]+?)(?:\n|$)/i);
    if (mobileMatch) details.mobile = mobileMatch[1].trim().replace(/[\s\-()]/g, '');

    const addressMatch = message.match(/address\s*:?\s*(.+?)(?:\n(?:shipping|$)|$)/is);
    if (addressMatch) details.address = addressMatch[1].trim();

    const shippingMatch = message.match(/shipping\s*address\s*:?\s*(.+?)(?:\n|$)/is);
    if (shippingMatch) {
        const shipping = shippingMatch[1].trim();
        details.shipping_address = shipping.toLowerCase().includes('same') ? details.address : shipping;
    } else {
        details.shipping_address = details.address; // Default to same
    }

    // Validate - at least company name is required
    const isValid = !!details.company_name;

    return {
        isValid,
        details,
        missingFields: [
            !details.company_name && 'Company Name',
            !details.contact_person && 'Contact Person',
            !details.mobile && 'Mobile Number',
            !details.address && 'Address'
        ].filter(Boolean)
    };
}

/**
 * Check if message looks like business details submission
 */
function isBusinessDetailsMessage(message) {
    const hasCompanyName = /company\s*name\s*:/i.test(message);
    const hasContactPerson = /contact\s*person\s*:/i.test(message);
    const hasAddress = /address\s*:/i.test(message);
    
    // Must have at least 2 of the 3 key fields
    return (hasCompanyName ? 1 : 0) + (hasContactPerson ? 1 : 0) + (hasAddress ? 1 : 0) >= 2;
}

/**
 * Save business details to customer profile
 */
async function saveBusinessDetails(tenantId, phoneNumber, details) {
    try {
        console.log('[MANUAL_BUSINESS_DETAILS] Saving details for:', phoneNumber);

        const { toWhatsAppFormat } = require('../utils/phoneUtils');
        const normalizedPhone = toWhatsAppFormat(phoneNumber);

        // Get customer profile
        const { data: profile, error: fetchError } = await dbClient
            .from('customer_profiles')
            .select('id')
            .eq('tenant_id', tenantId)
            .eq('phone', normalizedPhone)
            .maybeSingle();

        if (fetchError || !profile) {
            throw new Error('Customer profile not found');
        }

        // Update with business details
        const updateData = {
            business_name: details.company_name,
            name: details.contact_person || details.company_name,
            gst_preference: 'with_gst', // They're providing business details
            business_verified: true,
            onboarding_completed: true,
            updated_at: new Date().toISOString()
        };

        // Add optional fields if provided
        if (details.mobile) updateData.alternate_phone = details.mobile;
        if (details.address) updateData.business_address = details.address;
        if (details.shipping_address) updateData.shipping_address = details.shipping_address;

        const { error: updateError } = await dbClient
            .from('customer_profiles')
            .update(updateData)
            .eq('id', profile.id);

        if (updateError) {
            throw updateError;
        }

        console.log('[MANUAL_BUSINESS_DETAILS] Details saved successfully');
        return { success: true };

    } catch (error) {
        console.error('[MANUAL_BUSINESS_DETAILS] Error saving details:', error.message);
        return { success: false, error: error.message };
    }
}

/**
 * Send confirmation after saving business details
 */
async function sendBusinessDetailsConfirmation(phoneNumber, details) {
    let message = `âœ… *Business Details Saved*\n\n`;
    message += `*Company:* ${details.company_name}\n`;
    if (details.contact_person) message += `*Contact Person:* ${details.contact_person}\n`;
    if (details.mobile) message += `*Mobile:* ${details.mobile}\n`;
    if (details.address) message += `*Address:* ${details.address}\n`;
    if (details.shipping_address && details.shipping_address !== details.address) {
        message += `*Shipping Address:* ${details.shipping_address}\n`;
    }
    message += `\nYour information has been saved. You can now proceed with your order! ðŸŽ‰`;

    await sendMessage(phoneNumber, message);
}

/**
 * Main handler for business details submission
 */
async function handleBusinessDetailsSubmission(tenantId, phoneNumber, message) {
    try {
        console.log('[BUSINESS_DETAILS_HANDLER] Processing submission');

        const parsed = await parseManualBusinessDetails(message);

        if (!parsed.isValid) {
            // Missing required fields - ask for them
            let errorMsg = `âš ï¸ *Missing Information*\n\n`;
            errorMsg += `Please provide the following details:\n`;
            parsed.missingFields.forEach(field => {
                errorMsg += `â€¢ ${field}\n`;
            });
            errorMsg += `\nPlease use this format:\n`;
            errorMsg += `Company Name: [Your Company]\n`;
            errorMsg += `Contact Person: [Name]\n`;
            errorMsg += `Mobile: [Number]\n`;
            errorMsg += `Address: [Full Address]\n`;
            errorMsg += `Shipping Address: [If different, or say "Same"]`;

            await sendMessage(phoneNumber, errorMsg);
            return {
                handled: true,
                success: false,
                message: 'Incomplete business details'
            };
        }

        // Save details
        const saveResult = await saveBusinessDetails(tenantId, phoneNumber, parsed.details);

        if (!saveResult.success) {
            await sendMessage(phoneNumber, 'âŒ Failed to save your details. Please try again or contact support.');
            return {
                handled: true,
                success: false,
                error: saveResult.error
            };
        }

        // Send confirmation
        await sendBusinessDetailsConfirmation(phoneNumber, parsed.details);

        return {
            handled: true,
            success: true,
            details: parsed.details,
            message: 'Business details saved successfully'
        };

    } catch (error) {
        console.error('[BUSINESS_DETAILS_HANDLER] Error:', error.message);
        return {
            handled: false,
            error: error.message
        };
    }
}

module.exports = {
    parseManualBusinessDetails,
    isBusinessDetailsMessage,
    saveBusinessDetails,
    sendBusinessDetailsConfirmation,
    handleBusinessDetailsSubmission
};

