# Session Bootstrap

Use this file to start any new Codex/LLM session without re-reading the entire repository.

## Goal

Reduce repeated "project discovery" and keep context focused on the current backlog slice.

## 60-Second Context

- Product: Enterprise WB Analytics (`web/SaaS`), not a GAS-only runtime.
- Stack: Next.js + Supabase Auth + PostgreSQL + Drizzle + Inngest + Telegram integrations.
- Product focus: secure multi-tenant analytics, stable WB ingestion, operator workflows.
- Production baseline host: `metric-pulse-app-01` server path `/srv/projects/enterprise-wb-analytics`.

## Canonical Sources (Read In This Order)

1. `AGENTS.md`
2. `docs/knowledge/INDEX.md` (project memory: decisions, sources of truth, financial rules)
3. `docs/PROJECT_GUIDE.md`
4. `docs/ENTERPRISE_LAUNCH_CHECKLIST.md` (P0→P3 audit track — primary work queue since 2026-04-15)
5. `docs/ENTERPRISE_AUDIT_2026-04-15.md` (details and rationale for checklist items)
6. `docs/IMPLEMENTATION_BACKLOG.md` (only the relevant item/slice)
7. `docs/CHANGELOG.md` (latest entries relevant to touched area)
8. `docs/THREAT_MODEL.md` (before any auth/tenancy/secrets work)
9. `docs/INCIDENT_RESPONSE.md` (before any production-impacting task)
10. Root `PROJECT_PASSPORT.md` (only for architecture boundary and historical context)

## Default Session Rules

- Do not run a full-repo exploration unless the task explicitly requires it.
- Do not reinterpret the repo as GAS-only architecture.
- Do not trust `tenantId` from client input without membership checks.
- Do not mark tasks done without checks (or explicit blocker notes).
- Keep scope tight: one coherent backlog slice per change when possible.

## What To Read By Task Type

- Auth / tenancy / API access:
  - `src/lib/auth/**`
  - `src/app/api/**`
  - relevant backlog item
- WB sync / ingestion:
  - `src/inngest/**`
  - `src/server/jobs/**`
  - `docs/PRODUCTION_DEPLOYMENT.md` (runtime/env)
- Dashboard/operator UX:
  - `src/app/(dashboard)/**`
  - `src/components/**`
  - `docs/SMOKE_OPERATOR_FLOW.md`
- Release/deploy/readiness:
  - `docs/RELEASE_CHECKLIST.md`
  - `docs/PRODUCTION_DEPLOYMENT.md`
  - latest `docs/CHANGELOG.md`

## Minimal Startup Checklist (Per New Session)

1. Confirm cwd and branch.
2. Read `AGENTS.md` + this file.
3. Read only the docs/code needed for the current task.
4. State assumptions briefly, then implement.
5. Run relevant checks for touched surfaces.
6. Update docs/changelog/backlog if invariants or workflow changed.

## Quick Commands

```bash
git status --short
npm run build
npm run lint
npm run test
npm run smoke:operator
```

Use only the checks relevant to the changed scope if a full suite is too expensive.

## Anti-Drift Notes

- If docs conflict with code reality, update docs in the same task.
- If root prompts conflict with current implementation, treat root prompts as requirement inputs only.
- Prefer small, reviewable diffs over broad refactors during operational work.

## Companion File

For a copy-paste first message to start new sessions, use:

- `docs/START_PROMPT_TEMPLATE.md`
