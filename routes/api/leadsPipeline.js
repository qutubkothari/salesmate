const express = require('express');
const router = express.Router();
const { dbClient, USE_LOCAL_DB } = require('../../services/config');
const { writeAuditLog } = require('../../services/auditLogService');

function toBool(value) {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'boolean') return value;
  const s = String(value).toLowerCase();
  if (['1', 'true', 'yes', 'y'].includes(s)) return true;
  if (['0', 'false', 'no', 'n'].includes(s)) return false;
  return undefined;
}

function leadScoreRank(score) {
  const s = String(score || '').toUpperCase();
  if (s === 'HOT') return 3;
  if (s === 'WARM') return 2;
  if (s === 'COLD') return 1;
  return 0;
}

function leadSortKey(row) {
  const needsAttention = row?.requires_human_attention === true || row?.requires_human_attention === 1;
  const scoreRank = leadScoreRank(row?.lead_score);
  const ts = Date.parse(row?.updated_at || row?.last_message_at || row?.created_at || '') || 0;
  return { needsAttention, scoreRank, ts };
}

function isMissingPipelineTableError(err) {
  const code = err?.code ? String(err.code) : '';
  const msg = String(err?.message || '').toLowerCase();
  if (code === '42P01') return true; // Postgres: undefined_table
  if (msg.includes('no such table')) return true; // SQLite
  if (msg.includes('does not exist') && msg.includes('lead_pipeline')) return true;
  if (msg.includes('relation') && msg.includes('lead_pipeline')) return true;
  return false;
}

async function ensureDefaultStages(tenantId) {
  const defaults = [
    { name: 'New', position: 1, is_won: 0, is_lost: 0 },
    { name: 'Qualified', position: 2, is_won: 0, is_lost: 0 },
    { name: 'Won', position: 3, is_won: 1, is_lost: 0 },
    { name: 'Lost', position: 4, is_won: 0, is_lost: 1 },
  ];

  const { data: existing, error } = await dbClient
    .from('lead_pipeline_stages')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('position', { ascending: true });

  if (error) throw error;
  if (Array.isArray(existing) && existing.length > 0) return existing;

  const now = new Date().toISOString();
  const rows = defaults.map((d) => ({
    tenant_id: tenantId,
    name: d.name,
    position: d.position,
    is_won: d.is_won,
    is_lost: d.is_lost,
    created_at: now,
    updated_at: now,
  }));

  const { error: insErr } = await dbClient.from('lead_pipeline_stages').insert(rows);
  if (insErr) throw insErr;

  const { data: after, error: afterErr } = await dbClient
    .from('lead_pipeline_stages')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('position', { ascending: true });

  if (afterErr) throw afterErr;
  return after || [];
}

async function loadLeadStageMap(tenantId, conversationIds) {
  if (!conversationIds || conversationIds.length === 0) return new Map();
  const { data, error } = await dbClient
    .from('lead_pipeline_items')
    .select('conversation_id, stage_id')
    .eq('tenant_id', tenantId)
    .in('conversation_id', conversationIds);

  if (error) throw error;
  const map = new Map();
  for (const row of (data || [])) {
    if (row?.conversation_id) map.set(String(row.conversation_id), row?.stage_id ? String(row.stage_id) : null);
  }
  return map;
}

// GET /api/leads-pipeline/:tenantId/stages
router.get('/:tenantId/stages', async (req, res) => {
  const { tenantId } = req.params;

  try {
    const stages = await ensureDefaultStages(tenantId);
    return res.json({ success: true, stages });
  } catch (e) {
    // In hosted/dbClient env where tables may not exist, return readonly defaults.
    console.warn('[LEADS_PIPELINE] stages fallback:', e?.message || e);
    return res.json({
      success: true,
      readonly: true,
      stages: [
        { id: 'NEW', name: 'New', position: 1 },
        { id: 'QUALIFIED', name: 'Qualified', position: 2 },
        { id: 'WON', name: 'Won', position: 3, is_won: 1 },
        { id: 'LOST', name: 'Lost', position: 4, is_lost: 1 },
      ]
    });
  }
});

