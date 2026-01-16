/**
 * WhatsApp Web Service using whatsapp-web.js
 * Standalone broadcast system with QR code authentication
 */

const { Client, LocalAuth, MessageMedia, Buttons, List } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const { dbClient } = require('./config');
const { toWhatsAppFormat } = require('./phoneUtils');
const puppeteer18 = require('puppeteer18');
const fs = require('fs');
const path = require('path');

// Store active WhatsApp clients per tenant + session
// key format: `${tenantId}:${sessionName}`
const clients = new Map();
const qrCodes = new Map();
const clientStatus = new Map();
const clientMeta = new Map();
const tenantCache = new Map();

function normalizeSessionName(sessionName) {
    const raw = (sessionName == null || sessionName === '') ? 'default' : String(sessionName);
    const cleaned = raw.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_');
    return cleaned || 'default';
}

function makeClientKey(tenantId, sessionName) {
    return `${String(tenantId)}:${normalizeSessionName(sessionName)}`;
}

function makeLocalAuthClientId(tenantId, sessionName) {
    // LocalAuth uses this as a folder name; keep it filesystem-safe.
    return makeClientKey(tenantId, sessionName).replace(/[:]/g, '_');
}

function safeToString(val) {
    try {
        if (typeof val === 'string') return val;
        if (val == null) return '';
        return String(val);
    } catch {
        return '';
    }
}

async function destroyAndCleanupClient(tenantId, sessionName = 'default', reason) {
    // Backward-compat: older call sites used (tenantId, reason)
    // If reason is missing and sessionName looks like a reason, shift args.
    if (reason == null && typeof sessionName === 'string') {
        const maybeReason = sessionName;
        if (['timeout', 'error', 'auth_failed', 'disconnected'].includes(maybeReason)) {
            reason = maybeReason;
            sessionName = 'default';
        }
    }

    const key = makeClientKey(tenantId, sessionName);
    try {
        const existingClient = clients.get(key);
        if (existingClient) {
            try {
                await existingClient.destroy();
            } catch (e) {
                console.warn(`[WA_WEB] Non-critical destroy error for tenant ${tenantId} (${normalizeSessionName(sessionName)}):`, e?.message || e);
            }
        }
    } finally {
        clients.delete(key);
        qrCodes.delete(key);
        clientStatus.delete(key);
        clientMeta.delete(key);
        tenantCache.delete(tenantId);

        // If initialization failed, wipe LocalAuth session so the next connect attempt can generate a fresh QR.
        // (Corrupted sessions can cause whatsapp-web.js to hang without emitting a QR.)
        if (reason === 'timeout' || reason === 'error' || reason === 'auth_failed') {
            try {
                const clientId = makeLocalAuthClientId(tenantId, sessionName);
                const sessionPath = path.join(process.cwd(), '.wwebjs_auth', `session-${clientId}`);
                if (fs.existsSync(sessionPath)) {
                    fs.rmSync(sessionPath, { recursive: true, force: true });
                    console.log(`[WA_WEB] Removed LocalAuth session folder for tenant ${tenantId} (${normalizeSessionName(sessionName)}) due to ${reason}`);
                }
            } catch (e) {
                console.warn(`[WA_WEB] Non-critical failed to remove LocalAuth session for tenant ${tenantId} (${normalizeSessionName(sessionName)}):`, e?.message || e);
            }
        }

        if (reason) {
            clientStatus.set(key, reason);
        }
    }
}

/**
 * Initialize WhatsApp Web client for a tenant
 */
