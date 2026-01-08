const { supabase } = require('./config');

/**
 * CRM feature keys.
 * Keep these stable so older clients can depend on them.
 */
const CRM_FEATURES = Object.freeze({
  CRM_CORE: 'crm_core',
  CRM_USERS: 'crm_users',
  CRM_LEADS: 'crm_leads',
  CRM_CONVERSATIONS: 'crm_conversations',
  CRM_INGEST: 'crm_ingest',
  CRM_TRIAGE: 'crm_triage',
  CRM_ASSIGNMENT: 'crm_assignment',
  CRM_AI_ASSIST: 'crm_ai_assist',
  CRM_GMAIL: 'crm_gmail',
  CRM_TEMPLATES: 'crm_templates',
  CRM_NOTIFICATIONS: 'crm_notifications',
  CRM_AUDIT: 'crm_audit',
  CRM_SLA: 'crm_sla'
});

function normalizeTier(tier) {
  const t = String(tier || '').toLowerCase().trim();
  if (!t) return 'standard';
  // Support your wording too.
  if (t === 'basic') return 'free';
  if (t === 'business') return 'standard';
  return t;
}

function tierDefaults(tierRaw) {
  const tier = normalizeTier(tierRaw);

  // Defaults are intentionally conservative; you can open more features per tier.
  // Any tenant can override via tenants.enabled_features.
  const defaults = {
    free: {
      [CRM_FEATURES.CRM_CORE]: false,
      [CRM_FEATURES.CRM_USERS]: false,
      [CRM_FEATURES.CRM_LEADS]: false,
      [CRM_FEATURES.CRM_CONVERSATIONS]: false,
      [CRM_FEATURES.CRM_INGEST]: false,
      [CRM_FEATURES.CRM_TRIAGE]: false,
      [CRM_FEATURES.CRM_ASSIGNMENT]: false,
      [CRM_FEATURES.CRM_AI_ASSIST]: false,
      [CRM_FEATURES.CRM_GMAIL]: false,
      [CRM_FEATURES.CRM_TEMPLATES]: false,
      [CRM_FEATURES.CRM_NOTIFICATIONS]: false,
      [CRM_FEATURES.CRM_AUDIT]: false,
      [CRM_FEATURES.CRM_SLA]: false
    },
    standard: {
      [CRM_FEATURES.CRM_CORE]: true,
      [CRM_FEATURES.CRM_USERS]: true,
      [CRM_FEATURES.CRM_LEADS]: true,
      [CRM_FEATURES.CRM_CONVERSATIONS]: true,
      [CRM_FEATURES.CRM_INGEST]: true,
      [CRM_FEATURES.CRM_TRIAGE]: true,
      [CRM_FEATURES.CRM_ASSIGNMENT]: true,
      [CRM_FEATURES.CRM_AI_ASSIST]: false,
      [CRM_FEATURES.CRM_GMAIL]: false,
      [CRM_FEATURES.CRM_TEMPLATES]: true,
      [CRM_FEATURES.CRM_NOTIFICATIONS]: true,
      [CRM_FEATURES.CRM_AUDIT]: true,
      [CRM_FEATURES.CRM_SLA]: true
    },
    premium: {
      [CRM_FEATURES.CRM_CORE]: true,
      [CRM_FEATURES.CRM_USERS]: true,
      [CRM_FEATURES.CRM_LEADS]: true,
      [CRM_FEATURES.CRM_CONVERSATIONS]: true,
      [CRM_FEATURES.CRM_INGEST]: true,
      [CRM_FEATURES.CRM_TRIAGE]: true,
      [CRM_FEATURES.CRM_ASSIGNMENT]: true,
      [CRM_FEATURES.CRM_AI_ASSIST]: true,
      [CRM_FEATURES.CRM_GMAIL]: false,
      [CRM_FEATURES.CRM_TEMPLATES]: true,
      [CRM_FEATURES.CRM_NOTIFICATIONS]: true,
      [CRM_FEATURES.CRM_AUDIT]: true,
      [CRM_FEATURES.CRM_SLA]: true
    },
    enterprise: {
      [CRM_FEATURES.CRM_CORE]: true,
      [CRM_FEATURES.CRM_USERS]: true,
      [CRM_FEATURES.CRM_LEADS]: true,
      [CRM_FEATURES.CRM_CONVERSATIONS]: true,
      [CRM_FEATURES.CRM_INGEST]: true,
      [CRM_FEATURES.CRM_TRIAGE]: true,
      [CRM_FEATURES.CRM_ASSIGNMENT]: true,
      [CRM_FEATURES.CRM_AI_ASSIST]: true,
      [CRM_FEATURES.CRM_GMAIL]: true,
      [CRM_FEATURES.CRM_TEMPLATES]: true,
      [CRM_FEATURES.CRM_NOTIFICATIONS]: true,
      [CRM_FEATURES.CRM_AUDIT]: true,
      [CRM_FEATURES.CRM_SLA]: true
    }
  };

  return defaults[tier] || defaults.standard;
}

function coerceBoolean(value) {
  if (value === true || value === false) return value;
  if (value === 1 || value === 0) return Boolean(value);
  if (value == null) return undefined;
  const s = String(value).toLowerCase().trim();
  if (['true', '1', 'yes', 'y', 'on'].includes(s)) return true;
  if (['false', '0', 'no', 'n', 'off'].includes(s)) return false;
  return undefined;
}

function mergeFeatures(defaults, overrides) {
  const out = { ...defaults };
  if (!overrides || typeof overrides !== 'object') return out;
  for (const [k, v] of Object.entries(overrides)) {
    const b = coerceBoolean(v);
    if (b === undefined) continue;
    out[k] = b;
  }
  return out;
}

async function getTenantRowById(tenantId) {
  const { data, error } = await supabase
    .from('tenants')
    .select('id, subscription_tier, enabled_features')
    .eq('id', tenantId)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function getEffectiveFeaturesForTenant(tenantId) {
  const tenant = await getTenantRowById(tenantId);
  if (!tenant) return null;
  const defaults = tierDefaults(tenant.subscription_tier);
  const effective = mergeFeatures(defaults, tenant.enabled_features);
  return {
    tenantId: tenant.id,
    subscriptionTier: normalizeTier(tenant.subscription_tier),
    defaults,
    overrides: tenant.enabled_features || {},
    effective
  };
}

async function isFeatureEnabled(tenantId, featureKey) {
  const info = await getEffectiveFeaturesForTenant(tenantId);
  if (!info) return false;
  return info.effective[featureKey] === true;
}

module.exports = {
  CRM_FEATURES,
  tierDefaults,
  getEffectiveFeaturesForTenant,
  isFeatureEnabled
};
