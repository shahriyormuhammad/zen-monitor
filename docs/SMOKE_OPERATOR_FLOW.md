# Operator Smoke Flow

This document defines the first repeatable browser smoke path for `enterprise-wb-analytics`.

## Goal

Verify the main operator journey end-to-end:

1. auth (`login` or `signup`);
2. `settings`;
3. manual WB sync trigger;
4. `overview`;
5. signal drill-down when at least one active signal exists;
6. first recommendation link from the signal drill-down when it targets a focused operator screen;
6. `economics`.

The smoke does not require a successful WB data import. It is enough that the UI:

- authenticates correctly;
- can create the first cabinet when needed;
- records or surfaces a manual sync outcome;
- renders `overview` and `economics` in a valid ready or operator-state mode;
- opens the signal detail panel when signals are present on `overview`;
- follows the first recommendation link and checks focused-screen state when that path exists.

## Command

```bash
npm run smoke:operator
```

For a self-contained local runtime check that starts both `next dev` and `Inngest Dev Server` automatically:

```bash
npm run smoke:operator:runtime
```

For a production read-only smoke that does not authenticate, create tenants,
trigger sync, export data or mutate production state:

```bash
npm run smoke:production:readonly
```

The runtime wrapper now picks a free local app port automatically when `:3000` is already occupied, so `predeploy:gate` no longer depends on a pristine local desktop.

## Expected Prerequisites

- local app is running, usually at `http://localhost:3000`;
- local Inngest Dev Server is running when you expect the manual sync to be picked up by the worker path;
- local auth/database environment is configured through `.env`;
- Playwright Chromium is installed:

```bash
npx playwright install chromium
```

## Environment Variables

Optional variables for the smoke run:

- `SMOKE_BASE_URL`
  - default: `http://localhost:3000`
- `SMOKE_AUTH_MODE`
  - values: `auto`, `login`, `signup`
  - default: `auto`
- `SMOKE_EMAIL`
  - required for `login` mode
  - auto-generated in `auto` and `signup` mode when omitted
- `SMOKE_PASSWORD`
  - default: `CodexSmoke123!`
- `SMOKE_CABINET_NAME`
  - cabinet name used when the account has no tenant yet
- `SMOKE_WB_TOKEN`
  - dummy token accepted by the current onboarding flow
- `SMOKE_TRIGGER_SYNC`
  - `1` by default
  - set `0` to skip the manual sync step
- `SMOKE_HEADLESS`
  - `1` by default
  - set `0` to watch the browser
- `SMOKE_EXPECT_INNGEST_RUNTIME`
  - `0` by default for the plain smoke command
  - when set to `1`, the script fails if manual sync stops at the UI enqueue step instead of being picked up by the local worker
- `PLAYWRIGHT_SMOKE_RETENTION_DAYS`
  - default: `3`
  - old `output/playwright/operator-smoke-*` directories older than this are pruned before a new run
- `PLAYWRIGHT_SMOKE_MAX_DIRS`
  - default: `20`
  - even fresh smoke artifact directories are capped by count to stop `output/playwright` from growing forever

Example with an existing user:

```bash
SMOKE_AUTH_MODE=login \
SMOKE_EMAIL=owner@example.com \
SMOKE_PASSWORD='StrongPassword123!' \
npm run smoke:operator
```

Production authenticated smoke should use a dedicated existing account and
usually skip manual sync unless the operator explicitly wants to test the live
worker path:

```bash
SMOKE_BASE_URL=https://xn----ptbqdfd1ao2c.xn--p1ai \
SMOKE_AUTH_MODE=login \
SMOKE_EMAIL=ops-smoke@example.com \
SMOKE_PASSWORD='StrongPassword123!' \
SMOKE_TRIGGER_SYNC=0 \
npm run smoke:operator
```

Only set `SMOKE_TRIGGER_SYNC=1` in production when it is acceptable to enqueue
a real sync run for that cabinet.

## Artifacts

The script writes artifacts to:

```text
output/playwright/operator-smoke-<timestamp>/
```

Artifacts include:

- `report.json` or `report.failure.json`
- screenshots for the key stages
- `trace.zip`

Old smoke artifact directories are auto-pruned before a new run according to `PLAYWRIGHT_SMOKE_RETENTION_DAYS` / `PLAYWRIGHT_SMOKE_MAX_DIRS`.

## Interpretation

A passing smoke run means:

- auth redirect worked;
- settings page became usable;
- manual sync produced either a tracked status or a visible error surface;
- `overview` and `economics` rendered one of the expected valid states;
- signal drill-down opened successfully when at least one active signal existed on the overview page;
- focused follow-up navigation rendered `signal-focus-banner` when the recommendation led to `economics` or `explorer`.

For `npm run smoke:operator:runtime`, the stronger expectation is:

- local `Next + Inngest` runtime came up successfully;
- manual sync was accepted without UI-side `fetch failed`/`ECONNREFUSED`;
- `sync_runs` moved beyond `В очереди`, proving the local worker picked the event up.

It does not yet prove:

- real WB token validity;
- production Inngest delivery;
- correctness of imported finance/order data.
