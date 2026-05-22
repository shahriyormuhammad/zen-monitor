# Project Status

Last updated: 2026-05-14 MSK.

## Green

- Production server `metric-pulse-app-01` is on `origin/main` (`7d80c8e`) and passes
  `POSTDEPLOY_SMOKE_AUTH_MODE=skip npm run postdeploy:production`.
- Production DB migrations are current: `npm run db:migrate` reports
  `0 pending (84 total, all applied)`.
- Internal and external `/api/health` return `ok` for app, db, Supabase,
  Inngest and env.
- Read-only production browser smoke passes public pages, protected-route
  redirects and `/api/health` without page errors.
- Production standalone route-group manifest preparation covers both root
  `.next/server/app` and `.next/standalone/.next/server/app`.
- Local strict release baseline passed on `7d80c8e`; GitHub Actions should be
  checked on GitHub after push if a remote CI confirmation is required.

## Needs Runtime Proof

- Authenticated production smoke needs a dedicated existing account:
  `SMOKE_EMAIL` / `SMOKE_PASSWORD`.
- WB LK auth needs an explicit operator test window because it may involve
  CAPTCHA/SMS and the server-side Chromium/noVNC flow.
- Live manual sync should be triggered only intentionally; default production
  smoke should use `SMOKE_TRIGGER_SYNC=0`.
- Export/import paths should be tested with a known non-sensitive cabinet and
  archived smoke artifacts.

## Workspace Cleanup

- Completed local cleanup on 2026-05-12:
  generated repo artifacts `.next`, `coverage`, `output`, `tmp`,
  local scratch files and obsolete clean worktrees `РНП_Gemini-agent2..6`
  were removed.
- Large backup/copy folders were moved to Trash instead of being deleted:
  `/Users/vitea_b/.Trash/RNP_Gemini_cleanup_20260512-180222`
  (`enterprise-wb-analytics — копия`, `backups`,
  `enterprise-wb-analytics-backups`, `sync-backups`, ~6.9G total).
- Workspace root `/Users/vitea_b/Desktop/Боты/РНП_Gemini` is now ~1.1G.
  Preserved intentionally: `.env`, env backup, `node_modules` and current WIP
  source changes.
- 2026-05-14 reconciliation: production-local WIP was moved into Git and
  deployed cleanly. The broad stale local-only WIP was preserved outside the
  active tree in `stash@{0}` (`pre-reconcile-local-wip-20260514-132338`) and in
  `../reconcile-backups/20260514-132338/`.

## Release Path

1. Keep each change in a focused commit.
2. Run `node scripts/release-baseline.mjs` locally.
3. Push to `main`; GitHub Actions must pass lint, typecheck, tests, build and
   `audit:production`.
4. Deploy via `git pull --ff-only`, build and systemd restart on
   `metric-pulse-app-01`.
5. Run `npm run postdeploy:production`; for full auth coverage, add
   `SMOKE_EMAIL` / `SMOKE_PASSWORD` and keep `SMOKE_TRIGGER_SYNC=0` unless a
   live sync is intended.
