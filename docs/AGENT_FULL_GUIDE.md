<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes. Read the relevant guide in `node_modules/next/dist/docs/` before changing framework-level behavior.
<!-- END:nextjs-agent-rules -->

# Enterprise WB Analytics Agent Rules

## Project Identity

This repository is the implementation track for the WB analytics product in the `web/SaaS` stack:

- `Next.js`
- `Supabase Auth`
- `PostgreSQL`
- `Drizzle ORM`
- `Inngest`
- `Telegram integrations`

Do not reinterpret this repo as the full `GAS-only` project described in the root prompts. Those prompts are requirement sources and backlog inputs, not a statement of what is already implemented here.

## Source Of Truth

Use the following order of truth:

1. Server deployment snapshot on `metric-pulse-app-01`: `/srv/projects/enterprise-wb-analytics` (production baseline).
2. Local repo working tree in this workspace.
3. [docs/ENTERPRISE_LAUNCH_CHECKLIST.md](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/docs/ENTERPRISE_LAUNCH_CHECKLIST.md) — current primary work queue (P0→P3 from the 2026-04-15 audit).
4. [docs/ENTERPRISE_AUDIT_2026-04-15.md](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/docs/ENTERPRISE_AUDIT_2026-04-15.md) — detailed rationale for each checklist item.
5. [docs/operations/SERVER_PRODUCTION.md](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/docs/operations/SERVER_PRODUCTION.md) — ssh alias, port 3457, systemd units, known quirks.
6. [docs/operations/DEPLOY_PROCEDURE.md](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/docs/operations/DEPLOY_PROCEDURE.md) — exact deploy recipe.
7. [docs/operations/BACKUP_POLICY.md](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/docs/operations/BACKUP_POLICY.md) — when and how to snapshot before risky actions.
8. [docs/operations/CLAUDE_WORKFLOW.md](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/docs/operations/CLAUDE_WORKFLOW.md) — how to work with Claude Code on this repo (skills, sessions, wrap-up).
9. [docs/SESSION_BOOTSTRAP.md](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/docs/SESSION_BOOTSTRAP.md)
10. [docs/THREAT_MODEL.md](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/docs/THREAT_MODEL.md) — before any auth / tenancy / secrets work.
11. [docs/INCIDENT_RESPONSE.md](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/docs/INCIDENT_RESPONSE.md) — before any production-impacting task.
12. [docs/IMPLEMENTATION_BACKLOG.md](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/docs/IMPLEMENTATION_BACKLOG.md)
13. [docs/CHANGELOG.md](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/docs/CHANGELOG.md)
14. Root passport: [PROJECT_PASSPORT.md](/Users/vitea_b/Desktop/Боты/РНП_Gemini/PROJECT_PASSPORT.md)
15. Official WB API docs and release notes.

If a prompt, stale doc, or comment conflicts with the code and the passport, update the docs instead of inventing a second architecture.

## Server Access Quick Reference

- SSH alias: `metric-pulse-app-01` (resolves to `202.181.148.140`, root login via key)
- Project path on server: `/srv/projects/enterprise-wb-analytics`
- Web service listens on **port 3457**, not 3000 (override in systemd unit)
- Health: `curl http://localhost:3457/api/health` on the server
- Systemd units: `enterprise-wb-analytics.service`, `enterprise-wb-analytics-inngest.service`
- Full reference: [docs/operations/SERVER_PRODUCTION.md](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/docs/operations/SERVER_PRODUCTION.md)

Important:

- server directory is git-tracked and pinned to `origin/main`;
- baseline parity check is done by commit SHA (`git rev-parse`) between local and server;
- before non-trivial local work, ensure local `main` includes server HEAD.

## Non-Negotiables

- Do not start a parallel rewrite into Google Apps Script as the main runtime.
- Do not add tenant access shortcuts or trust `tenantId` from the client without membership validation.
- Do not expose RAW or analytics data from API routes without auth and tenant checks.
- Do not claim a task is done without running the relevant checks or explicitly documenting why they could not pass.
- Do not update product docs optimistically. Docs must reflect the actual state of the repo.
- Do not commit unrelated dirty worktree changes together with a focused task.

## Current Strategic Direction

The delivery target is `v1` of the web analytics platform with:

- secure auth and tenant isolation;
- stable user bootstrap and first-tenant creation;
- reliable WB ingestion;
- working views for overview, economics, dynamics, explorer, settings, and team;
- operational documentation and reproducible checks.

Google Sheets and Apps Script are allowed only as companion integration surfaces or future adapters.

## Required Workflow For Every Task

