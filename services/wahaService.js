const axios = require('axios');
const { toWhatsAppFormat, normalizePhone } = require('./phoneUtils');

const WAHA_URL = process.env.WAHA_URL || 'http://localhost:3000';
const WAHA_API_KEY = process.env.WAHA_API_KEY || 'your-secret-key';

async function wahaRequest(method, url, data = null, responseType = 'json') {
  const config = {
    method,
    url: `${WAHA_URL}${url}`,
    headers: {
      'Content-Type': 'application/json',
      // WAHA expects uppercase X-API-KEY
      'X-API-KEY': WAHA_API_KEY
    },
    responseType
  };

  if (data) {
    config.data = data;
  }

  return axios(config);
}

// Send broadcast via WAHA.
// Supports recipients as strings or objects ({ phone, message }).
// Supports single image (string) or multiple images (array of base64 strings).
async function sendBroadcastViaWaha(sessionName, recipients, message, imageBase64 = null, delays = {}) {
  const results = [];
  const batchSize = delays.batchSize || 10;
  const messageDelay = delays.messageDelay || 500;
  const batchDelay = delays.batchDelay || 2000;

  const images = Array.isArray(imageBase64)
    ? imageBase64.filter(Boolean)
    : (imageBase64 ? [imageBase64] : []);

  // Global opt-out enforcement (best-effort)
  let allowedRecipients = Array.isArray(recipients) ? recipients.slice() : [];
  let skippedUnsubscribed = 0;
  try {
    const { filterUnsubscribed, toDigits } = require('./unsubscribeService');
    const { isBypassNumber } = require('./outboundPolicy');

    const normalizedPhones = allowedRecipients
      .map((r) => (r && typeof r === 'object' ? (r.phone || r.phone_number || r.number || r.to || r.to_number) : r))
      .map((x) => toDigits(x) || x)
      .filter(Boolean);

    const bypassMap = new Map();
    for (const num of normalizedPhones) {
      try {
        bypassMap.set(num, await isBypassNumber(String(num)));
      } catch {
        bypassMap.set(num, false);
      }
    }

    const { allowed, skipped } = await filterUnsubscribed(normalizedPhones);
    const bypassed = skipped.filter((n) => bypassMap.get(n));
    skippedUnsubscribed = skipped.filter((n) => !bypassMap.get(n)).length;

    // Preserve original shape by keeping only recipients whose phone resolves into allowed/bypassed.
    const allowedSet = new Set(allowed.concat(bypassed));
    allowedRecipients = allowedRecipients.filter((r) => {
      const raw = r && typeof r === 'object' ? (r.phone || r.phone_number || r.number || r.to || r.to_number) : r;
      const digits = toDigits(raw) || raw;
      return allowedSet.has(digits);
    });

    // Record skipped recipients in results for visibility
    for (const n of skipped.filter((x) => !bypassMap.get(x))) {
      results.push({ phone: String(n), success: false, skipped: true, reason: 'unsubscribed' });
    }
  } catch (_) {
    // Fail-open if policy lookup fails
  }

  // Preflight: session must be WORKING
  try {
    const statusRes = await wahaRequest('GET', `/api/sessions/${sessionName}`);
    const sessionStatus = statusRes?.data?.status;
    if (sessionStatus !== 'WORKING') {
      throw new Error(`WAHA session '${sessionName}' not ready (status=${sessionStatus || 'unknown'})`);
    }
  } catch (e) {
    console.error('[WAHA_BROADCAST] Session preflight failed:', e.response?.data || e.message);
    throw e;
  }

  console.log(`[WAHA_BROADCAST] Starting broadcast to ${allowedRecipients.length} recipients`);
  console.log(`[WAHA_BROADCAST] Settings: batchSize=${batchSize}, messageDelay=${messageDelay}ms, batchDelay=${batchDelay}ms`);

  for (let i = 0; i < allowedRecipients.length; i += batchSize) {
    const batch = allowedRecipients.slice(i, i + batchSize);
    console.log(`[WAHA_BROADCAST] Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(allowedRecipients.length / batchSize)}`);

    for (const recipient of batch) {
      try {
        const phone = recipient && typeof recipient === 'object'
          ? (recipient.phone || recipient.phone_number || recipient.number || recipient.to || recipient.to_number)
          : recipient;
        const perRecipientText = recipient && typeof recipient === 'object' ? (recipient.message || recipient.text) : null;
        const effectiveText = String(perRecipientText != null ? perRecipientText : (message || ''));

        const normalized = normalizePhone(phone);
        const chatId = toWhatsAppFormat(normalized);
        if (!chatId) {
          throw new Error('Invalid recipient phone number');
        }

        if (images.length) {
          // Send 1..N images; caption only on first.
          for (let j = 0; j < images.length; j++) {
            const img = images[j];
            const resp = await wahaRequest('POST', '/api/sendImage', {
              session: sessionName,
              chatId,
              file: {
                mimetype: 'image/jpeg',
                data: img
              },
              caption: j === 0 ? effectiveText : ''
            });
            if (resp?.data?.error) {
              throw new Error(resp.data.error);
            }
          }
        } else {
          const resp = await wahaRequest('POST', '/api/sendText', {
            session: sessionName,
            chatId,
            text: effectiveText
          });
          if (resp?.data?.error) {
            throw new Error(resp.data.error);
          }
        }

        results.push({ phone: normalized || String(phone), success: true });

        if (messageDelay > 0) {
          await new Promise((resolve) => setTimeout(resolve, messageDelay));
        }
      } catch (error) {
        const phone = recipient && typeof recipient === 'object'
          ? (recipient.phone || recipient.phone_number || recipient.number || recipient.to || recipient.to_number)
          : recipient;
        results.push({ phone: String(phone || ''), success: false, error: error.message });
        console.error(`[WAHA_BROADCAST] Failed to send to ${phone}:`, error.response?.data || error.message);
      }
    }

    if (i + batchSize < allowedRecipients.length && batchDelay > 0) {
      console.log(`[WAHA_BROADCAST] Waiting ${batchDelay}ms before next batch...`);
      await new Promise((resolve) => setTimeout(resolve, batchDelay));
    }
  }

  const totalSent = results.filter((r) => r.success).length;
  const totalFailed = results.filter((r) => !r.success).length;

  return {
    success: true,
    totalSent,
    totalFailed,
    results,
    summary: {
      successRate: `${Math.round((totalSent / Math.max(1, allowedRecipients.length)) * 100)}%`,
      skippedUnsubscribed
    }
  };
}

module.exports = {
  wahaRequest,
  sendBroadcastViaWaha
};

