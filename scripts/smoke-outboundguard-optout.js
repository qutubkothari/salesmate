// scripts/smoke-outboundguard-optout.js
// Verifies outboundGuard does NOT block sends when maytapiService is missing,
// but DOES block unsubscribed recipients.

const assert = require('assert');

const Database = require('better-sqlite3');
const { canonicalUnsubscribeKey, toDigits } = require('../services/unsubscribeService');

function ensureUnsubTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS unsubscribed_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone_number TEXT UNIQUE,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

function upsertUnsubscribed(db, phoneDigits) {
  const canonical = canonicalUnsubscribeKey(phoneDigits);
  db.prepare(`INSERT OR IGNORE INTO unsubscribed_users (phone_number) VALUES (?)`).run(canonical);
  return canonical;
}

function removeUnsubscribed(db, phoneDigits) {
  const canonical = canonicalUnsubscribeKey(phoneDigits);
  db.prepare(`DELETE FROM unsubscribed_users WHERE phone_number = ?`).run(canonical);
  return canonical;
}

async function main() {
  const dbPath = process.env.SQLITE_DB_PATH || process.env.DB_PATH || './local-database.db';
  const db = new Database(dbPath);
  ensureUnsubTable(db);

  // Reset any prior init from previous runs.
  delete global.__outboundGuardInit;

  // Provide a legacy/original sender that outboundGuard should fall back to.
  global.sendWhatsAppText = async (to, text) => ({ ok: true, via: 'orig', to: String(to), text: String(text) });

  const { initOutbound } = require('../services/outboundGuard');
  initOutbound();

  const allowed = toDigits('919999990001');
  const blocked = toDigits('919999990002');

  // Ensure clean state.
  removeUnsubscribed(db, allowed);
  removeUnsubscribed(db, blocked);

  // 1) Allowed number should fall back to original (since maytapiService is missing)
  const allowedRes = await global.sendWhatsAppText(allowed, 'hello');
  assert.strictEqual(allowedRes?.ok, true);
  assert.strictEqual(allowedRes?.via, 'orig');

  // 2) Unsubscribed number should be blocked (no fallback)
  const canonical = upsertUnsubscribed(db, blocked);
  const blockedRes = await global.sendWhatsAppText(blocked, 'hello');
  assert.strictEqual(blockedRes?.ok, false);
  assert.strictEqual(blockedRes?.skipped, true);
  assert.strictEqual(blockedRes?.reason, 'unsubscribed');

  console.log(JSON.stringify({
    ok: true,
    allowed: { to: allowed, res: allowedRes },
    blocked: { to: blocked, canonical, res: blockedRes }
  }, null, 2));

  db.close();
}

main().catch(err => {
  console.error('smoke-outboundguard-optout failed:', err);
  process.exit(1);
});
