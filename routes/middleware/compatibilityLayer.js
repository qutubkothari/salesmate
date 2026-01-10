// routes/middleware/compatibilityLayer.js
// This contains the critical infrastructure from your original webhook.js

/**
 * Outbound Guard - Enforces digits-only phone numbers for WhatsApp compliance
 */
const initOutboundGuard = () => {
  try {
    const { initOutbound } = require('../../services/outboundGuard');
    initOutbound(); // digits-only, payload normalize, provider logging
  } catch (e) {
    console.warn('[OUTBOUND] init failed', e?.message || e);
  }
};

/**
 * Digits-only helper for phone number normalization
 */
const __digits = (x) => String(x || '').replace(/\D/g, '');

/**
 * Universal phone number normalizer (MSISDN format)
 */
const __msisdn = (x) => {
  if (!x) return '';
  return String(x).replace(/\D/g, '');
};

/**
 * Maytapi adapter for all current call shapes
 */
const initMaytapiAdapter = () => {
  const may = (() => {
    try { return require('../../services/maytapiService'); } catch { return null; }
  })();

  // Normalize current variants into Maytapi body
  function __toMaytapiTextBody(to, payloadOrText) {
    const toNum = __msisdn(to);
    let text = '';

    if (typeof payloadOrText === 'string') {
      text = payloadOrText;
    } else if (payloadOrText && typeof payloadOrText === 'object') {
      if (typeof payloadOrText.text === 'string') text = payloadOrText.text;
      else if (payloadOrText.text && typeof payloadOrText.text.body === 'string') text = payloadOrText.text.body;
      else if (typeof payloadOrText.message === 'string') text = payloadOrText.message;
      else if (payloadOrText.message && typeof payloadOrText.message.text === 'string') text = payloadOrText.message.text;
      else if (typeof payloadOrText.body === 'string') text = payloadOrText.body;
    }

    return {
      to_number: toNum,
      type: 'text',
      message: { text }
    };
  }

  // Single "truth" send that uses maytapiService if available
  const sendViaMaytapi = async (to, payloadOrText) => {
    const body = __toMaytapiTextBody(to, payloadOrText);

    // Global opt-out enforcement (best-effort)
    try {
      const { isUnsubscribed, toDigits } = require('../../services/unsubscribeService');
      const { isBypassNumber } = require('../../services/outboundPolicy');
      const digits = toDigits(body.to_number);
      if (digits) {
        const bypass = await isBypassNumber(digits);
        if (!bypass && (await isUnsubscribed(digits))) {
          console.warn('[MAYTAPI ADAPTER] skipped: unsubscribed', { to: digits });
          return { ok: false, skipped: true, reason: 'unsubscribed' };
        }
      }
    } catch (e) {
      // Fail-open if policy lookup fails
    }

    if (!may || typeof may.sendMessage !== 'function') {
      console.warn('[MAYTAPI ADAPTER] maytapiService not available; skipping send');
      return { ok: false, skipped: true };
    }
    try {
      const res = await may.sendMessage(body.to_number, body.message.text);
      console.log('[MAYTAPI ADAPTER RES]', res && res.status, res && res.data ? JSON.stringify(res.data).slice(0, 400) : '');
      return res;
    } catch (e) {
      const status = e?.response?.status;
      const data = e?.response?.data || e?.message;
      console.error('[MAYTAPI ADAPTER ERR]', status, typeof data === 'string' ? data.slice(0, 400) : JSON.stringify(data).slice(0, 400));
      throw e;
    }
  };

  return { sendViaMaytapi, __toMaytapiTextBody };
};

/**
 * Apply digits-only enforcement to all send functions
 */
const enforceDigitsOnly = () => {
  // Global function enforcement
  try {
    if (typeof global.sendWhatsAppText === 'function' && !global.sendWhatsAppText.__digitsWrap) {
      const __orig = global.sendWhatsAppText;
      global.sendWhatsAppText = async (to, text) => {
        const toD = __digits(to);
        const r = await __orig(toD, text);
        console.log('[SEND digits]', toD);
        return r;
      };
      global.sendWhatsAppText.__digitsWrap = true;
    }
  } catch {}

  // Service object enforcement
  try {
    if (typeof global.whatsappService !== 'undefined' && global.whatsappService && !global.whatsappService.__digitsWrap) {
      if (typeof global.whatsappService.sendText === 'function') {
        const __orig = global.whatsappService.sendText.bind(global.whatsappService);
        global.whatsappService.sendText = async (to, text) => {
          const toD = __digits(to);
          const r = await __orig(toD, text);
          console.log('[SEND digits svc.sendText]', toD);
          return r;
        };
      }
      if (typeof global.whatsappService.sendMessage === 'function') {
        const __orig = global.whatsappService.sendMessage.bind(global.whatsappService);
        global.whatsappService.sendMessage = async (a, b) => {
          if (a && typeof a === 'object' && !b) {
            const p = { ...a };
            p.to = __digits(p.to || p.to_number || p.toNumber || p.recipient || '');
            return await __orig(p);
          }
          return await __orig(__digits(a), b);
        };
      }
      global.whatsappService.__digitsWrap = true;
    }
  } catch {}
};

