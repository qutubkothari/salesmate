const express = require('express');
const router = express.Router();
const { dbClient } = require('../../services/config');
const { sendMessage, sendMessageWithImage } = require('../../services/whatsappService');
const { sendViaDesktopAgent, isDesktopAgentOnline } = require('../../services/desktopAgentBridge');
const { sendBroadcastViaWaha } = require('../../services/wahaService');
const { normalizePhone } = require('../../services/phoneUtils');
const { getClientStatus, sendWebMessage, sendWebMessageWithMedia, sendWebButtonsMessage, sendWebListMessage } = require('../../services/whatsappWebService');
const { filterUnsubscribed, canonicalUnsubscribeKey } = require('../../services/unsubscribeService');
const { createTrackedLinksAndRewriteMessage } = require('../../services/linkTrackingService');

// In local SQLite, `broadcast_recipients` may be a legacy contact-list table.
// Use a dedicated table for per-campaign delivery tracking.
const RECIPIENT_TRACKING_TABLE =
    process.env.USE_LOCAL_DB === 'true' ? 'broadcast_campaign_recipients' : 'broadcast_recipients';

const isLocalRecipientTrackingTable = RECIPIENT_TRACKING_TABLE === 'broadcast_campaign_recipients';

async function insertRecipientTrackingRows({ tenantId, campaignId, rows }) {
    if (!campaignId || !Array.isArray(rows) || rows.length === 0) return;
    try {
        const now = new Date().toISOString();
        const inserts = rows
            .filter((r) => r && r.phone)
            .map((r) => {
                const base = {
                    campaign_id: campaignId,
                    phone: String(r.phone),
                    status: r.status || 'pending',
                    sent_at: r.sent_at || (r.status === 'sent' ? now : null),
                    error_message: r.error_message || null,
                    created_at: now
                };
                if (isLocalRecipientTrackingTable) base.tenant_id = tenantId;
                return base;
            });

        if (inserts.length) {
            const { error } = await dbClient
                .from(RECIPIENT_TRACKING_TABLE)
                .insert(inserts);
            if (error) {
                console.warn('[BROADCAST_API] Warning: Failed inserting recipient tracking rows:', error);
            }
        }
    } catch (e) {
        console.warn('[BROADCAST_API] Warning: recipient tracking insert failed:', e?.message || e);
    }
}

function renderInteractiveFallbackText({ type, payload, bodyText }) {
    const t = String(type || '').toLowerCase();
    const p = payload && typeof payload === 'object' ? payload : {};
    const body = String(bodyText || p.body || p.text || p.message || '').trim();

    if (t === 'buttons') {
        const header = p.header ? String(p.header) : '';
        const footer = p.footer ? String(p.footer) : '';
        const buttons = Array.isArray(p.buttons) ? p.buttons : [];
        const lines = [];
        if (header) lines.push(header);
        if (body) lines.push(body);
        if (buttons.length) {
            lines.push('');
            lines.push('Options:');
            buttons.slice(0, 10).forEach((b, i) => {
                const title = b?.title || b?.text || b?.id || `Option ${i + 1}`;
                lines.push(`${i + 1}. ${String(title)}`);
            });
        }
        if (footer) {
            lines.push('');
            lines.push(footer);
        }
        return lines.filter(Boolean).join('\n');
    }

    if (t === 'list') {
        const buttonText = p.buttonText ? String(p.buttonText) : 'Choose an option';
        const sections = Array.isArray(p.sections) ? p.sections : [];
        const lines = [];
        if (body) lines.push(body);
        lines.push('');
        lines.push(buttonText + ':');
        let idx = 1;
        for (const s of sections) {
            const title = s?.title ? String(s.title) : '';
            const rows = Array.isArray(s?.rows) ? s.rows : [];
            if (title) lines.push(`\n${title}`);
            for (const r of rows.slice(0, 25)) {
                const tt = r?.title || r?.text || r?.id || `Item ${idx}`;
                lines.push(`${idx}. ${String(tt)}`);
                idx++;
            }
        }
        return lines.filter(Boolean).join('\n');
    }

    // catalog/unknown types: fallback to plain body
    return body;
}

function getValueByPath(obj, path) {
    try {
        if (!obj || !path) return '';
        const parts = String(path).split('.').map(p => p.trim()).filter(Boolean);
        let cur = obj;
        for (const part of parts) {
            if (cur == null) return '';
            if (Object.prototype.hasOwnProperty.call(cur, part)) {
                cur = cur[part];
            } else {
                return '';
            }
        }
        if (cur == null) return '';
        return String(cur);
    } catch {
        return '';
    }
}

function applyRecipientTemplate(text, recipient) {
    const input = String(text || '');
    if (!input.includes('{{')) return input;

    const data = recipient && typeof recipient === 'object' ? recipient : {};

    return input.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_m, key) => {
        const k = String(key || '').trim();
        if (!k) return '';
        // Common aliases
        if (k === 'phone' || k === 'mobile') {
            const p = data.phone || data.phone_number || data.to_phone_number || data.number || data.end_user_phone || '';
            return String(p || '');
        }
        return getValueByPath(data, k);
    });
}

function applyRecipientTemplateToInteractivePayload(payload, recipient) {
    if (!payload || typeof payload !== 'object') return null;
    const type = String(payload.type || '').toLowerCase();
    const out = { ...payload };

    if (out.header != null) out.header = applyRecipientTemplate(String(out.header), recipient);
    if (out.title != null) out.title = applyRecipientTemplate(String(out.title), recipient);
    if (out.footer != null) out.footer = applyRecipientTemplate(String(out.footer), recipient);

    if (type === 'buttons') {
        if (out.body != null) out.body = applyRecipientTemplate(String(out.body), recipient);
        if (out.text != null) out.text = applyRecipientTemplate(String(out.text), recipient);
        if (Array.isArray(out.buttons)) {
            out.buttons = out.buttons.map((b) => {
                if (!b || typeof b !== 'object') return b;
                const bb = { ...b };
                if (bb.title != null) bb.title = applyRecipientTemplate(String(bb.title), recipient);
                if (bb.text != null) bb.text = applyRecipientTemplate(String(bb.text), recipient);
                if (bb.body != null) bb.body = applyRecipientTemplate(String(bb.body), recipient);
                return bb;
            });
        }
    }

    if (type === 'list') {
        if (out.body != null) out.body = applyRecipientTemplate(String(out.body), recipient);
        if (out.text != null) out.text = applyRecipientTemplate(String(out.text), recipient);
        if (out.buttonText != null) out.buttonText = applyRecipientTemplate(String(out.buttonText), recipient);
        if (Array.isArray(out.sections)) {
            out.sections = out.sections.map((s) => {
                if (!s || typeof s !== 'object') return s;
                const ss = { ...s };
                if (ss.title != null) ss.title = applyRecipientTemplate(String(ss.title), recipient);
                if (Array.isArray(ss.rows)) {
                    ss.rows = ss.rows.map((r) => {
                        if (!r || typeof r !== 'object') return r;
                        const rr = { ...r };
                        if (rr.title != null) rr.title = applyRecipientTemplate(String(rr.title), recipient);
                        if (rr.text != null) rr.text = applyRecipientTemplate(String(rr.text), recipient);
                        if (rr.description != null) rr.description = applyRecipientTemplate(String(rr.description), recipient);
                        return rr;
                    });
                }
                return ss;
            });
        }
    }

    return out;
}

/**
 * POST /api/broadcast/send
 * Send or schedule a broadcast message to multiple recipients
 * 
 * PRIORITY: User Preference (Waha/Desktop) → Desktop Agent (FREE) → Maytapi (PAID FALLBACK)
 */