1. Read [docs/SESSION_BOOTSTRAP.md](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/docs/SESSION_BOOTSTRAP.md) and keep scope focused to the current task.
2. Baseline sync: compare local vs server commit SHA on `main` and align local to server if needed.
3. Read the relevant backlog item in [docs/IMPLEMENTATION_BACKLOG.md](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/docs/IMPLEMENTATION_BACKLOG.md).
4. Inspect the impacted files before editing.
5. Make the smallest coherent change that can close one backlog slice.
6. Run the relevant checks locally.
7. Merge into `main` and push to `origin/main`.
8. Deploy on server via git (`git fetch && git checkout main && git pull --ff-only`), then rebuild/restart services on server.
9. Verify server health and parity (`/api/health` and local/server SHA equality on `main`).
10. Update `docs/CHANGELOG.md`.
11. Update backlog status or notes if scope changed.
12. Commit only the files that belong to the closed item.

One closed backlog item should normally produce one focused commit.

## Check Policy

Minimum verification by task type:

- Docs-only change:
  - verify file links/paths manually;
  - run `git diff --check`.
- App/router/server logic:
  - run `npm run build` when the change can affect runtime integration;
  - run `npm run lint` if the touched area is lint-clean enough to provide signal;
  - run `npm run test` when the change touches pure helpers, queue logic, notification logic, or other unit-testable code paths;
  - if lint fails on pre-existing baseline issues, record that explicitly in the changelog or task notes.
- Data/schema change:
  - review `drizzle` files and schema together;
  - ensure the migration plan is updated in the backlog;
  - do not leave silent schema drift.
- UI flow change:
  - use browser-based verification when feasible;
  - prefer Playwright tooling for repeatable checks.

## Git And GitHub Rules

Current state:

- local git repo exists;
- default branch is `main`;
- GitHub remote `origin` is configured;
- GitHub repository: `viteab-source/enterprise-wb-analytics`;
- `gh` CLI is authenticated as `viteab-source`.

Rules:

- use focused branches with prefix `codex/` once branch work starts;
- never mix multiple backlog items in one commit;
- never stage unrelated untracked files just because they are nearby;
- when a GitHub remote is added, mirror backlog progress with commits before PR batching;
- default to pushing focused working branches, not dirty `main`;
- keep the remote private unless there is an explicit reason to open it.

## MCP And Tooling Policy

Primary tools for this repo:

- `git` and filesystem tools for local changes;
- GitHub MCP and `gh` for repository/PR/check operations;
- `web` for official WB API verification and external references;
- Playwright for UI and browser checks;
- `fetch` and GitHub search for external research;
- Google Workspace and Apps Script tools only when implementing Sheets/GAS companion workflows.

Do not browse random sources for API truth when official WB docs or release notes can answer the question.

## Skill Usage Guidance

Project-defined slash commands (in `.claude/commands/`) are the primary workflow entry points:

- `/audit-status` — read-only snapshot of the P0→P3 launch checklist, shows next recommended items
- `/close-p <id>` — open a specific P0/P1/P2/P3 item, propose a fix plan, then execute autonomously after approval
- `/deploy` — full deploy cycle to `metric-pulse-app-01` (backup if migration, push, pull, build, restart, verify)
- `/backup-db [tag]` — ad-hoc pg_dump snapshot before any risky action
- `/wrap-up` — finalize the current session and produce a copy-paste prompt for a fresh session

User-global skills and MCP tools to reach for:

- `playwright` / `chrome-devtools` — browser verification after UI changes
- `context7` — up-to-date library docs for Next.js 16, Drizzle 0.45, Supabase SSR, Zod 4, TanStack Query
- `sentry` — will become relevant once P0-08 adds Sentry integration
- `sequential-thinking` — for multi-step planning when the task spans several subsystems

Do not use:

- `wb-single-cabinet-analytics` — that skill is for a different workspace and architecture baseline
- `openai-docs` — this project uses YandexGPT, not OpenAI

Slash command file conventions: each command is a markdown file in `.claude/commands/` with a YAML frontmatter (`name`, `description`, optional `argument-hint`). The body is the instructions Claude follows when the slash command is invoked. The `$ARGUMENTS` token in the body is automatically replaced by whatever the user typed after the command (e.g. `/close-p P0-01` → `$ARGUMENTS = "P0-01"`). Files are committed to git (via the `.claude/commands/` allowlist in `.gitignore`) so teammates and new machines pick them up on clone. Note: do **not** confuse these with Anthropic "skills" (`anthropic-skills:*` etc.) — those are plugin-based, this is the standard Claude Code project commands mechanism.

## Session Management and Wrap-Up

This project prefers **focused sessions**, one coherent task per chat. Claude must **proactively** suggest wrapping up and providing a continuation prompt when any of these happen:

