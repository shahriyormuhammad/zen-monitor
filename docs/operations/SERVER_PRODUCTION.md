---
name: Production server topology
description: Bare-metal production host, SSH + ports + services + known pre-existing issues
type: reference
originSessionId: 0461dfe8-8845-435f-a7d5-f72890c3f71b
---
Production lives on a single bare-metal server, not Render. `render.yaml` and `Dockerfile` were removed from the repo in P3-42 — this is the only supported deployment topology.

## Access
- Hosting/VDS panel: `https://my.hosting-vds.com/` (billing/control panel for this server)
- SSH alias: `metric-pulse-app-01` (resolves to `202.181.148.140`, root login configured)
- Project path: `/srv/projects/enterprise-wb-analytics`
- Git tracked at `origin/main`, deploy is `git pull` + restart (no `autoDeploy`)

## Retired Previous Host
- Previous production SSH alias: `goalbot` (`194.147.149.157`)
- Status: decommissioned after migration to `metric-pulse-app-01`
- Removed from the old host: project directory, `enterprise-wb-*` systemd units/timers, Supabase Docker containers/volume/network, nginx site refs, logrotate config and project logs
- Do not deploy or run audits against `goalbot` unless explicitly investigating historical incidents

## Runtime
- OS: Ubuntu 24.04 LTS, 10 CPU, 23 GiB RAM, 242 GB disk, `/` at ~8% used after migration
- Postgres: local `postgresql@17-main.service`, database `enterprise_wb_analytics_prod`, user `enterprise_wb_analytics_user`, ~94 MB
- Supabase: self-hosted in Docker (`supabase_auth_*`, `supabase_kong_*`, `supabase_db_*`, `supabase_inbucket_*`)
- Telegram: grammY, webhook at `https://про-цифры.рф/api/bot` (direct DNS + nginx + Let's Encrypt)
- Playwright RPA: runs via `enterprise-wb-xvfb` + `enterprise-wb-x11vnc` + `enterprise-wb-novnc` services on a virtual display

## Systemd units
- `enterprise-wb-analytics.service` — Next.js web, ExecStart = `node .next/standalone/server.js`, env `PORT=3457`, `HOSTNAME=127.0.0.1`, prestart = `ops/prepare-next-standalone.sh`, log at `/var/log/enterprise-wb-analytics.log`
- `enterprise-wb-analytics-sync-worker.service` — Next.js worker process for WB sync/core jobs on `127.0.0.1:3458`
- `enterprise-wb-analytics-redistribution-worker.service` — redistribution worker on `127.0.0.1:3459`
- `enterprise-wb-analytics-advertising-worker.service` — advertising/bidder worker on `127.0.0.1:3460`
- `enterprise-wb-analytics-reviews-worker.service` — reviews/questions worker on `127.0.0.1:3461`
- `enterprise-wb-analytics-ops-worker.service` — ops worker for SLA/stock alert jobs on `127.0.0.1:3462`
- `enterprise-wb-analytics-inngest.service` — single signed self-hosted Inngest runtime on `127.0.0.1:8288`; registers all worker endpoints (`/sync`, `/redistribution`, `/advertising`, `/reviews`, `/ops`)
- `enterprise-wb-analytics-supabase.service` — local Supabase Docker stack
- `enterprise-wb-network-hardening.service` — persistent firewall hardening for internal app, Supabase, Inngest, noVNC and VNC ports
- `nginx.service` — public HTTP/HTTPS reverse proxy to `127.0.0.1:3457`
- `postgresql@17-main.service` — product DB
- `enterprise-wb-analytics-backup.timer` — nightly DB backup with restore-test via local postgres peer auth and `.env.backup`

## Network topology (production traffic path)

```
браузер → DNS A-record (202.181.148.140)
  → nginx :443  HTTPS reverse proxy
    → 127.0.0.1:3457 (Next.js)
```

- DNS: `про-цифры.рф` → A-record `202.181.148.140` (direct, no Cloudflare proxy)
- TLS cert: Let's Encrypt, `CN=xn----ptbqdfd1ao2c.xn--p1ai`, auto-renewal via acme-challenge on nginx :80
- `процифры.рф` (and www variants) → 301 redirect to `про-цифры.рф`
- Publicly allowed ports: `22`, `80`, `443`
- Internal ports blocked from outside by `enterprise-wb-network-hardening.service`: `3457`, worker app ports `3458-3461`, Supabase `54321/54322/54324`, Inngest ports `8288-8295`, `50052`, `50053`, `6080`, `5900`
- `/wb-vnc/` is not public through nginx. Open noVNC only via SSH tunnel: `ssh -L 6080:127.0.0.1:6080 metric-pulse-app-01`, then `http://127.0.0.1:6080/vnc.html`.

## Important quirks
- **Web listens on port 3457, not 3000** (override in unit file). `curl http://localhost:3457/api/health` for internal checks.
- **Do not remove `enterprise-wb-network-hardening.service`** while Docker publishes Supabase ports on `0.0.0.0`. Supabase CLI still exposes `54321/54322/54324` at Docker level; the firewall is the active external guard.
- **nginx config is tracked in `ops/nginx/enterprise-wb-analytics`**. Keep `proxy_buffer_size 64k`, `proxy_buffers 8 64k`, `proxy_busy_buffers_size 128k` for Next auth responses; otherwise successful login can fail as `502 upstream sent too big header` when auth cookies are large.
- **Backup service does not use the app DB role.** It runs as OS user `postgres` and reads `/srv/projects/enterprise-wb-analytics/.env.backup`, so `pg_dump` is not affected by RLS or missing table grants.
- **Prestart script copies `.next/static`, `public`, and route-group manifests into `.next/standalone/`** on each restart; if `npm run build` hasn't run, the restart will serve stale code.
- **Next 16 standalone route-group guard**: `ops/prepare-next-standalone.sh` copies manifests from `(auth)`/`(dashboard)` route groups into flat runtime paths. Without this, `/login`, `/overview`, `/advertising`, `/explorer` can hit `InvariantError: The client reference manifest for route ... does not exist`.
- **`.env` is a symlink to `.env.production`** on the server. Runtime-only settings live in `.env.runtime`.
- **Production Inngest is split by domain.** `.env.runtime` keeps `INNGEST_BASE_URL=http://127.0.0.1:8288` for web/default sync dispatch. Domain worker units override `INNGEST_BASE_URL` to their own runtime (`8290` redistribution, `8292` advertising, `8294` reviews/questions). `.env.runtime` must contain `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`; `INNGEST_DEV` must stay unset.
- **Public domain**: primary domain is `про-цифры.рф` (punycode `xn----ptbqdfd1ao2c.xn--p1ai`). `процифры.рф` (punycode `xn--h1alcecxm7b.xn--p1ai`) redirects to it. DNS A-record points directly to `202.181.148.140`. TLS via Let's Encrypt (auto-renew). Telegram webhook URL: `https://про-цифры.рф/api/bot`.

## Server backups
- Directory: `/srv/backups/enterprise-wb-analytics/<snapshot-name>/`
- Format: `database.dump` (pg_dump -Fc --compress=9), `project-files.tar.gz`, `repo-all-refs.bundle`, `env-files.tar.gz`, `systemd/*.service`, `checksums.sha256`
- Latest pre-audit snapshot: `pre-audit-20260415-224500` (also mirrored locally at `~/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics-backups/`)
- Latest pre-migration snapshot: `pre-migration-0029-20260415-204352`
