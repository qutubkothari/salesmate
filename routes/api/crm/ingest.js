const express = require('express');
const router = express.Router();

const { dbClient: supabase } = require('../../../services/config');
const { requireCrmAuth } = require('../../../middleware/crmAuth');
const { requireCrmFeature } = require('../../../middleware/requireCrmFeature');
const { CRM_FEATURES } = require('../../../services/crmFeatureFlags');

function nowIso() {
  return new Date().toISOString();
}

function normalizeChannel(channel) {
  return String(channel || 'WHATSAPP').toUpperCase();
}

async function upsertLeadFromInbound({ tenantId, channel, name, phone, email }) {
  // Very simple dedupe strategy for now: phone first, else email.
  const phoneKey = phone ? String(phone).trim() : null;
  const emailKey = email ? String(email).trim().toLowerCase() : null;

  let lead = null;
  if (phoneKey) {
    const { data } = await supabase
      .from('crm_leads')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('phone', phoneKey)
      .maybeSingle();
    lead = data || null;
  }

  if (!lead && emailKey) {
    const { data } = await supabase
      .from('crm_leads')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('email', emailKey)
      .maybeSingle();
    lead = data || null;
  }

  if (lead) {
    // Patch identity fields if missing
    const updates = {
      updated_at: nowIso(),
      last_activity_at: nowIso()
    };
    if (name && !lead.name) updates.name = String(name).trim();
    if (phoneKey && !lead.phone) updates.phone = phoneKey;
    if (emailKey && !lead.email) updates.email = emailKey;
    if (channel && !lead.channel) updates.channel = normalizeChannel(channel);

    const { data: updated } = await supabase
      .from('crm_leads')
      .update(updates)
      .eq('tenant_id', tenantId)
      .eq('id', lead.id)
      .select('*')
      .single();

    return updated;
  }

  const { data: created, error } = await supabase
    .from('crm_leads')
    .insert({
      tenant_id: tenantId,
      name: name ? String(name).trim() : null,
      phone: phoneKey,
      email: emailKey,
      channel: normalizeChannel(channel),
      status: 'NEW',
      heat: 'COLD',
      score: 0,
      last_activity_at: nowIso()
    })
    .select('*')
    .single();

  if (error) throw error;
  return created;
}

/**
 * POST /api/crm/ingest
 * Authenticated ingest (internal systems).
 * Body: { channel, lead: {name,phone,email}, message: {body, externalId, rawPayload} }
 */
router.post('/', requireCrmAuth, requireCrmFeature(CRM_FEATURES.CRM_INGEST), async (req, res) => {
  try {
    const tenantId = req.user.tenantId;
    const channel = normalizeChannel(req.body?.channel);

    const leadInput = req.body?.lead || {};
    const msgInput = req.body?.message || {};

    const lead = await upsertLeadFromInbound({
      tenantId,
      channel,
      name: leadInput.name,
      phone: leadInput.phone,
      email: leadInput.email
    });

    const { data: msg, error } = await supabase
      .from('crm_messages')
      .insert({
        tenant_id: tenantId,
        lead_id: lead.id,
        direction: 'INBOUND',
        channel,
        body: msgInput.body != null ? String(msgInput.body) : null,
        external_id: msgInput.externalId != null ? String(msgInput.externalId) : null,
        raw_payload: msgInput.rawPayload != null ? msgInput.rawPayload : null,
        created_at: nowIso()
      })
      .select('*')
      .single();

    if (error) throw error;

    return res.json({ success: true, lead, message: msg });
  } catch (e) {
    return res.status(500).json({ success: false, error: 'ingest_failed', details: e?.message || String(e) });
  }
});

/**
 * POST /api/crm/ingest/webhook
 * External ingestion (no cookies). Secured via shared secret header.
 * Header: x-webhook-secret: <CRM_WEBHOOK_SECRET>
 */
router.post('/webhook', requireCrmFeature(CRM_FEATURES.CRM_INGEST), async (req, res) => {
  try {
    const expected = process.env.CRM_WEBHOOK_SECRET || process.env.WEBHOOK_SECRET;
    if (!expected) return res.status(500).json({ success: false, error: 'server_not_configured' });

    const provided = req.get('x-webhook-secret') || req.get('X-Webhook-Secret');
    if (!provided || provided !== expected) return res.status(401).json({ success: false, error: 'unauthorized' });

    const { tenantId } = req.body || {};
    if (!tenantId) return res.status(400).json({ success: false, error: 'tenantId required' });

    const channel = normalizeChannel(req.body?.channel);
    const leadInput = req.body?.lead || {};
    const msgInput = req.body?.message || {};

    const lead = await upsertLeadFromInbound({
      tenantId,
      channel,
      name: leadInput.name,
      phone: leadInput.phone,
      email: leadInput.email
    });

    const { data: msg, error } = await supabase
      .from('crm_messages')
      .insert({
        tenant_id: tenantId,
        lead_id: lead.id,
        direction: 'INBOUND',
        channel,
        body: msgInput.body != null ? String(msgInput.body) : null,
        external_id: msgInput.externalId != null ? String(msgInput.externalId) : null,
        raw_payload: msgInput.rawPayload != null ? msgInput.rawPayload : null,
        created_at: nowIso()
      })
      .select('*')
      .single();

    if (error) throw error;

    return res.json({ success: true, lead, message: msg });
  } catch (e) {
    return res.status(500).json({ success: false, error: 'webhook_ingest_failed', details: e?.message || String(e) });
  }
});

module.exports = router;
