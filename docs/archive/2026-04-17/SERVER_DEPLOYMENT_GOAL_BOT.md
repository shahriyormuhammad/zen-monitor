# Goal Bot Server Deployment Runbook

This document records the real deployment done on `2026-04-09` for `enterprise-wb-analytics` on the `goal_bot` server and defines how to maintain it.

## Direct Domain Cutover (2026-04-12)

- Cloudflare quick-tunnel ingress is decommissioned for this project.
- Direct ingress is now served by `nginx` on `80/443`.
- `443` is shared safely with VPN transport:
  - `nginx stream` routes web SNI for project domains to local TLS backend `127.0.0.1:8443`;
  - all non-project SNI traffic is passed through to `vpn-xray` on `127.0.0.1:9443`.
- project web app remains on `127.0.0.1:3457` behind reverse proxy.
- target domains:
  - `про-цифры.рф` (`xn----ptbqdfd1ao2c.xn--p1ai`) - primary;
  - `процифры.рф` (`xn--h1alcecxm7b.xn--p1ai`) - alias/redirect candidate.

Current pending step after registrar changes:

- point DNS `A` (and optional `AAAA`) for both domains to server public IP;
- issue Let's Encrypt certificates and switch nginx TLS from temporary snakeoil cert to LE cert.

DNS/TLS cutover commands:

```bash
ssh goal_bot 'for d in xn----ptbqdfd1ao2c.xn--p1ai xn--h1alcecxm7b.xn--p1ai; do echo \"== $d\"; dig +short A $d; done'
ssh goal_bot 'LETSENCRYPT_EMAIL=<your-email> /usr/local/bin/enterprise-wb-enable-le.sh'
```

## Scope And Isolation

- target host: `202310.nl.web.highserver.ru` (via `ssh goal_bot`);
- app directory: `/srv/projects/enterprise-wb-analytics`;
- isolated Postgres database/user created for this app only;
- isolated `systemd` units created for this app only;
- no changes were made inside existing project folders under `/srv/projects`.

## Pre-Deploy Backup (Created)

Local backup was created before server work:

- backup folder: `/Users/vitea_b/Desktop/Боты/РНП_Gemini/backups/enterprise-wb-analytics-20260409-205527`
- git history snapshot: `repo-all-refs.bundle`
- full workspace archive: `project-full.tar.gz`
- working tree snapshots: `git-status.txt`, `working-tree.diff`, `untracked-files.txt`
- integrity checks: `checksums.sha256` (`OK`) and `git bundle verify` (`OK`)

## Deployed Runtime Topology

- app runtime: Next.js standalone server on port `3457`;
- database: local Postgres (`127.0.0.1:5432`) with dedicated DB/user;
- auth runtime: self-hosted Supabase local stack (`kong` + `gotrue` + `postgres` + `mailpit`);
- sync runtime: local Inngest Dev Server (`127.0.0.1:8288`) as separate service;
- external ingress: direct nginx reverse proxy on `80/443` with SNI split against `vpn-xray`.

## Systemd Services

- `enterprise-wb-analytics.service`
  - starts: `/usr/bin/node /srv/projects/enterprise-wb-analytics/.next/standalone/server.js`
  - before start: `ExecStartPre` syncs `.next/static` and `public` into `.next/standalone` (required so CSS/JS chunks are served correctly by standalone runtime)
  - env file: `/srv/projects/enterprise-wb-analytics/.env.runtime`
  - logs: `/var/log/enterprise-wb-analytics.log`
- `enterprise-wb-analytics-supabase.service`
  - starts self-hosted Supabase stack with a reduced profile (auth + kong + db + mailpit)
  - keeps state between restarts (`ExecStop=/bin/true`) so auth users are not wiped
  - logs: `/var/log/enterprise-wb-analytics-supabase.log`
- `enterprise-wb-analytics-inngest.service`
  - starts: `/usr/bin/npx --yes --ignore-scripts=false inngest-cli@latest dev --no-discovery -u http://127.0.0.1:3457/api/inngest`
  - env file: `/srv/projects/enterprise-wb-analytics/.env.runtime`
  - logs: `/var/log/enterprise-wb-analytics-inngest.log`
- `nginx.service`
  - public ingress on `80/443`;
  - stream SNI router on `443` for web + VPN coexistence;
  - web reverse proxy to app `127.0.0.1:3457`.
- `vpn-xray.service`
  - moved from public `:443` to local `127.0.0.1:9443`;
  - receives non-project TLS traffic from nginx stream proxy.

## Environment Files On Server

