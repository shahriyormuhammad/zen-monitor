# Claude Code workflow for this project

How to work with Claude Code effectively on `enterprise-wb-analytics`. This is the doc to read when:
- You're about to start a new chat session
- You're about to close a long session and want to pick up later
- You want to know which MCP servers and skills are relevant
- You want to understand how memory/context persists

---

## How Claude Code projects work

Claude Code auto-detects a "project" by the directory you launch it in. For this repo, the project identity is derived from the path:
```
/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics
```

All sessions you open in this directory (or its worktrees like `.claude/worktrees/*`) share the same project identity. The project-specific state lives in:
```
~/.claude/projects/-Users-vitea-b-Desktop----------Gemini-enterprise-wb-analytics/
├── memory/             # auto-loaded facts and user preferences
└── tasks/              # background task outputs
```

### What persists between sessions

- **Project memory** (`memory/*.md`): auto-loaded into every new session. For this project contains:
  - `server_production.md` — server topology (mirror of `docs/operations/SERVER_PRODUCTION.md`)
  - `deploy_procedure.md` — deploy recipe (mirror of `docs/operations/DEPLOY_PROCEDURE.md`)
  - `backup_policy.md` — backup policy (mirror of `docs/operations/BACKUP_POLICY.md`)
  - `user_role.md` — personal preferences (not in git)
  - `feedback_autonomous.md` — workflow preference for autonomous execution (not in git)
  - `audit_checklist_2026.md` — pointer to `docs/ENTERPRISE_LAUNCH_CHECKLIST.md`
- **CLAUDE.md / AGENTS.md** in the repo root — auto-loaded into every session via the Claude Code harness
- **Settings** in `~/.claude/settings.json` — hooks, themes, keybindings

### What does NOT persist between sessions

- **The conversation itself** — each new session is a clean slate
- **TodoWrite tasks** — reset on new session
- **File changes you made mid-session** — these are on disk or in git; Claude re-reads them
- **Running monitors** (`Monitor`, background `Bash` tasks) — they die when the session ends

### New session = new chat. Claude is the same Claude.

Every `claude` command you run in this directory loads the same project identity. The **conversation history is gone**, but memory, docs, and settings are all re-read at startup.

---

## Ending and continuing a session

### Why end sessions deliberately

- Very long sessions accumulate a long conversation history that costs more per token and eventually gets compacted (summarized, losing detail).
- Once a self-contained task is done (e.g. a P0 item closed and committed), there is no value in keeping it in conversation history when starting the next one.
- A fresh session re-reads the current state of files and docs, so it always sees the **current** truth — not a cached mental model from 2 hours ago.

### When to offer wrap-up

Claude is instructed (via `AGENTS.md`) to **proactively** suggest a fresh session when:
1. A P0 / P1 checklist item is closed and committed — the next item in the queue is a natural session boundary
2. The conversation has been running for a long time (> ~90 min of work) and a coherent subtask finished
3. A major state shift happened (server migration, infra change) that makes old context stale

The wrap-up offer should include a **copy-paste-ready prompt** for the next session. The skill `.claude/commands/wrap-up.md` generates this prompt from the current state of `docs/ENTERPRISE_LAUNCH_CHECKLIST.md`.

### Manual wrap-up

You can type `/wrap-up` at any time to get:
- Summary of what was done in the current session
- Current state of the launch checklist
- A copy-paste prompt for continuing in a new chat

Or ask explicitly: "заверни сессию и дай промпт для следующей" — the effect is the same.

---

## Slash commands defined for this project

Project-level slash commands live in `.claude/commands/*.md`. Each file becomes a `/command-name` available in any Claude Code session opened in this directory. Defined for this project:

| Slash command | What it does | When to use |
|---|---|---|
| `/audit-status` | Show the current P0 → P3 status with counts, done/todo breakdown | Any time you want to see the big picture without reading the full checklist file |
| `/close-p <id>` | Open a P0/P1 checklist item, read its context, and propose a focused fix plan | When you know you want to work on a specific item, e.g. `/close-p P0-07` |
| `/deploy` | Execute the full deploy cycle on `metric-pulse-app-01`: backup if needed, push, pull, build, restart, verify | After commits are ready and you want to ship them |
| `/backup-db [tag]` | Take a fresh pg_dump snapshot on the server (for ad-hoc safety before any risky action) | Before manual SQL, before `ALTER SYSTEM`, before any destructive operation |
| `/wrap-up` | Finalize the current session and generate a continuation prompt for a new chat | When a task is done and you want to pause / switch context |

### Format

Each file has YAML frontmatter (`name`, `description`, optional `argument-hint`) and a markdown body that becomes the prompt template. The token `$ARGUMENTS` in the body is replaced by whatever the user typed after the command name (e.g. `/close-p P0-01` → `$ARGUMENTS = "P0-01"`).

