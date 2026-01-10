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

  try {
    await waitForReady();
    const res = await fetch(`${base}/api/dashboard/reports/${tenantId}`);
    const body = await res.json().catch(() => ({}));

    console.log(
      JSON.stringify(
        {
          status: res.status,
          success: body.success,
          reports_keys: body.reports ? Object.keys(body.reports) : null,
          triage_total: body.reports?.triage?.total,
          pipeline_total: body.reports?.leadsPipeline?.total,
          broadcasts_today_total: body.reports?.broadcasts?.today?.total,
          audit_last24h: body.reports?.audit?.last24h,
        },
        null,
        2,
      ),
    );

    if (!res.ok || !body.success) process.exitCode = 1;
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