- `/srv/projects/enterprise-wb-analytics/.env.production`
  - canonical server env file used for deployment and DB migrations.
  - includes split Supabase URLs (`SUPABASE_URL_INTERNAL` for server-side calls, `NEXT_PUBLIC_SUPABASE_URL` for browser-side calls).
- `/srv/projects/enterprise-wb-analytics/.env`
  - symlink to `.env.production` for Next.js and Drizzle CLI runtime compatibility.
- `/srv/projects/enterprise-wb-analytics/.env.runtime`
  - filtered env file used by `systemd` units (without cron expressions containing spaces).

## Current Access Points (After Deploy)

- internal health: `http://127.0.0.1:3457/api/health`
- external app (planned canonical): `https://про-цифры.рф`
- external app alias: `https://процифры.рф`

Note:

- until DNS is pointed to this server and LE cert is issued, external domain validation may fail in browser due unresolved DNS or temporary cert.

Health verification on `2026-04-09` returned `HTTP 200` and:

```json
{
  "ok": true,
  "checks": {
    "app": "ok",
    "db": "ok",
    "env": "ok"
  }
}
```

## Repeatable Update Procedure

Git-first contract (mandatory):

```bash
cd /Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics
git fetch origin --prune
git checkout main
git pull --ff-only origin main
```

Develop locally on feature branch, then merge into `main` and push:

```bash
git checkout -b codex/<feature-name>
# ...changes, checks, commit...
git checkout main
git merge --ff-only codex/<feature-name>
git push origin main
```

Run strict local pre-deploy gate before touching the server:

```bash
cd /Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics
npm run predeploy:gate
```

Deploy on server via git pull:

```bash
ssh goal_bot
cd /srv/projects/enterprise-wb-analytics
git fetch origin --prune
git checkout main
git pull --ff-only origin main
ln -sfn .env.production .env
npm ci
npm run build
npm run db:migrate
systemctl start enterprise-wb-analytics-supabase.service
systemctl restart enterprise-wb-analytics.service
systemctl restart enterprise-wb-analytics-inngest.service
systemctl restart nginx
systemctl restart vpn-xray
```

Hard post-deploy verification (single command):

```bash
cd /Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics
SMOKE_EMAIL='<ops-login@example.com>' \
SMOKE_PASSWORD='<ops-smoke-password>' \
npm run postdeploy:goal-bot
```

What `postdeploy:goal-bot` enforces:

- local SHA equals remote SHA for `main`;
- all required `systemd` units are `active`;
- internal and external `/api/health` are `ok`;
- UI smoke (`smoke:operator` in login mode) passes.

Manual parity check by commit SHA (`main`) if needed:

```bash
cd /Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics
git rev-parse main
ssh goal_bot 'cd /srv/projects/enterprise-wb-analytics && git rev-parse main'
```

Emergency fallback only (if git pull path is unavailable): use rsync-based deploy from local snapshot.

## Operations Cheat Sheet

```bash
ssh goal_bot 'systemctl status enterprise-wb-analytics-supabase.service --no-pager'
ssh goal_bot 'systemctl status enterprise-wb-analytics.service --no-pager'
ssh goal_bot 'systemctl status enterprise-wb-analytics-inngest.service --no-pager'
ssh goal_bot 'systemctl status nginx.service --no-pager'
ssh goal_bot 'systemctl status vpn-xray.service --no-pager'
ssh goal_bot 'tail -n 120 /var/log/enterprise-wb-analytics-supabase.log'
ssh goal_bot 'tail -n 120 /var/log/enterprise-wb-analytics.log'
ssh goal_bot 'tail -n 120 /var/log/enterprise-wb-analytics-inngest.log'
ssh goal_bot 'journalctl -u nginx.service -n 120 --no-pager'
ssh goal_bot 'journalctl -u vpn-xray.service -n 120 --no-pager'
```

## Ops Watchdog (Telegram Alerts)

Run the watchdog every 3-5 minutes to alert on:

- `health != ok`;
- `systemd` unit down;
- new sync source failures from `sync_runs`.

Required env in `/srv/projects/enterprise-wb-analytics/.env.production`:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_OPS_CHAT_ID`
- `OPS_WATCHDOG_HEALTH_URL=http://127.0.0.1:3457/api/health`
- `OPS_WATCHDOG_SYSTEMD_UNITS=enterprise-wb-analytics.service,enterprise-wb-analytics-inngest.service,enterprise-wb-analytics-supabase.service,nginx.service,vpn-xray.service`

Cron example:

```bash
*/5 * * * * cd /srv/projects/enterprise-wb-analytics && set -a && . ./.env.production && set +a && npm run ops:watchdog >> /var/log/enterprise-wb-analytics-ops-watchdog.log 2>&1
```

