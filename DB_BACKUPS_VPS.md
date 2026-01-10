# SQLite Database Backups (Hostinger VPS)

This app uses a local SQLite file (default: `local-database.db`). On a VPS, you should:

1) Store the DB outside the repo (so deploys don’t overwrite it)
2) Run automated backups on a schedule
3) Keep multiple backups (retention)
4) Copy backups off the VPS (recommended)

## 1) Put the DB in a persistent path

Pick a location like:

- `/var/lib/salesmate/local-database.db`

Then run the app with an env var:

- `SQLITE_DB_PATH=/var/lib/salesmate/local-database.db`

The repo scripts also respect `DB_PATH` if you prefer that name.

## 2) Create backups (built-in script)

A backup script is included:

- `npm run backup-db`

It creates a point-in-time copy in `./backups/` by default.

### Optional env vars

- `SQLITE_DB_PATH` / `DB_PATH`: source DB file
- `SQLITE_BACKUP_DIR` / `BACKUP_DIR`: folder to write backups
- `SQLITE_BACKUP_RETENTION_DAYS` / `RETENTION_DAYS`: delete backups older than N days (default: 14)

Example:

```bash
SQLITE_DB_PATH=/var/lib/salesmate/local-database.db \
SQLITE_BACKUP_DIR=/var/backups/salesmate \
RETENTION_DAYS=30 \
node scripts/backup-db.js
```

## 3) Schedule backups (cron)

Install cron if needed, then add a daily job (example: 02:10 UTC):

```bash
crontab -e
```

Add:

```cron
10 2 * * * cd /opt/salesmate && /usr/bin/node scripts/backup-db.js >> /var/log/salesmate-db-backup.log 2>&1
```

If your app uses env vars via systemd or a `.env` file, either:

- export them in the cron line, or
- source an env file before running `node`.

## 4) Recommended: offsite backup

Keeping backups only on the VPS does NOT protect you from disk failure.

Common options:

- Copy nightly to another server via `rsync` over SSH
- Upload to S3-compatible storage with `rclone`

Example using rsync (push):

```bash
rsync -az --delete /var/backups/salesmate/ user@backup-vps:/srv/backups/salesmate/
```

## 5) Restore

1) Stop the node service
2) Pick a backup file (example): `/var/backups/salesmate/salesmate_20260109_021000Z.db`
3) Replace the live DB:

```bash
cp /var/lib/salesmate/local-database.db /var/lib/salesmate/local-database.db.bak
cp /var/backups/salesmate/salesmate_20260109_021000Z.db /var/lib/salesmate/local-database.db
```

4) Start the node service again

## 6) Periodically test restore

At least once per month, restore a backup into a temporary path and boot the app against it to ensure backups are usable.
