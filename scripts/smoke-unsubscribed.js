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

function makeTestPhone() {
  // 10-digit number, stable enough for smoke testing
  const tail = String(Date.now()).slice(-9);
  return `9${tail}`;
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

  const getJson = async (path) => {
    const res = await fetch(base + path);
    const body = await res.json().catch(() => ({}));
    return { status: res.status, body };
  };

  const postJson = async (path, data) => {
    const res = await fetch(base + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const body = await res.json().catch(() => ({}));
    return { status: res.status, body };
  };

  const delJson = async (path) => {
    const res = await fetch(base + path, { method: 'DELETE' });
    const body = await res.json().catch(() => ({}));
    return { status: res.status, body };
  };

  const phone = makeTestPhone();

  try {
    await waitForReady();

    const add = await postJson(`/api/broadcast/unsubscribed/${tenantId}`, { phone_number: phone });
    const list1 = await getJson(`/api/broadcast/unsubscribed/${tenantId}?limit=50`);
    const remove = await delJson(`/api/broadcast/unsubscribed/${tenantId}/${phone}`);
    const list2 = await getJson(`/api/broadcast/unsubscribed/${tenantId}?limit=50`);

    const list1Phones = Array.isArray(list1.body?.items) ? list1.body.items.map((x) => x.phone_number) : [];
    const list2Phones = Array.isArray(list2.body?.items) ? list2.body.items.map((x) => x.phone_number) : [];

    console.log(
      JSON.stringify(
        {
          tenantId,
          phone,
          add,
          list1_count: list1Phones.length,
          list1_includes_phone: list1Phones.includes(phone),
          remove,
          list2_count: list2Phones.length,
          list2_includes_phone: list2Phones.includes(phone),
        },
        null,
        2,
      ),
    );

    if (!add.body?.success) throw new Error(`Add failed: ${add.body?.error || add.status}`);
    if (!list1.body?.success) throw new Error(`List1 failed: ${list1.body?.error || list1.status}`);
    if (!remove.body?.success) throw new Error(`Remove failed: ${remove.body?.error || remove.status}`);
    if (!list2.body?.success) throw new Error(`List2 failed: ${list2.body?.error || list2.status}`);
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
