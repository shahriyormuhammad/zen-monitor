# Release Checklist

This document defines the current release/test baseline for `enterprise-wb-analytics`.

## Goal

Before broader feature work or any production-style release, the repository should be checked through one reproducible path instead of ad-hoc commands.

## Baseline Command

Use the local baseline script:

```bash
node scripts/release-baseline.mjs
```

For a non-blocking audit report:

```bash
node scripts/release-baseline.mjs --report-only
```

## Hard Pre-Deploy Gate

Use the strict gate before every production rollout:

```bash
npm run predeploy:gate
```

This command is fail-fast and blocks release on any failed step.

## What The Script Checks

1. `git status --short`
2. `npm run db:migration:check`
3. `npm run build`
4. `npm run lint`
5. `npm run typecheck`
6. `npm run test`
7. `npm run audit:production`

`npm run predeploy:gate` runs the baseline checks above and then enforces:

8. `npm run smoke:operator:runtime`

## Release Gate Policy

A release-ready slice should satisfy all of the following:

- working tree is clean;
- no runtime-relevant untracked files are hiding outside git;
- Drizzle reports no pending schema drift;
- production build passes;
- unit tests pass;
- lint passes or an explicitly approved exception exists.
- TypeScript typecheck passes;
- production dependency audit has no high+ vulnerabilities.

## Status Discipline

Do not treat this document as a static status snapshot. The only trustworthy release
status is the current output of:

- `node scripts/release-baseline.mjs`
- `npm run predeploy:gate`
- GitHub Actions workflow `CI`, which mirrors the minimum release checks:
  lint, typecheck, tests, build and production dependency audit.

Point-in-time notes that still matter:

- browser smoke still requires a running local app and Playwright Chromium installed
- `smoke:operator:runtime` is now part of the strict pre-deploy gate and remains the preferred local proof that manual sync reaches the worker path instead of failing at event dispatch
- `/api/health` is the committed production health endpoint and should return `200` before calling a deploy healthy
- the baseline assumes runtime files are committed and local scratch artifacts remain ignored through `.gitignore`
- if local dev logs show `relation "sync_runs" does not exist`, run `npm run db:repair-local` before treating it as an app bug
- production read-only smoke is available as `npm run smoke:production:readonly`; it does not log in, create tenants, trigger sync or mutate production data

## Notes On ESLint Scope

The lint baseline now ignores root-level scratch and operational scripts:

- `apply-all.js`
- `apply-rls.js`
- `seed-mock-data.js`
- `test.js`
- `test-query.js`

These files are intentionally excluded from the app-quality gate because they are local utility scripts, not application runtime code.

## Required Human Review Before Release

- verify the tenant/auth flows still work in the browser;
- for production authenticated smoke, use a dedicated existing user via
  `SMOKE_AUTH_MODE=login SMOKE_EMAIL=... SMOKE_PASSWORD=... SMOKE_TRIGGER_SYNC=0`;
- if local smoke was run with alternative env overrides, re-run `npm run smoke:operator:runtime` on the default local contour;
- verify settings manual sync shows a coherent `sync_runs` status;
- verify the dashboard screens render correctly for:
  - no tenant
  - empty data
  - normal data
- verify the branch does not depend on local-only untracked source files.
