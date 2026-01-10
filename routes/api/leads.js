const express = require('express');
const router = express.Router();
const { dbClient } = require('../../services/config');

const USE_LOCAL_DB = String(process.env.USE_LOCAL_DB || '').toLowerCase() === 'true';

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

// Leads (list)
// GET /api/leads/:tenantId?score=HOT|WARM|COLD&requiresAttention=true|false&q=phoneOrText&limit=200
router.get('/:tenantId', async (req, res) => {
  const { tenantId } = req.params;
  const { score, q } = req.query;
  const requiresAttention = toBool(req.query.requiresAttention);
  const limit = Math.min(Number(req.query.limit) || 200, 500);

  try {
    let convQuery = dbClient.from('conversations');
    if (USE_LOCAL_DB) {
      // Local SQLite schemas can drift; select('*') avoids hard failures.
      convQuery = convQuery.select('*');
    } else {
      convQuery = convQuery.select('id, tenant_id, end_user_phone, lead_score, requires_human_attention, triage_status, updated_at, created_at');
    }

    const { data, error } = await convQuery
      .eq('tenant_id', tenantId)
      .order('updated_at', { ascending: false })
      .limit(limit);

    if (error) throw error;

    let leads = Array.isArray(data) ? data : [];

    // Default "lead" criteria: scored leads or requires human attention.
    leads = leads.filter((c) => {
      const hasScore = c.lead_score !== null && c.lead_score !== undefined && String(c.lead_score).trim() !== '';
      const needsHuman = c.requires_human_attention === true || c.requires_human_attention === 1;
      return hasScore || needsHuman;
    });

    if (score) {
      const s = String(score).toUpperCase();
      leads = leads.filter((c) => String(c.lead_score || '').toUpperCase() === s);
    }

    if (requiresAttention !== undefined) {
      leads = leads.filter((c) => (c.requires_human_attention === true || c.requires_human_attention === 1) === requiresAttention);
    }

    // Attach a message preview (same concept as /api/dashboard/conversations)
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
            // Compatibility with older UI mapping
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

    // Default ordering for Leads tab: needs-attention first, then score, then recent.
    // (No new UI â€” just ordering.)
    leads.sort((a, b) => {
      const ka = leadSortKey(a);
      const kb = leadSortKey(b);

      if (ka.needsAttention !== kb.needsAttention) return ka.needsAttention ? -1 : 1;
      if (ka.scoreRank !== kb.scoreRank) return kb.scoreRank - ka.scoreRank;
      return kb.ts - ka.ts;
    });

    return res.json({ success: true, leads });
  } catch (e) {
    console.error('[LEADS] list failed', e);
    return res.status(500).json({ success: false, error: e?.message || String(e) });
  }
});

module.exports = router;

