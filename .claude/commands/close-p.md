---
name: close-p
description: Start working on a specific P0/P1/P2/P3 item from the enterprise launch checklist
argument-hint: <P0-XX>
---

The user passed an item ID like `P0-01`, `P1-09`, etc. as `$ARGUMENTS`. If `$ARGUMENTS` is empty, ask which item to work on and stop.

Target item: **$ARGUMENTS**

Workflow:

1. **Read context** (required, do not skip):
   - Read `docs/ENTERPRISE_LAUNCH_CHECKLIST.md` and find the section for the given ID. Extract:
     - Status (if already `done`, warn user and stop)
     - Files affected
     - Concrete steps / values
     - Verify criteria
     - Blocked-by dependencies
   - Read the corresponding detail section in `docs/ENTERPRISE_AUDIT_2026-04-15.md` for rationale
   - Read `docs/operations/SERVER_GOALBOT.md` if the fix will touch the server
   - Read `docs/operations/DEPLOY_PROCEDURE.md` if a deploy is involved
   - Read `docs/operations/BACKUP_POLICY.md` if a DB change is involved

2. **Read the actual files** mentioned in the checklist item. Understand the current state before proposing changes.

3. **Propose a plan** in Russian with:
   - Summary of what the item requires in 2-3 sentences
   - List of files to modify and the exact change in each
   - Verify steps that will run after implementation
   - Expected commit message in conventional format
   - Deploy path (code-only vs with migration)
   - **Explicit warning if the change needs a DB backup first** (per `BACKUP_POLICY.md`)
   - Estimated time to completion

4. **Wait for user approval**. Do not start making changes until the user says "да" / "давай" / "действуй" / "погнали".

5. **Execute autonomously** once approved:
   - Make the code changes
   - Run `npm run lint && npm run test && npm run build` (stop on failure)
   - Commit with the conventional message, Co-Authored-By trailer
   - Push to `origin/main`
   - Deploy following `docs/operations/DEPLOY_PROCEDURE.md`
   - Verify via the criteria in the checklist item
   - Update `docs/ENTERPRISE_LAUNCH_CHECKLIST.md` — set status to `done`, fill in the `Commit:` slot with the SHA
   - Update the progress counters at the top of the checklist
   - Write a new entry in `docs/CHANGELOG.md`
   - Commit the docs update separately
   - Push again and pull on server (no restart — docs only)

6. **Report** at the end:
   - Commit SHAs (code + docs)
   - Verify output summary
   - New progress counters
   - Optional `/wrap-up` suggestion if this was a big item

7. **Stop and ask** if anything unexpected happens:
   - Drift in local vs server state
   - Lint/test/build failure that can't be fixed in the item's scope
   - A dependency on a blocked item (e.g. P0-03 needs P0-06 infra decision)
   - Config values the user should pick (pool sizes, rate limits, Sentry DSN, etc.)
