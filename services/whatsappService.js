/**
 * @title WhatsApp Messaging Service
 * @description Multi-provider WhatsApp service (Desktop Agent, Waha, Maytapi)
 * @updated Phase 2 - Abstracted Maytapi dependency
 */
const fetch = require('node-fetch');
const MessageProvider = require('./messageProvider');
const { supabase } = require('./config');

const MAYTAPI_PRODUCT_ID = process.env.MAYTAPI_PRODUCT_ID;
const MAYTAPI_PHONE_ID = process.env.MAYTAPI_PHONE_ID;
const MAYTAPI_API_TOKEN = process.env.MAYTAPI_API_KEY;
const API_URL = `https://api.maytapi.com/api/${MAYTAPI_PRODUCT_ID}/${MAYTAPI_PHONE_ID}/sendMessage`;

/**
 * Sends a plain text message via MessageProvider (Desktop Agent, Waha, or Maytapi)
 * @param {string} to - Phone number (with or without @c.us)
 * @param {string} text - Message text
 * @param {object} tenant - Tenant object (optional, for provider selection)
 */
const sendMessage = async (to, text, tenant = null) => {
    try {
        // Clean up text formatting
        let cleanText = text
            .replace(/â‚¹/g, '₹')
            .replace(/Rs\./g, '₹')
            .replace(/Rs\s+/g, '₹')
            .replace(/Ã¢â€šÂ¹/g, '₹')
            .replace(/Ã°Å¸â€œÂ¦/g, '📦')
            .replace(/Ã¢Å"â€¦/g, '✅')
            .replace(/Ã°Å¸â€™Â³/g, '💳')
            .trim();
        
        console.log('[WHATSAPP_SEND] Cleaned text preview:', cleanText.substring(0, 100));

        // If tenant provided, use MessageProvider (NEW)
        if (tenant) {
            const provider = new MessageProvider(tenant);
            const result = await provider.sendMessage(to, cleanText);
            return result.messageId || null;
        }

        // Fallback to Maytapi (LEGACY - for backward compatibility)
        console.log('[WHATSAPP_SEND] Using Maytapi (legacy fallback)');
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json; charset=utf-8',
                'x-maytapi-key': MAYTAPI_API_TOKEN
            },
            body: JSON.stringify({
                to_number: to,
                type: 'text',
                message: cleanText
            })
        });
        const responseBody = await response.json();
        if (!response.ok) {
            console.error('Maytapi API Error:', JSON.stringify(responseBody, null, 2));
            throw new Error(`Maytapi API responded with status ${response.status}`);
        }
        console.log(`Text message sent to ${to}`);
        return responseBody.data?.message_id || null;
    } catch (error) {
        console.error('Error sending message:', error.message);
        return null;
    }
};
// ✅ FIX 2: Create a helper function for formatting currency
function formatCurrency(amount) {
    if (!amount && amount !== 0) return '₹0';
    // Use Intl.NumberFormat for proper Indian number formatting
    const formatted = new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: 'INR',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    }).format(amount);
    // Ensure we're using ₹ symbol, not Rs
    return formatted.replace(/Rs\.?\s*/, '₹');
}

/**
 * Sends a message with an image and a caption via MessageProvider or Maytapi
 * @param {string} to - Phone number
 * @param {string} caption - Image caption
 * @param {string} mediaUrl - Image URL
 * @param {object} tenant - Tenant object (optional)
 */
const sendMessageWithImage = async (to, caption, mediaUrl, tenant = null) => {
    try {
        // If tenant provided, use MessageProvider
        if (tenant) {
            const provider = new MessageProvider(tenant);
            const result = await provider.sendMessage(to, caption, mediaUrl);
            return result.messageId || null;
        }

        // Fallback to Maytapi (LEGACY)
        console.log('[WHATSAPP_SEND] Using Maytapi for image (legacy fallback)');
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-maytapi-key': MAYTAPI_API_TOKEN
            },
            body: JSON.stringify({
                to_number: to,
                type: 'media',
                message: mediaUrl,
                text: caption
            })
        });
        const responseBody = await response.json();
        if (!response.ok) {
            console.error('Maytapi API Error (Image):', JSON.stringify(responseBody, null, 2));
            throw new Error(`Maytapi API responded with status ${response.status}`);
        }
        console.log(`Image message sent to ${to}`);
        return responseBody.data?.message_id || null;
    } catch (error) {
        console.error('Error sending image message:', error.message);
        return null;
    }
};

/**
 * Sends a document (PDF, etc.) via the Maytapi API
 */
const sendDocument = async (to, documentBuffer, filename, caption = '') => {
    try {
        console.log('[MAYTAPI_DOCUMENT] Sending document:', filename, 'to:', to);
        console.log('[MAYTAPI_DOCUMENT] Buffer size:', documentBuffer.length, 'bytes');
        
        const base64Data = documentBuffer.toString('base64');
        console.log('[MAYTAPI_DOCUMENT] Base64 data length:', base64Data.length);
        
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-maytapi-key': MAYTAPI_API_TOKEN
            },
            body: JSON.stringify({
                to_number: to,
                type: 'document',
                text: caption,
                document: base64Data,
                filename: filename
            })
        });
        
        const responseBody = await response.json();
        console.log('[MAYTAPI_DOCUMENT] Response status:', response.status);
        console.log('[MAYTAPI_DOCUMENT] Response body:', JSON.stringify(responseBody, null, 2));
        
        if (!response.ok) {
            console.error('Maytapi Document API Error:', JSON.stringify(responseBody, null, 2));
            throw new Error(`Maytapi API responded with status ${response.status}: ${JSON.stringify(responseBody)}`);
        }
        
        console.log(`Document sent to ${to}: ${filename}`);
        return responseBody.data?.message_id || responseBody.message_id || 'document_sent';
        
    } catch (error) {
        console.error('Error sending document via Maytapi:', error.message);
        return null;
    }
};

module.exports = {
    sendMessage,
    sendMessageWithImage,
    sendDocument,
    formatCurrency,
    MessageProvider  // Export for direct use
};