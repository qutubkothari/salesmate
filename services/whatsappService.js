/**
 * @title WhatsApp Messaging Service
 * @description This service handles all interactions with the Maytapi API for sending messages.
 */
const fetch = require('node-fetch');

const MAYTAPI_PRODUCT_ID = process.env.MAYTAPI_PRODUCT_ID;
const MAYTAPI_PHONE_ID = process.env.MAYTAPI_PHONE_ID;
const MAYTAPI_API_TOKEN = process.env.MAYTAPI_API_KEY;
const API_URL = `https://api.maytapi.com/api/${MAYTAPI_PRODUCT_ID}/${MAYTAPI_PHONE_ID}/sendMessage`;

/**
 * Sends a plain text message via the Maytapi API and returns the message ID.
 */
const sendMessage = async (to, text) => {
    try {
        // ✅ FIX 1: Clean up currency symbols and ensure UTF-8
        let cleanText = text
            .replace(/â‚¹/g, '₹')  // Fix corrupted rupee symbols
            .replace(/Rs\./g, '₹')  // Standardize Rs. → ₹
            .replace(/Rs\s+/g, '₹') // Standardize Rs  → ₹
            .replace(/Ã¢â€šÂ¹/g, '₹') // Fix double-encoded symbols
            .replace(/Ã°Å¸â€œÂ¦/g, '📦') // Fix package emoji
            .replace(/Ã¢Å"â€¦/g, '✅') // Fix checkmark
            .replace(/Ã°Å¸â€™Â³/g, '💳') // Fix payment emoji
            .trim();
        
        console.log('[WHATSAPP_SEND] Cleaned text preview:', cleanText.substring(0, 100));
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json; charset=utf-8',  // ✅ Explicit UTF-8
                'x-maytapi-key': MAYTAPI_API_TOKEN
            },
            body: JSON.stringify({
                to_number: to,
                type: 'text',
                message: cleanText  // ✅ Use cleaned text
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
        console.error('Error sending message via Maytapi:', error.message);
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
 * Sends a message with an image and a caption via the Maytapi API and returns the message ID.
 */
const sendMessageWithImage = async (to, caption, mediaUrl) => {
    try {
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
        console.error('Error sending image message via Maytapi:', error.message);
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
    formatCurrency  // ✅ Add this export
};