## Nightly DB Backup + Restore-Test

Run a nightly backup with mandatory restore check into a separate DB.

Required env in `/srv/projects/enterprise-wb-analytics/.env.production`:

- `BACKUP_DIR=/srv/backups/enterprise-wb-analytics/postgres`
- `BACKUP_RETENTION_DAYS=7`
- `BACKUP_RESTORE_DATABASE_URL=<separate-test-db-url>`
- `BACKUP_RESTORE_MIN_TABLES=10`

Cron example:

```bash
30 2 * * * cd /srv/projects/enterprise-wb-analytics && set -a && . ./.env.production && set +a && npm run db:backup:nightly >> /var/log/enterprise-wb-analytics-backup.log 2>&1
```

## RPA Session Bootstrap (Required For Slot Monitor)

Symptom:

- slot monitor reports `wb_lk_session_missing`;
- no routes are probed or auto-submitted even when monitor is enabled.

Reason:

- slot monitor and RPA flow require a saved WB LK browser session per tenant;
- this session path is stored in `tenants.wb_lk_storage_state_path` and must point to an existing JSON storage-state file on server.

Operator checklist:

1. Open app settings for each tenant (`Settings -> WB ЛК Доступ (RPA)`).
2. Run manual WB login (`Открыть ручной вход`), complete phone/SMS/captcha/offer, wait for `Доступ к WB ЛК подтвержден`.
3. Verify DB paths are saved:

```bash
ssh goal_bot 'cd /srv/projects/enterprise-wb-analytics && set -a && . ./.env.production && set +a && psql "$DATABASE_URL" -c "select id, name, coalesce(wb_lk_storage_state_path, '\''<null>'\'') as wb_lk_storage_state_path from tenants order by created_at;"'
```

4. Verify storage-state files exist on server:

```bash
ssh goal_bot 'cd /srv/projects/enterprise-wb-analytics && set -a && . ./.env.production && set +a && psql "$DATABASE_URL" -At -c "select wb_lk_storage_state_path from tenants where wb_lk_storage_state_path is not null;" | while IFS= read -r p; do [ -f "$p" ] && echo "OK $p" || echo "MISSING $p"; done'
```

5. Run manual monitor probe check:

```bash
ssh goal_bot 'cd /srv/projects/enterprise-wb-analytics && DOTENV_CONFIG_PATH=.env.production node -r dotenv/config ./node_modules/.bin/tsx --eval "(async () => { const mod = await import(\"./src/server/redistribution/slot-monitor.ts\"); const result = await mod.default.runSlotMonitorForAllTenants({ maxRoutesPerTenant: 24, autoSubmit: true, source: \"manual_monitor_now\" }); console.log(JSON.stringify(result, null, 2)); process.exit(0); })().catch((error) => { console.error(error); process.exit(1); });"'
```

Expected after successful bootstrap:

- monitor no longer returns `wb_lk_session_missing`;
- blocked routes start probing in monitor runs;
- when slot opens, auto-submit can trigger immediately (`REDISTRIBUTION_SLOT_MONITOR_AUTO_SUBMIT=true`).

## Known Constraints

- direct public access to raw port `3457` is intentionally not used; only nginx on `80/443` is public;
- `443` is shared between web and VPN using SNI routing in nginx stream; changing project domains requires updating nginx stream SNI map;
- until DNS points to server IP and LE cert is issued, browsers can show TLS warning for direct domain;
- Supabase CLI local stack currently hardcodes recovery-link base URL to `http://127.0.0.1:54321` in auth emails (`supabase/cli` issue `#4006`), so for self-hosted contour replace that host with `https://про-цифры.рф/supabase`;
- keep `APP_BASE_URL` and `APP_RESET_URL` in server env synced to the production domain URL so recovery redirects stay valid;
- never deploy with rsync rules that delete `.env.production` or `.env.runtime` on server;
- `INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY` are currently empty, so background execution is intentionally running through local Inngest Dev runtime (`INNGEST_DEV=1`) on the server;
- for strict production contour, keep direct nginx ingress and replace Inngest Dev runtime with Inngest Cloud keys.

## Troubleshooting: Unstyled Login Page

If `/login` shows plain HTML without styles, first check CSS chunk status:

```bash
curl -sS -I "https://про-цифры.рф/_next/static/chunks/<chunk>.css"
```

Expected: `HTTP 200`.

If it is `404`, restart the web service (it runs static sync in `ExecStartPre`):

```bash
ssh goal_bot 'systemctl restart enterprise-wb-analytics.service'
```
