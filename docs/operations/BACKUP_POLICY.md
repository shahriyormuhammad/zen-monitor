---
name: Backup always before DB changes and risky moves
description: DB snapshot + local mirror are mandatory before migrations, resets, or destructive ops; format and paths documented
type: feedback
originSessionId: 0461dfe8-8845-435f-a7d5-f72890c3f71b
---
Always take a database snapshot before any production-impacting action. The user explicitly requested this on 2026-04-15 before starting audit fixes.

**Why:** losing a tenant's data is the one thing that cannot be undone. Even "safe-looking" migrations or config edits have historically caused issues in this project (see `scripts/repair-local-db-baseline.mjs` — that exists because drift happened).

**How to apply:**

Before **any** of these actions, run `pg_dump` first:
- `npm run db:migrate` (any migration)
- `ALTER TABLE`, `DROP`, `TRUNCATE`, `CREATE INDEX` via raw SQL
- `git reset --hard` on server with uncommitted changes
- Editing `.env.production` values that affect runtime secrets (e.g. `ENCRYPTION_KEY`)
- `systemctl stop` on production services
- Uninstalling / reinstalling `node_modules` via `rm -rf`

**Snapshot format** (matches existing convention in `/srv/backups/enterprise-wb-analytics/`):
```bash
ssh metric-pulse-app-01 'set -e
SNAP=/srv/backups/enterprise-wb-analytics/pre-<reason>-$(date -u +%Y%m%d-%H%M%S)
mkdir -p "$SNAP"
cd /srv/projects/enterprise-wb-analytics
DB_URL=$(awk -F= "/^DATABASE_URL=/{sub(/^DATABASE_URL=/,\"\"); print}" .env.production)
pg_dump --format=custom --compress=9 --file="$SNAP/database.dump" "$DB_URL"
cd "$SNAP"
sha256sum database.dump > checksums.sha256
echo "$SNAP"'
```

**Local mirror** (optional but recommended for true offline recovery):
```bash
rsync -avz metric-pulse-app-01:/srv/backups/enterprise-wb-analytics/<snap>/ ~/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics-backups/<snap>/
cd ~/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics-backups/<snap>/ && shasum -a 256 -c checksums.sha256
```

**Local git safety net**: before starting a multi-commit audit-fix branch, create a backup branch from the current main:
```bash
git branch backup/pre-<task>-$(date +%Y%m%d-%H%M) main
```
That way any `git reset --hard` has a safe target.

If the user has already taken a snapshot recently (same day), one new snapshot is still required before schema changes — but code-only deploys can reuse the same-day snapshot.
