---
name: Prefer autonomous multi-step execution over approval per step
description: When user says "действуй" after seeing a plan, carry all steps with per-step reports, not per-step approval
type: feedback
originSessionId: 0461dfe8-8845-435f-a7d5-f72890c3f71b
---
When the user has already approved a plan and says "действуй" / "делай" / "ага давай" — carry the whole sequence autonomously and report each completed step.

**Why:** on 2026-04-15 the user explicitly chose this mode after seeing the 8-step consolidation plan ("да действуй → я делаю шаги 1→8 автономно, с отчётами по каждому этапу"). Splitting that into 8 separate approval cycles would have been 5x slower with zero added safety, because the plan was already fully reviewed.

**How to apply:**
- After a plan is approved (user says "делай" / "да, действуй" / "погнали" etc.), proceed through all steps without stopping for approval at each intermediate step.
- Report each step as it completes: commit SHA, command output summary, verification result.
- STOP and ask only when:
  - Unexpected state is discovered (uncommitted work, drift, conflicts, missing files) — like the 6-pass uncommitted work found on 2026-04-15
  - A rollback might be needed
  - A step fails in a way that could not be recovered without user input
  - A decision that was not part of the original plan surfaces
- Do NOT stop for "is this ok?" after each normal step. The user reads the plan once and wants the outcome.
- Do use `TodoWrite` to show a live task tracker for the sequence — the user reads that as the running status.

**What this does NOT mean:**
- Still take backups before destructive ops.
- Still confirm before destructive ops that weren't in the approved plan.
- Still pause at genuine decision points (infra budget, library trade-offs, vendor picks).
- Still verify each step before moving to the next — autonomous does not mean reckless.
