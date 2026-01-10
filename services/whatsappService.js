/**
 * @title WhatsApp Messaging Service
 * @description This service handles all interactions with the Maytapi API for sending messages.
 */
const fetch = require('node-fetch');
const { dbClient } = require('./config');
const { isUnsubscribed, toDigits } = require('./unsubscribeService');
const { isBypassNumber } = require('./outboundPolicy');

const MAYTAPI_PRODUCT_ID = process.env.MAYTAPI_PRODUCT_ID;
const MAYTAPI_PHONE_ID = process.env.MAYTAPI_PHONE_ID;
const MAYTAPI_API_TOKEN = process.env.MAYTAPI_API_KEY;

const providerCache = new Map();

const maytapiConfigCache = new Map();

function getEnvMaytapiConfig() {
    return {
        productId: MAYTAPI_PRODUCT_ID || '',
        phoneId: MAYTAPI_PHONE_ID || '',
        apiKey: MAYTAPI_API_TOKEN || ''
    };
}

function hasMaytapiConfig(cfg) {
    return !!(cfg && cfg.productId && cfg.phoneId && cfg.apiKey);
}

async function getTenantMaytapiConfig(tenantId) {
    const cacheKey = String(tenantId);
    const now = Date.now();
    const cached = maytapiConfigCache.get(cacheKey);
    if (cached && (now - cached.at) < 60_000) {
        return cached.cfg;
    }

    let cfg = getEnvMaytapiConfig();
    try {
        const { data: tenant, error } = await dbClient
            .from('tenants')
            .select('maytapi_product_id, maytapi_phone_id, maytapi_api_key')
            .eq('id', tenantId)
            .maybeSingle();

        if (!error && tenant) {
            cfg = {
                productId: String(tenant.maytapi_product_id || cfg.productId || ''),
                phoneId: String(tenant.maytapi_phone_id || cfg.phoneId || ''),
                apiKey: String(tenant.maytapi_api_key || cfg.apiKey || '')
            };
        }
    } catch (_) {
        // ignore and use env fallback
    }

    maytapiConfigCache.set(cacheKey, { cfg, at: now });
    return cfg;
}

function parseCsvList(value) {
    return String(value || '')
        .split(',')
        .map(v => v.trim().toLowerCase())
        .filter(Boolean);
}

async function resolveTenantProvider(tenantId) {
    const mode = String(process.env.WHATSAPP_PROVIDER_MODE || 'auto').trim().toLowerCase();
    if (mode === 'maytapi') return 'maytapi';
    if (mode === 'whatsapp_web' || mode === 'whatsapp-web' || mode === 'waweb') return 'whatsapp_web';

    const cacheKey = String(tenantId);
    const now = Date.now();
    const cached = providerCache.get(cacheKey);
    if (cached && (now - cached.at) < 60_000) {
        return cached.provider;
    }

    let provider = String(process.env.WHATSAPP_PROVIDER_DEFAULT || 'whatsapp_web').trim().toLowerCase();
    provider = (provider === 'maytapi') ? 'maytapi' : 'whatsapp_web';

    try {
        const { data: tenant, error } = await dbClient
            .from('tenants')
            .select('subscription_status, subscription_tier')
            .eq('id', tenantId)
            .maybeSingle();

        if (!error && tenant) {
            const status = String(tenant.subscription_status || '').toLowerCase();
            const tier = String(tenant.subscription_tier || '').toLowerCase();

            const maytapiTiers = parseCsvList(process.env.WHATSAPP_MAYTAPI_TIERS || 'premium,enterprise,pro');
            const maytapiForActive = String(process.env.WHATSAPP_MAYTAPI_FOR_ACTIVE || '0') === '1';

            if (status === 'active' && (maytapiForActive || maytapiTiers.includes(tier))) {
                provider = 'maytapi';
            }
        }
    } catch (e) {
        // Fail safe: keep default provider.
    }

    // If we're about to route to Maytapi but no credentials exist, fall back to WhatsApp Web.
    if (provider === 'maytapi') {
        const cfg = await getTenantMaytapiConfig(tenantId);
        if (!hasMaytapiConfig(cfg)) {
            provider = 'whatsapp_web';
        }
    }

    providerCache.set(cacheKey, { provider, at: now });
    return provider;
}

