/**
 * Phone Number Utilities
 * Handles phone number normalization and formatting
 */

/**
 * Normalize phone number to standard format
 * @param {string} phone - Phone number to normalize
 * @returns {string} Normalized phone number
 */
function normalizePhone(phone) {
    if (!phone) return null;
    
    // Remove all non-digit characters
    let cleaned = phone.toString().replace(/\D/g, '');
    
    // If starts with 91, keep it
    // If doesn't start with 91 and has 10 digits, add 91
    if (cleaned.startsWith('91') && cleaned.length === 12) {
        return cleaned;
    } else if (cleaned.length === 10) {
        return '91' + cleaned;
    } else if (cleaned.length === 12 && !cleaned.startsWith('91')) {
        // Keep as is
        return cleaned;
    }
    
    return cleaned;
}

/**
 * Convert phone number to WhatsApp format (with @c.us suffix)
 * @param {string} phone - Phone number
 * @returns {string} WhatsApp formatted number
 */
function toWhatsAppFormat(phone) {
    if (!phone) return null;
    
    const normalized = normalizePhone(phone);
    if (!normalized) return null;
    
    // If already has @c.us, return as is
    if (normalized.includes('@c.us')) {
        return normalized;
    }
    
    return `${normalized}@c.us`;
}

/**
 * Extract phone number from WhatsApp format
 * @param {string} whatsappNumber - WhatsApp formatted number
 * @returns {string} Clean phone number
 */
function fromWhatsAppFormat(whatsappNumber) {
    if (!whatsappNumber) return null;
    
    return whatsappNumber.replace('@c.us', '').replace('@s.whatsapp.net', '');
}

/**
 * Validate if phone number is valid Indian number
 * @param {string} phone - Phone number to validate
 * @returns {boolean} True if valid
 */
function isValidIndianNumber(phone) {
    const normalized = normalizePhone(phone);
    if (!normalized) return false;
    
    // Should be 12 digits starting with 91, or 10 digits
    return (normalized.length === 12 && normalized.startsWith('91')) ||
           normalized.length === 10;
}

module.exports = {
    normalizePhone,
    toWhatsAppFormat,
    fromWhatsAppFormat,
    isValidIndianNumber
};

