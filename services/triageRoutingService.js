function stableHash(input) {
  // Small deterministic hash for tie-breaking; not crypto.
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function nowIso() {
  return new Date().toISOString();
}

function isMissingTableError(err) {
  const msg = String(err?.message || err || '').toLowerCase();
  return (
    msg.includes('no such table') ||
    msg.includes('does not exist') ||
    (msg.includes('relation') && msg.includes('does not exist'))
  );
}

const DEFAULT_CONFIG = Object.freeze({
  strategy: 'LEAST_ACTIVE',
  autoAssign: true,
  considerCapacity: true,
  considerScore: false,
});

const KPI_SCORE_CACHE_MS = Number(process.env.TRIAGE_KPI_SCORE_CACHE_MS || 5 * 60 * 1000);
const KPI_LOOKBACK_DAYS_WINS = Number(process.env.TRIAGE_KPI_WINS_LOOKBACK_DAYS || 45);
const KPI_LOOKBACK_DAYS_ACTIVITY = Number(process.env.TRIAGE_KPI_ACTIVITY_LOOKBACK_DAYS || 14);

const _kpiCache = new Map(); // tenantId => { at, scoresByUserId: Map<string, number> }

function clamp01(n) {
  return Math.max(0, Math.min(1, n));
}

function normalizeByMinMax(valuesByKey) {
  const keys = Array.from(valuesByKey.keys());
  if (keys.length === 0) return new Map();
  let min = Infinity;
  let max = -Infinity;
  for (const k of keys) {
    const v = Number(valuesByKey.get(k) || 0);
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const out = new Map();
  const denom = max - min;
  for (const k of keys) {
    const v = Number(valuesByKey.get(k) || 0);
    out.set(k, denom <= 0 ? 0.5 : clamp01((v - min) / denom));
  }
  return out;
}

async function computeKpiScoresByUserId(dbClient, tenantId, { users, loadBy } = {}) {
  if (!dbClient || !tenantId) return new Map();

  const now = Date.now();
  const cached = _kpiCache.get(String(tenantId));
  if (cached && now - cached.at < KPI_SCORE_CACHE_MS) return cached.scoresByUserId;

  const activeUserIds = (Array.isArray(users) ? users : []).map((u) => String(u.id));
  if (activeUserIds.length === 0) return new Map();

  const winsByUser = new Map(activeUserIds.map((id) => [id, 0]));
  const activityByUser = new Map(activeUserIds.map((id) => [id, 0]));
  const avgCloseHoursByUser = new Map(activeUserIds.map((id) => [id, 0]));

  const sinceWinsIso = new Date(Date.now() - KPI_LOOKBACK_DAYS_WINS * 24 * 60 * 60 * 1000).toISOString();
  const sinceActivityIso = new Date(Date.now() - KPI_LOOKBACK_DAYS_ACTIVITY * 24 * 60 * 60 * 1000).toISOString();

  // 1) Deals closed (Won): infer by pipeline stage is_won and attribute to current triage assignee via conversation_id
  try {
    const { data: wonStages, error: stageErr } = await dbClient
      .from('lead_pipeline_stages')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('is_won', 1)
      .limit(50);

    if (!stageErr && Array.isArray(wonStages) && wonStages.length > 0) {
      const wonStageIds = wonStages.map((s) => String(s.id));

      const { data: wonItems, error: itemsErr } = await dbClient
        .from('lead_pipeline_items')
        .select('conversation_id, updated_at')
        .eq('tenant_id', tenantId)
        .in('stage_id', wonStageIds)
        .gte('updated_at', sinceWinsIso)
        .order('updated_at', { ascending: false })
        .limit(300);

      if (!itemsErr && Array.isArray(wonItems) && wonItems.length > 0) {
        const convIds = Array.from(new Set(wonItems.map((i) => String(i.conversation_id)).filter(Boolean)));
        if (convIds.length > 0) {
          const { data: triageRows, error: triageErr } = await dbClient
            .from('triage_queue')
            .select('conversation_id, assigned_to')
            .eq('tenant_id', tenantId)
            .in('conversation_id', convIds)
            .not('assigned_to', 'is', null)
            .limit(1000);

          if (!triageErr && Array.isArray(triageRows)) {
            for (const r of triageRows) {
              const uid = r?.assigned_to ? String(r.assigned_to) : '';
              if (!uid || !winsByUser.has(uid)) continue;
              winsByUser.set(uid, (winsByUser.get(uid) || 0) + 1);
            }
          }
        }
      }
    }
  } catch (e) {
    // best-effort; missing tables in some envs
  }

  // 2) Salesman responsiveness/activity: recent updates and closed-time on triage items
  try {
    const { data: recentTriage, error: triageErr } = await dbClient
      .from('triage_queue')
      .select('assigned_to, status, created_at, updated_at, closed_at')
      .eq('tenant_id', tenantId)
      .not('assigned_to', 'is', null)
      .gte('updated_at', sinceActivityIso)
      .limit(2000);

    if (!triageErr && Array.isArray(recentTriage) && recentTriage.length > 0) {
      const closeSums = new Map(activeUserIds.map((id) => [id, { sumHours: 0, count: 0 }]));

      for (const row of recentTriage) {
        const uid = row?.assigned_to ? String(row.assigned_to) : '';
        if (!uid || !activityByUser.has(uid)) continue;

        activityByUser.set(uid, (activityByUser.get(uid) || 0) + 1);

        const status = String(row?.status || '').toUpperCase();
        if (status === 'CLOSED' && row?.closed_at && row?.created_at) {
          const created = Date.parse(row.created_at);
          const closed = Date.parse(row.closed_at);
          if (Number.isFinite(created) && Number.isFinite(closed) && closed >= created) {
            const hours = (closed - created) / (1000 * 60 * 60);
            const bucket = closeSums.get(uid);
            if (bucket) {
              bucket.sumHours += hours;
              bucket.count += 1;
            }
          }
        }
      }

      for (const [uid, bucket] of closeSums.entries()) {
        if (bucket.count > 0) avgCloseHoursByUser.set(uid, bucket.sumHours / bucket.count);
      }
    }
  } catch (e) {
    // best-effort
  }

  // 3) Combine into a 0-100 score (higher is better)
  const winsNorm = normalizeByMinMax(winsByUser);
  const activityNorm = normalizeByMinMax(activityByUser);

  // Lower avg close hours is better
  const closeSpeedInv = new Map();
  for (const uid of activeUserIds) {
    closeSpeedInv.set(uid, -Number(avgCloseHoursByUser.get(uid) || 0));
  }
  const closeSpeedNorm = normalizeByMinMax(closeSpeedInv);

  // Lower load is better
  const loadInv = new Map();
  for (const uid of activeUserIds) {
    const load = loadBy?.get(uid) || 0;
    loadInv.set(uid, -Number(load));
  }
  const loadNorm = normalizeByMinMax(loadInv);

  const scoresByUserId = new Map();
  for (const uid of activeUserIds) {
    const score01 =
      0.45 * (winsNorm.get(uid) ?? 0.5) +
      0.25 * (closeSpeedNorm.get(uid) ?? 0.5) +
      0.20 * (activityNorm.get(uid) ?? 0.5) +
      0.10 * (loadNorm.get(uid) ?? 0.5);
    scoresByUserId.set(uid, Math.round(100 * clamp01(score01)));
  }

  _kpiCache.set(String(tenantId), { at: now, scoresByUserId });
  return scoresByUserId;
}

async function getTriageAssignmentConfig(dbClient, tenantId) {
  // Allow quick opt-out without schema/config.
  if (String(process.env.TRIAGE_AUTO_ASSIGN || '').toLowerCase() === 'false') {
    return { ...DEFAULT_CONFIG, autoAssign: false };
  }

  if (!dbClient || !tenantId) return { ...DEFAULT_CONFIG };

  try {
    const { data, error } = await dbClient
      .from('triage_assignment_config')
      .select('strategy, auto_assign, consider_capacity, consider_score')
      .eq('tenant_id', tenantId)
      .limit(1);

    if (error) throw error;

    const row = Array.isArray(data) ? data[0] : null;
    if (!row) return { ...DEFAULT_CONFIG };

    return {
      strategy: String(row.strategy || DEFAULT_CONFIG.strategy).toUpperCase(),
      autoAssign: row.auto_assign === 1 || row.auto_assign === true,
      considerCapacity: row.consider_capacity === 1 || row.consider_capacity === true,
      considerScore: row.consider_score === 1 || row.consider_score === true,
    };
  } catch (e) {
    // Config table may not exist in some environments; default silently.
    if (isMissingTableError(e)) return { ...DEFAULT_CONFIG };
    console.warn('[TRIAGE][ASSIGN] failed to load assignment config; using defaults', e?.message || String(e));
    return { ...DEFAULT_CONFIG };
  }
}

async function listActiveSalesUsers(dbClient, tenantId) {
  const { data, error } = await dbClient
    .from('sales_users')
    .select('id, name, phone, role, is_active, capacity, score')
    .eq('tenant_id', tenantId)
    .eq('is_active', 1)
    .order('created_at', { ascending: true })
    .limit(500);

  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

async function computeTriageLoadByAssignee(dbClient, tenantId) {
  // dbClient-js doesn't have groupBy; compute in JS.
  const { data, error } = await dbClient
    .from('triage_queue')
    .select('assigned_to, status')
    .eq('tenant_id', tenantId)
    .not('assigned_to', 'is', null)
    .limit(2000);

  if (error) throw error;
  const rows = Array.isArray(data) ? data : [];

  const loadBy = new Map();
  for (const row of rows) {
    const status = String(row?.status || '').toUpperCase();
    if (status === 'CLOSED') continue;
    const assigneeId = row?.assigned_to ? String(row.assigned_to) : '';
    if (!assigneeId) continue;
    loadBy.set(assigneeId, (loadBy.get(assigneeId) || 0) + 1);
  }

  return loadBy;
}

function pickLeastActive(users, loadBy, config, seed) {
  let best = null;
  let leastLoad = Infinity;

  for (const u of users) {
    const load = loadBy.get(String(u.id)) || 0;
    const capacity = Number(u.capacity || 0);

    if (config.considerCapacity && capacity > 0 && load >= capacity) {
      continue;
    }

    if (load < leastLoad) {
      leastLoad = load;
      best = u;
    } else if (load === leastLoad && best) {
      const h1 = stableHash(`${seed}:${u.id}`);
      const h2 = stableHash(`${seed}:${best.id}`);
      if (h1 > h2) best = u;
    }
  }

  return best;
}

function pickWeighted(users, loadBy, config, seed) {
  let best = null;
  let bestWeight = -Infinity;

  for (const u of users) {
    const load = loadBy.get(String(u.id)) || 0;
    const capacity = Number(u.capacity || 0);

    if (config.considerCapacity && capacity > 0 && load >= capacity) {
      continue;
    }

    const scoreNorm = config.considerScore ? Math.max(0, Math.min(1, Number(u.score || 0) / 100)) : 0.5;
    const loadNorm = 1 / (1 + load);
    const capNorm = capacity > 0 ? Math.max(0, Math.min(1, 1 - load / capacity)) : 0.5;

    const baseWeight = (config.considerScore ? 0.65 : 0.35) * scoreNorm + 0.3 * loadNorm + 0.05 * capNorm;
    const jitter = (stableHash(`${seed}:${u.id}`) % 1000) / 1_000_000;
    const weight = baseWeight + jitter;

    if (weight > bestWeight) {
      bestWeight = weight;
      best = u;
    }
  }

  return best;
}

async function pickAssigneeForTriage(dbClient, tenantId, opts) {
  if (!dbClient || !tenantId) return null;

  const seed = opts?.seed ?? '';
  const config = await getTriageAssignmentConfig(dbClient, tenantId);
  if (!config.autoAssign) return null;

  try {
    const users = await listActiveSalesUsers(dbClient, tenantId);
    if (users.length === 0) return null;

    const loadBy = await computeTriageLoadByAssignee(dbClient, tenantId);

    // If considerScore is enabled, compute KPI-driven scores and feed them into the existing scoring path.
    // This keeps the UX unchanged: smart-assign settings still control whether scoring is used.
    if (config.considerScore) {
      const kpiScores = await computeKpiScoresByUserId(dbClient, tenantId, { users, loadBy });
      for (const u of users) {
        const uid = String(u.id);
        if (kpiScores.has(uid)) u.score = kpiScores.get(uid);
      }
    }

    const strategy = String(config.strategy || '').toUpperCase();
    if (strategy === 'ROUND_ROBIN') {
      return pickWeighted(users, loadBy, config, seed);
    }

    // Default: LEAST_ACTIVE
    return pickLeastActive(users, loadBy, config, seed);
  } catch (e) {
    if (isMissingTableError(e)) return null;
    console.warn('[TRIAGE][ASSIGN] pickAssignee failed', e?.message || String(e));
    return null;
  }
}

async function autoAssignTriageItemIfNeeded(dbClient, { tenantId, triageId, seed }) {
  if (!dbClient || !tenantId || !triageId) return { ok: false, skipped: true, reason: 'missing_args' };

  if (String(process.env.TRIAGE_AUTO_ASSIGN || '').toLowerCase() === 'false') {
    return { ok: false, skipped: true, reason: 'disabled_env' };
  }

  try {
    const { data: rows, error: selErr } = await dbClient
      .from('triage_queue')
      .select('id, assigned_to, status')
      .eq('tenant_id', tenantId)
      .eq('id', triageId)
      .limit(1);

    if (selErr) throw selErr;

    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row) return { ok: false, skipped: true, reason: 'not_found' };
    if (row.assigned_to) return { ok: true, action: 'noop', assigned_to: row.assigned_to };

    const picked = await pickAssigneeForTriage(dbClient, tenantId, { seed: seed || triageId });
    if (!picked?.id) return { ok: false, skipped: true, reason: 'no_assignee' };

    const now = nowIso();
    const { error: updErr } = await dbClient
      .from('triage_queue')
      .update({
        assigned_to: String(picked.id),
        status: 'IN_PROGRESS',
        updated_at: now,
      })
      .eq('tenant_id', tenantId)
      .eq('id', triageId);

    if (updErr) throw updErr;

    return { ok: true, action: 'assigned', assigned_to: String(picked.id) };
  } catch (e) {
    if (isMissingTableError(e)) return { ok: false, skipped: true, reason: 'missing_table' };
    console.warn('[TRIAGE][ASSIGN] auto-assign failed', e?.message || String(e));
    return { ok: false, error: e?.message || String(e) };
  }
}

module.exports = {
  getTriageAssignmentConfig,
  pickAssigneeForTriage,
  autoAssignTriageItemIfNeeded,
};

