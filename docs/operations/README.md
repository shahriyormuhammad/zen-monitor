# Operations knowledge base

This directory is the **source of truth** for operational facts about the project:
- Production server topology and access (`SERVER_PRODUCTION.md`)
- Deploy procedure and rollback (`DEPLOY_PROCEDURE.md`)
- Backup policy and snapshot recipes (`BACKUP_POLICY.md`)
- MCP servers and Claude Code skills (`CLAUDE_WORKFLOW.md`)

## Why these are in `docs/`, not just in Claude memory

Files here are committed to git so they are:
- **Shared across machines** — any clone of the repo has them
- **Readable by humans** — new teammates can onboard without Claude
- **Versioned** — you can see history of how deploy/backup/server topology evolved
- **Mirrored** into `~/.claude/projects/.../memory/` on developer machines so Claude Code auto-loads them at session start

## Mirror to Claude Code memory

The files `SERVER_PRODUCTION.md`, `DEPLOY_PROCEDURE.md`, `BACKUP_POLICY.md` are duplicated with the same contents into the developer's local Claude Code project memory (`~/.claude/projects/-Users-vitea-b-Desktop----------Gemini-enterprise-wb-analytics/memory/`) so that every new Claude session in this repo knows them without having to read them on demand.

**When you edit a file in `docs/operations/`, copy the change into the corresponding memory file.** There is a helper `scripts/sync-claude-memory.mjs` described in `CLAUDE_WORKFLOW.md` that does this automatically.

## Relation to other docs

- `docs/PRODUCTION_DEPLOYMENT.md` — higher-level "how production is organized" reference (long-form)
- `docs/INCIDENT_RESPONSE.md` — runbook for incidents, references recipes from `BACKUP_POLICY.md` and `DEPLOY_PROCEDURE.md`
- `docs/ENTERPRISE_LAUNCH_CHECKLIST.md` — work queue, uses facts from this directory
- `docs/operations/` (this dir) — concrete commands, ssh aliases, exact paths, versions

If there's a conflict between `docs/operations/*` and a higher-level doc, `docs/operations/*` wins for operational details (ports, paths, commands). The higher-level doc wins for "why" questions.
