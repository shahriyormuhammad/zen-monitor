---
name: Deploy procedure for metric-pulse-app-01
description: Ordered steps to push code, apply DB migration if any, and restart services safely
type: project
originSessionId: 0461dfe8-8845-435f-a7d5-f72890c3f71b
---
Sequential steps for any deploy to the bare-metal production hosts. Do **not** skip steps — especially the backup.

`goalbot` is retired and must not be used as a deployment target.

Metric Pulse (`metric-pulse-app-01`) remains the primary production server and
`origin/main` remains the only canonical source of deployable code. The
secondary server (`rmp_gemmini`, `194.164.245.199`) is a one-way deploy target:
it may pull approved `origin/main`, but it must not push code or sync runtime
data back to Metric Pulse. See `docs/operations/DUAL_PRODUCTION_DEPLOYMENT.md`.

## Happy-path deploy (code-only, no migration)

1. **Local checks**: `npm run lint && npm run test && npm run build` must all pass green.
2. **Commit focused**: one logical change per commit, Co-Authored-By trailer for Claude.
3. **Push**: `git push origin main`.
4. **Automatic dual deploy** runs from GitHub Actions:
   `.github/workflows/deploy-production.yml`.
5. **Manual server deploy fallback** for Metric Pulse:
   ```bash
   ssh metric-pulse-app-01 'cd /srv/projects/enterprise-wb-analytics && DEPLOY_SERVICES="enterprise-wb-analytics.service enterprise-wb-analytics-inngest.service enterprise-wb-analytics-sync-worker.service enterprise-wb-analytics-redistribution-worker.service enterprise-wb-analytics-advertising-worker.service enterprise-wb-analytics-reviews-worker.service enterprise-wb-analytics-ops-worker.service" bash scripts/deploy-remote-production.sh'
   ```
   The remote script serializes deploys with
   `/tmp/enterprise-wb-analytics-deploy.lock`, then performs `git fetch`,
   `git reset --hard origin/main`, `npm ci`, `npm run build`, migration,
   restart, and health verification. Do not run raw `npm ci` / `npm run build`
   in the production working tree while GitHub Actions may also be deploying.
6. **Manual restart-only fallback** after a successful build, if restart did
   not happen:
   ```bash
   ssh metric-pulse-app-01 'systemctl restart enterprise-wb-analytics enterprise-wb-analytics-sync-worker enterprise-wb-analytics-redistribution-worker enterprise-wb-analytics-advertising-worker enterprise-wb-analytics-reviews-worker enterprise-wb-analytics-ops-worker enterprise-wb-analytics-inngest && systemctl is-active enterprise-wb-analytics enterprise-wb-analytics-sync-worker enterprise-wb-analytics-redistribution-worker enterprise-wb-analytics-advertising-worker enterprise-wb-analytics-reviews-worker enterprise-wb-analytics-ops-worker enterprise-wb-analytics-inngest'
   ```
7. **Verify**:
   ```bash
   ssh metric-pulse-app-01 'curl -sS http://localhost:3457/api/health'
   ```
   Expect `{"ok":true,"app":"ok","db":"ok","env":"ok"}`.
8. **Update changelog + checklist status + push docs** if the task is from the enterprise launch checklist.

## If the change includes a DB migration

Insert these steps **between 3 (push) and 4 (server pull)**:

3.5. **Fresh pre-migration DB snapshot** on the server:
```bash
ssh metric-pulse-app-01 'set -e; cd /srv/projects/enterprise-wb-analytics; SNAP=/srv/backups/enterprise-wb-analytics/pre-migration-$(date -u +%Y%m%d-%H%M%S)-verified; mkdir -p "$SNAP"; chown postgres:postgres "$SNAP"; chmod 700 "$SNAP"; set -a; . ./.env.backup; set +a; sudo -u postgres env DATABASE_URL="$DATABASE_URL" BACKUP_RESTORE_DATABASE_URL="$BACKUP_RESTORE_DATABASE_URL" BACKUP_DIR="$SNAP" BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-7}" BACKUP_RESTORE_MIN_TABLES="${BACKUP_RESTORE_MIN_TABLES:-10}" node scripts/nightly-db-backup.mjs; echo "snapshot: $SNAP"'
```

Use the dedicated backup env/role, not app `DATABASE_URL` from
`.env.production`: the app DB role may not have table-level dump privileges for
all operational tables.

3.6. **Apply migration after the `npm ci` in step 4**:
```bash
ssh metric-pulse-app-01 'cd /srv/projects/enterprise-wb-analytics && npm run db:migrate'
```

3.7. **Verify migration state**:
```bash
ssh metric-pulse-app-01 'cd /srv/projects/enterprise-wb-analytics && DB_URL=$(awk -F= "/^DATABASE_URL=/{sub(/^DATABASE_URL=/,\"\"); print}" .env.production) && psql "$DB_URL" -c "SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id DESC LIMIT 3;"'
```

### About `npm run db:migrate`

Since 2026-04-19, `db:migrate` runs `scripts/db-migrate.mjs` instead of `drizzle-kit migrate`. Reason: drizzle-kit 0.31.10 silently skipped migrations 0045/0046 during a production deploy while reporting `[✓] migrations applied successfully!`. The custom script reads `drizzle/meta/_journal.json`, SHA256s each SQL file, compares to `drizzle.__drizzle_migrations.hash`, and applies anything missing — with clear `[db:migrate] applying …` logs for every statement run. Zero silent skips.

`drizzle-kit` is no longer a repo dev dependency because its transitive `esbuild` tree kept the full `npm audit` red. Use `npm run db:migration:check` for release validation. If schema diff/generate work is needed, run `drizzle-kit` in an isolated one-off sandbox and commit only the reviewed SQL migration plus journal updates.

For statements that Postgres rejects inside transactions (`CREATE INDEX CONCURRENTLY`, `REFRESH MATERIALIZED VIEW CONCURRENTLY`), add `-- @no-transaction` inside the first 10 lines of the migration file — the migrator will apply its statements without a surrounding `BEGIN`. Default behaviour is still "one transaction per migration, rollback on any failure".

If the migration creates indexes on large tables, drizzle-kit generates plain `CREATE INDEX` (not CONCURRENTLY). Acceptable while the database is small (tens of MB). For the next large-table index migration, write raw SQL with `CONCURRENTLY` by hand, add `-- @no-transaction` at the top, and let `db:migrate` pick it up.

## Rollback

Not automatic. Options:
- **Code-only regression**: `git reset --hard <previous_sha>` on server, `npm run build`, `systemctl restart`.
- **Migration went wrong**: restore from the snapshot made in step 3.5 using `pg_restore --clean --if-exists -d $DB_URL <snapshot>/database.dump`. See `docs/INCIDENT_RESPONSE.md` §2.8 for the full procedure.

## What never to do without explicit user approval

- `rm -rf` anything under `/srv/projects/enterprise-wb-analytics/.env*`
- `systemctl stop` without plan to `start` right after
- `pg_dump`/`pg_restore` targeting a live database without a target snapshot dir
- Modifying `/etc/systemd/system/enterprise-wb-analytics*.service` units
- Editing `.env.production` in place — always go through a `.env.production.bak-<timestamp>` dance first
