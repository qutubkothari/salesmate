/**
 * WhatsApp Web Service using whatsapp-web.js
 * Standalone broadcast system with QR code authentication
 */

const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const { supabase } = require('./config');
const { toWhatsAppFormat } = require('./phoneUtils');
const puppeteer18 = require('puppeteer18');
const fs = require('fs');
const path = require('path');
const { checkSubscriptionStatus } = require('./subscriptionService');

// Store active WhatsApp clients per tenant
const clients = new Map();
const qrCodes = new Map();
const clientStatus = new Map();
const tenantCache = new Map();

function safeToString(val) {
    try {
        if (typeof val === 'string') return val;
        if (val == null) return '';
        return String(val);
    } catch {
        return '';
    }
}

async function destroyAndCleanupClient(tenantId, reason) {
    try {
        const existingClient = clients.get(tenantId);
        if (existingClient) {
            try {
                await existingClient.destroy();
            } catch (e) {
                console.warn(`[WA_WEB] Non-critical destroy error for tenant ${tenantId}:`, e?.message || e);
            }
        }
    } finally {
        clients.delete(tenantId);
        qrCodes.delete(tenantId);
        tenantCache.delete(tenantId);

        // If initialization failed, wipe LocalAuth session so the next connect attempt can generate a fresh QR.
        // (Corrupted sessions can cause whatsapp-web.js to hang without emitting a QR.)
        if (reason === 'timeout' || reason === 'error' || reason === 'auth_failed') {
            try {
                const sessionPath = path.join(process.cwd(), '.wwebjs_auth', `session-${tenantId}`);
                if (fs.existsSync(sessionPath)) {
                    fs.rmSync(sessionPath, { recursive: true, force: true });
                    console.log(`[WA_WEB] Removed LocalAuth session folder for tenant ${tenantId} due to ${reason}`);
                }
            } catch (e) {
                console.warn(`[WA_WEB] Non-critical failed to remove LocalAuth session for tenant ${tenantId}:`, e?.message || e);
            }
        }

        if (reason) {
            clientStatus.set(tenantId, reason);
        }
    }
}

async function enforceWhatsAppWebEntitlement(tenantId) {
    const sub = await checkSubscriptionStatus(tenantId);

    if (sub?.status === 'expired') {
        // Turn off any active WA Web client for this tenant and prevent auto-reconnect.
        await disconnectClient(tenantId, {
            dbStatus: 'disabled_subscription_expired',
            reason: 'subscription_expired'
        });

        const err = new Error(sub.message || 'Subscription expired. Please contact support to renew.');
        err.code = 'SUBSCRIPTION_EXPIRED';
        throw err;
    }

    return sub;
}

/**
 * Initialize WhatsApp Web client for a tenant
 */