router.post('/send', async (req, res) => {
    try {
        const { 
            tenantId, 
            campaignName, 
            message, 
            recipients, 
            messageType, 
            scheduleType, 
            scheduleTime,
            imageBase64,
            imageBase64List,
            interactive,
            interactiveMessage,
            messagePayload,
            templateId,
            template_id,
            batchSize = 10,
            messageDelay = 500,
            batchDelay = 2000,
            forceMethod, // 'desktop_agent', 'waha', or 'maytapi' - for testing
            botDeliveryMethod // From frontend: 'desktop' or 'cloud' (Waha)
        } = req.body;

        let normalizedMessageType = String(messageType || 'text').trim().toLowerCase();

        // Accept interactive payload from multiple keys; also allow `message` itself to be an object.
        let interactivePayload =
            (interactive && typeof interactive === 'object' ? interactive : null) ||
            (interactiveMessage && typeof interactiveMessage === 'object' ? interactiveMessage : null) ||
            (messagePayload && typeof messagePayload === 'object' ? messagePayload : null) ||
            (message && typeof message === 'object' ? message : null);

        let baseBodyText = (typeof message === 'string' && message.trim())
            ? String(message)
            : String(interactivePayload?.body || interactivePayload?.text || interactivePayload?.message || '').trim();

        const normalizedImageList = Array.isArray(imageBase64List)
            ? imageBase64List.filter(Boolean)
            : (Array.isArray(req.body?.imagesBase64) ? req.body.imagesBase64.filter(Boolean) : []);
        let firstImageBase64 = normalizedImageList.length ? normalizedImageList[0] : (imageBase64 || null);
        let allImageBase64 = normalizedImageList.length ? normalizedImageList : (imageBase64 ? [imageBase64] : []);

        // Optional: drive broadcast from a saved template (including interactive payload)
        const effectiveTemplateId = templateId || template_id || req.body?.templateId || req.body?.template_id || null;
        if (effectiveTemplateId) {
            try {
                const { data: tpl, error: tplErr } = await dbClient
                    .from('message_templates')
                    .select('id, tenant_id, template_text, message_type, image_url, interactive_payload')
                    .eq('id', effectiveTemplateId)
                    .eq('tenant_id', tenantId)
                    .single();

                if (!tplErr && tpl) {
                    if (!baseBodyText) {
                        baseBodyText = String(tpl.template_text || '').trim();
                    }

                    if ((normalizedMessageType === 'text' || !normalizedMessageType) && tpl.message_type) {
                        normalizedMessageType = String(tpl.message_type || 'text').trim().toLowerCase();
                    }

                    if ((!firstImageBase64 || !allImageBase64.length) && tpl.image_url) {
                        firstImageBase64 = String(tpl.image_url);
                        allImageBase64 = [String(tpl.image_url)];
                    }

                    if (!interactivePayload && tpl.interactive_payload) {
                        try {
                            const parsed = typeof tpl.interactive_payload === 'string' ? JSON.parse(tpl.interactive_payload) : tpl.interactive_payload;
                            if (parsed && typeof parsed === 'object') {
                                interactivePayload = parsed;
                            }
                        } catch (_) {
                            // ignore
                        }
                    }
                }
            } catch (_) {
                // Best-effort: template lookup should not block sending
            }
        }

        // If we loaded an interactive payload template without template_text,
        // still allow broadcasts by using the payload's body/text as the base body.
        if (!baseBodyText) {
            baseBodyText = String(interactivePayload?.body || interactivePayload?.text || interactivePayload?.message || '').trim();
        }

        const isInteractive = (normalizedMessageType === 'buttons' || normalizedMessageType === 'list' || normalizedMessageType === 'catalog');

        console.log('[BROADCAST_API] Request:', { 
            tenantId, 
            campaignName, 
            recipientCount: recipients?.length, 
            messageType, 
            scheduleType,
            batchSize,
            messageDelay,
            batchDelay,
            forceMethod,
            botDeliveryMethod
        });

        // Validate required fields
        if (!tenantId || !campaignName || !recipients || recipients.length === 0 || !baseBodyText) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields: tenantId, campaignName, message (or interactive body/text), recipients'
            });
        }

        // Base URL used for tracked links. Prefer forwarded headers when behind a proxy.
        const requestProto = String((req.headers['x-forwarded-proto'] || req.protocol || 'http')).split(',')[0].trim();
        const requestHost = String((req.headers['x-forwarded-host'] || req.get('host') || '')).split(',')[0].trim();
        const requestBaseUrl = requestHost ? `${requestProto}://${requestHost}` : null;

        // Normalize recipients STRICTLY (digits only, length 10-15; add 91 for 10-digit)
        const normalizeRecipientStrict = (value) => {
            if (!value) return null;
            const digits = String(value).replace(/\D/g, '');
            if (digits.length < 10) return null;
            let normalized = digits;
            if (normalized.length === 10) normalized = '91' + normalized;
            if (normalized.length < 10 || normalized.length > 15) return null;
            return normalized;
        };

        // Preserve recipient metadata for {{variable}} substitution
        const recipientEntries = (recipients || [])
            .map((r) => {
                if (r && typeof r === 'object') {
                    const rawPhone = r.phone || r.phone_number || r.to_phone_number || r.number || r.mobile || r.whatsapp || r.end_user_phone;
                    const phone = normalizeRecipientStrict(rawPhone);
                    if (!phone) return null;
                    return { phone, recipient: r };
                }
                const phone = normalizeRecipientStrict(r);
                if (!phone) return null;
                return { phone, recipient: { phone } };
            })
            .filter(Boolean);

        const normalizedRecipients = recipientEntries.map(e => e.phone);
        if (normalizedRecipients.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'No valid recipient phone numbers after normalization'
            });
        }

        // Enforce opt-out list before attempting any delivery method
        let allowedRecipients = normalizedRecipients;
        let allowedRecipientEntries = recipientEntries;
        let skippedRecipients = [];
        let skippedDailyLimitRecipients = [];
        try {
            const filtered = await filterUnsubscribed(normalizedRecipients);
            allowedRecipients = filtered.allowed;
            skippedRecipients = filtered.skipped;

            const allowedSet = new Set(allowedRecipients);
            allowedRecipientEntries = recipientEntries.filter(e => allowedSet.has(e.phone));
        } catch (e) {
            console.warn('[BROADCAST_API] Warning: unsubscribe filter failed, proceeding:', e?.message || e);
        }

        if (allowedRecipients.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'All recipients are unsubscribed. No messages were sent or scheduled.',
                details: {
                    total: normalizedRecipients.length,
                    skipped_unsubscribed: skippedRecipients.length,
                    attempted: 0,
                }
            });
        }

        // Get tenant info
        const { data: tenant, error: tenantError } = await dbClient
            .from('tenants')
            .select('id, business_name, phone_number, daily_message_limit')
            .eq('id', tenantId)
            .single();

        if (tenantError || !tenant) {
            console.error('[BROADCAST_API] Tenant not found:', tenantError);
            return res.status(404).json({
                success: false,
                error: 'Tenant not found',
                details: tenantError?.message
            });
        }

        // Enforce daily message limit for immediate sending paths.
        // (Maytapi scheduling also enforces internally, but WA Web/Waha/Desktop send directly.)
        if (scheduleType === 'now') {
            try {
                const dailyLimit = tenant?.daily_message_limit || 1000;
                const today = new Date();
                today.setHours(0, 0, 0, 0);

                const { data: sentRows, error: sentErr } = await dbClient
                    .from('bulk_schedules')
                    .select('id')
                    .eq('tenant_id', tenantId)
                    .eq('status', 'sent')
                    .gte('delivered_at', today.toISOString());

                if (!sentErr) {
                    const sentToday = sentRows?.length || 0;
                    const remainingMessages = Math.max(0, dailyLimit - sentToday);

                    // Cost model: 1 recipient = 1 message for text, or N messages for N images.
                    const perRecipientCost = (messageType === 'image')
                        ? Math.max(1, allImageBase64.length || (firstImageBase64 ? 1 : 0))
                        : 1;

                    const maxRecipientsAllowed = perRecipientCost > 0
                        ? Math.floor(remainingMessages / perRecipientCost)
                        : 0;

                    if (maxRecipientsAllowed <= 0) {
                        return res.status(429).json({
                            success: false,
                            error: 'Daily message limit reached. Try again tomorrow or increase your daily limit.',
                            details: {
                                total: normalizedRecipients.length,
                                skipped_unsubscribed: skippedRecipients.length,
                                attempted: 0,
                                daily_limit: dailyLimit,
                                sent_today: sentToday,
                                remaining: remainingMessages
                            }
                        });
                    }

                    if (allowedRecipients.length > maxRecipientsAllowed) {
                        skippedDailyLimitRecipients = allowedRecipients.slice(maxRecipientsAllowed);
                        allowedRecipients = allowedRecipients.slice(0, maxRecipientsAllowed);

                        const allowedSet = new Set(allowedRecipients);
                        allowedRecipientEntries = allowedRecipientEntries.filter(e => allowedSet.has(e.phone));
                    }
                } else {
                    console.warn('[BROADCAST_API] Warning: daily limit count failed, proceeding:', sentErr?.message || sentErr);
                }
            } catch (e) {
                console.warn('[BROADCAST_API] Warning: daily limit enforcement failed, proceeding:', e?.message || e);
            }
        }

        // Priority 0: Check user preference for cloud bot (Waha 24/7)
        if (botDeliveryMethod === 'cloud' && forceMethod !== 'desktop_agent' && forceMethod !== 'maytapi') {
            console.log('[BROADCAST_API] ☁️ User selected Cloud Bot (Waha 24/7) - Using Waha!');
            
            try {
                const campaignId = `campaign_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
                const sendAt = new Date().toISOString();

                let messageToSend = baseBodyText;
                try {
                    if (requestBaseUrl) {
                        const rewritten = await createTrackedLinksAndRewriteMessage({
                            tenantId,
                            campaignId,
                            message: baseBodyText,
                            baseUrl: requestBaseUrl
                        });
                        if (rewritten?.message) messageToSend = rewritten.message;
                    }
                } catch (e) {
                    // Best-effort
                }

                const finalTextToSend = isInteractive
                    ? renderInteractiveFallbackText({ type: normalizedMessageType, payload: interactivePayload, bodyText: messageToSend })
                    : messageToSend;

                const hasTemplateVars = String(finalTextToSend || '').includes('{{');
                const wahaRecipients = hasTemplateVars
                    ? allowedRecipientEntries.map((e) => ({
                        phone: e.phone,
                        message: applyRecipientTemplate(finalTextToSend, e.recipient || { phone: e.phone })
                    }))
                    : allowedRecipients;

                const result = await sendBroadcastViaWaha(
                    'default', // Session name
                    wahaRecipients,
                    finalTextToSend,
                    (normalizedMessageType === 'image' ? (allImageBase64.length ? allImageBase64 : firstImageBase64) : null),
                    { batchSize, messageDelay, batchDelay }
                );
                
                if (result.success) {
                    // Persist history + per-contact report for WAHA sends (immediate path)
                    try {
                        const now = new Date().toISOString();

                        const perRecipient = [];
                        for (const to of skippedRecipients) perRecipient.push({ phone: to, status: 'skipped', error_message: 'User unsubscribed', sent_at: null });
                        for (const to of skippedDailyLimitRecipients) perRecipient.push({ phone: to, status: 'skipped', error_message: 'Daily limit reached', sent_at: null });

                        const byPhone = new Map();
                        for (const r of (result.results || [])) {
                            const phone = String(r.phone || '').replace(/\D/g, '') || String(r.phone || r.recipient || '');
                            if (!phone) continue;
                            if (r.skipped) {
                                byPhone.set(phone, { phone, status: 'skipped', error_message: r.reason || 'Skipped', sent_at: null });
                            } else if (r.success) {
                                byPhone.set(phone, { phone, status: 'sent', error_message: null, sent_at: now });
                            } else {
                                byPhone.set(phone, { phone, status: 'failed', error_message: r.error || 'Failed', sent_at: null });
                            }
                        }

                        for (const entry of allowedRecipientEntries) {
                            const to = entry.phone;
                            const base = byPhone.get(String(to)) || { phone: to, status: 'sent', error_message: null, sent_at: now };
                            if (hasTemplateVars) {
                                base.message = applyRecipientTemplate(finalTextToSend, entry.recipient || { phone: to });
                            }
                            perRecipient.push(base);
                        }

                        const historyFirstImage = (messageType === 'image' && allImageBase64.length) ? allImageBase64[0] : null;
                        const scheduleRecords = perRecipient.map((r, idx) => ({
                            tenant_id: tenantId,
                            name: String(campaignName || '').slice(0, 255),
                            phone_number: r.phone,
                            to_phone_number: r.phone,
                            campaign_id: campaignId,
                            campaign_name: String(campaignName || '').slice(0, 255),
                            message_text: String((r.message || messageToSend) || '').slice(0, 4096),
                            message_body: String((r.message || messageToSend) || '').slice(0, 4096),
                            image_url: historyFirstImage,
                            media_url: historyFirstImage,
                            scheduled_at: sendAt,
                            status: r.status,
                            delivery_status: r.status === 'sent' ? 'delivered' : r.status,
                            error_message: r.error_message || null,
                            retry_count: 0,
                            sequence_number: idx + 1,
                            created_at: now,
                            updated_at: now,
                            processed_at: now,
                            delivered_at: r.status === 'sent' ? now : null
                        }));

                        await dbClient.from('bulk_schedules').insert(scheduleRecords);
                        await insertRecipientTrackingRows({ tenantId, campaignId, rows: perRecipient.map((r) => ({ phone: r.phone, status: r.status, sent_at: r.sent_at, error_message: r.error_message })) });
                    } catch (persistErr) {
                        console.warn('[BROADCAST_API] Warning: Failed to persist WAHA history/report:', persistErr?.message || persistErr);
                    }

                    return res.json({
                        success: true,
                        message: `Broadcast sent via Waha Cloud Bot (24/7)! ${result.totalSent} sent, ${result.totalFailed} failed.${skippedRecipients.length ? ` ${skippedRecipients.length} skipped (unsubscribed).` : ''}${skippedDailyLimitRecipients.length ? ` ${skippedDailyLimitRecipients.length} skipped (daily limit).` : ''}`,
                        method: 'waha',
                        details: {
                            total: normalizedRecipients.length,
                            attempted: allowedRecipients.length,
                            sent: result.totalSent,
                            failed: result.totalFailed,
                            skipped_unsubscribed: skippedRecipients.length,
                            skipped_daily_limit: skippedDailyLimitRecipients.length,
                            successRate: result.summary?.successRate,
                            status: 'completed'
                        }
                    });
                }
            } catch (wahaError) {
                console.log('[BROADCAST_API] ⚠️ Waha failed:', wahaError.message);
                // Fall through to desktop agent or Maytapi
            }
        }

        // Priority 0.5: WhatsApp Web (FREE) when connected
        // If Desktop Agent is offline, this prevents falling back to queued Maytapi sends.
        if (scheduleType === 'now' && forceMethod !== 'maytapi' && forceMethod !== 'waha') {
            const waWebStatus = getClientStatus(tenantId);
            if (waWebStatus?.status === 'ready' && waWebStatus?.hasClient) {
                console.log('[BROADCAST_API] ✅ WhatsApp Web READY - sending directly');

                const batchSz = Math.max(1, parseInt(batchSize || 10, 10) || 10);
                const msgDelay = Math.max(0, parseInt(messageDelay || 0, 10) || 0);
                const bDelay = Math.max(0, parseInt(batchDelay || 0, 10) || 0);

                const campaignId = `campaign_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
                const sendAt = new Date().toISOString();

                let messageToSend = baseBodyText;
                try {
                    if (requestBaseUrl) {
                        const rewritten = await createTrackedLinksAndRewriteMessage({
                            tenantId,
                            campaignId,
                            message: baseBodyText,
                            baseUrl: requestBaseUrl
                        });
                        if (rewritten?.message) messageToSend = rewritten.message;
                    }
                } catch (e) {}

                const finalTextToSend = isInteractive
                    ? renderInteractiveFallbackText({ type: normalizedMessageType, payload: interactivePayload, bodyText: messageToSend })
                    : messageToSend;

                let totalSent = 0;
                let totalFailed = 0;
                const failures = [];
                const perRecipient = [];

                // Record unsubscribed as skipped
                for (const to of skippedRecipients) {
                    perRecipient.push({ to, status: 'skipped', error: 'User unsubscribed' });
                }

                // Record daily limit skips
                for (const to of skippedDailyLimitRecipients) {
                    perRecipient.push({ to, status: 'skipped', error: 'Daily limit reached' });
                }

                for (let i = 0; i < allowedRecipientEntries.length; i++) {
                    const entry = allowedRecipientEntries[i];
                    const to = entry.phone;
                    const recipientMeta = entry.recipient || { phone: to };
                    try {
                        const personalizedTextToSend = applyRecipientTemplate(finalTextToSend, recipientMeta);

                        if (normalizedMessageType === 'image' && allImageBase64.length) {
                            await sendWebMessageWithMedia(tenantId, to, personalizedTextToSend, allImageBase64[0]);
                            for (let j = 1; j < allImageBase64.length; j++) {
                                await sendWebMessageWithMedia(tenantId, to, '', allImageBase64[j]);
                            }
                        } else if (normalizedMessageType === 'buttons') {
                            try {
                                const basePayload = { ...(interactivePayload || {}), type: 'buttons', body: messageToSend, text: messageToSend };
                                const p = applyRecipientTemplateToInteractivePayload(basePayload, recipientMeta);
                                await sendWebButtonsMessage(tenantId, to, p);
                            } catch (e) {
                                await sendWebMessage(tenantId, to, personalizedTextToSend);
                            }
                        } else if (normalizedMessageType === 'list') {
                            try {
                                const basePayload = { ...(interactivePayload || {}), type: 'list', body: messageToSend, text: messageToSend };
                                const p = applyRecipientTemplateToInteractivePayload(basePayload, recipientMeta);
                                await sendWebListMessage(tenantId, to, p);
                            } catch (e) {
                                await sendWebMessage(tenantId, to, personalizedTextToSend);
                            }
                        } else {
                            await sendWebMessage(tenantId, to, personalizedTextToSend);
                        }
                        totalSent++;
                        perRecipient.push({ to, status: 'sent', error: null, message: personalizedTextToSend });
                    } catch (e) {
                        totalFailed++;
                        perRecipient.push({ to, status: 'failed', error: e?.message || String(e), message: null });
                        if (failures.length < 5) {
                            failures.push({ to, error: e?.message || String(e) });
                        }
                    }

                    // Per-message delay
                    if (msgDelay > 0 && i < allowedRecipientEntries.length - 1) {
                        await new Promise(r => setTimeout(r, msgDelay));
                    }

                    // Per-batch delay
                    const atBatchEnd = ((i + 1) % batchSz === 0);
                    if (bDelay > 0 && atBatchEnd && i < allowedRecipientEntries.length - 1) {
                        await new Promise(r => setTimeout(r, bDelay));
                    }
                }

                if (totalSent === 0 && totalFailed > 0) {
                    return res.status(500).json({
                        success: false,
                        error: failures[0]?.error || 'All WhatsApp Web sends failed',
                        method: 'whatsapp-web',
                        details: { total: normalizedRecipients.length, attempted: allowedRecipients.length, sent: 0, failed: totalFailed, skipped_unsubscribed: skippedRecipients.length, failures }
                    });
                }

                // Save broadcast history so dashboard "Recent Broadcasts" shows this send
                try {
                    const now = new Date().toISOString();
                    const historyFirstImage = (normalizedMessageType === 'image' && allImageBase64.length) ? allImageBase64[0] : null;
                    const scheduleRecords = perRecipient.map((r, idx) => ({
                        tenant_id: tenantId,
                        name: String(campaignName || '').slice(0, 255),
                        phone_number: r.to,
                        to_phone_number: r.to,
                        campaign_id: campaignId,
                        campaign_name: String(campaignName || '').slice(0, 255),
                        message_text: String((r.message || finalTextToSend) || '').slice(0, 4096),
                        message_body: String((r.message || finalTextToSend) || '').slice(0, 4096),
                        message_type: isInteractive ? 'text' : (normalizedMessageType || 'text'),
                        image_url: historyFirstImage,
                        media_url: historyFirstImage,
                        scheduled_at: sendAt,
                        status: r.status,
                        delivery_status: r.status === 'sent' ? 'delivered' : r.status,
                        error_message: r.error || null,
                        retry_count: 0,
                        sequence_number: idx + 1,
                        created_at: now,
                        updated_at: now,
                        processed_at: now,
                        delivered_at: r.status === 'sent' ? now : null
                    }));

                    const { error: histErr } = await dbClient
                        .from('bulk_schedules')
                        .insert(scheduleRecords);
                    if (histErr) {
                        console.warn('[BROADCAST_API] Warning: Failed to save WhatsApp Web broadcast history:', histErr);
                    }

                    // Save per-contact report rows
                    await insertRecipientTrackingRows({
                        tenantId,
                        campaignId,
                        rows: perRecipient.map((r) => ({
                            phone: r.to,
                            status: r.status,
                            sent_at: r.status === 'sent' ? now : null,
                            error_message: r.error || null
                        }))
                    });
                } catch (histCatch) {
                    console.warn('[BROADCAST_API] Warning: Failed to save WhatsApp Web broadcast history:', histCatch?.message || histCatch);
                }

                return res.json({
                    success: true,
                    message: `Broadcast sent via WhatsApp Web! ${totalSent} sent, ${totalFailed} failed.${skippedRecipients.length ? ` ${skippedRecipients.length} skipped (unsubscribed).` : ''}${skippedDailyLimitRecipients.length ? ` ${skippedDailyLimitRecipients.length} skipped (daily limit).` : ''}`,
                    method: 'whatsapp-web',
                    details: {
                        total: normalizedRecipients.length,
                        attempted: allowedRecipients.length,
                        sent: totalSent,
                        failed: totalFailed,
                        skipped_unsubscribed: skippedRecipients.length,
                        skipped_daily_limit: skippedDailyLimitRecipients.length,
                        failures: failures.length ? failures : undefined,
                        status: 'completed'
                    }
                });
            }
        }

        // Priority 1: Try Desktop Agent (FREE!)
        if (forceMethod !== 'maytapi' && forceMethod !== 'waha') {
            console.log('[BROADCAST_API] 🔍 Checking desktop agent availability...');
            
            const agentOnline = await isDesktopAgentOnline(tenantId);
            
            if (agentOnline) {
                console.log('[BROADCAST_API] ✅ Desktop Agent ONLINE - Using FREE local WhatsApp!');

                const campaignId = `campaign_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

                let messageToSend = baseBodyText;
                try {
                    if (requestBaseUrl) {
                        const rewritten = await createTrackedLinksAndRewriteMessage({
                            tenantId,
                            campaignId,
                            message: baseBodyText,
                            baseUrl: requestBaseUrl
                        });
                        if (rewritten?.message) messageToSend = rewritten.message;
                    }
                } catch (e) {}

                const finalTextToSend = isInteractive
                    ? renderInteractiveFallbackText({ type: normalizedMessageType, payload: interactivePayload, bodyText: messageToSend })
                    : messageToSend;

                const hasTemplateVars = String(finalTextToSend || '').includes('{{');
                const desktopAgentRecipients = hasTemplateVars
                    ? allowedRecipientEntries.map((e) => ({
                        phone: e.phone,
                        message: applyRecipientTemplate(finalTextToSend, e.recipient || { phone: e.phone })
                    }))
                    : allowedRecipients;
                
                const broadcastData = {
                    recipients: desktopAgentRecipients,
                    message: finalTextToSend,
                    messageType: (isInteractive ? 'text' : (messageType || 'text')),
                    imageBase64: firstImageBase64,
                    imageBase64List: allImageBase64.length ? allImageBase64 : null,
                    batchSize,
                    messageDelay,
                    batchDelay
                };
                
                const result = await sendViaDesktopAgent(tenantId, broadcastData);
                
                if (result.success) {
                    // Save broadcast record to database for history
                    
                    console.log('[BROADCAST_API] Saving broadcast to database for history...');
                    
                    // Save each recipient to bulk_schedules table
                    const now = new Date().toISOString();

                    const resultMap = new Map();
                    for (const r of (result.results || [])) {
                        const phone = String(r.phone || r.to || r.number || '').replace(/\D/g, '') || String(r.phone || '');
                        if (!phone) continue;
                        resultMap.set(phone, {
                            status: r.status || (r.error ? 'failed' : 'sent'),
                            error_message: r.error || null
                        });
                    }

                    const perContact = [];
                    for (const to of skippedRecipients) perContact.push({ phone: to, status: 'skipped', error_message: 'User unsubscribed', sent_at: null });
                    for (const to of skippedDailyLimitRecipients) perContact.push({ phone: to, status: 'skipped', error_message: 'Daily limit reached', sent_at: null });
                    for (const entry of allowedRecipientEntries) {
                        const to = entry.phone;
                        const r = resultMap.get(String(to)) || { status: 'sent', error_message: null };
                        const personalized = hasTemplateVars
                            ? applyRecipientTemplate(finalTextToSend, entry.recipient || { phone: to })
                            : null;
                        perContact.push({
                            phone: to,
                            status: r.status === 'failed' ? 'failed' : 'sent',
                            error_message: r.error_message,
                            sent_at: r.status === 'failed' ? null : now,
                            message: personalized
                        });
                    }

                    const hasAnyImage = messageType === 'image' && !!firstImageBase64;
                    const scheduleRecords = [
                        ...perContact.map((row, idx) => ({
                        tenant_id: tenantId,
                        name: campaignName,
                        phone_number: row.phone,
                        to_phone_number: row.phone,
                        campaign_id: campaignId,
                        campaign_name: campaignName,
                        message_text: row.message || messageToSend,
                        message_body: row.message || messageToSend,
                        image_url: hasAnyImage ? 'data:image/png;base64,...' : null,
                        media_url: hasAnyImage ? 'data:image/png;base64,...' : null,
                        scheduled_at: now,
                        status: row.status,
                        delivery_status: row.status === 'sent' ? 'delivered' : row.status,
                        error_message: row.error_message || null,
                        retry_count: 0,
                        sequence_number: idx + 1,
                        created_at: now,
                        updated_at: now,
                        processed_at: now,
                        delivered_at: row.status === 'sent' ? now : null,
                    })),
                    ];
                    
                    const { error: insertError } = await dbClient
                        .from('bulk_schedules')
                        .insert(scheduleRecords);
                    
                    if (insertError) {
                        console.error('[BROADCAST_API] Warning: Failed to save broadcast history:', insertError);
                    } else {
                        console.log('[BROADCAST_API] ✅ Broadcast history saved successfully');
                    }

                    // Save per-contact report rows
                    await insertRecipientTrackingRows({
                        tenantId,
                        campaignId,
                        rows: perContact.map((r) => ({ phone: r.phone, status: r.status, sent_at: r.sent_at, error_message: r.error_message }))
                    });
                    
                    return res.json({
                        success: true,
                        message: `Broadcast sent via Desktop Agent (FREE)! ${result.totalSent} sent, ${result.totalFailed} failed.${skippedRecipients.length ? ` ${skippedRecipients.length} skipped (unsubscribed).` : ''}${skippedDailyLimitRecipients.length ? ` ${skippedDailyLimitRecipients.length} skipped (daily limit).` : ''}`,
                        method: 'desktop_agent',
                        details: {
                            total: normalizedRecipients.length,
                            attempted: allowedRecipients.length,
                            sent: result.totalSent,
                            failed: result.totalFailed,
                            skipped_unsubscribed: skippedRecipients.length,
                            skipped_daily_limit: skippedDailyLimitRecipients.length,
                            successRate: result.summary?.successRate,
                            status: 'completed'
                        }
                    });
                } else {
                    console.log('[BROADCAST_API] ⚠️ Desktop Agent failed, falling back to Maytapi...');
                }
            } else {
                console.log('[BROADCAST_API] ⚠️ Desktop Agent OFFLINE - Falling back to Maytapi (PAID)');
            }
        }

        // Priority 2: Fallback to Maytapi (PAID)
        console.log('[BROADCAST_API] 💰 Using Maytapi (PAID service)');
        
        const phoneNumberId = tenant.phone_number;

        if (scheduleType === 'now') {
            // Use the broadcastService to schedule the messages
            const { scheduleBroadcast } = require('../../services/broadcastService');
            
            console.log('[BROADCAST_API] Scheduling broadcast via broadcastService (Maytapi)');
            
            try {
                const finalTextToSend = (normalizedMessageType === 'buttons' || normalizedMessageType === 'list' || normalizedMessageType === 'catalog')
                    ? renderInteractiveFallbackText({ type: normalizedMessageType, payload: interactivePayload, bodyText: baseBodyText })
                    : baseBodyText;

                const hasTemplateVars = String(finalTextToSend || '').includes('{{');
                const maytapiRecipients = hasTemplateVars
                    ? allowedRecipientEntries.map((e) => ({
                        phone: e.phone,
                        message: applyRecipientTemplate(finalTextToSend, e.recipient || { phone: e.phone })
                    }))
                    : allowedRecipients;

                const result = await scheduleBroadcast(
                    tenantId,
                    campaignName,
                    finalTextToSend,
                    new Date().toISOString(), // Send now
                    maytapiRecipients,
                    firstImageBase64 // Image URL/base64 (Maytapi supports single media)
                );
                
                // scheduleBroadcast returns a string message
                console.log('[BROADCAST_API] Broadcast scheduled:', result);
                
                // Check if it's an error message
                if (result.includes('error') || result.includes('failed') || result.includes('No valid')) {
                    return res.status(400).json({
                        success: false,
                        error: result
                    });
                }
                
                return res.json({
                    success: true,
                    message: `Broadcast queued via Maytapi! Processing ${allowedRecipients.length} recipients in background.${skippedRecipients.length ? ` ${skippedRecipients.length} skipped (unsubscribed).` : ''}${skippedDailyLimitRecipients.length ? ` ${skippedDailyLimitRecipients.length} skipped (daily limit).` : ''}`,
                    method: 'maytapi',
                    details: {
                        total: normalizedRecipients.length,
                        attempted: allowedRecipients.length,
                        skipped_unsubscribed: skippedRecipients.length,
                        skipped_daily_limit: skippedDailyLimitRecipients.length,
                        status: 'queued',
                        result: result
                    }
                });
            } catch (err) {
                console.error('[BROADCAST_API] Failed to schedule broadcast:', err);
                return res.status(500).json({
                    success: false,
                    error: 'Failed to queue broadcast: ' + err.message
                });
            }
        } else {
            // Schedule for later (existing code)
            const scheduledTime = new Date(scheduleTime);


            
            if (isNaN(scheduledTime.getTime())) {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid schedule time format'
                });
            }

            const finalTextToSend = (normalizedMessageType === 'buttons' || normalizedMessageType === 'list' || normalizedMessageType === 'catalog')
                ? renderInteractiveFallbackText({ type: normalizedMessageType, payload: interactivePayload, bodyText: baseBodyText })
                : baseBodyText;

            // Schedule via bulk_schedules so the existing queue processor (processBroadcastQueue)
            // actually sends it later.
            const { scheduleBroadcast } = require('../../services/broadcastService');

            const hasTemplateVars = String(finalTextToSend || '').includes('{{');
            const maytapiRecipients = hasTemplateVars
                ? allowedRecipientEntries.map((e) => ({
                    phone: e.phone,
                    message: applyRecipientTemplate(finalTextToSend, e.recipient || { phone: e.phone })
                }))
                : allowedRecipients;

            const result = await scheduleBroadcast(
                tenantId,
                campaignName,
                finalTextToSend,
                scheduledTime.toISOString(),
                maytapiRecipients,
                firstImageBase64
            );

            // scheduleBroadcast returns a string result
            console.log('[BROADCAST_API] Broadcast scheduled:', { campaignName, scheduledTime });

            return res.json({
                success: true,
                message: String(result || `Broadcast scheduled for ${scheduledTime.toLocaleString()}`),
                method: 'maytapi',
                details: {
                    campaignName,
                    scheduledTime: scheduledTime.toISOString(),
                    recipientCount: allowedRecipients.length,
                    skipped_unsubscribed: skippedRecipients.length,
                    skipped_daily_limit: skippedDailyLimitRecipients.length
                }
            });
        }

    } catch (error) {
        console.error('[BROADCAST_API] Error:', error);
        return res.status(500).json({
            success: false,
            error: 'Internal server error',
            details: error.message
        });
    }
});

/**
 * GET /api/broadcast/history/:tenantId
 * Get broadcast history for a tenant with optional filtering
 * Query params: search (campaign name), status, dateFrom, dateTo
 */
router.get('/history/:tenantId', async (req, res) => {
    try {
        const { tenantId } = req.params;
        const { search, status, dateFrom, dateTo } = req.query;

        // Build query with filters
        let query = dbClient
            .from('bulk_schedules')
            .select('campaign_id, campaign_name, message_text, image_url, scheduled_at, status, created_at')
            .eq('tenant_id', tenantId);

        // Apply campaign name search
        if (search) {
            query = query.ilike('campaign_name', `%${search}%`);
        }

        // Apply status filter
        if (status) {
            query = query.eq('status', status);
        }

        // Apply date range filter
        if (dateFrom) {
            query = query.gte('created_at', dateFrom);
        }
        if (dateTo) {
            query = query.lte('created_at', dateTo);
        }

        const { data: campaigns, error } = await query.order('created_at', { ascending: false });

        if (error) {
            console.error('[BROADCAST_API] Error fetching history:', error);
            return res.status(500).json({
                success: false,
                error: 'Failed to fetch broadcast history'
            });
        }

        if (!campaigns || campaigns.length === 0) {
            return res.json({
                success: true,
                broadcasts: []
            });
        }

        // Group by campaign and aggregate stats
        const campaignMap = new Map();
        
        campaigns.forEach(item => {
            const key = item.campaign_id || `${item.campaign_name}_${item.created_at}`;
            
            if (!campaignMap.has(key)) {
                campaignMap.set(key, {
                    campaign_id: item.campaign_id,
                    campaign_name: item.campaign_name,
                    message_content: item.message_text,
                    image_url: item.image_url,
                    scheduled_at: item.scheduled_at,
                    created_at: item.created_at,
                    sent_at: item.created_at,
                    recipient_count: 0,
                    success_count: 0,
                    fail_count: 0,
                    status: 'pending'
                });
            }
            
            const campaign = campaignMap.get(key);
            campaign.recipient_count++;
            
            if (item.status === 'sent' || item.status === 'delivered') {
                campaign.success_count++;
            } else if (item.status === 'failed') {
                campaign.fail_count++;
            } else if (item.status === 'skipped') {
                campaign.skipped_count = (campaign.skipped_count || 0) + 1;
            }
            
            // Determine overall status
            const doneCount = campaign.success_count + campaign.fail_count + (campaign.skipped_count || 0);
            if (doneCount >= campaign.recipient_count) {
                campaign.status = 'completed';
            } else if (doneCount > 0) {
                campaign.status = 'processing';
            } else {
                campaign.status = 'pending';
            }
        });

        const broadcasts = Array.from(campaignMap.values())
            .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
            .slice(0, 20);

        return res.json({
            success: true,
            broadcasts
        });

    } catch (error) {
        console.error('[BROADCAST_API] Error:', error);
        return res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
});

/**
 * POST /api/broadcast/groups/save
 * Save a contact group for reuse
 */
router.post('/groups/save', async (req, res) => {
    try {
        const { tenantId, groupName, contacts } = req.body;
        const isLocalDb = process.env.USE_LOCAL_DB === 'true';

        if (!tenantId || !groupName || !contacts || contacts.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields: tenantId, groupName, contacts'
            });
        }

        // Normalize contacts on save to avoid legacy/invalid formats breaking delivery
        const normalizeRecipientStrict = (value) => {
            if (!value) return null;
            const digits = String(value).replace(/\D/g, '');
            if (digits.length < 10) return null;
            let normalized = digits;
            if (normalized.length === 10) normalized = '91' + normalized;
            if (normalized.length < 10 || normalized.length > 15) return null;
            return normalized;
        };

        const normalizedContacts = [...new Set((contacts || [])
            .map(c => (typeof c === 'object' && c ? (c.phone || c.phone_number || c.number) : c))
            .map(normalizeRecipientStrict)
            .filter(Boolean))];

        if (normalizedContacts.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'No valid contact phone numbers to save in this group'
            });
        }

        // Check if group name already exists for this tenant
        const { data: existing } = await dbClient
            .from('contact_groups')
            .select('id')
            .eq('tenant_id', tenantId)
            .eq('group_name', groupName)
            .single();

        if (existing) {
            return res.status(400).json({
                success: false,
                error: 'A group with this name already exists. Please choose a different name.'
            });
        }

        // Save the group
        const insertData = {
            tenant_id: tenantId,
            group_name: groupName,
            contacts: normalizedContacts,
            contact_count: normalizedContacts.length
        };
        // Back-compat for older local schemas that had `name` + UNIQUE(tenant_id, name)
        if (isLocalDb) insertData.name = groupName;

        const { data: group, error } = await dbClient
            .from('contact_groups')
            .insert(insertData)
            .select()
            .single();

        if (error) throw error;

        if (isLocalDb && group && typeof group.contacts === 'string') {
            try { group.contacts = JSON.parse(group.contacts); } catch (_) {}
        }
        if (group && !group.group_name && group.name) group.group_name = group.name;

        res.json({
            success: true,
            group: group
        });
    } catch (error) {
        console.error('[BROADCAST_API] Error saving contact group:', error);
        const msg = error?.message || 'Failed to save contact group';
        if (/UNIQUE constraint failed/i.test(msg) || /duplicate key value/i.test(msg)) {
            return res.status(400).json({
                success: false,
                error: 'A group with this name already exists. Please choose a different name.'
            });
        }
        res.status(500).json({
            success: false,
            error: msg
        });
    }
});

/**
 * GET /api/broadcast/groups/:tenantId
 * Get all contact groups for a tenant
 */
router.get('/groups/:tenantId', async (req, res) => {
    try {
        const { tenantId } = req.params;
        const isLocalDb = process.env.USE_LOCAL_DB === 'true';

        const { data: groups, error } = await dbClient
            .from('contact_groups')
            .select('*')
            .eq('tenant_id', tenantId)
            .order('created_at', { ascending: false });

        if (error) throw error;

        if (isLocalDb && Array.isArray(groups)) {
            for (const g of groups) {
                if (g && typeof g.contacts === 'string') {
                    try { g.contacts = JSON.parse(g.contacts); } catch (_) {}
                }
                if (g && !g.group_name && g.name) g.group_name = g.name;
            }
        }

        res.json({
            success: true,
            groups: groups || []
        });
    } catch (error) {
        console.error('[BROADCAST_API] Error fetching contact groups:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to fetch contact groups'
        });
    }
});

/**
 * DELETE /api/broadcast/groups/:groupId
 * Delete a contact group
 */
router.delete('/groups/:groupId', async (req, res) => {
    try {
        const { groupId } = req.params;

        const { error } = await dbClient
            .from('contact_groups')
            .delete()
            .eq('id', groupId);

        if (error) throw error;

        res.json({
            success: true,
            message: 'Group deleted successfully'
        });
    } catch (error) {
        console.error('[BROADCAST_API] Error deleting contact group:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to delete contact group'
        });
    }
});

/**
 * GET /api/broadcast/campaign-report/:campaignId
 * Get per-contact delivery report for a campaign
 */
router.get('/campaign-report/:campaignId', async (req, res) => {
    try {
        const { campaignId } = req.params;

        const { data: recipients, error } = await dbClient
            .from(RECIPIENT_TRACKING_TABLE)
            .select('phone, status, sent_at, error_message')
            .eq('campaign_id', campaignId)
            .order('phone', { ascending: true });

        if (error) throw error;

        // Get campaign summary
        const { data: campaign, error: campaignError } = await dbClient
            .from('bulk_schedules')
            .select('tenant_id, campaign_name, message_text, created_at')
            .eq('campaign_id', campaignId)
            .limit(1)
            .single();

        // Reply tracking: mark recipients who replied after the broadcast
        let recipientsWithReplies = recipients || [];
        try {
            const tenantId = campaign?.tenant_id;
            const campaignCreatedAt = campaign?.created_at ? new Date(campaign.created_at).toISOString() : null;
            const phones = (recipientsWithReplies || []).map((r) => String(r.phone || '').replace(/\D/g, '')).filter(Boolean);

            if (tenantId && campaignCreatedAt && phones.length) {
                const { data: inbound, error: inboundErr } = await dbClient
                    .from('inbound_messages')
                    .select('from_phone, body, received_at')
                    .eq('tenant_id', tenantId)
                    .in('from_phone', phones)
                    .gte('received_at', campaignCreatedAt)
                    .order('received_at', { ascending: false });

                if (!inboundErr && Array.isArray(inbound)) {
                    const lastReplyByPhone = new Map();
                    for (const m of inbound) {
                        const p = String(m.from_phone || '').replace(/\D/g, '');
                        if (!p) continue;
                        if (!lastReplyByPhone.has(p)) {
                            lastReplyByPhone.set(p, {
                                replied_at: m.received_at || null,
                                last_reply: typeof m.body === 'string' ? m.body : ''
                            });
                        }
                    }

                    recipientsWithReplies = recipientsWithReplies.map((r) => {
                        const p = String(r.phone || '').replace(/\D/g, '');
                        const ref = r.sent_at || campaignCreatedAt;
                        const lr = lastReplyByPhone.get(p);
                        const repliedAt = lr?.replied_at || null;
                        const replied = !!(repliedAt && ref && new Date(repliedAt) >= new Date(ref));
                        return {
                            ...r,
                            replied,
                            replied_at: replied ? repliedAt : null,
                            last_reply: replied ? (lr?.last_reply || '') : ''
                        };
                    });
                }
            }
        } catch (e) {
            // Best-effort
        }

        // Click tracking: aggregate tracked links for this campaign
        let trackedLinks = [];
        let clickStats = { links_tracked: 0, clicks_total: 0 };
        try {
            if (campaignId) {
                let q = dbClient
                    .from('tracked_links')
                    .select('original_url, short_code, click_count, last_clicked_at, created_at')
                    .eq('campaign_id', campaignId);
                if (campaign?.tenant_id) q = q.eq('tenant_id', campaign.tenant_id);
                const { data: links, error: linksErr } = await q.order('created_at', { ascending: true });
                if (!linksErr && Array.isArray(links)) {
                    trackedLinks = links;
                    clickStats.links_tracked = links.length;
                    clickStats.clicks_total = links.reduce((sum, l) => sum + Number(l?.click_count || 0), 0);
                }
            }
        } catch (e) {
            // Best-effort
        }

        res.json({
            success: true,
            campaign: {
                id: campaignId,
                name: campaign?.campaign_name || 'Unknown',
                message: campaign?.message_text || '',
                created_at: campaign?.created_at
            },
            recipients: recipientsWithReplies || [],
            tracked_links: trackedLinks,
            click_stats: clickStats,
            stats: {
                total: recipientsWithReplies?.length || 0,
                sent: recipientsWithReplies?.filter(r => r.status === 'sent').length || 0,
                failed: recipientsWithReplies?.filter(r => r.status === 'failed').length || 0,
                skipped: recipientsWithReplies?.filter(r => r.status === 'skipped').length || 0,
                pending: recipientsWithReplies?.filter(r => r.status === 'pending').length || 0,
                replied: recipientsWithReplies?.filter(r => r.replied).length || 0
            }
        });
    } catch (error) {
        console.error('[BROADCAST_API] Error fetching campaign report:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to fetch campaign report'
        });
    }
});

/**
 * GET /api/broadcast/campaign-report/:campaignId/export
 * Export campaign report as CSV
 */
router.get('/campaign-report/:campaignId/export', async (req, res) => {
    try {
        const { campaignId } = req.params;

        const { data: recipients, error } = await dbClient
            .from(RECIPIENT_TRACKING_TABLE)
            .select('phone, status, sent_at, error_message')
            .eq('campaign_id', campaignId)
            .order('phone', { ascending: true });

        if (error) throw error;

        // Get campaign summary
        const { data: campaign } = await dbClient
            .from('bulk_schedules')
            .select('tenant_id, campaign_name, message_text, created_at')
            .eq('campaign_id', campaignId)
            .limit(1)
            .single();

        // Reply tracking (best-effort)
        let replyByPhone = new Map();
        try {
            const tenantId = campaign?.tenant_id;
            const campaignCreatedAt = campaign?.created_at ? new Date(campaign.created_at).toISOString() : null;
            const phones = (recipients || []).map((r) => String(r.phone || '').replace(/\D/g, '')).filter(Boolean);
            if (tenantId && campaignCreatedAt && phones.length) {
                const { data: inbound, error: inboundErr } = await dbClient
                    .from('inbound_messages')
                    .select('from_phone, body, received_at')
                    .eq('tenant_id', tenantId)
                    .in('from_phone', phones)
                    .gte('received_at', campaignCreatedAt)
                    .order('received_at', { ascending: false });
                if (!inboundErr && Array.isArray(inbound)) {
                    for (const m of inbound) {
                        const p = String(m.from_phone || '').replace(/\D/g, '');
                        if (!p) continue;
                        if (!replyByPhone.has(p)) {
                            replyByPhone.set(p, {
                                replied_at: m.received_at || null,
                                last_reply: typeof m.body === 'string' ? m.body : ''
                            });
                        }
                    }
                }
            }
        } catch (_) {}

        // Generate CSV
        const csvHeader = 'Phone Number,Status,Sent At,Error Message,Replied,Replied At,Last Reply\n';
        const csvRows = recipients.map(r => {
            const sentAt = r.sent_at ? new Date(r.sent_at).toLocaleString() : '';
            const errorMsg = (r.error_message || '').replace(/,/g, ';').replace(/\n/g, ' ');
            const p = String(r.phone || '').replace(/\D/g, '');
            const ref = r.sent_at || campaign?.created_at || null;
            const rep = replyByPhone.get(p);
            const repliedAt = rep?.replied_at || '';
            const replied = !!(repliedAt && ref && new Date(repliedAt) >= new Date(ref));
            const repliedAtFmt = repliedAt ? new Date(repliedAt).toLocaleString() : '';
            const lastReply = (rep?.last_reply || '').replace(/,/g, ';').replace(/\n/g, ' ');
            return `${r.phone},${r.status},${sentAt},"${errorMsg}",${replied ? 'yes' : 'no'},${repliedAtFmt},"${lastReply}"`;
        }).join('\n');

        const csv = csvHeader + csvRows;

        // Set headers for download
        const filename = `campaign-${campaign?.campaign_name || campaignId}-${Date.now()}.csv`;
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(csv);
    } catch (error) {
        console.error('[BROADCAST_API] Error exporting campaign report:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to export campaign report'
        });
    }
});

/**
 * POST /api/broadcast/templates
 * Save a new message template
 */
router.post('/templates', async (req, res) => {
    try {
        const {
            tenantId,
            // Back-compat keys (existing callers)
            templateName,
            messageText,
            messageType,
            imageUrl,
            image_url,
            mediaUrl,
            media_url,
            // New/explicit keys
            name,
            templateText,
            category,
            variables,
            isActive,
            // Interactive template payload
            interactive,
            interactivePayload,
            interactive_payload,
            payload
        } = req.body;

        const finalName = (name || templateName || '').trim();
        const finalText = (templateText || messageText || '').trim();
        const finalCategory = (category || messageType || null);
        const finalMessageType = String((req.body.message_type || messageType || 'text') || 'text').trim().toLowerCase();
        const finalImageUrl = (imageUrl || image_url || mediaUrl || media_url || null);
        const finalVariables = variables != null ? variables : '[]';
        const finalIsActive = (isActive == null) ? 1 : (isActive ? 1 : 0);

        const rawInteractivePayload =
            (interactive && typeof interactive === 'object' ? interactive : null) ||
            (interactivePayload && typeof interactivePayload === 'object' ? interactivePayload : null) ||
            (payload && typeof payload === 'object' ? payload : null) ||
            (interactive_payload && typeof interactive_payload === 'object' ? interactive_payload : null);

        const finalInteractivePayload = rawInteractivePayload
            ? JSON.stringify({ ...rawInteractivePayload, type: rawInteractivePayload.type || finalMessageType })
            : null;

        if (!tenantId || !finalName || !finalText) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields: tenantId, templateName, messageText'
            });
        }

        const { data, error } = await dbClient
            .from('message_templates')
            .insert({
                tenant_id: tenantId,
                name: finalName,
                template_text: finalText,
                message_type: finalMessageType,
                image_url: finalImageUrl,
                interactive_payload: finalInteractivePayload,
                category: finalCategory,
                variables: finalVariables,
                is_active: finalIsActive,
                updated_at: new Date().toISOString()
            })
            .select()
            .single();

        if (error) throw error;

        res.json({
            success: true,
            template: data
        });
    } catch (error) {
        console.error('[BROADCAST_API] Error saving template:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to save template'
        });
    }
});

/**
 * GET /api/broadcast/templates/:tenantId
 * Get all message templates for a tenant
 */
router.get('/templates/:tenantId', async (req, res) => {
    try {
        const { tenantId } = req.params;

        const { data: templates, error } = await dbClient
            .from('message_templates')
            .select('*')
            .eq('tenant_id', tenantId)
            .order('created_at', { ascending: false });

        if (error) throw error;

        res.json({
            success: true,
            templates: templates || []
        });
    } catch (error) {
        console.error('[BROADCAST_API] Error fetching templates:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to fetch templates'
        });
    }
});

/**
 * PUT /api/broadcast/templates/:templateId
 * Update a message template
 */
router.put('/templates/:templateId', async (req, res) => {
    try {
        const { templateId } = req.params;
        const {
            // Back-compat keys
            templateName,
            messageText,
            messageType,
            imageUrl,
            image_url,
            mediaUrl,
            media_url,
            message_type,
            // New keys
            name,
            templateText,
            category,
            variables,
            isActive,
            // Interactive payload
            interactive,
            interactivePayload,
            interactive_payload,
            payload
        } = req.body;

        const updatePayload = {
            updated_at: new Date().toISOString()
        };

        const finalName = (name || templateName || '').trim();
        const finalText = (templateText || messageText || '').trim();

        if (finalName) updatePayload.name = finalName;
        if (finalText) updatePayload.template_text = finalText;

        if (category != null) updatePayload.category = category;
        else if (messageType != null) updatePayload.category = messageType;

        const finalMessageType = (message_type || messageType || null);
        const finalImageUrl = (imageUrl || image_url || mediaUrl || media_url);
        if (finalMessageType != null) updatePayload.message_type = finalMessageType;
        if (finalImageUrl != null) updatePayload.image_url = finalImageUrl;

        const rawInteractivePayload =
            (interactive && typeof interactive === 'object' ? interactive : null) ||
            (interactivePayload && typeof interactivePayload === 'object' ? interactivePayload : null) ||
            (payload && typeof payload === 'object' ? payload : null) ||
            (interactive_payload && typeof interactive_payload === 'object' ? interactive_payload : null);

        if (rawInteractivePayload != null) {
            const mt = String((finalMessageType || updatePayload.message_type || '').trim().toLowerCase());
            updatePayload.interactive_payload = JSON.stringify({ ...rawInteractivePayload, type: rawInteractivePayload.type || mt || undefined });
        }

        if (variables != null) updatePayload.variables = variables;
        if (isActive != null) updatePayload.is_active = isActive ? 1 : 0;

        if (!updatePayload.name && !updatePayload.template_text && updatePayload.category == null && updatePayload.variables == null && updatePayload.is_active == null && updatePayload.interactive_payload == null && updatePayload.message_type == null && updatePayload.image_url == null) {
            return res.status(400).json({ success: false, error: 'No fields provided to update' });
        }

        const { data, error } = await dbClient
            .from('message_templates')
            .update(updatePayload)
            .eq('id', templateId)
            .select()
            .single();

        if (error) throw error;

        res.json({ success: true, template: data });
    } catch (error) {
        console.error('[BROADCAST_API] Error updating template:', error);
        res.status(500).json({ success: false, error: error.message || 'Failed to update template' });
    }
});

/**
 * DELETE /api/broadcast/templates/:templateId
 * Delete a message template
 */
router.delete('/templates/:templateId', async (req, res) => {
    try {
        const { templateId } = req.params;

        const { error } = await dbClient
            .from('message_templates')
            .delete()
            .eq('id', templateId);

        if (error) throw error;

        res.json({
            success: true,
            message: 'Template deleted successfully'
        });
    } catch (error) {
        console.error('[BROADCAST_API] Error deleting template:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to delete template'
        });
    }
});

/**
 * PUT /api/broadcast/templates/:templateId/use
 * Increment template usage count
 */
router.put('/templates/:templateId/use', async (req, res) => {
    try {
        const { templateId } = req.params;

        // RPC isn't supported in SQLite wrapper; increment usage_count directly.
        const { data: template } = await dbClient
            .from('message_templates')
            .select('usage_count')
            .eq('id', templateId)
            .single();

        await dbClient
            .from('message_templates')
            .update({ usage_count: (template?.usage_count || 0) + 1, updated_at: new Date().toISOString() })
            .eq('id', templateId);

        res.json({ success: true });
    } catch (error) {
        console.error('[BROADCAST_API] Error updating template usage:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/broadcast/daily-stats/:tenantId
 * Get daily message usage statistics
 */
router.get('/daily-stats/:tenantId', async (req, res) => {
    try {
        const { tenantId } = req.params;
        
        // Get tenant's configured daily limit
        const { data: tenant, error: tenantError } = await dbClient
            .from('tenants')
            .select('daily_message_limit')
            .eq('id', tenantId)
            .single();
        
        const dailyLimit = tenant?.daily_message_limit || 1000;

        const { data: count, error } = await dbClient
            .rpc('get_daily_message_count', { p_tenant_id: tenantId });

        if (error) {
            // Fallback: count today's sent messages from bulk_schedules
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            
            const { data: messages, error: countError } = await dbClient
                .from('bulk_schedules')
                .select('id', { count: 'exact' })
                .eq('tenant_id', tenantId)
                .eq('status', 'sent')
                .gte('delivered_at', today.toISOString());

            const fallbackCount = messages?.length || 0;
            
            res.json({
                success: true,
                stats: {
                    sent_today: fallbackCount,
                    daily_limit: dailyLimit,
                    remaining: Math.max(0, dailyLimit - fallbackCount),
                    percentage_used: Math.round((fallbackCount / dailyLimit) * 100),
                    status: fallbackCount >= dailyLimit ? 'limit_reached' : 
                           fallbackCount > dailyLimit * 0.8 ? 'warning' : 'safe'
                }
            });
        } else {
            const currentCount = count || 0;
            res.json({
                success: true,
                stats: {
                    sent_today: currentCount,
                    daily_limit: dailyLimit,
                    remaining: Math.max(0, dailyLimit - currentCount),
                    percentage_used: Math.round((currentCount / dailyLimit) * 100),
                    status: currentCount >= dailyLimit ? 'limit_reached' : 
                           currentCount > dailyLimit * 0.8 ? 'warning' : 'safe'
                }
            });
        }
    } catch (error) {
        console.error('[BROADCAST_API] Error fetching daily stats:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to fetch daily stats'
        });
    }
});

// ---------------------------------------------------------------------------
// Unsubscribed (Opt-out) List
// NOTE: Current schema uses a global `unsubscribed_users` table keyed by phone_number.
// We keep tenantId in the route for dashboard/session alignment.
// ---------------------------------------------------------------------------

// GET /api/broadcast/unsubscribed/:tenantId?limit=500
router.get('/unsubscribed/:tenantId', async (req, res) => {
    try {
        const limitRaw = req.query.limit != null ? Number(req.query.limit) : 500;
        const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 2000) : 500;

        const { data, error } = await dbClient
            .from('unsubscribed_users')
            .select('phone_number, created_at')
            .order('created_at', { ascending: false })
            .limit(limit);

        if (error) throw error;

        return res.json({ success: true, items: data || [] });
    } catch (error) {
        console.error('[BROADCAST_API] Error fetching unsubscribed list:', error);
        return res.status(500).json({ success: false, error: error.message || 'Failed to fetch unsubscribed list' });
    }
});

// POST /api/broadcast/unsubscribed/:tenantId  body: { phone_number }
router.post('/unsubscribed/:tenantId', async (req, res) => {
    try {
        const raw = req.body?.phone_number;
        const phone = canonicalUnsubscribeKey(raw);
        if (!phone || phone.length < 10 || phone.length > 15) {
            return res.status(400).json({ success: false, error: 'Valid phone_number is required' });
        }

        const { data, error } = await dbClient
            .from('unsubscribed_users')
            .insert({ phone_number: phone })
            .select('*')
            .single();

        if (error) {
            const msg = String(error?.message || error || '').toLowerCase();
            if (msg.includes('unique') || msg.includes('constraint')) {
                return res.json({ success: true, item: { phone_number: phone } });
            }
            throw error;
        }

        return res.json({ success: true, item: data || { phone_number: phone } });
    } catch (error) {
        console.error('[BROADCAST_API] Error adding unsubscribed number:', error);
        return res.status(500).json({ success: false, error: error.message || 'Failed to add number' });
    }
});

// DELETE /api/broadcast/unsubscribed/:tenantId/:phoneNumber
router.delete('/unsubscribed/:tenantId/:phoneNumber', async (req, res) => {
    try {
        const raw = req.params?.phoneNumber;
        const phone = canonicalUnsubscribeKey(raw);
        if (!phone) return res.status(400).json({ success: false, error: 'phoneNumber is required' });

        const { error } = await dbClient
            .from('unsubscribed_users')
            .delete()
            .eq('phone_number', phone);

        if (error) throw error;

        return res.json({ success: true });
    } catch (error) {
        console.error('[BROADCAST_API] Error removing unsubscribed number:', error);
        return res.status(500).json({ success: false, error: error.message || 'Failed to remove number' });
    }
});

// Update tenant daily message limit
router.put('/daily-limit/:tenantId', async (req, res) => {
    try {
        const { tenantId } = req.params;
        const { dailyLimit } = req.body;
        
        if (!dailyLimit || dailyLimit < 100 || dailyLimit > 10000) {
            return res.status(400).json({
                success: false,
                error: 'Daily limit must be between 100 and 10,000'
            });
        }
        
        // Check if column exists first
        const { error: checkError } = await dbClient
            .from('tenants')
            .select('daily_message_limit')
            .eq('id', tenantId)
            .single();
        
        if (checkError && checkError.message.includes('column')) {
            return res.status(400).json({
                success: false,
                error: 'Please run the database migration first. See MULTIDAY_BROADCAST_GUIDE.md'
            });
        }
        
        const { error } = await dbClient
            .from('tenants')
            .update({ daily_message_limit: dailyLimit })
            .eq('id', tenantId);
        
        if (error) throw error;
        
        res.json({
            success: true,
            message: `Daily limit updated to ${dailyLimit} messages`,
            dailyLimit
        });
    } catch (error) {
        console.error('[BROADCAST_API] Error updating daily limit:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to update daily limit'
        });
    }
});

// Get tenant daily limit
router.get('/daily-limit/:tenantId', async (req, res) => {
    try {
        const { tenantId } = req.params;
        
        const { data: tenant, error } = await dbClient
            .from('tenants')
            .select('daily_message_limit')
            .eq('id', tenantId)
            .single();
        
        if (error) throw error;
        
        res.json({
            success: true,
            dailyLimit: tenant?.daily_message_limit || 1000
        });
    } catch (error) {
        console.error('[BROADCAST_API] Error fetching daily limit:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to fetch daily limit'
        });
    }
});

module.exports = router;



