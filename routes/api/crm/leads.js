const express = require('express');
const router = express.Router();

const { dbClient: supabase } = require('../../../services/config');
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

    const leads = data || [];

    // Add message counts for each lead (crm_messages)
    try {
      const leadIds = leads.map((l) => l.id).filter(Boolean);
      if (leadIds.length > 0) {
        const { data: msgRows, error: msgErr } = await supabase
          .from('crm_messages')
          .select('lead_id')
          .eq('tenant_id', req.user.tenantId)
          .in('lead_id', leadIds);

        if (!msgErr && Array.isArray(msgRows)) {
          const counts = msgRows.reduce((acc, row) => {
            const id = row.lead_id;
            if (!id) return acc;
            acc[id] = (acc[id] || 0) + 1;
            return acc;
          }, {});
          leads.forEach((lead) => {
            lead.message_count = counts[lead.id] || 0;
          });
        }
      }
    } catch (countErr) {
      console.warn('[CRM_LEADS] Failed to compute message counts:', countErr?.message || countErr);
    }

    // Fallback message counts from WhatsApp messages -> conversations_new (by phone)
    try {
      const leadsNeedingFallback = leads.filter((l) => (l.message_count || 0) === 0 && l.phone);
      const phones = leadsNeedingFallback.map((l) => String(l.phone).trim()).filter(Boolean);

      if (phones.length > 0) {
        const { data: convs, error: convErr } = await supabase
          .from('conversations_new')
          .select('id, end_user_phone')
          .eq('tenant_id', req.user.tenantId)
          .in('end_user_phone', phones);

        if (!convErr && Array.isArray(convs) && convs.length > 0) {
          const convIds = convs.map((c) => c.id).filter(Boolean);
          const convPhoneMap = convs.reduce((acc, c) => {
            if (c.id && c.end_user_phone) acc[c.id] = c.end_user_phone;
            return acc;
          }, {});

          if (convIds.length > 0) {
            const { data: msgRows2, error: msgErr2 } = await supabase
              .from('messages')
              .select('conversation_id')
              .eq('tenant_id', req.user.tenantId)
              .in('conversation_id', convIds);

            if (!msgErr2 && Array.isArray(msgRows2)) {
              const phoneCounts = msgRows2.reduce((acc, row) => {
                const phone = convPhoneMap[row.conversation_id];
                if (!phone) return acc;
                acc[phone] = (acc[phone] || 0) + 1;
                return acc;
              }, {});

              leads.forEach((lead) => {
                if ((lead.message_count || 0) > 0) return;
                const phone = String(lead.phone || '').trim();
                if (phoneCounts[phone]) {
                  lead.message_count = phoneCounts[phone];
                }
              });
            }
          }
        }
      }
    } catch (fallbackErr) {
      console.warn('[CRM_LEADS] Fallback message count failed:', fallbackErr?.message || fallbackErr);
    }

    return res.json({ success: true, leads });
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

    // If assigned now, mark as needing contact
    if (mapped.assigned_user_id) {
      try {
        await supabase
          .from('crm_triage_items')
          .insert({
            tenant_id: req.user.tenantId,
            lead_id: leadId,
            status: 'OPEN',
            reason: 'Assigned lead - contact requested',
            created_at: nowIso()
          });
      } catch (_) {
        // ignore if triage table missing
      }
    }

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
 * GET /api/crm/leads/:leadId/timeline
 * Get activity timeline for a lead (events + messages combined)
 */
router.get('/:leadId/timeline', requireCrmAuth, requireCrmFeature(CRM_FEATURES.CRM_LEADS), requireRole(['OWNER', 'ADMIN', 'MANAGER', 'SALESMAN']), async (req, res) => {
  try {
    const { leadId } = req.params;
    const { limit = 50 } = req.query;

    // Verify lead exists and belongs to tenant
    const { data: lead, error: leadError } = await supabase
      .from('crm_leads')
      .select('id, name, phone, email')
      .eq('tenant_id', req.user.tenantId)
      .eq('id', leadId)
      .maybeSingle();

    if (leadError) throw leadError;
    if (!lead) return res.status(404).json({ success: false, error: 'lead_not_found' });

    // Fetch events
    const { data: events, error: eventsError } = await supabase
      .from('crm_lead_events')
      .select('*, actor_user_id')
      .eq('tenant_id', req.user.tenantId)
      .eq('lead_id', leadId)
      .order('created_at', { ascending: false })
      .limit(parseInt(limit, 10) || 50);

    if (eventsError) throw eventsError;

    // Fetch messages
    const { data: messages, error: messagesError } = await supabase
      .from('crm_messages')
      .select('*')
      .eq('tenant_id', req.user.tenantId)
      .eq('lead_id', leadId)
      .order('created_at', { ascending: false })
      .limit(parseInt(limit, 10) || 50);

    if (messagesError) throw messagesError;

    // Combine and sort by timestamp
    const timeline = [];

    (events || []).forEach(event => {
      timeline.push({
        type: 'event',
        timestamp: event.created_at,
        eventType: event.event_type,
        actorUserId: event.actor_user_id,
        payload: event.event_payload,
        data: event
      });
    });

    (messages || []).forEach(message => {
      timeline.push({
        type: 'message',
        timestamp: message.created_at,
        direction: message.direction,
        channel: message.channel,
        body: message.body,
        data: message
      });
    });

    // Sort by timestamp descending (newest first)
    timeline.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    return res.json({ 
      success: true, 
      lead,
      timeline,
      count: timeline.length 
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: 'timeline_failed', details: e?.message || String(e) });
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
