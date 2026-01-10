const { spawn } = require('child_process');
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

  const serverProcess = spawn(process.execPath, ['index.js'], {
    cwd: process.cwd(),
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let outputBuffer = '';
  let ready = false;
  const startedAt = Date.now();

  const append = (chunk) => {
    const text = chunk.toString('utf8');
    outputBuffer += text;
    if (!ready && outputBuffer.includes('Server listening on port')) ready = true;
  };

  serverProcess.stdout.on('data', append);
  serverProcess.stderr.on('data', append);

  const waitForReady = async () => {
    while (!ready) {
      if (Date.now() - startedAt > 30000) throw new Error('Server start timeout (30s)');
      await new Promise((r) => setTimeout(r, 200));
    }
  };

  const base = 'http://127.0.0.1:8081';

  const postJson = async (path, data) => {
    const res = await fetch(base + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const body = await res.json().catch(() => ({}));
    return { status: res.status, body };
  };

  try {
    await waitForReady();

    const phone10 = makePhone10();

    // Add opt-out
    const addUnsub = await postJson(`/api/broadcast/unsubscribed/${tenantId}`, { phone_number: phone10 });
    if (!addUnsub.body?.success) throw new Error(`Failed to add opt-out: ${addUnsub.body?.error || addUnsub.status}`);

    // Schedule a follow-up due now
    const nowIso = new Date().toISOString();
    const db = new Database(dbPath);
    let followUpId;
    try {
      const info = db
        .prepare(
          `INSERT INTO scheduled_followups (tenant_id, end_user_phone, scheduled_time, description, original_request, conversation_context, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          tenantId,
          phone10,
          nowIso,
          'Smoke follow-up opt-out',
          'smoke',
          JSON.stringify({ smoke: true }),
          'scheduled',
          nowIso,
        );

      followUpId = info.lastInsertRowid;
      if (!followUpId) {
        const row = db
          .prepare('SELECT id FROM scheduled_followups WHERE tenant_id=? ORDER BY created_at DESC LIMIT 1')
          .get(tenantId);
        followUpId = row?.id;
      }
    } finally {
      db.close();
    }

    // Process due follow-ups
    const { processScheduledFollowUps } = require('../services/followUpSchedulerService');
    await processScheduledFollowUps();

    // Verify status is skipped
    const db2 = new Database(dbPath);
    try {
      const row = db2
        .prepare('SELECT id, status, error_message FROM scheduled_followups WHERE tenant_id=? AND end_user_phone=? ORDER BY created_at DESC LIMIT 1')
        .get(tenantId, phone10);

      console.log(
        JSON.stringify(
          {
            tenantId,
            phone10,
            addUnsub,
            followUpRow: row,
          },
          null,
          2,
        ),
      );

      if (!row) throw new Error('No scheduled_followups row found');
      if (String(row.status) !== 'skipped') throw new Error(`Expected status=skipped, got ${row.status}`);
    } finally {
      db2.close();
    }
  } catch (error) {
    console.error('SMOKE_FAIL:', error.message);
    console.error(outputBuffer.slice(-4000));
    process.exitCode = 1;
  } finally {
    try {
      serverProcess.kill('SIGINT');
    } catch {
      // ignore
    }
  }
}

main().catch((e) => {
  console.error('SMOKE_FAIL:', e.message);
  process.exitCode = 1;
});
