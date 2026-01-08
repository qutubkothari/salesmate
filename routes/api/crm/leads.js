const express = require('express');
const router = express.Router();

const { supabase } = require('../../../services/config');
const { requireCrmAuth, requireRole } = require('../../../middleware/crmAuth');
const { requireCrmFeature } = require('../../../middleware/requireCrmFeature');
const { CRM_FEATURES } = require('../../../services/crmFeatureFlags');

function nowIso() {
  return new Date().toISOString();
}

async function addLeadEvent({ tenantId, leadId, actorUserId, eventType, eventPayload }) {
  await supabase
    .from('crm_lead_events')
    .insert({
      tenant_id: tenantId,
      lead_id: leadId,
      actor_user_id: actorUserId || null,
      event_type: eventType,
      event_payload: eventPayload || {}
    });
}

/**
 * POST /api/crm/leads
 */
router.post('/', requireCrmAuth, requireCrmFeature(CRM_FEATURES.CRM_LEADS), requireRole(['OWNER', 'ADMIN', 'MANAGER', 'SALESMAN']), async (req, res) => {
  try {
    const {
      name,
      phone,
      email,
      channel = 'WHATSAPP',
      status = 'NEW',
      heat = 'COLD',
      score = 0,
      qualificationLevel,
      qualification_level,
      assignedUserId
    } = req.body || {};

    const insert = {
      tenant_id: req.user.tenantId,
      created_by_user_id: req.user.id,
      assigned_user_id: assignedUserId || null,
      name: name ? String(name).trim() : null,
      phone: phone ? String(phone).trim() : null,
      email: email ? String(email).trim().toLowerCase() : null,
      channel: String(channel).toUpperCase(),
      status: String(status).toUpperCase(),
      heat: String(heat).toUpperCase(),
      score: Number.isFinite(Number(score)) ? Number(score) : 0,
      qualification_level: (qualification_level ?? qualificationLevel) != null ? String(qualification_level ?? qualificationLevel).trim() : 'UNQUALIFIED',
      last_activity_at: nowIso()
    };

    const { data: lead, error } = await supabase
      .from('crm_leads')
      .insert(insert)
      .select('*')
      .single();

    if (error) throw error;

    await addLeadEvent({
      tenantId: req.user.tenantId,
      leadId: lead.id,
      actorUserId: req.user.id,
      eventType: 'LEAD_CREATED',
      eventPayload: { channel: insert.channel }
    });

    return res.status(201).json({ success: true, lead });
  } catch (e) {
    return res.status(500).json({ success: false, error: 'create_failed', details: e?.message || String(e) });
  }
});

/**
 * GET /api/crm/leads
 * Query: status, assignedUserId, channel
 */
router.get('/', requireCrmAuth, requireCrmFeature(CRM_FEATURES.CRM_LEADS), requireRole(['OWNER', 'ADMIN', 'MANAGER', 'SALESMAN']), async (req, res) => {
  try {
    const { status, assignedUserId, channel, limit = 100 } = req.query;

    let query = supabase
      .from('crm_leads')
      .select('*')
      .eq('tenant_id', req.user.tenantId)
      .order('updated_at', { ascending: false })
      .limit(parseInt(limit, 10) || 100);

    if (status) query = query.eq('status', String(status).toUpperCase());
    if (channel) query = query.eq('channel', String(channel).toUpperCase());
    if (assignedUserId) query = query.eq('assigned_user_id', assignedUserId);

    const { data, error } = await query;
    if (error) throw error;

    return res.json({ success: true, leads: data || [] });
  } catch (e) {
    return res.status(500).json({ success: false, error: 'list_failed', details: e?.message || String(e) });
  }
});

/**
 * GET /api/crm/leads/:leadId
 */
router.get('/:leadId', requireCrmAuth, requireCrmFeature(CRM_FEATURES.CRM_LEADS), requireRole(['OWNER', 'ADMIN', 'MANAGER', 'SALESMAN']), async (req, res) => {
  try {
    const { leadId } = req.params;
    const { data: lead, error } = await supabase
      .from('crm_leads')
      .select('*')
      .eq('tenant_id', req.user.tenantId)
      .eq('id', leadId)
      .maybeSingle();

    if (error) throw error;
    if (!lead) return res.status(404).json({ success: false, error: 'not_found' });

    const [{ data: events }, { data: messages }] = await Promise.all([
      supabase
        .from('crm_lead_events')
        .select('*')
        .eq('tenant_id', req.user.tenantId)
        .eq('lead_id', leadId)
        .order('created_at', { ascending: false })
        .limit(200),
      supabase
        .from('crm_messages')
        .select('*')
        .eq('tenant_id', req.user.tenantId)
        .eq('lead_id', leadId)
        .order('created_at', { ascending: false })
        .limit(200)
    ]);

    return res.json({ success: true, lead, events: events || [], messages: messages || [] });
  } catch (e) {
    return res.status(500).json({ success: false, error: 'get_failed', details: e?.message || String(e) });
  }
});