async function initializeClient(tenantId, sessionName = 'default', options = {}) {
    const sn = normalizeSessionName(sessionName);
    const key = makeClientKey(tenantId, sn);
    console.log(`[WA_WEB] Initializing client for tenant: ${tenantId} session: ${sn}`);
    
    // Avoid creating duplicate clients for the same tenant.
    if (clients.has(key)) {
        const status = clientStatus.get(key) || 'not_initialized';

        if (status === 'ready') {
            console.log(`[WA_WEB] Client already initialized and ready for tenant: ${tenantId} (${sn})`);
            return { success: true, status: 'ready' };
        }

        // If a client is already in-flight, return current status and let it continue.
        if (status === 'initializing' || status === 'qr_ready' || status === 'authenticated') {
            console.log(`[WA_WEB] Client already exists for tenant ${tenantId} (${sn}) (status=${status}); reusing`);
            return { success: true, status };
        }

        // For terminal/error states, destroy old client before retrying.
        if (status === 'timeout' || status === 'error' || status === 'auth_failed' || status === 'disconnected') {
            console.log(`[WA_WEB] Cleaning up previous client for tenant ${tenantId} (${sn}) (status=${status}) before re-init`);
            await destroyAndCleanupClient(tenantId, sn, 'disconnected');
        }
    }

    try {
        console.log(`[WA_WEB] Creating client WITH persistent auth (LocalAuth)`);

        // Cache tenant record for message routing
        try {
            const { data: tenant, error } = await dbClient
                .from('tenants')
                .select('*')
                .eq('id', tenantId)
                .single();
            if (!error && tenant) {
                tenantCache.set(tenantId, tenant);
            }
        } catch (e) {
            console.warn(`[WA_WEB] Failed to preload tenant ${tenantId}:`, e?.message || e);
        }

        clientMeta.set(key, {
            salesmanId: options?.salesmanId != null ? String(options.salesmanId) : null
        });

        const client = new Client({
            authStrategy: new LocalAuth({
                clientId: makeLocalAuthClientId(tenantId, sn),
                dataPath: path.join(process.cwd(), '.wwebjs_auth')
            }),
            puppeteer: {
                headless: true,
                executablePath: puppeteer18.executablePath(),
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--no-first-run',
                    '--no-zygote',
                    '--disable-gpu'
                ]
            }
        });

        // Extra events for visibility during init (helps diagnose timeouts)
        client.on('loading_screen', (percent, message) => {
            console.log(`[WA_WEB] Loading ${tenantId}: ${percent}% - ${safeToString(message)}`);
        });

        client.on('change_state', (state) => {
            console.log(`[WA_WEB] State changed ${tenantId}: ${safeToString(state)}`);
        });

        // QR Code event
        client.on('qr', async (qr) => {
            console.log(`[WA_WEB] QR Code generated for tenant: ${tenantId} session: ${sn}`);
            try {
                const qrDataUrl = await qrcode.toDataURL(qr);
                qrCodes.set(key, qrDataUrl);
                clientStatus.set(key, 'qr_ready');
                
                // Save QR code to database
                try {
                    const meta = clientMeta.get(key) || {};
                    const salesmanId = meta.salesmanId;
                    let existing = null;
                    try {
                        const r = await dbClient
                            .from('whatsapp_connections')
                            .select('*')
                            .eq('tenant_id', tenantId)
                            .eq('session_name', sn)
                            .single();
                        existing = r?.data || null;
                    } catch (e) {
                        // In SQLite wrapper, "not found" typically comes back as an error; treat as no existing row.
                        existing = null;
                    }

                    if (existing?.id) {
                        await dbClient
                            .from('whatsapp_connections')
                            .update({
                                qr_code: qrDataUrl,
                                status: 'awaiting_scan',
                                salesman_id: salesmanId || existing.salesman_id || null,
                                provider: existing.provider || 'whatsapp_web',
                                updated_at: new Date().toISOString()
                            })
                            .eq('id', existing.id);
                    } else {
                        await dbClient
                            .from('whatsapp_connections')
                            .insert({
                                tenant_id: tenantId,
                                session_name: sn,
                                qr_code: qrDataUrl,
                                status: 'awaiting_scan',
                                salesman_id: salesmanId || null,
                                provider: 'whatsapp_web',
                                updated_at: new Date().toISOString()
                            });
                    }
                } catch (dbErr) {
                    console.warn(`[WA_WEB] Non-critical DB save QR failed for ${tenantId}:`, dbErr?.message || dbErr);
                }
            } catch (err) {
                console.error(`[WA_WEB] QR Code generation error for tenant ${tenantId}:`, err);
            }
        });

        // Ready event
        client.on('ready', async () => {
            console.log(`[WA_WEB] Client ready for tenant: ${tenantId} session: ${sn}`);
            clientStatus.set(key, 'ready');
            qrCodes.delete(key);
            
            try {
                // Get connected phone number
                const info = client.info;
                console.log(`[WA_WEB] Phone info:`, info.wid.user);
                
                // Update database - use update instead of upsert to avoid conflict
                const { data, error } = await dbClient
                    .from('whatsapp_connections')
                    .update({
                        phone_number: info.wid.user,
                        status: 'connected',
                        qr_code: null,
                        connected_at: new Date().toISOString(),
                        updated_at: new Date().toISOString()
                    })
                    .eq('tenant_id', tenantId)
                    .eq('session_name', sn);
                
                if (error) {
                    console.error(`[WA_WEB] Database update error for tenant ${tenantId}:`, error);
                } else {
                    console.log(`[WA_WEB] Database updated successfully for tenant ${tenantId}`);
                }
            } catch (err) {
                console.error(`[WA_WEB] Error in ready handler for tenant ${tenantId}:`, err);
            }
        });

        // Inbound message → route through existing AI handler and reply via WhatsApp Web
        client.on('message', async (msg) => {
            try {
                if (!msg || msg.fromMe) return;
                if (clientStatus.get(key) !== 'ready') return;

                const body = typeof msg.body === 'string' ? msg.body.trim() : '';
                if (!body) return;

                const from = String(msg.from || '').replace(/@c\.us$/i, '').trim();
                if (!from) return;

                // Best-effort: store inbound message for reply tracking
                try {
                    const fromDigits = String(from).replace(/\D/g, '');
                    if (fromDigits) {
                        const messageId = (() => {
                            try {
                                if (typeof msg.id === 'string') return msg.id;
                                if (msg.id && typeof msg.id.id === 'string') return msg.id.id;
                                return null;
                            } catch {
                                return null;
                            }
                        })();

                        await dbClient
                            .from('inbound_messages')
                            .insert({
                                tenant_id: tenantId,
                                from_phone: fromDigits,
                                body,
                                received_at: new Date().toISOString(),
                                message_id: messageId
                            });
                    }
                } catch (e) {
                    // Non-critical
                }

                const tenant = tenantCache.get(tenantId);
                if (!tenant) {
                    // Best-effort re-fetch
                    const { data: t } = await dbClient
                        .from('tenants')
                        .select('*')
                        .eq('id', tenantId)
                        .single();
                    if (t) tenantCache.set(tenantId, t);
                }

                const resolvedTenant = tenantCache.get(tenantId);
                if (!resolvedTenant) {
                    console.warn('[WA_WEB] No tenant found for inbound message:', tenantId);
                    return;
                }

                // Capture outbound messages (main handler sends via Maytapi service)
                const prevDesktop = !!global.desktopAgentMode;
                const prevCaptured = global.capturedMessage;
                const prevCapturedMessages = global.capturedMessages;
                global.desktopAgentMode = true;
                global.capturedMessage = null;
                global.capturedMessages = [];

                try {
                    const customerHandler = require('../routes/handlers/customerHandler');
                    const fakeReq = {
                        tenant: resolvedTenant,
                        message: {
                            from,
                            to: resolvedTenant.bot_phone_number || null,
                            type: 'text',
                            text: { body }
                        }
                    };
                    const fakeRes = {
                        status: () => ({ json: () => null }),
                        json: () => null
                    };

                    await customerHandler.handleCustomer(fakeReq, fakeRes);
                } finally {
                    // Restore globals
                    const outgoing = Array.isArray(global.capturedMessages) && global.capturedMessages.length
                        ? global.capturedMessages
                        : (global.capturedMessage ? [global.capturedMessage] : []);

                    global.desktopAgentMode = prevDesktop;
                    global.capturedMessage = prevCaptured;
                    global.capturedMessages = prevCapturedMessages;

                    // Global opt-out enforcement for replies
                    try {
                        const { isUnsubscribed, toDigits } = require('./unsubscribeService');
                        const { isBypassNumber } = require('./outboundPolicy');
                        const digits = toDigits(from);
                        if (digits) {
                            const bypass = await isBypassNumber(digits);
                            if (!bypass && (await isUnsubscribed(digits))) {
                                console.warn('[WA_WEB] Skipped reply (unsubscribed):', digits);
                                return;
                            }
                        }
                    } catch (e) {
                        // Fail-open if policy lookup fails
                    }

                    // Send captured responses via WhatsApp Web (if any)
                    for (const text of outgoing) {
                        if (typeof text !== 'string' || !text.trim()) continue;
                        await client.sendMessage(msg.from, text);
                    }
                }
            } catch (e) {
                console.error('[WA_WEB] Inbound message processing error:', e?.message || e);
            }
        });

        // Authenticated event
        client.on('authenticated', () => {
            console.log(`[WA_WEB] Client authenticated for tenant: ${tenantId} session: ${sn}`);
            clientStatus.set(key, 'authenticated');
        });

        // Disconnected event
        client.on('disconnected', async (reason) => {
            console.log(`[WA_WEB] Client disconnected for tenant ${tenantId} session ${sn}:`, reason);
            clientStatus.set(key, 'disconnected');
            await destroyAndCleanupClient(tenantId, sn, 'disconnected');
            
            // Update database
            try {
                await dbClient
                    .from('whatsapp_connections')
                    .update({
                        status: 'disconnected',
                        updated_at: new Date().toISOString()
                    })
                    .eq('tenant_id', tenantId)
                    .eq('session_name', sn);
            } catch (dbErr) {
                console.warn(`[WA_WEB] Non-critical DB update disconnected failed for ${tenantId} (${sn}):`, dbErr?.message || dbErr);
            }
        });

        // Authentication failure event
        client.on('auth_failure', async (msg) => {
            console.error(`[WA_WEB] Authentication failure for tenant ${tenantId} session ${sn}:`, msg);
            clientStatus.set(key, 'auth_failed');

            // Destroy the client so the next connect attempt can generate a fresh QR/session.
            await destroyAndCleanupClient(tenantId, sn, 'auth_failed');
            
            // Update database
            await dbClient
                .from('whatsapp_connections')
                .update({
                    status: 'auth_failed',
                    updated_at: new Date().toISOString()
                })
                .eq('tenant_id', tenantId)
                .eq('session_name', sn);
        });

        // Store client
        clients.set(key, client);
        clientStatus.set(key, 'initializing');

        // Initialize client with timeout to prevent hanging.
        // WA Web can legitimately take >30s (first load, slow network, or session restore).
        const initTimeoutMs = 120000; // 2 minutes
        const initTimeout = setTimeout(async () => {
            console.error(`[WA_WEB] Initialization timeout for tenant ${tenantId} (${sn}) after ${initTimeoutMs}ms`);
            clientStatus.set(key, 'timeout');
            await destroyAndCleanupClient(tenantId, sn, 'timeout');

            // Best-effort update DB so UI reflects reality.
            try {
                await dbClient
                    .from('whatsapp_connections')
                    .update({
                        status: 'timeout',
                        updated_at: new Date().toISOString()
                    })
                    .eq('tenant_id', tenantId)
                    .eq('session_name', sn);
            } catch (dbErr) {
                console.warn(`[WA_WEB] Non-critical DB update timeout failed for ${tenantId} (${sn}):`, dbErr?.message || dbErr);
            }
        }, initTimeoutMs);

        try {
            // Initialize in background - don't await to prevent API timeout
            client.initialize().then(() => {
                clearTimeout(initTimeout);
                console.log(`[WA_WEB] Client initialization complete for tenant ${tenantId} (${sn})`);
            }).catch((err) => {
                clearTimeout(initTimeout);
                console.error(`[WA_WEB] Client initialization failed for tenant ${tenantId} (${sn}):`, err && err.stack ? err.stack : err);
                clientStatus.set(key, 'error');

                // Destroy the client so future attempts can retry cleanly.
                destroyAndCleanupClient(tenantId, sn, 'error').catch(() => null);
            });
        } catch (err) {
            clearTimeout(initTimeout);
            throw err;
        }

        return { success: true, status: 'initializing' };

    } catch (error) {
        console.error(`[WA_WEB] Error initializing client for tenant ${tenantId}:`, error);
        clientStatus.set(key, 'error');
        return { success: false, error: error.message };
    }
}

