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
  const tail = String(rand).padStart(9, '0');
  return `9${tail}`; // 10-digit
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

    const unsub10 = makePhone10();
    const sub10 = makePhone10();

    // Add opt-out using 10-digit input (backend should canonicalize to 91+10)
    const addUnsub = await postJson(`/api/broadcast/unsubscribed/${tenantId}`, { phone_number: unsub10 });

    // Now broadcast send (force Maytapi so it schedules without needing WA connectivity)
    const send = await postJson('/api/broadcast/send', {
      tenantId,
      campaignName: `Smoke OptOut ${Date.now()}`,
      message: 'Test message',
      recipients: [unsub10, sub10],
      scheduleType: 'now',
      forceMethod: 'maytapi',
      messageType: 'text',
    });

    console.log(
      JSON.stringify(
        {
          tenantId,
          unsub10,
          sub10,
          addUnsub,
          send,
        },
        null,
        2,
      ),
    );

    if (!addUnsub.body?.success) throw new Error(`Unsubscribe add failed: ${addUnsub.body?.error || addUnsub.status}`);
    if (!send.body?.success) throw new Error(`Broadcast send failed: ${send.body?.error || send.status}`);

    const skipped = send.body?.details?.skipped_unsubscribed;
    const attempted = send.body?.details?.attempted;

    if (skipped !== 1) throw new Error(`Expected skipped_unsubscribed=1, got ${skipped}`);
    if (attempted !== 1) throw new Error(`Expected attempted=1, got ${attempted}`);
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
