---
name: Enterprise launch checklist is the work queue
description: P0-P3 items from 2026-04-15 audit are tracked in docs/ENTERPRISE_LAUNCH_CHECKLIST.md; always open it before starting a fix
type: project
originSessionId: 0461dfe8-8845-435f-a7d5-f72890c3f71b
---
Since 2026-04-15 the primary backlog for this repo is the Enterprise Launch track. If the user asks to close Px-yy, it refers to items in this list.

**Why:** one big audit on 2026-04-15 catalogued 50 items across 4 priority tiers; IDs are stable across sessions and used in commit messages and branch names.

**How to apply:**
- Before any P0/P1 work, read the relevant section of `docs/ENTERPRISE_LAUNCH_CHECKLIST.md` (not the full audit doc unless context is needed).
- The checklist has per-item `Verify:` criteria — treat them as acceptance tests.
- Commit messages should reference the item: e.g. `fix(bot): fail-closed webhook when secret missing (P0-01)`.
- After closing an item: update its status to `done`, write the commit SHA into the `Commit:` slot, update progress summary at top of file, add a line to `docs/CHANGELOG.md`.
- Pre-existing doc `docs/AUDIT_FIXES.md` is historical (passes 1-6 from another agent) — useful as context but the current tracking is in `ENTERPRISE_LAUNCH_CHECKLIST.md`.

**Order recommendation** (from the 2026-04-15 audit):
1. Cheap P0 batch: P0-01 (bot fail-closed), P0-02 (error scrub), P0-05 (DB pool) — can be done in one commit in under an hour.
2. CI rails: P0-07 (GitHub Actions).
3. Observability: P0-08 (Sentry + pino).
4. Wait for user decision / server migration for P0-06 (infra topology).
5. After server migration: P0-03 (RLS). Delaying RLS until after migration avoids drift between old and new DB roles.

Related docs:
- `docs/ENTERPRISE_AUDIT_2026-04-15.md` — full audit report with rationale and file:line references
- `docs/THREAT_MODEL.md` — STRIDE review, consult before touching auth / secrets / tenancy
- `docs/INCIDENT_RESPONSE.md` — runbook, consult before any production-impacting action