/**
 * Get QR code for tenant
 */
function getQRCode(tenantId, sessionName = 'default') {
    const sn = normalizeSessionName(sessionName);
    const key = makeClientKey(tenantId, sn);
    const qr = qrCodes.get(key);
    const status = clientStatus.get(key) || 'not_initialized';
    
    return {
        qrCode: qr || null,
        status: status
    };
}

/**
 * Get client status
 */
function getClientStatus(tenantId, sessionName = 'default') {
    const sn = normalizeSessionName(sessionName);
    const key = makeClientKey(tenantId, sn);
    return {
        status: clientStatus.get(key) || 'not_initialized',
        hasClient: clients.has(key)
    };
}

/**
 * Disconnect client
 */
async function disconnectClient(tenantId, sessionName = 'default') {
    const sn = normalizeSessionName(sessionName);
    const key = makeClientKey(tenantId, sn);
    console.log(`[WA_WEB] Disconnecting client for tenant: ${tenantId} session: ${sn}`);
    
    try {
        await destroyAndCleanupClient(tenantId, sn, 'disconnected');

        // Update database
        await dbClient
            .from('whatsapp_connections')
            .update({
                status: 'disconnected',
                updated_at: new Date().toISOString()
            })
            .eq('tenant_id', tenantId)
            .eq('session_name', sn);

        return { success: true };
    } catch (error) {
        console.error(`[WA_WEB] Error disconnecting client for tenant ${tenantId}:`, error);
        return { success: false, error: error.message };
    }
}

