---
name: deploy
description: Deploy the current main to the goalbot production server following the standard procedure (backup if migration, push, pull, build, restart, verify)
---

Execute a full deploy to the bare-metal `goalbot` production server. Do **not** start unless `docs/operations/DEPLOY_PROCEDURE.md` is the source of truth for the procedure.

Read `docs/operations/DEPLOY_PROCEDURE.md` first. Then follow these steps exactly:

## 1. Pre-flight checks

- `git -C /Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics status` — must be clean
- Local `main` HEAD is the intended deploy target
- `npm run lint && npm run test && npm run build` passed locally (if not already)
- Any new migrations in `drizzle/` since the last deploy? If yes — `TAG AS MIGRATION DEPLOY` and require a fresh pre-migration DB snapshot (see step 2).

## 2. Pre-migration backup (only if migrations are new)

Run the exact snapshot command from `docs/operations/BACKUP_POLICY.md`:

```bash
ssh goalbot 'set -e
SNAP=/srv/backups/enterprise-wb-analytics/pre-deploy-$(date -u +%Y%m%d-%H%M%S)
mkdir -p "$SNAP"
cd /srv/projects/enterprise-wb-analytics
DB_URL=$(awk -F= "/^DATABASE_URL=/{sub(/^DATABASE_URL=/,\"\"); print}" .env.production)
pg_dump --format=custom --compress=9 --file="$SNAP/database.dump" "$DB_URL"
cd "$SNAP"
sha256sum database.dump > checksums.sha256
echo "$SNAP"'
```

Record the snapshot path in the deploy log message.

## 3. Push

```bash
git -C /Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics push origin main
```

## 4. Server pull, install, build

```bash
ssh goalbot 'set -e
cd /srv/projects/enterprise-wb-analytics
git fetch origin main
git pull --ff-only origin main
npm ci --no-audit --no-fund
npm run build'
```

## 5. If migration: apply it

```bash
ssh goalbot 'cd /srv/projects/enterprise-wb-analytics && npm run db:migrate'
```

## 6. Restart

```bash
ssh goalbot 'systemctl restart enterprise-wb-analytics enterprise-wb-analytics-inngest && systemctl is-active enterprise-wb-analytics enterprise-wb-analytics-inngest'
```

## 7. Verify

```bash
ssh goalbot 'curl -sS http://localhost:3457/api/health'
```

Must return `{"ok":true,"app":"ok","db":"ok","env":"ok"}`. If not — stop and investigate.

If a migration added indexes, run a quick `EXPLAIN ANALYZE` on a representative query to confirm index usage.

## 8. Report

- Local SHA pushed
- Server SHA after pull
- Migration applied: Y/N, which one
- Services restarted: Y/N
- Health status
- Any noteworthy warnings from build/migrate logs

## When to stop and ask

- Lint/test/build failed locally — investigate before pushing
- `git push` rejected — possible concurrent push, rebase needed
- `npm ci` on server fails — likely node version mismatch or network issue
- `npm run build` fails on server — almost always a missing env or stale cache
- `db:migrate` errors — DO NOT proceed, stop and restore from snapshot in step 2
- Health check fails after restart — roll back via `git reset --hard <previous_sha>` + rebuild + restart
- Logs show new errors that were not present before (check `journalctl -u enterprise-wb-analytics -n 100`)

Do not run this skill if you're in the middle of an unfinished edit. Commit first.
