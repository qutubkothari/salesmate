// Smoke test: daily limit enforcement logic (SQLite)
// This test does NOT hit HTTP endpoints; it validates DB state assumptions used by /api/broadcast/send.
// Usage: node smoke_test_daily_limit_enforcement.js

const crypto = require('crypto');
const { dbClient } = require('./services/config');

async function main() {
  // Pick an existing tenant to avoid FK/NOT NULL issues.
  const { data: tenants } = await dbClient.from('tenants').select('id, daily_message_limit').limit(1);
  const tenantId = tenants?.[0]?.id;
  if (!tenantId) throw new Error('No tenant found to run smoke test');

  const dailyLimit = 3;
  await dbClient.from('tenants').update({ daily_message_limit: dailyLimit }).eq('id', tenantId);

  // Clear today's sent rows for this tenant (best-effort)
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  try {
    await dbClient
      .from('bulk_schedules')
      .delete()
      .eq('tenant_id', tenantId)
      .eq('status', 'sent')
      .gte('delivered_at', today.toISOString());
  } catch (_) {}

  // Insert 2 sent messages for today
  const now = new Date().toISOString();
  const campaignId = 'smoke-campaign-' + crypto.randomUUID().slice(0, 8);
  const sentRows = [
    { tenant_id: tenantId, campaign_id: campaignId, campaign_name: 'Smoke', to_phone_number: '910000000001', message_text: 'x', message_body: 'x', status: 'sent', delivered_at: now, created_at: now, updated_at: now },
    { tenant_id: tenantId, campaign_id: campaignId, campaign_name: 'Smoke', to_phone_number: '910000000002', message_text: 'x', message_body: 'x', status: 'sent', delivered_at: now, created_at: now, updated_at: now }
  ];
  await dbClient.from('bulk_schedules').insert(sentRows);

  // Count like the route does
  const { data: counted } = await dbClient
    .from('bulk_schedules')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('status', 'sent')
    .gte('delivered_at', today.toISOString());

  const sentToday = counted?.length || 0;
  const remaining = Math.max(0, dailyLimit - sentToday);

  if (sentToday !== 2) throw new Error('Expected sentToday=2, got ' + sentToday);
  if (remaining !== 1) throw new Error('Expected remaining=1, got ' + remaining);

  console.log('[SMOKE][DAILY_LIMIT] OK', { tenantId, dailyLimit, sentToday, remaining });
}

main().catch((e) => {
  console.error('[SMOKE][DAILY_LIMIT] FAILED', e);
  process.exit(1);
});