/**
 * Send text message via WhatsApp Web
 */
async function sendWebMessage(tenantId, phoneNumber, message, sessionName = 'default') {
    const sn = normalizeSessionName(sessionName);
    const key = makeClientKey(tenantId, sn);
    const client = clients.get(key);
    
    if (!client) {
        throw new Error('WhatsApp client not initialized. Please connect via QR code first.');
    }

    const status = clientStatus.get(key);
    if (status !== 'ready') {
        throw new Error(`WhatsApp client not ready. Current status: ${status}`);
    }

    // Global opt-out enforcement
    try {
        const { isUnsubscribed, toDigits } = require('./unsubscribeService');
        const { isBypassNumber } = require('./outboundPolicy');
        const digits = toDigits(phoneNumber);
        if (digits) {
            const bypass = await isBypassNumber(digits);
            if (!bypass && (await isUnsubscribed(digits))) {
                throw new Error('User unsubscribed');
            }
        }
    } catch (e) {
        // If the policy modules load but the check itself throws 'User unsubscribed', bubble it.
        if (String(e?.message || e).includes('User unsubscribed')) throw e;
        // Otherwise fail-open to avoid breaking WA web service unexpectedly.
    }

    try {
        const chatId = toWhatsAppFormat(phoneNumber);
        if (!chatId) {
            throw new Error('Invalid recipient phone number');
        }

        // Validate recipient exists on WhatsApp to avoid false "sent" signals
        const isRegistered = await client.isRegisteredUser(chatId);
        if (!isRegistered) {
            throw new Error('Recipient is not registered on WhatsApp');
        }
        
        // Send message
        const sentMessage = await client.sendMessage(chatId, message);
        
        console.log(`[WA_WEB] Message sent to ${phoneNumber} via tenant ${tenantId} (${sn})`);
        
        return {
            success: true,
            messageId: sentMessage.id.id
        };

    } catch (error) {
        console.error(`[WA_WEB] Error sending message to ${phoneNumber}:`, error);
        throw error;
    }
}

