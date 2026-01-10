// scripts/smoke-document-optout-lowlevel.js
// Confirms low-level whatsappService.sendDocument blocks unsubscribed recipients.

const Database = require('better-sqlite3');

function getFirstTenantId(dbPath) {
  const db = new Database(dbPath);
  try {
    const row = db.prepare('SELECT id FROM tenants ORDER BY created_at ASC LIMIT 1').get();
    return row?.id || null;
  } finally {
    db.close();
  }
}

function makePhone10() {
  const rand = Math.floor(Math.random() * 1e9);
  return `9${String(rand).padStart(9, '0')}`;
}

async function main() {
  const dbPath = process.env.SQLITE_DB_PATH || process.env.DB_PATH || './local-database.db';
  const tenantId = getFirstTenantId(dbPath);
  if (!tenantId) throw new Error('No tenants found');

  const phone10 = makePhone10();

  const { canonicalUnsubscribeKey } = require('../services/unsubscribeService');
  const canonical = canonicalUnsubscribeKey(phone10);
  if (!canonical) throw new Error('Failed to canonicalize phone');

  const db = new Database(dbPath);
  try {
    db.prepare('INSERT OR IGNORE INTO unsubscribed_users (phone_number) VALUES (?)').run(canonical);
  } finally {
    db.close();
  }

  const { sendDocument } = require('../services/whatsappService');
  const buf = Buffer.from('%PDF-1.4\n%\u00E2\u00E3\u00CF\u00D3\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n');

  const res = await sendDocument(canonical, buf, 'smoke.pdf', 'Smoke doc opt-out', tenantId);

  console.log(JSON.stringify({ tenantId, phone10, canonical, sendDocumentResult: res }, null, 2));

  if (res !== null) {
    throw new Error('Expected sendDocument to return null when unsubscribed');
  }
}

main().catch((e) => {
  console.error('SMOKE_FAIL:', e.message);
  process.exitCode = 1;
});