// GET /api/leads-pipeline/:tenantId/board?q=...&limit=200
router.get('/:tenantId/board', async (req, res) => {
  const { tenantId } = req.params;
  const { q } = req.query;
  const limit = Math.min(Number(req.query.limit) || 200, 500);
  const requiresAttention = toBool(req.query.requiresAttention);

  try {
    let stages;
    let readonly = false;
    try {
      stages = await ensureDefaultStages(tenantId);
    } catch (e) {
      // Hosted environments may not have the pipeline tables yet.
      console.warn('[LEADS_PIPELINE] stages missing; using defaults:', e?.message || e);
      readonly = true;
      stages = [
        { id: 'NEW', tenant_id: tenantId, name: 'New', position: 1, is_won: 0, is_lost: 0 },
        { id: 'QUALIFIED', tenant_id: tenantId, name: 'Qualified', position: 2, is_won: 0, is_lost: 0 },
        { id: 'WON', tenant_id: tenantId, name: 'Won', position: 3, is_won: 1, is_lost: 0 },
        { id: 'LOST', tenant_id: tenantId, name: 'Lost', position: 4, is_won: 0, is_lost: 1 },
      ];
    }

    let convQuery = dbClient.from('conversations_new');
    if (USE_LOCAL_DB) {
      convQuery = convQuery.select('*');
    } else {
      convQuery = convQuery.select('id, tenant_id, end_user_phone, lead_score, requires_human_attention, updated_at, created_at');
    }

    const { data: convs, error: convErr } = await convQuery
      .eq('tenant_id', tenantId)
      .order('updated_at', { ascending: false })
      .limit(limit);

    if (convErr) throw convErr;

    let leads = Array.isArray(convs) ? convs : [];

    // Default "lead" criteria: scored leads or requires human attention.
    leads = leads.filter((c) => {
      const hasScore = c.lead_score !== null && c.lead_score !== undefined && String(c.lead_score).trim() !== '';
      const needsHuman = c.requires_human_attention === true || c.requires_human_attention === 1;
      return hasScore || needsHuman;
    });

    if (requiresAttention !== undefined) {
      leads = leads.filter((c) => (c.requires_human_attention === true || c.requires_human_attention === 1) === requiresAttention);
    }

    // Attach a message preview
    const withPreview = await Promise.all(
      leads.map(async (c) => {
        try {
          const { data: msgs, error: msgError } = await dbClient
            .from('messages')
            .select('message_body, sender, created_at, message_type')
            .eq('conversation_id', c.id)
            .order('created_at', { ascending: false })
            .limit(3);

          if (msgError) throw msgError;
          const messageList = Array.isArray(msgs) ? msgs : [];
          const last = messageList[0];
          const lastMessage = last?.message_body || '';

          return {
            ...c,
            messages: messageList,
            lastMessage,
            last_message: lastMessage,
          };
        } catch (_) {
          return {
            ...c,
            messages: [],
            lastMessage: '',
            last_message: '',
          };
        }
      })
    );

    if (q) {
      const needle = String(q).toLowerCase();
      leads = withPreview.filter((c) => {
        const phone = String(c.end_user_phone || '').toLowerCase();
        const last = String(c.lastMessage || c.last_message || '').toLowerCase();
        return phone.includes(needle) || last.includes(needle);
      });
    } else {
      leads = withPreview;
    }

    // Sort same as Leads tab
    leads.sort((a, b) => {
      const ka = leadSortKey(a);
      const kb = leadSortKey(b);

      if (ka.needsAttention !== kb.needsAttention) return ka.needsAttention ? -1 : 1;
      if (ka.scoreRank !== kb.scoreRank) return kb.scoreRank - ka.scoreRank;
      return kb.ts - ka.ts;
    });

    const conversationIds = leads.map((l) => String(l.id));
    let stageMap = new Map();
    if (!readonly) {
      try {
        stageMap = await loadLeadStageMap(tenantId, conversationIds);
      } catch (e) {
        // If items table is missing, treat as readonly.
        console.warn('[LEADS_PIPELINE] items missing; using defaults:', e?.message || e);
        readonly = true;
        stageMap = new Map();
      }
    }

    const defaultStageId = stages[0]?.id ? String(stages[0].id) : null;
    const stagesById = new Map(stages.map((s) => [String(s.id), s]));

    const enrichedLeads = leads.map((l) => {
      const currentStageId = stageMap.get(String(l.id)) || defaultStageId;
      const stage = currentStageId ? stagesById.get(String(currentStageId)) : null;
      return {
        ...l,
        pipeline_stage_id: currentStageId,
        pipeline_stage_name: stage?.name || null,
      };
    });

    const columns = stages.map((s) => {
      const sid = String(s.id);
      return {
        stage: s,
        leads: enrichedLeads.filter((l) => String(l.pipeline_stage_id || '') === sid),
      };
    });

    return res.json({ success: true, readonly, stages, columns, leads: enrichedLeads });
  } catch (e) {
    console.error('[LEADS_PIPELINE] board failed', e);
    return res.status(500).json({ success: false, error: e?.message || String(e) });
  }
});

// PUT /api/leads-pipeline/:tenantId/leads/:conversationId/stage { stage_id }
router.put('/:tenantId/leads/:conversationId/stage', async (req, res) => {
  const { tenantId, conversationId } = req.params;
  const stageId = req.body?.stage_id ? String(req.body.stage_id) : '';

  if (!stageId) {
    return res.status(400).json({ success: false, error: 'stage_id is required' });
  }

  try {
    // Ensure stage exists (and defaults exist)
    const stages = await ensureDefaultStages(tenantId);
    const exists = stages.some((s) => String(s.id) === stageId);
    if (!exists) return res.status(400).json({ success: false, error: 'Unknown stage_id' });

    const now = new Date().toISOString();

    const { data: existing, error: exErr } = await dbClient
      .from('lead_pipeline_items')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('conversation_id', conversationId)
      .maybeSingle();

    if (exErr) throw exErr;

    if (existing?.id) {
      const { error: upErr } = await dbClient
        .from('lead_pipeline_items')
        .update({ stage_id: stageId, updated_at: now })
        .eq('id', existing.id);

      if (upErr) throw upErr;
    } else {
      const { error: insErr } = await dbClient
        .from('lead_pipeline_items')
        .insert({ tenant_id: tenantId, conversation_id: conversationId, stage_id: stageId, created_at: now, updated_at: now });

      if (insErr) throw insErr;
    }

    writeAuditLog({
      tenantId,
      action: 'lead.stage.move',
      entityType: 'conversation',
      entityId: conversationId,
      summary: 'Lead moved to new pipeline stage',
      metadata: { stage_id: stageId },
    }).catch(() => undefined);

    return res.json({ success: true });
  } catch (e) {
    if (isMissingPipelineTableError(e)) {
      console.warn('[LEADS_PIPELINE] set stage readonly (missing tables):', e?.message || e);
      return res.status(409).json({
        success: false,
        readonly: true,
        error: 'Pipeline storage is not available in this environment (read-only).',
      });
    }

    console.error('[LEADS_PIPELINE] set stage failed', e);
    return res.status(500).json({ success: false, error: e?.message || String(e) });
  }
});

module.exports = router;