/**
 * Patch existing senders with Maytapi adapter
 */
const patchSenders = async () => {
  const { sendViaMaytapi } = initMaytapiAdapter();
  
  try {
    // Global sendWhatsAppText
    if (typeof global.sendWhatsAppText === 'function' && !global.sendWhatsAppText.__mayAdapted) {
      const __orig = global.sendWhatsAppText;
      global.sendWhatsAppText = async (to, text) => {
        try { return await sendViaMaytapi(to, text); }
        catch { return await __orig(__msisdn(to), text); }
      };
      global.sendWhatsAppText.__mayAdapted = true;
    }

    // Service object
    if (typeof global.whatsappService !== 'undefined' && global.whatsappService && !global.whatsappService.__mayAdapted) {
      if (typeof global.whatsappService.sendText === 'function') {
        const __orig = global.whatsappService.sendText.bind(global.whatsappService);
        global.whatsappService.sendText = async (to, text) => {
          try { return await sendViaMaytapi(to, text); }
          catch { return await __orig(__msisdn(to), text); }
        };
      }
      if (typeof global.whatsappService.sendMessage === 'function') {
        const __orig = global.whatsappService.sendMessage.bind(global.whatsappService);
        global.whatsappService.sendMessage = async (a, b) => {
          if (a && typeof a === 'object' && !b) {
            const to = a.to || a.to_number || a.toNumber;
            const payload = a.text ?? a.message ?? a;
            try { return await sendViaMaytapi(to, payload); }
            catch { return await __orig(a); }
          } else {
            const to = a;
            const payload = b;
            try { return await sendViaMaytapi(to, payload); }
            catch { return await __orig(__msisdn(to), payload); }
          }
        };
      }
      global.whatsappService.__mayAdapted = true;
    }

    // Standalone sendMessage
    if (typeof global.sendMessage === 'function' && !global.sendMessage.__mayAdapted) {
      const __orig = global.sendMessage;
      global.sendMessage = async (a, b) => {
        if (a && typeof a === 'object' && !b) {
          const to = a.to || a.to_number || a.toNumber;
          const payload = a.text ?? a.message ?? a;
          try { return await sendViaMaytapi(to, payload); }
          catch { return await __orig(a); }
        } else {
          const to = a;
          const payload = b;
          try { return await sendViaMaytapi(to, payload); }
          catch { return await __orig(__msisdn(to), payload); }
        }
      };
      global.sendMessage.__mayAdapted = true;
    }
  } catch (e) {
    console.warn('[MAYTAPI ADAPTER PATCH WARN]', e?.message || e);
  }
};

/**
 * Initialize safety shims for missing dependencies
 */
const initSafetyShims = () => {
  try {
    // Segments safety shim
    if (typeof globalThis !== 'undefined') {
      if (typeof globalThis.segments === 'undefined') {
        globalThis.segments = {
          matchSegments: function() { return []; },
          matchesRule: function() { return false; }
        };
      }
    }
  } catch (_) { /* ignore */ }

  try {
    // Global digits helper
    if (typeof globalThis !== 'undefined' && typeof globalThis.__msisdn === 'undefined') {
      globalThis.__msisdn = __msisdn;
    }
  } catch (_) { /* ignore */ }

  try {
    // Universal text sender
    if (typeof globalThis !== 'undefined' && typeof globalThis.WATXT === 'undefined') {
      globalThis.WATXT = async function(to, text) {
        try {
          if (typeof sendWhatsAppText === 'function') {
            return await sendWhatsAppText(globalThis.__msisdn(to), text);
          }
          if (typeof global.whatsappService !== 'undefined' && global.whatsappService) {
            if (typeof global.whatsappService.sendText === 'function') {
              return await global.whatsappService.sendText(globalThis.__msisdn(to), text);
            }
            if (typeof global.whatsappService.sendMessage === 'function') {
              try {
                return await global.whatsappService.sendMessage({ to: globalThis.__msisdn(to), type: 'text', text: text });
              } catch (_e) {
                return await global.whatsappService.sendMessage({ to: globalThis.__msisdn(to), type: 'text', text: { body: text } });
              }
            }
          }
          console.error('[WATXT] No sender available');
          return { ok: false, error: 'no-sender' };
        } catch (e) {
          console.error('[WATXT error]', (e && e.message) ? e.message : e);
          return { ok: false, error: 'exception' };
        }
      };
    }
  } catch (_) { /* ignore */ }
};

/**
 * Initialize all compatibility layers
 */
const initCompatibilityLayer = async () => {
  console.log('[COMPAT] Initializing compatibility layer...');
  
  // Initialize in correct order
  initOutboundGuard();
  initSafetyShims();
  enforceDigitsOnly();
  await patchSenders();
  
  console.log('[COMPAT] Compatibility layer initialized');
};

module.exports = {
  initCompatibilityLayer,
  __digits,
  __msisdn,
  initSafetyShims,
  enforceDigitsOnly
};