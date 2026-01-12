const express = require('express');
const router = express.Router();

const { supabase } = require('../../../services/config');
const { requireCrmAuth, requireRole } = require('../../../middleware/crmAuth');
const { requireCrmFeature } = require('../../../middleware/requireCrmFeature');
const { CRM_FEATURES } = require('../../../services/crmFeatureFlags');

function nowIso() {
  return new Date().toISOString();
}

// Rules CRUD
router.get('/rules', requireCrmAuth, requireCrmFeature(CRM_FEATURES.CRM_SLA), requireRole(['OWNER', 'ADMIN', 'MANAGER']), async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('crm_sla_rules')
      .select('*')
      .eq('tenant_id', req.user.tenantId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return res.json({ success: true, rules: data || [] });
  } catch (e) {
    return res.status(500).json({ success: false, error: 'list_failed', details: e?.message || String(e) });
  }
});

router.post('/rules', requireCrmAuth, requireCrmFeature(CRM_FEATURES.CRM_SLA), requireRole(['OWNER', 'ADMIN']), async (req, res) => {
  try {
    const { name, responseTimeMinutes, escalationTimeMinutes, notifyRoles = [], isActive = true } = req.body || {};
    if (!name || !responseTimeMinutes) {
      return res.status(400).json({ success: false, error: 'name and responseTimeMinutes required' });
    }

    const { data, error } = await supabase
      .from('crm_sla_rules')
      .insert({
        tenant_id: req.user.tenantId,
        name: String(name).trim(),
        response_time_minutes: parseInt(responseTimeMinutes, 10),
        escalation_time_minutes: escalationTimeMinutes != null ? parseInt(escalationTimeMinutes, 10) : null,
        notify_roles: notifyRoles,
        is_active: Boolean(isActive),
        created_at: nowIso(),
        updated_at: nowIso()
      })
      .select('*')
      .single();

    if (error) throw error;
    return res.status(201).json({ success: true, rule: data });
  } catch (e) {
    return res.status(500).json({ success: false, error: 'create_failed', details: e?.message || String(e) });
  }
});

// SLA status endpoint (computed)
router.get('/status/:leadId', requireCrmAuth, requireCrmFeature(CRM_FEATURES.CRM_SLA), requireRole(['OWNER', 'ADMIN', 'MANAGER', 'SALESMAN']), async (req, res) => {
  try {
    const { leadId } = req.params;

    // Fetch lead + latest inbound message timestamp
    const { data: lead, error: leadErr } = await supabase
      .from('crm_leads')
      .select('id, created_at, last_activity_at')
      .eq('tenant_id', req.user.tenantId)
      .eq('id', leadId)
      .maybeSingle();

    if (leadErr) throw leadErr;
    if (!lead) return res.status(404).json({ success: false, error: 'lead_not_found' });

    const { data: lastInbound } = await supabase
      .from('crm_messages')
      .select('created_at')
      .eq('tenant_id', req.user.tenantId)
      .eq('lead_id', leadId)
      .eq('direction', 'INBOUND')
      .order('created_at', { ascending: false })
      .limit(1);

    const lastInboundAt = (lastInbound && lastInbound[0] && lastInbound[0].created_at) ? new Date(lastInbound[0].created_at) : null;

    const { data: rules } = await supabase
      .from('crm_sla_rules')
      .select('*')
      .eq('tenant_id', req.user.tenantId)
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(1);

    const rule = rules && rules[0] ? rules[0] : null;
    if (!rule) {
      return res.json({ success: true, rule: null, state: { status: 'NO_RULE' } });
    }

    const base = lastInboundAt || new Date(lead.created_at);
    const now = new Date();
    const mins = Math.floor((now.getTime() - base.getTime()) / (60 * 1000));

    const responseDue = rule.response_time_minutes;
    const escalationDue = rule.escalation_time_minutes;

    let status = 'OK';
    if (mins > responseDue) status = 'BREACHED_RESPONSE';
    if (escalationDue != null && mins > escalationDue) status = 'BREACHED_ESCALATION';

    return res.json({
      success: true,
      rule: {
        id: rule.id,
        name: rule.name,
        responseTimeMinutes: rule.response_time_minutes,
        escalationTimeMinutes: rule.escalation_time_minutes,
        notifyRoles: rule.notify_roles
      },
      state: {
        baseTime: base.toISOString(),
        minutesSinceBase: mins,
        status
      }
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: 'status_failed', details: e?.message || String(e) });
  }
});

module.exports = router;
