const express = require('express');
const router = express.Router();
const { requireTenantAuth } = require('../../services/tenantAuth');
const { sendMessage } = require('../../services/whatsappService');
const { getClientStatus, sendWebButtonsMessage, sendWebListMessage } = require('../../services/whatsappWebService');

function getValueByPath(obj, path) {
  try {
    if (!obj || !path) return '';
    const parts = String(path).split('.').map((p) => p.trim()).filter(Boolean);
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

function interactiveToText(payload) {
  const type = String(payload?.type || 'text').toLowerCase();

  if (type === 'buttons') {
    const header = payload?.header ? String(payload.header) : '';
    const body = payload?.body ? String(payload.body) : String(payload?.text || '');
    const footer = payload?.footer ? String(payload.footer) : '';
    const buttons = Array.isArray(payload?.buttons) ? payload.buttons : [];

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

  if (type === 'list') {
    const body = payload?.body ? String(payload.body) : String(payload?.text || '');
    const buttonText = payload?.buttonText ? String(payload.buttonText) : 'Choose an option';
    const sections = Array.isArray(payload?.sections) ? payload.sections : [];

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
        const t = r?.title || r?.text || r?.id || `Item ${idx}`;
        lines.push(`${idx}. ${String(t)}`);
        idx++;
      }
    }

    return lines.filter(Boolean).join('\n');
  }

  if (type === 'catalog') {
    const text = payload?.text ? String(payload.text) : 'Please view our catalog.';
    return text;
  }

  return String(payload?.text || payload?.body || '');
}

// Send an interactive message.
// Note: provider-specific interactive payloads vary; we implement a safe fallback to text.
router.post('/:tenantId/send', requireTenantAuth(), async (req, res) => {
  try {
    const { tenantId } = req.params;
    const { to, message, recipient } = req.body || {};
    if (!to) return res.status(400).json({ success: false, error: 'to is required' });

    const recipientMeta = (recipient && typeof recipient === 'object')
      ? recipient
      : ({ phone: String(to) });

    const type = String(message?.type || 'text').toLowerCase();
    const status = getClientStatus(String(tenantId));

    // Prefer WhatsApp Web native interactive messages
    if (status && status.status === 'ready') {
      try {
        if (type === 'buttons') {
          const p = applyRecipientTemplateToInteractivePayload({ ...(message || {}), type: 'buttons' }, recipientMeta) || (message || {});
          const sent = await sendWebButtonsMessage(String(tenantId), String(to), p);
          return res.json({ success: true, messageId: sent.messageId, fallback: false, provider: 'whatsapp_web' });
        }
        if (type === 'list') {
          const p = applyRecipientTemplateToInteractivePayload({ ...(message || {}), type: 'list' }, recipientMeta) || (message || {});
          const sent = await sendWebListMessage(String(tenantId), String(to), p);
          return res.json({ success: true, messageId: sent.messageId, fallback: false, provider: 'whatsapp_web' });
        }
        // catalog (and unknown types): fall through to text until provider-native support is added
      } catch (e) {
        // Fall back to text below
      }
    }

    const fallbackText = applyRecipientTemplate(interactiveToText(message || {}), recipientMeta);
    const sentId = await sendMessage(String(to), fallbackText, String(tenantId));

    res.json({ success: true, messageId: sentId, fallback: true, provider: 'fallback_text' });
  } catch (e) {
    console.error('[INTERACTIVE] send error:', e?.message || e);
    res.status(500).json({ success: false, error: 'Failed to send interactive message' });
  }
});

module.exports = router;
