/**
 * Smoke Test: Reply Tracking (Inbound Messages -> Campaign Report)
 *
 * Validates DB wiring for reply tracking:
 * - inbound_messages table exists and can store inbound messages
 * - campaign report logic can detect a reply after sent_at/created_at
 *
 * Run with: node smoke_test_reply_tracking.js
 */

const { dbClient } = require('./services/config');

async function run() {
  const tenantId = `smoke_reply_${Date.now()}`;
  const campaignId = `campaign_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const phone = '919999888877';

  const now = new Date();
  const createdAt = new Date(now.getTime() - 60 * 1000).toISOString();
  const sentAt = new Date(now.getTime() - 30 * 1000).toISOString();
  const replyAt = new Date(now.getTime() - 5 * 1000).toISOString();

  console.log('1) Create tenant + campaign seed rows');
  await dbClient.from('tenants').insert({
    id: tenantId,
    business_name: 'Smoke Reply Tracking',
    owner_whatsapp_number: '911111111111',
    phone_number: '922222222222',
    created_at: createdAt
  });

  // bulk_schedules row used by campaign-report to resolve tenant_id + created_at
  await dbClient.from('bulk_schedules').insert({
    tenant_id: tenantId,
    campaign_id: campaignId,
    campaign_name: 'Reply Tracking Campaign',
    message_text: 'Hello',
    created_at: createdAt,
    scheduled_at: createdAt,
    status: 'sent',
    delivered_at: sentAt
  });

  console.log('2) Insert per-contact tracking row');
  // Local DB uses broadcast_campaign_recipients
  await dbClient.from('broadcast_campaign_recipients').insert({
    tenant_id: tenantId,
    campaign_id: campaignId,
    phone,
    status: 'sent',
    sent_at: sentAt,
    created_at: createdAt
  });

  console.log('3) Insert inbound reply after sent_at');
  await dbClient.from('inbound_messages').insert({
    tenant_id: tenantId,
    from_phone: phone,
    body: 'Yes, interested',
    received_at: replyAt,
    message_id: 'smoke-test'
  });

  console.log('4) Compute reply detection (mirrors API logic)');
  const { data: recipients } = await dbClient
    .from('broadcast_campaign_recipients')
    .select('phone, status, sent_at, error_message')
    .eq('campaign_id', campaignId);

  const { data: campaign } = await dbClient
    .from('bulk_schedules')
    .select('tenant_id, created_at')
    .eq('campaign_id', campaignId)
    .limit(1)
    .single();

  const phones = recipients.map((r) => String(r.phone).replace(/\D/g, '')).filter(Boolean);
  const { data: inbound } = await dbClient
    .from('inbound_messages')
    .select('from_phone, body, received_at')
    .eq('tenant_id', campaign.tenant_id)
    .in('from_phone', phones)
    .gte('received_at', campaign.created_at)
    .order('received_at', { ascending: false });

  const lastReplyByPhone = new Map();
  for (const m of inbound) {
    const p = String(m.from_phone || '').replace(/\D/g, '');
    if (!p) continue;
    if (!lastReplyByPhone.has(p)) {
      lastReplyByPhone.set(p, { replied_at: m.received_at, last_reply: m.body || '' });
    }
  }

  const r0 = recipients[0];
  const lr = lastReplyByPhone.get(String(r0.phone).replace(/\D/g, ''));
  const replied = !!(lr?.replied_at && r0.sent_at && new Date(lr.replied_at) >= new Date(r0.sent_at));

  if (!replied) {
    throw new Error('Expected replied=true but got false');
  }

  console.log('✅ Reply tracking detected reply correctly');

  console.log('5) Cleanup');
  await dbClient.from('inbound_messages').delete().eq('tenant_id', tenantId);
  await dbClient.from('broadcast_campaign_recipients').delete().eq('campaign_id', campaignId);
  await dbClient.from('bulk_schedules').delete().eq('campaign_id', campaignId);
  await dbClient.from('tenants').delete().eq('id', tenantId);

  console.log('🎉 smoke_test_reply_tracking PASSED');
}

if (require.main === module) {
  run().catch((e) => {
    console.error('❌ smoke_test_reply_tracking FAILED:', e?.message || e);
    process.exit(1);
  });
}
