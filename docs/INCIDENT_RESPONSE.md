# Incident Response Runbook — Enterprise WB Analytics

> Last updated: 2026-04-15
> On-call: _(впишите контакт дежурного оператора)_
> Эскалация: _(впишите контакт техлида/владельца)_

Этот документ — **действующий runbook** для оператора. Держите его открытым в отдельной вкладке во время дежурства. Обновляйте после каждого инцидента.

---

## 0. Экстренные контакты и доступы

| Ресурс | Доступ | Комментарий |
|---|---|---|
| SSH к `metric-pulse-app-01` (202.181.148.140) | `ssh metric-pulse-app-01` (root) | Alias должен быть в `~/.ssh/config`. |
| БД приложения | `psql "$DATABASE_URL"` на сервере | Через env, пароль не хранить в clipboard. |
| Supabase API | `http://127.0.0.1:54321` на сервере | Self-hosted, внешний доступ закрыт firewall. |
| Telegram bot admin | Чат оператора бота | Token в `.env.production`. |
| Cloudflare | — | Если DNS cutover уже сделан. |
| Backups директория | `/srv/backups/enterprise-wb-analytics/` на сервере | Последние снапшоты pg_dump + project files. |
| Локальная копия последнего бэкапа | `~/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics-backups/` | Для offline восстановления. |

---

## 1. Severity matrix

| Severity | Критерий | Реакция |
|---|---|---|
| **SEV-1** | Сервис недоступен для всех тенантов; утечка данных; компрометация токена/ключа | Разбудить техлида немедленно; начать расследование в ≤ 15 минут. |
| **SEV-2** | Частичная потеря функционала (один домен — advertising, reviews, redistribution); один тенант не может залогиниться; Inngest встал | Реакция в ≤ 30 минут в рабочее время, ≤ 2 часа ночью. |
| **SEV-3** | Деградация UX; высокий error rate; зависшие sync-run'ы; cost abuse в YandexGPT | Реакция в ≤ 4 часа. |
| **SEV-4** | Косметические баги, нерегулярные warnings, устаревшие данные в дашборде | Обычный backlog. |

---

## 2. Playbooks

### 2.1 Сервис недоступен (web/API возвращает 5xx)

```bash
ssh metric-pulse-app-01
systemctl status enterprise-wb-analytics
# если failed:
journalctl -u enterprise-wb-analytics -n 200 --no-pager
systemctl restart enterprise-wb-analytics
# если не помогает — проверить предыдущий деплой:
cd /srv/projects/enterprise-wb-analytics
git log -5
# rollback к предыдущему коммиту:
git reset --hard <previous_commit>   # осторожно, только если уверены
systemctl restart enterprise-wb-analytics
```

Проверить health после рестарта:
```bash
curl -sS http://localhost:3457/api/health | jq .
```

### 2.2 Inngest не исполняет задачи

```bash
systemctl status enterprise-wb-analytics-inngest
journalctl -u enterprise-wb-analytics-inngest -n 200 --no-pager
# если signed self-hosted runtime подвис:
systemctl restart enterprise-wb-analytics-inngest
# проверить, что /api/inngest доступен:
curl -sS http://localhost:3457/api/inngest
```

Если после рестарта cron-функции не срабатывают в течение 5 минут — проверить env `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`, `INNGEST_BASE_URL` в `.env.runtime`; `INNGEST_DEV` в production должен отсутствовать.

### 2.3 БД не отвечает / connection exhausted

```bash
ssh metric-pulse-app-01
systemctl status postgresql@17-main
journalctl -u postgresql@17-main -n 200 --no-pager
# посмотреть активные подключения:
psql "$DATABASE_URL" -c "SELECT pid, usename, state, query_start, wait_event, query FROM pg_stat_activity WHERE datname = current_database() ORDER BY query_start NULLS LAST;"
# убить зависшую транзакцию (осторожно):
psql "$DATABASE_URL" -c "SELECT pg_terminate_backend(<pid>);"
```

Если connection pool забит `idle in transaction` — это симптом P0-05 (неправильно настроенный pool) или долгих транзакций в коде. Смотрите последние deploys.