function assertMaytapiConfigured(cfg) {
    if (!hasMaytapiConfig(cfg)) {
        throw new Error('Maytapi is not configured (missing MAYTAPI_PRODUCT_ID/MAYTAPI_PHONE_ID/MAYTAPI_API_KEY)');
    }
}

async function sendViaMaytapi(to, cleanText, cfg) {
    assertMaytapiConfigured(cfg);

    const apiUrl = `https://api.maytapi.com/api/${cfg.productId}/${cfg.phoneId}/sendMessage`;

    const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'x-maytapi-key': cfg.apiKey
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
}

function cleanOutgoingText(text) {
    return String(text || '')
        .replace(/Ã¢â€šÂ¹/g, 'â‚¹')
        .replace(/Rs\./g, 'â‚¹')
        .replace(/Rs\s+/g, 'â‚¹')
        .replace(/ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¹/g, 'â‚¹')
        .replace(/ÃƒÂ°Ã…Â¸Ã¢â‚¬Å“Ã‚Â¦/g, 'ðŸ“¦')
        .replace(/ÃƒÂ¢Ã…"Ã¢â‚¬Â¦/g, 'âœ…')
        .replace(/ÃƒÂ°Ã…Â¸Ã¢â‚¬â„¢Ã‚Â³/g, 'ðŸ’³')
        .trim();
}

/**
 * Sends a plain text message via the Maytapi API and returns the message ID.
 */
// NOTE: tenantId is optional for backwards compatibility.
// If tenantId is provided, the provider is selected per-tenant:
// - paid tiers (configurable) -> Maytapi
// - otherwise -> WhatsApp Web
const sendMessage = async (to, text, tenantId = null) => {
    // Check if we're in desktop agent mode - if so, capture instead of sending
    if (global.desktopAgentMode) {
        console.log('[WHATSAPP_SERVICE] Desktop agent mode - capturing message instead of sending');
        // Preserve legacy single-message behavior
        global.capturedMessage = text;
        // Also support multi-message capture (WhatsApp Web / WAHA bridge, etc.)
        if (!Array.isArray(global.capturedMessages)) {
            global.capturedMessages = [];
        }
        global.capturedMessages.push(text);
        return 'desktop_agent_captured_' + Date.now();
    }
    
    const cleanText = cleanOutgoingText(text);

    // Global opt-out enforcement (no outbound to unsubscribed numbers)
    try {
        const digits = toDigits(to);
        if (digits) {
            const bypass = await isBypassNumber(digits);
            if (!bypass && (await isUnsubscribed(digits))) {
                console.warn('[WHATSAPP_SEND] Skipped (unsubscribed):', digits);
                return null;
            }
        }
    } catch (e) {
        // Fail-open here to avoid breaking core flows if policy check fails
        console.warn('[WHATSAPP_SEND] Opt-out check failed; proceeding:', e?.message || e);
    }

    try {
        // Default behavior when tenantId is unknown: Maytapi (legacy webhook/admin flows)
        if (!tenantId) {
            console.log('[WHATSAPP_SEND] Cleaned text preview:', cleanText.substring(0, 100));
            return await sendViaMaytapi(to, cleanText, getEnvMaytapiConfig());
        }

        const provider = await resolveTenantProvider(String(tenantId));
        if (provider === 'maytapi') {
            console.log('[WHATSAPP_SEND] Provider: Maytapi (tenant)', tenantId);
            console.log('[WHATSAPP_SEND] Cleaned text preview:', cleanText.substring(0, 100));
            const cfg = await getTenantMaytapiConfig(String(tenantId));
            return await sendViaMaytapi(to, cleanText, cfg);
        }

        console.log('[WHATSAPP_SEND] Provider: WhatsApp Web (tenant)', tenantId);
        const { getClientStatus, sendWebMessage } = require('./whatsappWebService');
        const status = getClientStatus(String(tenantId));
        if (!status || status.status !== 'ready') {
            throw new Error('WhatsApp Web is not connected for this tenant. Please connect via QR code first.');
        }

        const result = await sendWebMessage(String(tenantId), to, cleanText);
        if (!result?.success) {
            throw new Error('Failed to send WhatsApp Web message');
        }
        return result.messageId || result.message_id || ('waweb_' + Date.now());
    } catch (error) {
        console.error('Error sending WhatsApp message:', error.message);
        return null;
    }
};
// âœ… FIX 2: Create a helper function for formatting currency
function formatCurrency(amount) {
    if (!amount && amount !== 0) return 'â‚¹0';
    // Use Intl.NumberFormat for proper Indian number formatting
    const formatted = new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: 'INR',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    }).format(amount);
    // Ensure we're using â‚¹ symbol, not Rs
    return formatted.replace(/Rs\.?\s*/, 'â‚¹');
}