async function ensureWebReadyAndRecipient(tenantId, phoneNumber, sessionName = 'default') {
    const sn = normalizeSessionName(sessionName);
    const key = makeClientKey(tenantId, sn);
    const client = clients.get(key);
    if (!client) {
        throw new Error('WhatsApp client not initialized. Please connect via QR code first.');
    }

    const status = clientStatus.get(key);
    if (status !== 'ready') {
        throw new Error(`WhatsApp client not ready. Current status: ${status}`);
    }

    // Global opt-out enforcement
    try {
        const { isUnsubscribed, toDigits } = require('./unsubscribeService');
        const { isBypassNumber } = require('./outboundPolicy');
        const digits = toDigits(phoneNumber);
        if (digits) {
            const bypass = await isBypassNumber(digits);
            if (!bypass && (await isUnsubscribed(digits))) {
                throw new Error('User unsubscribed');
            }
        }
    } catch (e) {
        if (String(e?.message || e).includes('User unsubscribed')) throw e;
    }

    const chatId = toWhatsAppFormat(phoneNumber);
    if (!chatId) {
        throw new Error('Invalid recipient phone number');
    }

    const isRegistered = await client.isRegisteredUser(chatId);
    if (!isRegistered) {
        throw new Error('Recipient is not registered on WhatsApp');
    }

    return { client, chatId };
}

