// services/conversationFlagService.js
// Crash-proof, minimal implementation used by scheduler.js and tests.
// Keeps running even if the DB/table isn't present yet.

const { dbClient } = require('./config');

function nowIso() { return new Date().toISOString(); }

/**
 * Flags inactive conversations for follow-up.
 * Looks for rows in `conversations` that haven't updated in `minutes` and are still open.
 * If `conversation_flags` table doesn't exist yet, this becomes a no-op with a warning.
 */
async function flagInactiveConversations({ tenantId = null, minutes = 60 } = {}) {
  const cutoffMinutes = Math.max(1, Number(minutes) || 60);
  const since = new Date(Date.now() - cutoffMinutes * 60 * 1000).toISOString();

  try {
    // 1) Find inactive, open conversations
    let q = dbClient
      .from('conversations_new')
      .select('id, tenant_id, updated_at, status')
      .lte('updated_at', since)
      .eq('status', 'open')
      .limit(1000);

    if (tenantId) q = q.eq('tenant_id', tenantId);

    const { data: convs, error: convErr } = await q;
    if (convErr) throw convErr;

    if (!convs || convs.length === 0) return { ok: true, flagged: 0, ts: nowIso() };

    // 2) Upsert flags
    const flags = convs.map(c => ({
      conversation_id: c.id,
      tenant_id: c.tenant_id,
      reason: 'inactive',
      flagged_at: nowIso(),
      meta: { since, minutes: cutoffMinutes }
    }));

    const { error: upErr } = await dbClient
      .from('conversation_flags')
      .upsert(flags, { onConflict: 'conversation_id' });

    if (upErr) throw upErr;

    return { ok: true, flagged: flags.length, ts: nowIso() };
  } catch (e) {
    console.warn('[conversationFlagService.flagInactiveConversations] noop:', e?.message || e);
    return { ok: false, flagged: 0, error: String(e?.message || e), ts: nowIso() };
  }
}

/**
 * Clears flags for a tenant or a single conversation.
 */
async function clearFlags({ tenantId = null, conversationId = null } = {}) {
  try {
    let q = dbClient.from('conversation_flags').delete();
    if (conversationId) q = q.eq('conversation_id', conversationId);
    if (tenantId) q = q.eq('tenant_id', tenantId);
    const { error } = await q;
    if (error) throw error;
    return { ok: true, ts: nowIso() };
  } catch (e) {
    console.warn('[conversationFlagService.clearFlags] noop:', e?.message || e);
    return { ok: false, error: String(e?.message || e), ts: nowIso() };
  }
}

/**
 * Returns a small summary for health checks.
 */
async function getFlagSummary() {
  try {
    const { count, error } = await dbClient
      .from('conversation_flags')
      .select('*', { count: 'exact', head: true });
    if (error) throw error;
    return { ok: true, flags: count || 0, ts: nowIso() };
  } catch (e) {
    // If table missing, still return ok:false but do not crash the app.
    return { ok: false, flags: 0, error: String(e?.message || e), ts: nowIso() };
  }
}

module.exports = {
  flagInactiveConversations,
  clearFlags,
  getFlagSummary
};