/**
 * PATCH /api/crm/leads/:leadId
 * Supports updating: status, heat, score, assigned_user_id, identity fields.
 */
router.patch('/:leadId', requireCrmAuth, requireCrmFeature(CRM_FEATURES.CRM_LEADS), requireRole(['OWNER', 'ADMIN', 'MANAGER', 'SALESMAN']), async (req, res) => {
  try {
    const { leadId } = req.params;
    const updates = {};

    const allowed = ['name', 'phone', 'email', 'channel', 'status', 'heat', 'score', 'qualification_level', 'qualificationLevel', 'assigned_user_id', 'assignedUserId'];
    for (const k of allowed) {
      if (Object.prototype.hasOwnProperty.call(req.body || {}, k)) {
        updates[k] = req.body[k];
      }
    }

    const mapped = {
      name: updates.name != null ? String(updates.name).trim() : undefined,
      phone: updates.phone != null ? String(updates.phone).trim() : undefined,
      email: updates.email != null ? String(updates.email).trim().toLowerCase() : undefined,
      channel: updates.channel != null ? String(updates.channel).toUpperCase() : undefined,
      status: updates.status != null ? String(updates.status).toUpperCase() : undefined,
      heat: updates.heat != null ? String(updates.heat).toUpperCase() : undefined,
      score: updates.score != null ? (Number.isFinite(Number(updates.score)) ? Number(updates.score) : 0) : undefined,
      qualification_level: updates.qualification_level != null
        ? String(updates.qualification_level).trim()
        : (updates.qualificationLevel != null ? String(updates.qualificationLevel).trim() : undefined),
      assigned_user_id: updates.assigned_user_id != null ? updates.assigned_user_id : (updates.assignedUserId != null ? updates.assignedUserId : undefined),
      updated_at: nowIso(),
      last_activity_at: nowIso()
    };

    // remove undefined
    for (const [k, v] of Object.entries(mapped)) {
      if (v === undefined) delete mapped[k];
    }

    const { data: lead, error } = await supabase
      .from('crm_leads')
      .update(mapped)
      .eq('tenant_id', req.user.tenantId)
      .eq('id', leadId)
      .select('*')
      .maybeSingle();

    if (error) throw error;
    if (!lead) return res.status(404).json({ success: false, error: 'not_found' });

    await addLeadEvent({
      tenantId: req.user.tenantId,
      leadId,
      actorUserId: req.user.id,
      eventType: 'LEAD_UPDATED',
      eventPayload: mapped
    });

    return res.json({ success: true, lead });
  } catch (e) {
    return res.status(500).json({ success: false, error: 'update_failed', details: e?.message || String(e) });
  }
});

/**
 * POST /api/crm/leads/:leadId/messages
 * Manual message logging.
 */
router.post('/:leadId/messages', requireCrmAuth, requireCrmFeature(CRM_FEATURES.CRM_CONVERSATIONS), requireRole(['OWNER', 'ADMIN', 'MANAGER', 'SALESMAN']), async (req, res) => {
  try {
    const { leadId } = req.params;
    const { direction = 'OUTBOUND', channel = 'MANUAL', body, externalId, rawPayload } = req.body || {};

    const { data: lead, error: leadErr } = await supabase
      .from('crm_leads')
      .select('id')
      .eq('tenant_id', req.user.tenantId)
      .eq('id', leadId)
      .maybeSingle();

    if (leadErr) throw leadErr;
    if (!lead) return res.status(404).json({ success: false, error: 'lead_not_found' });

    const { data: msg, error } = await supabase
      .from('crm_messages')
      .insert({
        tenant_id: req.user.tenantId,
        lead_id: leadId,
        direction: String(direction).toUpperCase(),
        channel: String(channel).toUpperCase(),
        body: body != null ? String(body) : null,
        external_id: externalId != null ? String(externalId) : null,
        raw_payload: rawPayload != null ? rawPayload : null,
        created_by_user_id: req.user.id
      })
      .select('*')
      .single();

    if (error) throw error;

    await supabase
      .from('crm_leads')
      .update({ last_activity_at: nowIso(), updated_at: nowIso() })
      .eq('tenant_id', req.user.tenantId)
      .eq('id', leadId);

    await addLeadEvent({
      tenantId: req.user.tenantId,
      leadId,
      actorUserId: req.user.id,
      eventType: 'MESSAGE_LOGGED',
      eventPayload: { direction: msg.direction, channel: msg.channel }
    });

    return res.status(201).json({ success: true, message: msg });
  } catch (e) {
    return res.status(500).json({ success: false, error: 'message_failed', details: e?.message || String(e) });
  }
});

module.exports = router;