### 2.4 Sync WB завис/упал

Проверить состояние run-ов:
```bash
psql "$DATABASE_URL" -c "SELECT id, tenant_id, status, started_at, finished_at, error_message FROM sync_runs ORDER BY started_at DESC NULLS LAST LIMIT 20;"
```

Auto-finalize stale:
```bash
# применяется в UI при обновлении, см. getSyncRunsHistory
# альтернатива — принудительно:
psql "$DATABASE_URL" -c "UPDATE sync_runs SET status='failed', error_message='[sync_run_stale_manual]', finished_at=NOW() WHERE status IN ('pending','running') AND started_at < NOW() - INTERVAL '30 minutes';"
```

Проверить последние ошибки WB API:
```bash
journalctl -u enterprise-wb-analytics-inngest -n 500 --no-pager | grep -iE "wb_|syncWildberries" | tail -30
```

### 2.5 Telegram webhook не приходит

1. Проверить статус webhook в Telegram:
   ```bash
   TOKEN=$(grep '^TELEGRAM_BOT_TOKEN=' /srv/projects/enterprise-wb-analytics/.env.production | cut -d= -f2-)
   curl -sS "https://api.telegram.org/bot${TOKEN}/getWebhookInfo" | jq .
   ```
   - `last_error_message` / `last_error_date` покажут, падал ли.
2. Проверить, что публичный домен ведёт на новый сервер:
   ```bash
   dig +short xn----ptbqdfd1ao2c.xn--p1ai A
   curl -sS https://про-цифры.рф/api/health | jq .
   ```
3. Проверить `/api/bot` локально:
   ```bash
   curl -sS -X POST http://localhost:3457/api/bot -H "X-Telegram-Bot-Api-Secret-Token: $(grep TELEGRAM_WEBHOOK_SECRET /srv/projects/enterprise-wb-analytics/.env.production | cut -d= -f2-)" -H "Content-Type: application/json" -d '{}'
   ```
4. Пере-установить webhook если Telegram указывает не на основной домен:
   ```bash
   curl -sS "https://api.telegram.org/bot${TOKEN}/setWebhook?url=https://про-цифры.рф/api/bot&secret_token=$(grep TELEGRAM_WEBHOOK_SECRET .env.production | cut -d= -f2-)"
   ```

### 2.6 RPA не проходит (Playwright падает)

```bash
systemctl status enterprise-wb-xvfb enterprise-wb-x11vnc enterprise-wb-novnc
# debug скриншоты:
ls -lhtr /srv/projects/enterprise-wb-analytics/output/wb-rpa-debug-*.png | tail -5
```

Открыть noVNC только через SSH-туннель: `ssh -L 6080:127.0.0.1:6080 metric-pulse-app-01`, затем `http://127.0.0.1:6080/vnc.html`.

Типичные причины:
- WB поменяла DOM → нужно обновить селекторы в `.env.production`.
- Cookies протухли → удалить файл storage state, заставить re-login.
- Rate limit от WB → подождать, замедлить.

### 2.7 Подозрение на утечку/компрометацию

**Немедленно:**
1. Заблокировать подозреваемый API-токен WB:
   ```bash
   psql "$DATABASE_URL" -c "UPDATE tenants SET wb_token_health_status='revoked' WHERE id='<tenantId>';"
   ```
2. Инвалидировать Supabase-сессии конкретного пользователя: через Supabase Studio → Authentication → Users → выбрать → "Sign out".
3. Ротировать `ENCRYPTION_KEY`:
   - Сгенерировать новый: `openssl rand -hex 32`.
   - Сохранить старый.
   - Расшифровать старым, зашифровать новым через `scripts/rotate-encryption-key.mjs` (TODO: создать, см. P1-09).
   - Обновить `.env.production`.
   - Рестарт сервисов.
4. Ротировать `TELEGRAM_WEBHOOK_SECRET` + `setWebhook` заново.
5. Снять snapshot логов и БД **до** любых дальнейших действий (для forensics).

**Далее:**
- Сообщить затронутым клиентам (требование 152-ФЗ / GDPR).
- Провести ретроспективу, зафиксировать timeline в `docs/incidents/YYYY-MM-DD-short-name.md`.

