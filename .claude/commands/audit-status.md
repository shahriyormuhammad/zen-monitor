---
name: audit-status
description: Show the current state of the enterprise launch audit checklist — counts by priority, done/todo breakdown, and the next recommended item
---

Read `docs/ENTERPRISE_LAUNCH_CHECKLIST.md` and produce a concise status snapshot. Do not make any changes.

Steps:
1. Read the top of `docs/ENTERPRISE_LAUNCH_CHECKLIST.md` (progress summary section) to get the overall counts.
2. Scan the full file for items marked `Status: done` and items marked `Status: todo` / `blocked` / `in_progress`.
3. Cross-reference with `docs/IMPLEMENTATION_BACKLOG.md` "Enterprise Launch Track" section for a second view.
4. Output the following, in Russian:
   - A short header with date and current `main` commit SHA
   - A compact progress table: | Priority | Total | Done | In progress | Todo | Blocked |
   - A list of the **next 3 recommended items to close**, based on:
     - P0 blockers first, cheapest first (P0-01, P0-02, P0-05 are the cheapest)
     - Skip items that are blocked (like P0-06 until user decides infra)
     - Prefer items that do not require infra decisions
   - For each recommended item include: ID, one-line description, estimated time, blocking dependencies
   - If any P0/P1 is `in_progress`, list its remaining subtasks explicitly
5. End with a single-line suggestion: `Предлагаю начать с P0-XX — это <минуты> работы, не требует миграций/бэкапов. Напиши "погнали" чтобы начать.`

Do not offer to make code changes during this skill. This is a read-only status command.
