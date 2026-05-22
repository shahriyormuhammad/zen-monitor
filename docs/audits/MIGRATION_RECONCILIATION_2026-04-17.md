# Migration journal reconciliation — 2026-04-17

## Что было сломано

`drizzle/meta/_journal.json` заканчивался на idx `36 → 0036_wb_lk_storage_state_encryption`.  
В `drizzle/` при этом лежали **5 незарегистрированных** (orphan) SQL-файлов:

- `0036_advertising_balance.sql` (конфликт idx)
- `0036_advertising_guardrails.sql` (конфликт idx)
- `0037_advertising_dayparting_audit.sql`
- `0038_rls_enable.sql`
- `0039_telegram_processed_updates.sql`

Эти миграции были применены на проде **вручную** через `psql`, минуя `drizzle-kit migrate`. На свежем окружении (`staging`, новый dev) `npm run db:migrate` пропустил бы их полностью — → на DR-восстановлении из `schema.ts` получилась бы схема без RLS, без balance-snapshots, без guardrails, без telegram dedup.

## Что сделано в этом коммите

1. Файлы **переименованы** в уникальные idx (git mv):
   - `0036_advertising_balance.sql` → `0037_advertising_balance.sql`
   - `0036_advertising_guardrails.sql` → `0038_advertising_guardrails.sql`
   - `0037_advertising_dayparting_audit.sql` → `0039_advertising_dayparting_audit.sql`
   - `0038_rls_enable.sql` → `0040_rls_enable.sql`
   - `0039_telegram_processed_updates.sql` → `0041_telegram_processed_updates.sql`
2. `_journal.json` расширен записями idx 37–41 с актуальными tag'ами.
3. `0038_advertising_guardrails.sql` сделан **идемпотентным** (`ALTER TABLE ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`). Остальные 4 файла изначально идемпотентные (`CREATE TABLE IF NOT EXISTS`, `DROP POLICY IF EXISTS` + `CREATE POLICY`).
4. Snapshot-файлы `drizzle/meta/0037_snapshot.json` … `0041_snapshot.json` созданы как копии `0036_snapshot.json`. **Это технически неверно** — они не отражают реального состояния схемы после каждой миграции. Эти snapshot'ы **используются только `drizzle-kit generate`** для сравнения с `schema.ts` при создании следующей миграции. `drizzle-kit migrate` (применение) их не использует.

## Последствия для dev/staging/DR

`npm run db:migrate` на **чистой** БД:
- пройдёт все 42 entries журнала (0000…0041);
- создаст полную схему (products, advertising\_\*, RLS, telegram_processed_updates);
- запишет hash каждого SQL-файла в `drizzle.__drizzle_migrations`;
- БД идентична проду.

## Последствия для прода (goalbot)

На проде `drizzle.__drizzle_migrations` содержит только hash'и 0000…0036 (применённые через `drizzle-kit`). Hash-записей для 0037–0041 там **нет** (они применялись напрямую через `psql`).

При следующем деплое после этого коммита `npm run db:migrate` увидит 5 «новых» миграций и попытается их применить:
- все IF NOT EXISTS → no-op на уже существующих таблицах/колонках/индексах;
- `DROP POLICY IF EXISTS` + `CREATE POLICY` в `0040_rls_enable` — тоже no-op (voucher/policies remain identical);
- после успешного apply drizzle запишет 5 новых hash'ей в `drizzle.__drizzle_migrations`.

**Риск:** между `DROP POLICY` и `CREATE POLICY` в `0040_rls_enable` существует микрогэп (~ms), в котором таблица имеет RLS+FORCE но без tenant_isolation policy. Любой SELECT/INSERT в этот момент от `enterprise_wb_analytics_user` упал бы. Для снятия риска — выполнить миграцию в тихий час (ночь MSK) и желательно когда Inngest-вокеров нет в активной работе.

## Чек-лист перед деплоем

- [x] Бэкап прод-БД: `/srv/backups/enterprise-wb-analytics/pre-audit-fixes-20260417-211814/database.dump` (8.1M, sha256 verified)
- [ ] Деплой в тихий час (после 00:00 MSK) — Inngest idle, меньше trafic
- [ ] Запустить `npm run db:migrate` на проде; проверить exit code == 0
- [ ] Verify: `SELECT count(*) FROM drizzle.__drizzle_migrations` → `42`
- [ ] Verify: `SELECT count(*) FROM pg_policies WHERE policyname='tenant_isolation'` → 50 (все RLS-политики на месте)
- [ ] Verify: `curl http://localhost:3457/api/health` → `db:ok`

## План отката

При сбое:
```bash
ssh goalbot
cd /srv/projects/enterprise-wb-analytics
# 1. остановить сервисы
systemctl stop enterprise-wb-analytics enterprise-wb-analytics-inngest

# 2. восстановить БД из бэкапа
su - postgres -c "pg_restore --clean --if-exists --exit-on-error \
  -d enterprise_wb_analytics_prod \
  /srv/backups/enterprise-wb-analytics/pre-audit-fixes-20260417-211814/database.dump"

# 3. git reset к пред-fixes коммиту
git reset --hard <PREV_SHA>

# 4. rebuild + restart
npm ci && npm run build
systemctl start enterprise-wb-analytics enterprise-wb-analytics-inngest
curl -sS http://localhost:3457/api/health | jq .
```