function normalizeButtonsPayload(payload) {
    const body = String(payload?.body || payload?.text || '');
    const title = payload?.header != null ? String(payload.header) : (payload?.title != null ? String(payload.title) : '');
    const footer = payload?.footer != null ? String(payload.footer) : '';
    const inputButtons = Array.isArray(payload?.buttons) ? payload.buttons : [];

    // whatsapp-web.js buttons expect up to 3 buttons generally.
    const mapped = inputButtons
        .filter(Boolean)
        .slice(0, 3)
        .map((b, i) => ({ body: String(b?.title || b?.text || b?.body || b?.id || `Option ${i + 1}`) }));

    return { body, title, footer, buttons: mapped };
}

function normalizeListPayload(payload) {
    const body = String(payload?.body || payload?.text || '');
    const buttonText = String(payload?.buttonText || payload?.button || 'Choose');
    const title = payload?.title != null ? String(payload.title) : '';
    const footer = payload?.footer != null ? String(payload.footer) : '';

    const inputSections = Array.isArray(payload?.sections) ? payload.sections : [];
    const sections = inputSections
        .filter(Boolean)
        .slice(0, 10)
        .map((s, si) => {
            const sTitle = s?.title != null ? String(s.title) : `Section ${si + 1}`;
            const rowsIn = Array.isArray(s?.rows) ? s.rows : [];
            const rows = rowsIn
                .filter(Boolean)
                .slice(0, 25)
                .map((r, ri) => ({
                    title: String(r?.title || r?.text || `Item ${ri + 1}`),
                    description: r?.description != null ? String(r.description) : '',
                    rowId: String(r?.id || r?.rowId || `${si + 1}-${ri + 1}`)
                }));
            return { title: sTitle, rows };
        });

    return { body, buttonText, sections, title, footer };
}

async function sendWebButtonsMessage(tenantId, phoneNumber, payload, sessionName = 'default') {
    if (typeof Buttons !== 'function') {
        throw new Error('Buttons are not supported by this whatsapp-web.js build');
    }

    const { client, chatId } = await ensureWebReadyAndRecipient(tenantId, phoneNumber, sessionName);
    const { body, buttons, title, footer } = normalizeButtonsPayload(payload);

    if (!body) throw new Error('buttons body/text is required');
    if (!buttons.length) throw new Error('buttons[] is required');

    const buttonsMessage = new Buttons(body, buttons, title || undefined, footer || undefined);
    const sentMessage = await client.sendMessage(chatId, buttonsMessage);

    return { success: true, messageId: sentMessage.id.id };
}

async function sendWebListMessage(tenantId, phoneNumber, payload, sessionName = 'default') {
    if (typeof List !== 'function') {
        throw new Error('Lists are not supported by this whatsapp-web.js build');
    }

    const { client, chatId } = await ensureWebReadyAndRecipient(tenantId, phoneNumber, sessionName);
    const { body, buttonText, sections, title, footer } = normalizeListPayload(payload);

    if (!body) throw new Error('list body/text is required');
    if (!sections.length || !sections.some(s => Array.isArray(s.rows) && s.rows.length)) {
        throw new Error('list sections/rows are required');
    }

    const listMessage = new List(body, buttonText, sections, title || undefined, footer || undefined);
    const sentMessage = await client.sendMessage(chatId, listMessage);

    return { success: true, messageId: sentMessage.id.id };
}

/**
 * Send image message via WhatsApp Web
 */
async function sendWebImageMessage(tenantId, phoneNumber, caption, imageBase64OrUrl, sessionName = 'default') {
    const sn = normalizeSessionName(sessionName);
    const { client, chatId } = await ensureWebReadyAndRecipient(tenantId, phoneNumber, sn);

    try {
        // Create media from base64 or URL
        let media;
        if (imageBase64OrUrl.startsWith('data:')) {
            // Base64 image
            media = new MessageMedia(
                'image/jpeg',
                imageBase64OrUrl.split(',')[1],
                'broadcast_image.jpg'
            );
        } else if (imageBase64OrUrl.startsWith('http')) {
            // URL image
            media = await MessageMedia.fromUrl(imageBase64OrUrl);
        } else {
            // Assume it's base64 without data URI prefix
            media = new MessageMedia('image/jpeg', imageBase64OrUrl, 'broadcast_image.jpg');
        }
        
        // Send message with media
        const sentMessage = await client.sendMessage(chatId, media, { caption: caption });
        
        console.log(`[WA_WEB] Image message sent to ${phoneNumber} via tenant ${tenantId} (${sn})`);
        
        return {
            success: true,
            messageId: sentMessage.id.id
        };

    } catch (error) {
        console.error(`[WA_WEB] Error sending image to ${phoneNumber}:`, error);
        throw error;
    }
}