### 2.8 Восстановление из бэкапа

**Из серверного снапшота (`/srv/backups/enterprise-wb-analytics/pre-audit-20260415-224500/`):**

```bash
ssh metric-pulse-app-01
# 1. Остановить сервисы
systemctl stop enterprise-wb-analytics enterprise-wb-analytics-inngest

# 2. Создать сейфовую точку ДО восстановления
mkdir -p /srv/backups/enterprise-wb-analytics/pre-restore-$(date +%Y%m%d-%H%M)
pg_dump --format=custom --compress=9 --file=/srv/backups/enterprise-wb-analytics/pre-restore-$(date +%Y%m%d-%H%M)/database.dump "$DATABASE_URL"

# 3. Восстановить БД (deletes current data!)
DB_URL="$DATABASE_URL"
dropdb --if-exists enterprise_wb_analytics_prod
createdb enterprise_wb_analytics_prod
pg_restore --clean --if-exists --exit-on-error -d "$DB_URL" /srv/backups/enterprise-wb-analytics/pre-audit-20260415-224500/database.dump

# 4. Восстановить файлы проекта (если нужно)
cd /srv/projects/enterprise-wb-analytics
tar -xzf /srv/backups/enterprise-wb-analytics/pre-audit-20260415-224500/project-files.tar.gz

# 5. Запустить сервисы
systemctl start enterprise-wb-analytics enterprise-wb-analytics-inngest
curl -sS http://localhost:3457/api/health | jq .
```

**Из локальной копии (полностью offline):**
```bash
cd ~/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics-backups/pre-audit-20260415-224500
shasum -a 256 -c checksums.sha256
# проверить что ok, затем rsync обратно на сервер или восстановить локально
```

### 2.9 Rollback развертывания

```bash
ssh metric-pulse-app-01
cd /srv/projects/enterprise-wb-analytics
# посмотреть историю
git log --oneline -10
# откатить к предыдущему коммиту (если нет миграций схемы)
git reset --hard <previous_sha>
# пересобрать
npm ci
npm run build
systemctl restart enterprise-wb-analytics enterprise-wb-analytics-inngest
```

**Если новый релиз включал миграцию БД** — rollback сложнее. Нужно либо:
- иметь down-миграцию (drizzle-kit этого не умеет автоматически — ручной SQL),
- либо восстановить БД из pre-deploy бэкапа (см. 2.8).

---

## 3. Health check endpoints

| Endpoint | Что проверяет | Статус OK | Статус degraded |
|---|---|---|---|
| `GET /api/health` | env + `SELECT 1` | `200, ok:true` | `503, ok:false, missingEnv:[]` |
| `GET /api/bot` | наличие bot instance | `200, "Bot status: INITIALIZED"` | `200, "WAITING_FOR_TOKEN"` |

Будущее (P3-34): расширить `/api/health` до Supabase + Inngest + disk space.

---

## 4. Шаблон post-mortem

Создать файл `docs/incidents/YYYY-MM-DD-slug.md`:

```markdown
# Incident: <one-line summary>

- **Date:** YYYY-MM-DD HH:MM–HH:MM MSK
- **Severity:** SEV-1 / SEV-2 / SEV-3
- **Duration:** X minutes
- **Impact:** какие тенанты/функции/данные
- **Detection:** как узнали (алерт, клиент, мониторинг)

## Timeline (MSK)
- HH:MM — ...
- HH:MM — ...

## Root cause
Техническое описание первопричины.

## Fix
Что сделали немедленно.

## Why wasn't this caught earlier
Честный анализ: отсутствие теста? monitoring gap? human error?

## Action items
- [ ] ...
- [ ] ...
```

---

## 5. Journaling

После каждого значимого инцидента — обновить:
- `docs/CHANGELOG.md` (если фикс прошёл в код);
- `docs/THREAT_MODEL.md` (если появилась новая угроза или принятый риск);
- `docs/ENTERPRISE_LAUNCH_CHECKLIST.md` (если выявлен новый backlog-пункт);
- `docs/incidents/YYYY-MM-DD-slug.md` (post-mortem).
