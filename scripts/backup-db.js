#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

function pad2(n) {
  return String(n).padStart(2, '0');
}

function timestampUtc() {
  const d = new Date();
  return `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}_${pad2(d.getUTCHours())}${pad2(d.getUTCMinutes())}${pad2(d.getUTCSeconds())}Z`;
}

function safeMkdirp(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function listFiles(dirPath) {
  try {
    return fs.readdirSync(dirPath).map((name) => path.join(dirPath, name));
  } catch {
    return [];
  }
}

function isFile(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function unlinkSafe(p) {
  try {
    fs.unlinkSync(p);
    return true;
  } catch {
    return false;
  }
}

function parseIntOrDefault(v, def) {
  const n = Number.parseInt(String(v ?? ''), 10);
  return Number.isFinite(n) ? n : def;
}

async function main() {
  const repoRoot = path.join(__dirname, '..');

  const dbPath =
    process.env.SQLITE_DB_PATH ||
    process.env.DB_PATH ||
    path.join(repoRoot, 'local-database.db');

  const backupsDir =
    process.env.SQLITE_BACKUP_DIR ||
    process.env.BACKUP_DIR ||
    path.join(repoRoot, 'backups');

  const retentionDays = parseIntOrDefault(process.env.SQLITE_BACKUP_RETENTION_DAYS || process.env.RETENTION_DAYS, 14);

  safeMkdirp(backupsDir);

  if (!fs.existsSync(dbPath)) {
    console.error(`[BACKUP] DB file not found: ${dbPath}`);
    process.exitCode = 2;
    return;
  }

  const Database = require('better-sqlite3');
  const db = new Database(dbPath);

  const outFile = path.join(backupsDir, `salesmate_${timestampUtc()}.db`);
  const tmpFile = `${outFile}.tmp`;

  const startedAt = Date.now();
  console.log(`[BACKUP] Starting SQLite backup`);
  console.log(`[BACKUP] Source: ${dbPath}`);
  console.log(`[BACKUP] Dest:   ${outFile}`);

  try {
    // better-sqlite3 uses SQLite Online Backup API (safe while DB is in use).
    await db.backup(tmpFile);

    // Atomic move into place
    fs.renameSync(tmpFile, outFile);

    const sizeBytes = fs.statSync(outFile).size;
    console.log(`[BACKUP] OK (${Math.round((Date.now() - startedAt) / 1000)}s, ${sizeBytes} bytes)`);
  } catch (e) {
    console.error('[BACKUP] FAILED:', e?.message || e);
    unlinkSafe(tmpFile);
    process.exitCode = 1;
  } finally {
    try { db.close(); } catch {}
  }

  // Retention: delete backups older than N days
  if (retentionDays > 0) {
    const cutoffMs = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    const files = listFiles(backupsDir).filter(isFile);

    let deleted = 0;
    for (const f of files) {
      const base = path.basename(f);
      if (!base.startsWith('salesmate_')) continue;
      if (!base.endsWith('.db')) continue;

      try {
        const st = fs.statSync(f);
        if (st.mtimeMs < cutoffMs) {
          if (unlinkSafe(f)) deleted += 1;
        }
      } catch {
        // ignore
      }
    }

    if (deleted) console.log(`[BACKUP] Retention: deleted ${deleted} old backup(s)`);
  }
}

main().catch((e) => {
  console.error('[BACKUP] Unhandled error:', e?.message || e);
  process.exitCode = 1;
});
