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

  const putJson = async (path, data) => {
    const res = await fetch(base + path, {
      method: 'PUT',
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

  try {
    await waitForReady();

    const create = await postJson('/api/broadcast/templates', {
      tenantId,
      templateName: `Smoke Template ${Date.now()}`,
      messageText: 'Hello {{name}}, this is a test template.',
      category: 'smoke',
      variables: ['name'],
      isActive: true,
    });

    const createdId = create.body?.template?.id || null;

    const list1 = await getJson(`/api/broadcast/templates/${tenantId}`);

    const update = createdId
      ? await putJson(`/api/broadcast/templates/${createdId}`, {
          templateName: `Smoke Template Updated ${Date.now()}`,
          messageText: 'Updated text {{name}}',
          category: 'smoke',
          variables: ['name'],
          isActive: true,
        })
      : null;

    const use = createdId ? await putJson(`/api/broadcast/templates/${createdId}/use`, {}) : null;

    const del = createdId ? await delJson(`/api/broadcast/templates/${createdId}`) : null;

    const list2 = await getJson(`/api/broadcast/templates/${tenantId}`);

    console.log(
      JSON.stringify(
        {
          tenantId,
          create,
          list1_count: Array.isArray(list1.body?.templates) ? list1.body.templates.length : null,
          update,
          use,
          del,
          list2_count: Array.isArray(list2.body?.templates) ? list2.body.templates.length : null,
        },
        null,
        2,
      ),
    );
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
