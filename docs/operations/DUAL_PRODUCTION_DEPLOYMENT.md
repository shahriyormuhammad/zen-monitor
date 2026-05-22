# Dual Production Deployment

## Rule

`origin/main` is the only canonical source for production code.

Traffic/data do not sync between servers. Each host has its own local database,
Supabase stack, env files, systemd units and runtime state. Deploy copies code
from GitHub to both hosts; it never copies runtime data from one host to the
other.

## Hosts

- Primary: `metric-pulse-app-01`, IP `202.181.148.140`, brand/domain
  `про-цифры.рф`, path `/srv/projects/enterprise-wb-analytics`.
- Secondary: `rmp_gemmini`, IP `194.164.245.199`, temporary public URL
  `http://194.164.245.199`, path `/srv/projects/enterprise-wb-analytics`.

## Direction

Allowed:

- developer-approved code -> `origin/main` -> primary + secondary deploy;
- secondary developer branch/fork -> pull request/review -> approved merge to
  `origin/main` -> deploy.

Not allowed:

- server working tree -> GitHub push;
- secondary server changes -> primary without review;
- database, Supabase auth, Telegram, WB runtime state, or worker queues syncing
  between hosts.

Both production clones have push disabled:

```bash
git remote -v
# origin  git@github.com:viteab-source/enterprise-wb-analytics.git (fetch)
# origin  DISABLED_PUSH_FROM_PRODUCTION (push)
```

## Deploy

GitHub Actions workflow:

- `.github/workflows/deploy-production.yml`
- trigger: push to `main` or manual `workflow_dispatch`;
- SSH secret: `DUAL_PRODUCTION_SSH_KEY`;
- remote script: `scripts/deploy-remote-production.sh`.

Order:

1. deploy primary Metric Pulse;
2. deploy secondary.

The remote script hard-resets the production working tree to `origin/main`,
runs `npm ci`, `npm run build`, `npm run db:migrate`, restarts configured
services, and requires `/api/health` to return `ok: true`.

Deploys on each host are serialized with
`/tmp/enterprise-wb-analytics-deploy.lock`. GitHub Actions acquires the same
lock before its remote `git reset`; manual fallback deploys must use
`scripts/deploy-remote-production.sh` so they share that lock. This prevents
two deploy processes from modifying `node_modules` or `.next` in the same
production working tree at the same time.

## Secondary Safety Mode

The secondary server currently runs:

- `enterprise-wb-analytics-supabase.service`;
- `enterprise-wb-analytics.service`;
- `enterprise-wb-analytics-inngest.service` in safe mode without worker URLs;
- `enterprise-wb-network-hardening.service`;
- `nginx.service`;
- `postgresql@18-main.service`.

Worker services are intentionally not enabled on secondary yet. This prevents
duplicate WB sync/RPA/Telegram actions while the second brand, domain and bot
are not finalized.