1. A P0 or P1 checklist item has been fully closed (committed, deployed, verified, checklist updated)
2. Two or more checklist items were closed in the same session
3. The conversation has been running for more than ~90 minutes of active work
4. A major state shift just occurred (server migration, schema change, infra decision) that invalidates earlier context
5. The remaining work in the session is a different topic area than what was done

The wrap-up flow is implemented in `.claude/commands/wrap-up.md`. When Claude decides to offer it, Claude should:
- Say "Задача закрыта. Предлагаю завернуть сессию и начать следующую с чистым контекстом."
- Execute the wrap-up skill internally (summary + next item + continuation prompt)
- Present the continuation prompt as a copy-paste block
- Wait for user acknowledgement

The user can always decline and continue in the same chat, but the offer should be made.

Do not wrap up if:
- The current task is still in progress
- There is an uncommitted local change that would be lost
- There is a pending question the user must answer before the next step
- The user explicitly said "продолжим в этом чате"

## Memory and Shared Knowledge

`~/.claude/projects/-Users-vitea-b-Desktop----------Gemini-enterprise-wb-analytics/memory/` contains auto-loaded files. For this project, three of them mirror files in `docs/operations/`:

- `server_production.md` ↔ `docs/operations/SERVER_PRODUCTION.md`
- `deploy_procedure.md` ↔ `docs/operations/DEPLOY_PROCEDURE.md`
- `backup_policy.md` ↔ `docs/operations/BACKUP_POLICY.md`

When you update any file in `docs/operations/`, immediately run:

```bash
node scripts/sync-claude-memory.mjs
```

This propagates the edit into the local memory so future Claude sessions load the fresh version. If you don't run it, the memory will go stale and diverge from the committed truth in git.

The remaining memory files (`user_role.md`, `feedback_autonomous.md`, `audit_checklist_2026.md`) are personal to this developer and do not have git counterparts.

## Architecture Guardrails

Prefer extracting shared auth and tenant validation helpers instead of duplicating checks in each route.

When touching data access, bias toward:

- explicit membership checks;
- deterministic tenant scoping;
- typed parsing and validation;
- idempotent writes where possible;
- auditability for background sync jobs.

When touching WB integrations, bias toward:

- retry/backoff;
- batching;
- source freshness markers;
- handling of partial failures;
- documentation of API caveats and version-sensitive behavior.

## Documentation Policy

The following docs must stay current:

- [README.md](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/README.md)
- [docs/SESSION_BOOTSTRAP.md](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/docs/SESSION_BOOTSTRAP.md)
- [docs/START_PROMPT_TEMPLATE.md](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/docs/START_PROMPT_TEMPLATE.md)
- [docs/ENTERPRISE_LAUNCH_CHECKLIST.md](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/docs/ENTERPRISE_LAUNCH_CHECKLIST.md)
- [docs/ENTERPRISE_AUDIT_2026-04-15.md](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/docs/ENTERPRISE_AUDIT_2026-04-15.md)
- [docs/THREAT_MODEL.md](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/docs/THREAT_MODEL.md)
- [docs/INCIDENT_RESPONSE.md](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/docs/INCIDENT_RESPONSE.md)
- [docs/operations/README.md](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/docs/operations/README.md)
- [docs/operations/SERVER_PRODUCTION.md](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/docs/operations/SERVER_PRODUCTION.md)
- [docs/operations/DEPLOY_PROCEDURE.md](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/docs/operations/DEPLOY_PROCEDURE.md)
- [docs/operations/BACKUP_POLICY.md](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/docs/operations/BACKUP_POLICY.md)
- [docs/operations/CLAUDE_WORKFLOW.md](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/docs/operations/CLAUDE_WORKFLOW.md)
- [docs/IMPLEMENTATION_BACKLOG.md](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/docs/IMPLEMENTATION_BACKLOG.md)
- [docs/CHANGELOG.md](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/docs/CHANGELOG.md)
- [docs/PROJECT_GUIDE.md](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/docs/PROJECT_GUIDE.md)
- [docs/RELEASE_CHECKLIST.md](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/docs/RELEASE_CHECKLIST.md)
- [docs/PRODUCTION_DEPLOYMENT.md](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/docs/PRODUCTION_DEPLOYMENT.md)
- [docs/PILOT_OPERATIONS.md](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/docs/PILOT_OPERATIONS.md)
- [PROJECT_PASSPORT.md](/Users/vitea_b/Desktop/Боты/РНП_Gemini/PROJECT_PASSPORT.md)

If a task changes architecture, workflow, or invariants, update docs in the same task.

## Definition Of Done

A task can be marked done only if:

- the target behavior is implemented;
- the impacted code paths were checked;
- backlog status is updated;
- changelog entry is written;
- the result is commit-ready without hidden assumptions.

If a task is blocked by a missing remote, missing secret, broken baseline lint, or missing environment, mark the blocker explicitly instead of calling the work complete.
