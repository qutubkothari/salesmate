let warnedMissingTriageTable = false;

const { autoAssignTriageItemIfNeeded } = require('./triageRoutingService');

function isMissingTableError(err) {
  const msg = String(err?.message || err || '').toLowerCase();
  return (
    msg.includes('no such table') ||
    msg.includes('does not exist') ||
    msg.includes('relation') && msg.includes('does not exist')
  );
}

function nowIso() {
  return new Date().toISOString();
}

/**
 * Upsert a triage item for a conversation.
 * - If an open item exists (NEW/IN_PROGRESS), do nothing.
 * - If the latest item is CLOSED, reopen it.
 * - If none exists, create it.
 *
 * Safe in environments where triage_queue doesn't exist: it will no-op.
 */
async function upsertTriageForConversation(dbClient, {
  tenantId,
  conversationId,
  endUserPhone,
  type = 'HUMAN_ATTENTION',
  messagePreview = '',
  metadata = null,
}) {
  if (!dbClient) return { ok: false, skipped: true, reason: 'no_db' };
  if (!tenantId || !conversationId) return { ok: false, skipped: true, reason: 'missing_ids' };

  try {
    const { data: existingRows, error: selErr } = await dbClient
      .from('triage_queue')
      .select('id, status, assigned_to')
      .eq('tenant_id', tenantId)
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(1);

    if (selErr) throw selErr;

    const existing = Array.isArray(existingRows) ? existingRows[0] : null;
    const status = String(existing?.status || '').toUpperCase();

    if (existing && status && status !== 'CLOSED') {
      return { ok: true, action: 'noop', id: existing.id };
    }

    if (existing && status === 'CLOSED') {
      const { error: updErr } = await dbClient
        .from('triage_queue')
        .update({
          status: 'NEW',
          closed_reason: null,
          closed_at: null,
          updated_at: nowIso(),
        })
        .eq('id', existing.id);

      if (updErr) throw updErr;

      // Best-effort smart assign if still unassigned
      if (!existing.assigned_to) {
        await autoAssignTriageItemIfNeeded(dbClient, {
          tenantId,
          triageId: existing.id,
          seed: conversationId,
        });
      }
      return { ok: true, action: 'reopen', id: existing.id };
    }

    const { data: inserted, error: insErr } = await dbClient
      .from('triage_queue')
      .insert({
        tenant_id: tenantId,
        conversation_id: conversationId,
        end_user_phone: endUserPhone || null,
        type,
        status: 'NEW',
        assigned_to: null,
        message_preview: messagePreview || null,
        metadata: metadata ? JSON.stringify(metadata) : null,
        created_at: nowIso(),
        updated_at: nowIso(),
      })
      .select('id')
      .single();

    if (insErr) throw insErr;

    // Best-effort smart assign
    if (inserted?.id) {
      await autoAssignTriageItemIfNeeded(dbClient, {
        tenantId,
        triageId: inserted.id,
        seed: conversationId,
      });
    }

    return { ok: true, action: 'create', id: inserted?.id };
  } catch (e) {
    if (isMissingTableError(e)) {
      if (!warnedMissingTriageTable) {
        warnedMissingTriageTable = true;
        console.warn('[TRIAGE] triage_queue missing; auto-triage disabled in this environment');
      }
      return { ok: false, skipped: true, reason: 'missing_table' };
    }

    console.error('[TRIAGE] upsert failed', e);
    return { ok: false, error: e?.message || String(e) };
  }
}

module.exports = {
  upsertTriageForConversation,
};