async function initializeClient(tenantId) {
    console.log(`[WA_WEB] Initializing client for tenant: ${tenantId}`);

    try {
        await enforceWhatsAppWebEntitlement(tenantId);
    } catch (e) {
        if (e?.code === 'SUBSCRIPTION_EXPIRED') {
            clientStatus.set(tenantId, 'subscription_expired');
            return { success: false, status: 'subscription_expired', error: e.message };
        }
        throw e;
    }
    
    // Avoid creating duplicate clients for the same tenant.
    if (clients.has(tenantId)) {
        const status = clientStatus.get(tenantId) || 'not_initialized';

        if (status === 'ready') {
            console.log(`[WA_WEB] Client already initialized and ready for tenant: ${tenantId}`);
            return { success: true, status: 'ready' };
        }

        // If a client is already in-flight, return current status and let it continue.
        if (status === 'initializing' || status === 'qr_ready' || status === 'authenticated') {
            console.log(`[WA_WEB] Client already exists for tenant ${tenantId} (status=${status}); reusing`);
            return { success: true, status };
        }

        // For terminal/error states, destroy old client before retrying.
        if (status === 'timeout' || status === 'error' || status === 'auth_failed' || status === 'disconnected') {
            console.log(`[WA_WEB] Cleaning up previous client for tenant ${tenantId} (status=${status}) before re-init`);
            await destroyAndCleanupClient(tenantId, 'disconnected');
        }
    }

    try {
        console.log(`[WA_WEB] Creating client WITH persistent auth (LocalAuth)`);

        // Cache tenant record for message routing
        try {
            const { data: tenant, error } = await supabase
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

        const client = new Client({
            authStrategy: new LocalAuth({
                clientId: tenantId,
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
            console.log(`[WA_WEB] QR Code generated for tenant: ${tenantId}`);
            try {
                const qrDataUrl = await qrcode.toDataURL(qr);
                qrCodes.set(tenantId, qrDataUrl);
                clientStatus.set(tenantId, 'qr_ready');
                
                // Save QR code to database
                try {
                    const sessionName = 'default';
                    let existing = null;
                    try {
                        const r = await supabase
                            .from('whatsapp_connections')
                            .select('*')
                            .eq('tenant_id', tenantId)
                            .eq('session_name', sessionName)
                            .single();
                        existing = r?.data || null;
                    } catch (e) {
                        // In SQLite wrapper, "not found" typically comes back as an error; treat as no existing row.
                        existing = null;
                    }

                    if (existing?.id) {
                        await supabase
                            .from('whatsapp_connections')
                            .update({
                                qr_code: qrDataUrl,
                                status: 'awaiting_scan',
                                updated_at: new Date().toISOString()
                            })
                            .eq('id', existing.id);
                    } else {
                        await supabase
                            .from('whatsapp_connections')
                            .insert({
                                tenant_id: tenantId,
                                session_name: sessionName,
                                qr_code: qrDataUrl,
                                status: 'awaiting_scan',
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
            console.log(`[WA_WEB] Client ready for tenant: ${tenantId}`);
            clientStatus.set(tenantId, 'ready');
            qrCodes.delete(tenantId);
            
            try {
                // Get connected phone number
                const info = client.info;
                console.log(`[WA_WEB] Phone info:`, info.wid.user);
                
                // Update database - use update instead of upsert to avoid conflict
                const { data, error } = await supabase
                    .from('whatsapp_connections')
                    .update({
                        phone_number: info.wid.user,
                        status: 'connected',
                        qr_code: null,
                        connected_at: new Date().toISOString(),
                        updated_at: new Date().toISOString()
                    })
                    .eq('tenant_id', tenantId);
                
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
                if (clientStatus.get(tenantId) !== 'ready') return;

                const body = typeof msg.body === 'string' ? msg.body.trim() : '';
                if (!body) return;

                const from = String(msg.from || '').replace(/@c\.us$/i, '').trim();
                if (!from) return;

                const preview = body.replace(/\s+/g, ' ').slice(0, 160);
                console.log(`[WA_WEB] Inbound from ${from} (${body.length} chars): ${preview}${body.length > 160 ? '…' : ''}`);

                const tenant = tenantCache.get(tenantId);
                if (!tenant) {
                    // Best-effort re-fetch
                    const { data: t } = await supabase
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

                    // Send captured responses via WhatsApp Web (if any)
                    for (const item of outgoing) {
                        // Plain text
                        if (typeof item === 'string') {
                            if (!item.trim()) continue;
                            const trimmed = item.trim();
                            const preview = trimmed.replace(/\s+/g, ' ').slice(0, 140);
                            console.log(`[WA_WEB] Sending reply to ${from} (${trimmed.length} chars): ${preview}${trimmed.length > 140 ? '…' : ''}`);
                            try {
                                const sent = await client.sendMessage(msg.from, trimmed);
                                const sentId = sent?.id ? JSON.stringify(sent.id) : 'unknown';
                                console.log(`[WA_WEB] Sent reply to ${from} (id=${sentId})`);
                            } catch (sendErr) {
                                console.error(`[WA_WEB] Failed sending reply to ${from}:`, sendErr?.message || sendErr);
                            }
                            continue;
                        }

                        // Media payloads
                        if (item && typeof item === 'object' && item.type === 'image' && item.url) {
                            const url = String(item.url).trim();
                            const caption = item.caption ? String(item.caption) : '';
                            const preview = caption.replace(/\s+/g, ' ').slice(0, 140);
                            console.log(`[WA_WEB] Sending image to ${from}: ${preview}${caption.length > 140 ? '…' : ''} (url=${url.slice(0, 80)}${url.length > 80 ? '…' : ''})`);
                            try {
                                const media = await MessageMedia.fromUrl(url, { unsafeMime: true });
                                const sent = await client.sendMessage(msg.from, media, caption ? { caption } : undefined);
                                const sentId = sent?.id ? JSON.stringify(sent.id) : 'unknown';
                                console.log(`[WA_WEB] Sent image to ${from} (id=${sentId})`);
                            } catch (sendErr) {
                                console.error(`[WA_WEB] Failed sending image to ${from}:`, sendErr?.message || sendErr);
                                // Fallback to sending the URL as text
                                try {
                                    await client.sendMessage(msg.from, url);
                                } catch (fallbackErr) {
                                    console.error(`[WA_WEB] Failed sending image fallback URL to ${from}:`, fallbackErr?.message || fallbackErr);
                                }
                            }
                        }
                    }
                }
            } catch (e) {
                console.error('[WA_WEB] Inbound message processing error:', e?.message || e);
            }
        });

        // Authenticated event
        client.on('authenticated', () => {
            console.log(`[WA_WEB] Client authenticated for tenant: ${tenantId}`);
            clientStatus.set(tenantId, 'authenticated');
        });

        // Disconnected event
        client.on('disconnected', async (reason) => {
            console.log(`[WA_WEB] Client disconnected for tenant ${tenantId}:`, reason);
            clientStatus.set(tenantId, 'disconnected');
            await destroyAndCleanupClient(tenantId, 'disconnected');
            
            // Update database
            try {
                await supabase
                    .from('whatsapp_connections')
                    .update({
                        status: 'disconnected',
                        updated_at: new Date().toISOString()
                    })
                    .eq('tenant_id', tenantId);
            } catch (dbErr) {
                console.warn(`[WA_WEB] Non-critical DB update disconnected failed for ${tenantId}:`, dbErr?.message || dbErr);
            }
        });

        // Authentication failure event
        client.on('auth_failure', async (msg) => {
            console.error(`[WA_WEB] Authentication failure for tenant ${tenantId}:`, msg);
            clientStatus.set(tenantId, 'auth_failed');

            // Destroy the client so the next connect attempt can generate a fresh QR/session.
            await destroyAndCleanupClient(tenantId, 'auth_failed');
            
            // Update database
            await supabase
                .from('whatsapp_connections')
                .update({
                    status: 'auth_failed',
                    updated_at: new Date().toISOString()
                })
                .eq('tenant_id', tenantId);
        });

        // Store client
        clients.set(tenantId, client);
        clientStatus.set(tenantId, 'initializing');

        // Initialize client with timeout to prevent hanging.
        // WA Web can legitimately take >30s (first load, slow network, or session restore).
        const initTimeoutMs = 120000; // 2 minutes
        const initTimeout = setTimeout(async () => {
            console.error(`[WA_WEB] Initialization timeout for tenant ${tenantId} after ${initTimeoutMs}ms`);
            clientStatus.set(tenantId, 'timeout');
            await destroyAndCleanupClient(tenantId, 'timeout');

            // Best-effort update DB so UI reflects reality.
            try {
                await supabase
                    .from('whatsapp_connections')
                    .update({
                        status: 'timeout',
                        updated_at: new Date().toISOString()
                    })
                    .eq('tenant_id', tenantId);
            } catch (dbErr) {
                console.warn(`[WA_WEB] Non-critical DB update timeout failed for ${tenantId}:`, dbErr?.message || dbErr);
            }
        }, initTimeoutMs);

        try {
            // Initialize in background - don't await to prevent API timeout
            client.initialize().then(() => {
                clearTimeout(initTimeout);
                console.log(`[WA_WEB] Client initialization complete for tenant ${tenantId}`);
            }).catch((err) => {
                clearTimeout(initTimeout);
                console.error(`[WA_WEB] Client initialization failed for tenant ${tenantId}:`, err && err.stack ? err.stack : err);
                clientStatus.set(tenantId, 'error');

                // Destroy the client so future attempts can retry cleanly.
                destroyAndCleanupClient(tenantId, 'error').catch(() => null);
            });
        } catch (err) {
            clearTimeout(initTimeout);
            throw err;
        }

        return { success: true, status: 'initializing' };

    } catch (error) {
        console.error(`[WA_WEB] Error initializing client for tenant ${tenantId}:`, error);
        if (error?.code === 'SUBSCRIPTION_EXPIRED') {
            clientStatus.set(tenantId, 'subscription_expired');
            return { success: false, status: 'subscription_expired', error: error.message };
        }
        clientStatus.set(tenantId, 'error');
        return { success: false, error: error.message };
    }
}

/**
 * Get QR code for tenant
 */
function getQRCode(tenantId) {
    const qr = qrCodes.get(tenantId);
    const status = clientStatus.get(tenantId) || 'not_initialized';
    
    return {
        qrCode: qr || null,
        status: status
    };
}

/**
 * Get client status
 */
function getClientStatus(tenantId) {
    return {
        status: clientStatus.get(tenantId) || 'not_initialized',
        hasClient: clients.has(tenantId)
    };
}

/**
 * Disconnect client
 */
async function disconnectClient(tenantId, options = {}) {
    console.log(`[WA_WEB] Disconnecting client for tenant: ${tenantId}`);
    
    try {
        const dbStatus = options.dbStatus || 'disconnected';
        const reason = options.reason || 'disconnected';

        await destroyAndCleanupClient(tenantId, reason);

        // Update database
        await supabase
            .from('whatsapp_connections')
            .update({
                status: dbStatus,
                updated_at: new Date().toISOString()
            })
            .eq('tenant_id', tenantId);

        return { success: true };
    } catch (error) {
        console.error(`[WA_WEB] Error disconnecting client for tenant ${tenantId}:`, error);
        return { success: false, error: error.message };
    }
}

/**
 * Send text message via WhatsApp Web
 */
async function sendWebMessage(tenantId, phoneNumber, message) {
    await enforceWhatsAppWebEntitlement(tenantId);

    const client = clients.get(tenantId);
    
    if (!client) {
        throw new Error('WhatsApp client not initialized. Please connect via QR code first.');
    }

    const status = clientStatus.get(tenantId);
    if (status !== 'ready') {
        throw new Error(`WhatsApp client not ready. Current status: ${status}`);
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
        
        console.log(`[WA_WEB] Message sent to ${phoneNumber} via tenant ${tenantId}`);
        
        return {
            success: true,
            messageId: sentMessage.id.id
        };

    } catch (error) {
        console.error(`[WA_WEB] Error sending message to ${phoneNumber}:`, error);
        throw error;
    }
}

/**
 * Send image message via WhatsApp Web
 */
async function sendWebImageMessage(tenantId, phoneNumber, caption, imageBase64OrUrl) {
    await enforceWhatsAppWebEntitlement(tenantId);

    const client = clients.get(tenantId);
    
    if (!client) {
        throw new Error('WhatsApp client not initialized. Please connect via QR code first.');
    }

    const status = clientStatus.get(tenantId);
    if (status !== 'ready') {
        throw new Error(`WhatsApp client not ready. Current status: ${status}`);
    }

    try {
        const chatId = toWhatsAppFormat(phoneNumber);
        if (!chatId) {
            throw new Error('Invalid recipient phone number');
        }

        const isRegistered = await client.isRegisteredUser(chatId);
        if (!isRegistered) {
            throw new Error('Recipient is not registered on WhatsApp');
        }
        
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
        
        console.log(`[WA_WEB] Image message sent to ${phoneNumber} via tenant ${tenantId}`);
        
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
 * Send document (PDF, etc.) via WhatsApp Web
 */
async function sendWebDocumentMessage(tenantId, phoneNumber, caption, documentBuffer, filename, mimeType = 'application/pdf') {
    await enforceWhatsAppWebEntitlement(tenantId);

    const client = clients.get(tenantId);

    if (!client) {
        throw new Error('WhatsApp client not initialized. Please connect via QR code first.');
    }

    const status = clientStatus.get(tenantId);
    if (status !== 'ready') {
        throw new Error(`WhatsApp client not ready. Current status: ${status}`);
    }

    try {
        const chatId = toWhatsAppFormat(phoneNumber);
        if (!chatId) {
            throw new Error('Invalid recipient phone number');
        }

        const isRegistered = await client.isRegisteredUser(chatId);
        if (!isRegistered) {
            throw new Error('Recipient is not registered on WhatsApp');
        }

        const base64 = Buffer.isBuffer(documentBuffer)
            ? documentBuffer.toString('base64')
            : Buffer.from(documentBuffer).toString('base64');

        const safeName = (filename && String(filename).trim()) ? String(filename).trim() : `document_${Date.now()}.pdf`;
        const media = new MessageMedia(String(mimeType || 'application/pdf'), base64, safeName);

        const sentMessage = await client.sendMessage(chatId, media, caption ? { caption: String(caption) } : undefined);

        console.log(`[WA_WEB] Document sent to ${phoneNumber} via tenant ${tenantId} (filename=${safeName})`);

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
async function isRegisteredUser(tenantId, phoneNumber) {
    const client = clients.get(tenantId);
    
    if (!client || clientStatus.get(tenantId) !== 'ready') {
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
    for (const [tenantId, client] of clients.entries()) {
        connections.push({
            tenantId,
            status: clientStatus.get(tenantId),
            hasQR: qrCodes.has(tenantId)
        });
    }
    return connections;
}

async function enforceExpiredWhatsAppWebConnections() {
    const nowIso = new Date().toISOString();

    try {
        // Trials that are past end date but not yet marked expired
        const { data: expiredTrials, error: trialErr } = await supabase
            .from('tenants')
            .select('id')
            .eq('subscription_status', 'trial')
            .lt('trial_ends_at', nowIso);

        if (trialErr) {
            console.warn('[WA_WEB] Trial expiry enforcement query failed:', trialErr?.message || trialErr);
        }

        // Paid subscriptions that are past end date but not yet marked expired
        const { data: expiredPaid, error: paidErr } = await supabase
            .from('tenants')
            .select('id')
            .eq('subscription_status', 'active')
            .lt('subscription_end_date', nowIso);

        if (paidErr) {
            console.warn('[WA_WEB] Subscription expiry enforcement query failed:', paidErr?.message || paidErr);
        }

        const ids = new Set([
            ...(expiredTrials || []).map(r => r.id),
            ...(expiredPaid || []).map(r => r.id)
        ].filter(Boolean));

        if (ids.size === 0) return;

        for (const tenantId of ids) {
            try {
                // Updates tenant.subscription_status to 'expired' when needed.
                const sub = await checkSubscriptionStatus(tenantId);
                if (sub?.status === 'expired') {
                    await disconnectClient(tenantId, {
                        dbStatus: 'disabled_subscription_expired',
                        reason: 'subscription_expired'
                    });
                }
            } catch (e) {
                console.warn(`[WA_WEB] Failed enforcing expiry for tenant ${tenantId}:`, e?.message || e);
            }
        }
    } catch (e) {
        console.warn('[WA_WEB] Expiry enforcement loop error:', e?.message || e);
    }
}

/**
 * Auto-initialize clients for tenants with connected status on server startup
 */
async function autoInitializeConnectedClients() {
    try {
        console.log('[WA_WEB] Auto-initializing connected clients on server startup...');
        
        const { data: connections, error } = await supabase
            .from('whatsapp_connections')
            .select('tenant_id, status')
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
        
        // Initialize each connected tenant's client
        for (const conn of connections) {
            console.log(`[WA_WEB] Auto-initializing client for tenant: ${conn.tenant_id}`);
            try {
                await initializeClient(conn.tenant_id);
            } catch (error) {
                console.error(`[WA_WEB] Failed to auto-initialize tenant ${conn.tenant_id}:`, error.message);
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
    sendWebImageMessage,
    sendWebDocumentMessage,
    sendWebMessageWithMedia: sendWebImageMessage, // Alias for broadcast compatibility
    isRegisteredUser,
    getAllConnections,
    autoInitializeConnectedClients,
    enforceExpiredWhatsAppWebConnections
};
