# Enterprise WB Analytics — agent rules (concise)

> Полный гайд (workflow, doc policy, definition-of-done и т.п.) лежит в
> [docs/AGENT_FULL_GUIDE.md](docs/AGENT_FULL_GUIDE.md). Читай его только если
> текущая задача того требует — в каждом turn'е он не нужен.

## Stack

Next.js 16 (Turbopack) · Supabase Auth · PostgreSQL · Drizzle ORM · Inngest · Telegram.
Это **НЕ** обычный Next.js — есть breaking changes. Если меняешь framework-level поведение,
сначала посмотри `node_modules/next/dist/docs/`.

## Production server

- Hosting/VDS panel: **`https://my.hosting-vds.com/`**.
- SSH alias: **`metric-pulse-app-01`** (root через ключ).
- Project path: `/srv/projects/enterprise-wb-analytics`.
- Web service: **port 3457** (не 3000), systemd unit `enterprise-wb-analytics.service`.
- Health: `curl http://localhost:3457/api/health`.
- Полная справка: [docs/operations/SERVER_PRODUCTION.md](docs/operations/SERVER_PRODUCTION.md).

## Non-negotiables

- Не запускать параллельный rewrite в Google Apps Script как основной runtime.
- Не доверять `tenantId` от клиента без `requireTenantAccess()` / membership-проверки.
- Не отдавать RAW / analytics-данные из API без auth + tenant-проверки.
- Не объявлять задачу done без релевантных проверок (см. ниже).
- Не обновлять product docs «оптимистично» — docs должны отражать реальное состояние.
- Не смешивать в одном коммите несвязанные изменения.

## Karpathy-style execution rules

Эти правила встроены в проектный workflow по мотивам
`forrestchang/andrej-karpathy-skills` и обязательны для нетривиальных задач.

- Сначала формулируй допущения, риск и критерий успеха; если смысл задачи
  реально неоднозначен — коротко уточни, а не угадывай.
- Делай минимальное решение под текущую цель: без speculative features, лишней
  конфигурируемости и абстракций для одного места.
- Правь хирургически: каждая изменённая строка должна быть связана с задачей.
  Несвязанный dead code или грязь фиксируй в отчёте/backlog, не удаляй походя.
- Сохраняй стиль существующего участка даже если лично выбрал бы другой.
- Любую задачу закрывай проверкой: тест, typecheck, build, smoke или явное
  объяснение, почему проверка сейчас невозможна.
- Для рефакторинга сначала докажи текущее поведение, затем меняй и снова
  проверяй. Если 200 строк можно заменить 50 без потери ясности — упрощай.

## Workflow (краткий)

1. Один backlog-item → один focused commit.
2. Перед нетривиальной локальной работой — синхронизировать local/server SHA на `main`.
3. Деплой через `ssh metric-pulse-app-01` → `git pull --ff-only` → build → systemctl restart.
4. После деплоя — `/api/health` + parity SHA (local == server).
5. Обновить `docs/CHANGELOG.md`.
6. Если мигрировал что-то в `docs/operations/*` — запустить `node scripts/sync-claude-memory.mjs`.

## Checks по типу задачи

- **Docs-only**: `git diff --check` + проверка ссылок.
- **App / route / server logic**: `npm run build` обязательно; `npm run test` если задеты pure helpers / queue / notifications; `npm run lint` если зона lint-clean.
- **Schema / migration**: пройти `drizzle/`, обновить план в backlog, не оставлять silent drift.
- **UI flow**: browser-проверка где возможно (Playwright или Chrome MCP).

## Slash-команды проекта (`.claude/commands/`)

- `/audit-status` — read-only снимок P0-P3 чек-листа.
- `/close-p <id>` — открыть P-item, предложить план, выполнить после ОК.
- `/deploy` — full-cycle деплой на metric-pulse-app-01.
- `/backup-db [tag]` — pg_dump snapshot перед рискованной операцией.
- `/wrap-up` — закрыть сессию + выдать промпт для следующей.

## Источник правды

`docs/IMPLEMENTATION_BACKLOG.md` (текущая очередь) + `docs/CHANGELOG.md` (история).
Если prompt / stale doc / комментарий конфликтуют с кодом — обновляй docs, не выдумывай вторую архитектуру.

## Memory sync

Файлы в `~/.claude/projects/-Users-...-enterprise-wb-analytics/memory/` — auto-loaded.
Три из них синхронизированы с `docs/operations/`:
`server_production.md`, `deploy_procedure.md`, `backup_policy.md`.
После правки любого `docs/operations/*` — **обязательно**:
```bash
node scripts/sync-claude-memory.mjs
```
