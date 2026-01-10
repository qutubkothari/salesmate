// Smoke test: message_templates CRUD + image fields (SQLite)
// Usage: node smoke_test_message_templates.js

const crypto = require('crypto');
const { dbClient } = require('./services/config');

async function main() {
  // Reuse an existing tenant if present (avoids FK + NOT NULL constraints).
  let tenantId = null;
  try {
    const { data: tenants } = await dbClient.from('tenants').select('id').limit(1);
    tenantId = tenants?.[0]?.id || null;
  } catch (_) {}

  if (!tenantId) {
    tenantId = 'smoke-tenant-' + crypto.randomUUID().slice(0, 8);
    try {
      await dbClient.from('tenants').insert({
        id: tenantId,
        business_name: 'Smoke Tenant',
        phone_number: '910000000000'
      });
    } catch (_) {
      // If tenant creation fails, template insert will likely fail too.
    }
  }

  const name = 'Smoke Template ' + crypto.randomUUID().slice(0, 6);
  const template_text = 'Hello {name} from {business}!';
  const message_type = 'image';
  const image_url = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=';

  const { data: inserted, error: insertErr } = await dbClient
    .from('message_templates')
    .insert({
      tenant_id: tenantId,
      name,
      template_text,
      message_type,
      image_url,
      category: 'image',
      variables: JSON.stringify(['name', 'business']),
      is_active: 1,
      updated_at: new Date().toISOString(),
    })
    .select('*')
    .single();

  if (insertErr) throw insertErr;
  if (!inserted?.id) throw new Error('Insert failed: no id returned');

  const templateId = inserted.id;

  const { data: fetched, error: fetchErr } = await dbClient
    .from('message_templates')
    .select('*')
    .eq('id', templateId)
    .single();

  if (fetchErr) throw fetchErr;
  if ((fetched?.message_type || 'text') !== message_type) throw new Error('message_type not persisted');
  if ((fetched?.image_url || '') !== image_url) throw new Error('image_url not persisted');

  // Increment usage_count
  const before = fetched?.usage_count || 0;
  await dbClient
    .from('message_templates')
    .update({ usage_count: before + 1, updated_at: new Date().toISOString() })
    .eq('id', templateId);

  const { data: fetched2 } = await dbClient
    .from('message_templates')
    .select('usage_count')
    .eq('id', templateId)
    .single();

  if ((fetched2?.usage_count || 0) !== before + 1) throw new Error('usage_count increment failed');

  // Cleanup
  await dbClient.from('message_templates').delete().eq('id', templateId);

  console.log('[SMOKE][TEMPLATES] OK', { tenantId, templateId });
}

main().catch((e) => {
  console.error('[SMOKE][TEMPLATES] FAILED', e);
  process.exit(1);
});