/**
 * Send document message via WhatsApp Web
 */
async function sendWebDocumentMessage(tenantId, phoneNumber, documentBase64OrBuffer, filename, caption = '', sessionName = 'default') {
    const sn = normalizeSessionName(sessionName);
    const { client, chatId } = await ensureWebReadyAndRecipient(tenantId, phoneNumber, sn);

    try {
        const base64 = Buffer.isBuffer(documentBase64OrBuffer)
            ? documentBase64OrBuffer.toString('base64')
            : String(documentBase64OrBuffer || '');

        const lower = String(filename || '').toLowerCase();
        const mimetype = lower.endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream';

        const media = new MessageMedia(mimetype, base64, filename || 'document');

        const sentMessage = await client.sendMessage(chatId, media, caption ? { caption } : undefined);

        console.log(`[WA_WEB] Document sent to ${phoneNumber} via tenant ${tenantId} (${sn})`);

        return {
            success: true,
            messageId: sentMessage.id.id
        };
    } catch (error) {
        console.error(`[WA_WEB] Error sending document to ${phoneNumber}:`, error);
        throw error;
    }
}

/**
 * Check if number is registered on WhatsApp
 */
async function isRegisteredUser(tenantId, phoneNumber, sessionName = 'default') {
    const sn = normalizeSessionName(sessionName);
    const key = makeClientKey(tenantId, sn);
    const client = clients.get(key);
    
    if (!client || clientStatus.get(key) !== 'ready') {
        return false;
    }

    try {
        const chatId = phoneNumber.includes('@c.us') ? phoneNumber.replace('@c.us', '') : phoneNumber;
        const isRegistered = await client.isRegisteredUser(`${chatId}@c.us`);
        return isRegistered;
    } catch (error) {
        console.error(`[WA_WEB] Error checking registration for ${phoneNumber}:`, error);
        return false;
    }
}

/**
 * Get all active connections
 */
function getAllConnections() {
    const connections = [];
    for (const [key, client] of clients.entries()) {
        const [tenantId, sessionName] = String(key).split(':');
        connections.push({
            tenantId,
            sessionName: sessionName || 'default',
            status: clientStatus.get(key),
            hasQR: qrCodes.has(key)
        });
    }
    return connections;
}

/**
 * Auto-initialize clients for tenants with connected status on server startup
 */
async function autoInitializeConnectedClients() {
    try {
        console.log('[WA_WEB] Auto-initializing connected clients on server startup...');
        
        const { data: connections, error } = await dbClient
            .from('whatsapp_connections')
            .select('tenant_id, session_name, salesman_id, provider, status')
            .eq('status', 'connected');
        
        if (error) {
            console.error('[WA_WEB] Error fetching connected clients:', error);
            return;
        }
        
        if (!connections || connections.length === 0) {
            console.log('[WA_WEB] No connected clients to auto-initialize');
            return;
        }
        
        console.log(`[WA_WEB] Found ${connections.length} connected client(s), initializing...`);
        
        // Initialize each connected session
        for (const conn of connections) {
            const sn = normalizeSessionName(conn.session_name || 'default');
            console.log(`[WA_WEB] Auto-initializing client for tenant: ${conn.tenant_id} session: ${sn}`);
            try {
                await initializeClient(conn.tenant_id, sn, { salesmanId: conn.salesman_id || null });
            } catch (error) {
                console.error(`[WA_WEB] Failed to auto-initialize tenant ${conn.tenant_id} (${sn}):`, error.message);
            }
        }
        
        console.log('[WA_WEB] Auto-initialization complete');
    } catch (error) {
        console.error('[WA_WEB] Error in autoInitializeConnectedClients:', error);
    }
}

module.exports = {
    initializeClient,
    getQRCode,
    getClientStatus,
    disconnectClient,
    sendWebMessage,
    sendWebButtonsMessage,
    sendWebListMessage,
    sendWebImageMessage,
    sendWebDocumentMessage,
    sendWebMessageWithMedia: sendWebImageMessage, // Alias for broadcast compatibility
    isRegisteredUser,
    getAllConnections,
    autoInitializeConnectedClients
};


