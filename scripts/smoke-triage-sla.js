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

function getLatestSlaAuditEvent(dbPath, tenantId) {
  const db = new Database(dbPath);
  try {
    return (
      db
        .prepare(
          "SELECT id, tenant_id, actor_type, actor_id, actor_name, action, entity_type, entity_id, summary, metadata, created_at FROM audit_logs WHERE tenant_id = ? AND action = 'triage.sla.update' ORDER BY created_at DESC LIMIT 1",
        )
        .get(tenantId) || null
    );
  } finally {
    db.close();
  }
}

async function main() {
  const dbPath = process.env.SQLITE_DB_PATH || process.env.DB_PATH || './local-database.db';
  const tenantId = getFirstTenantId(dbPath);
  if (!tenantId) {
    throw new Error('No tenants found; cannot smoke-test SLA endpoints');
  }

  const serverProcess = spawn(process.execPath, ['index.js'], {
    cwd: process.cwd(),
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let outputBuffer = '';
  let ready = false;

  const append = (chunk) => {
    const text = chunk.toString('utf8');
    outputBuffer += text;
    if (!ready && outputBuffer.includes('Server listening on port')) {
      ready = true;
    }
  };

  serverProcess.stdout.on('data', append);
  serverProcess.stderr.on('data', append);

  const startedAt = Date.now();
  const waitForReady = async () => {
    while (!ready) {
      if (Date.now() - startedAt > 30000) {
        throw new Error('Server start timeout (30s)');
      }
      await new Promise((r) => setTimeout(r, 200));
    }
  };

  const base = 'http://127.0.0.1:8081';
  const getJson = async (path) => {
    const res = await fetch(base + path);
    let body = {};
    try {
      body = await res.json();
    } catch {
      // ignore
    }
    return { status: res.status, body };
  };

  const putJson = async (path, data) => {
    const res = await fetch(base + path, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    let body = {};
    try {
      body = await res.json();
    } catch {
      // ignore
    }
    return { status: res.status, body };
  };

  try {
    await waitForReady();

    const before = await getJson(`/api/triage/${tenantId}/sla-config`);
    const saved = await putJson(`/api/triage/${tenantId}/sla-config`, { enabled: true, minutes: 30 });
    const after = await getJson(`/api/triage/${tenantId}/sla-config`);
    const list = await getJson(`/api/triage/${tenantId}`);

    const audit = getLatestSlaAuditEvent(dbPath, tenantId);

    const items = list.body?.items || list.body?.triage || [];

    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify(
        {
          tenantId,
          before,
          saved,
          after,
          audit,
          triage_list_first_item: items[0] || null,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('SMOKE_FAIL:', error.message);
    // eslint-disable-next-line no-console
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
  // eslint-disable-next-line no-console
  console.error('SMOKE_FAIL:', e.message);
  process.exitCode = 1;
});
