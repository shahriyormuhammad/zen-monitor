---
name: wrap-up
description: Finalize the current Claude Code session and produce a copy-paste-ready prompt for continuing the work in a fresh session
---

Wrap up the current session cleanly. This is called either:
- Automatically by Claude when a P0/P1 item is closed or when the session gets long
- Manually by the user when they want to pause / switch context

## 1. Summarize what was done in the current session

Look at the conversation history and extract:
- Files modified
- Commits made (with SHAs, find them via `git log --oneline` after the most recent pre-session HEAD)
- Any P0-Pxx checklist items that were closed or progressed
- Server changes: deploys, migrations, restarts
- Any pending / blocked items the user should know about

If the session did not produce any commits, note that and skip the commit list.

## 2. Take the current state snapshot

- `git -C /Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics rev-parse HEAD` — current main SHA
- Compare with `ssh goalbot 'git -C /srv/projects/enterprise-wb-analytics rev-parse HEAD'` — server SHA
- If they differ, warn: "Local and server are out of sync — decide whether to deploy before closing."
- Read `docs/ENTERPRISE_LAUNCH_CHECKLIST.md` progress summary for the latest counts

## 3. Identify the next best task

Based on the checklist, pick the highest-priority item that is:
- `todo` or `in_progress` (not `done`)
- Not blocked on a user decision or external dependency
- Cheapest to close given the remaining work

If multiple are equally good, prefer the one that would benefit the next items in the queue (e.g. P0-07 CI/CD unlocks safe deploys for P0-03 RLS).

## 4. Generate the continuation prompt

Produce a fenced code block containing a complete self-contained prompt the user can paste into a new Claude Code session. It must:

- Open with the target item ID and a brief description
- Reference `docs/ENTERPRISE_LAUNCH_CHECKLIST.md` as the source of truth
- Set the autonomy level ("действуй автономно, отчёт по каждому шагу")
- List the expected workflow (plan → approve → execute → verify → update checklist → commit → deploy → report)
- Include any project-specific quirks the next session needs to know that are NOT already in memory files (rare, but e.g. "the last session left a dirty state in X, clean it up first")
- End with a guardrail list: "Не трогай вне скоупа; сервер на порту 3457; P2-48 client-reference-manifest errors — known issue, не регрессия"

## 5. Present to the user in Russian

Format the final output as:

```
## Сессия закрыта

**Сделано:**
- <list>

**Текущее состояние:**
- main: <SHA> (local == server ✓ or ⚠️)
- P0/P1/P2/P3 progress: <table>

**Рекомендую дальше:** <item ID> — <reason>

**Промпт для новой сессии:**

​```
<the full continuation prompt here>
​```

Готов? Закрывай этот чат и вставляй промпт выше в новый.
```

Do not actually close anything (Claude can't close the terminal). Just provide the information.