/**
 * Sends a message with an image and a caption via the Maytapi API and returns the message ID.
 */
const sendMessageWithImage = async (to, caption, mediaUrl, tenantId = null) => {
    try {
        // Global opt-out enforcement
        try {
            const digits = toDigits(to);
            if (digits) {
                const bypass = await isBypassNumber(digits);
                if (!bypass && (await isUnsubscribed(digits))) {
                    console.warn('[WHATSAPP_SEND_MEDIA] Skipped (unsubscribed):', digits);
                    return null;
                }
            }
        } catch (e) {
            console.warn('[WHATSAPP_SEND_MEDIA] Opt-out check failed; proceeding:', e?.message || e);
        }

        if (tenantId) {
            const provider = await resolveTenantProvider(String(tenantId));
            if (provider === 'whatsapp_web') {
                const { getClientStatus, sendWebImageMessage } = require('./whatsappWebService');
                const status = getClientStatus(String(tenantId));
                if (!status || status.status !== 'ready') {
                    throw new Error('WhatsApp Web is not connected for this tenant. Please connect via QR code first.');
                }
                const result = await sendWebImageMessage(String(tenantId), to, caption || '', mediaUrl);
                if (result?.success) {
                    return result.messageId || result.message_id || ('waweb_media_' + Date.now());
                }
                return null;
            }
        }

        // Maytapi
        const cfg = tenantId ? await getTenantMaytapiConfig(String(tenantId)) : getEnvMaytapiConfig();
        assertMaytapiConfigured(cfg);
        const apiUrl = `https://api.maytapi.com/api/${cfg.productId}/${cfg.phoneId}/sendMessage`;

        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-maytapi-key': cfg.apiKey
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
const sendDocument = async (to, documentBuffer, filename, caption = '', tenantId = null) => {
    try {
        // Global opt-out enforcement
        try {
            const { isUnsubscribed, toDigits } = require('./unsubscribeService');
            const { isBypassNumber } = require('./outboundPolicy');
            const digits = toDigits(to);
            if (digits) {
                const bypass = await isBypassNumber(digits);
                if (!bypass && (await isUnsubscribed(digits))) {
                    console.warn('[WHATSAPP_SEND_DOCUMENT] Skipped (unsubscribed):', digits);
                    return null;
                }
            }
        } catch (e) {
            console.warn('[WHATSAPP_SEND_DOCUMENT] Opt-out check failed; proceeding:', e?.message || e);
        }

        if (tenantId) {
            const provider = await resolveTenantProvider(String(tenantId));
            if (provider === 'whatsapp_web') {
                const { getClientStatus, sendWebDocumentMessage } = require('./whatsappWebService');
                const status = getClientStatus(String(tenantId));
                if (!status || status.status !== 'ready') {
                    throw new Error('WhatsApp Web is not connected for this tenant. Please connect via QR code first.');
                }
                const result = await sendWebDocumentMessage(String(tenantId), to, documentBuffer, filename, caption);
                if (result?.success) {
                    return result.messageId || result.message_id || ('waweb_doc_' + Date.now());
                }
                return null;
            }
        }

        console.log('[MAYTAPI_DOCUMENT] Sending document:', filename, 'to:', to);
        console.log('[MAYTAPI_DOCUMENT] Buffer size:', documentBuffer.length, 'bytes');

        const cfg = tenantId ? await getTenantMaytapiConfig(String(tenantId)) : getEnvMaytapiConfig();
        assertMaytapiConfigured(cfg);

        const apiUrl = `https://api.maytapi.com/api/${cfg.productId}/${cfg.phoneId}/sendMessage`;
        
        const base64Data = documentBuffer.toString('base64');
        console.log('[MAYTAPI_DOCUMENT] Base64 data length:', base64Data.length);
        
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-maytapi-key': cfg.apiKey
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
        console.error('Error sending document:', error.message);
        return null;
    }
};

module.exports = {
    sendMessage,
    sendMessageWithImage,
    sendDocument,
    formatCurrency  // âœ… Add this export
};