### Slash commands vs Anthropic skills

These are **slash commands** (the standard Claude Code project commands mechanism), not "skills". Anthropic skills (`anthropic-skills:pdf`, `anthropic-skills:docx`, `update-config`, `loop`, etc.) are plugin-based and listed separately in the available-tools list — they cannot be created by dropping a file into `.claude/commands/`. If you mistakenly put a project command file into `.claude/skills/`, the new session will respond `Unknown skill: <name>` because that path is not recognized.

### Reload after editing

After adding or editing a file in `.claude/commands/`, **start a new Claude Code session** in the same project directory (just open a new tab / new chat). The current session does not hot-reload the commands list. No app restart is required.

---

## MCP servers used by this project

Claude Code reads MCP server config from three places (in priority order):
1. User-global: `~/.claude.json`
2. Project-shared: `.mcp.json` in the repo root (committed to git)
3. CLI flags: `--mcp-config`

### Already available (user-global, not repo-specific)

These are configured on the developer's local Claude Code installation and work in any project:
- **filesystem** — read/write files outside the current working directory (e.g. `~/Downloads`)
- **chrome-devtools** / **playwright** — browser automation for UI verification
- **linear** — Linear issues (not yet used by this project)
- **notion** — Notion page reads (not yet used)
- **sentry** — Sentry error search (will be used once P0-08 adds Sentry)
- **cloudflare-bindings** — for Cloudflare Workers / KV / D1 (not used)
- **context7** — up-to-date library docs (extremely useful for Next.js 16, Drizzle, Supabase SSR)
- **prisma-local** / **prisma-remote** — we use drizzle, not prisma; irrelevant
- **memory** — knowledge graph memory (we use file-based memory instead)
- **time** — current time / timezone conversions
- **fetch** — HTTP fetches through the model
- **openai-docs** — not relevant (we use YandexGPT)
- **sequential-thinking** — reasoning helper

### Specifically useful for this project

When working on any task, Claude can call:
- **`context7`** for Next.js 16 / Drizzle 0.45 / Supabase SSR / Zod 4 / TanStack Query docs. Example query: "how to configure postgres-js pool max in drizzle 0.45".
- **`sentry`** (after P0-08 lands) — search production errors by tag, get stack traces.
- **`playwright`** — run a quick E2E smoke after a UI change (we already have Playwright locally for RPA).
- **`fetch`** — hit WB API docs or a health endpoint.
- Direct `Bash` with `ssh metric-pulse-app-01` — for anything on the server (SSH config is already in `~/.ssh/config`).

### Project-local MCP config (`.mcp.json`)

We **do not** maintain a project-specific `.mcp.json` because:
- The developer's user-global MCP config already covers everything we need
- Adding project-local MCP servers would duplicate config and create drift
- If a teammate without the user-global setup joins, they should follow the installation guide in the Claude Code docs

If we ever need a shared MCP server (e.g. a self-hosted inspection tool for RPA state), we'll add `.mcp.json` at that time.

---

## The sync-claude-memory script

`scripts/sync-claude-memory.mjs` mirrors `docs/operations/*.md` into the developer's local `~/.claude/projects/.../memory/` directory so Claude auto-loads them.

```bash
# Copy docs/operations -> memory (normal direction)
node scripts/sync-claude-memory.mjs

# Reverse: copy memory -> docs (use if you edited memory by hand first)
node scripts/sync-claude-memory.mjs --reverse

# Check only (exit 1 if out of sync, useful for pre-commit hook)
node scripts/sync-claude-memory.mjs --check
```

**Run this after editing any file in `docs/operations/`** so the change takes effect in Claude memory.

The script is local-only — it modifies `~/.claude/projects/.../memory/`, which is per-developer and not in git. CI never runs it.

---

## Recommended session flow

1. Open a new Claude Code chat in the project directory
2. State the task in one sentence and say "действуй автономно"
3. Claude shows a short plan — approve or refine
4. Claude executes: code → lint/test/build → commit → push → deploy → verify → update checklist
5. Claude offers a `/wrap-up` prompt for the next session
6. You accept and close the chat

A clean cycle for one P0 item is ~15-40 min of real-time work on Claude's side.

---

## What NOT to do

- **Don't edit `~/.claude/projects/.../memory/*.md` directly** unless it's a personal preference file (user_role.md, feedback_autonomous.md). Edit `docs/operations/*.md` and re-run the sync script.
- **Don't commit `~/.claude/` anything** — it's developer-local state, not shared.
- **Don't pile multiple P0 items into one chat** — that's exactly the kind of long session the wrap-up flow is designed to avoid.
- **Don't expect Claude to remember yesterday's chat** — it won't. But it will read `docs/CHANGELOG.md` and `docs/ENTERPRISE_LAUNCH_CHECKLIST.md` and figure out what happened.
