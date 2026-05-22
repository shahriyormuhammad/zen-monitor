# Threat Model — Enterprise WB Analytics

> Last updated: 2026-04-24
> Reviewed against: [`ENTERPRISE_AUDIT_2026-04-15.md`](./ENTERPRISE_AUDIT_2026-04-15.md)
>
> **Scope:** multi-tenant SaaS для продавцов Wildberries. Хранит API-токены WB, raw выгрузки продаж/остатков/реализаций/рекламы, бизнес-аналитику. Интегрируется с WB API, Telegram, YandexGPT, Playwright RPA в личный кабинет WB.

Этот документ поддерживается вручную. При любых архитектурных изменениях или новых интеграциях — обновлять соответствующие разделы.

---

## 1. Активы (Assets)

| Asset | Классификация | Где хранится | Комментарий |
|---|---|---|---|
| WB API token (per tenant) | **Critical** | `tenants.wb_api_token` (зашифровано AES-256-GCM) | Владение = доступ ко всей рекламе, финансам, поставкам клиента. |
| WB RPA session state (cookies) | **Critical** | `tenants.wb_lk_storage_state` (зашифровано AES-256-GCM), во время активного RPA — краткоживущий temp file | Владение = подмена личности продавца в seller.wildberries.ru LK. Legacy plaintext-файлы на сервере должны быть очищены отдельно. |
| Telegram bot token | **Critical** | env `TELEGRAM_BOT_TOKEN`, .env.production mode 600 | Единый для всех тенантов. Ротация полная при компрометации. |
| Telegram webhook secret | **High** | env `TELEGRAM_WEBHOOK_SECRET` | Защищает webhook endpoint. В production endpoint fail-closed при пустом/коротком секрете. |
| Agent API key(s) | **High** | env `AGENT_API_KEY` / `AGENT_API_CLIENTS` | Даёт сервисный read-only доступ к tenant-scoped отчётам. Не должен даваться внешним клиентам без rate limit, audit и явного allowlist по tenant/report. |
| Supabase service keys | **Critical** | env `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (если используется) | Self-hosted Supabase на `metric-pulse-app-01`. |
| Postgres креды приложения | **Critical** | `DATABASE_URL` в env | Только one user `enterprise_wb_analytics_user`, доступ через localhost. |
| YandexGPT API key | **High** | env `YANDEX_GPT_API_KEY` | Финансово значим (платный API). |
| ENCRYPTION_KEY | **Critical** | env `ENCRYPTION_KEY` | Ротация ломает расшифровку WB токенов без re-encrypt. |
| User passwords (hashed) | **Critical** | Supabase auth БД | bcrypt/argon2 внутри gotrue. |
| Analytics data (raw WB + derived) | **Confidential (business)** | Postgres `raw_api_*`, `products`, `orders`, `sales`, `stocks`, `risk_signals` | Leak между тенантами = конец доверия. |
| Operator Telegram chat IDs | **Internal** | `tenants` (оператор маркировка) | Получают push-уведомления о сигналах. |
| Audit trail (sync_runs, advertising changes, signal timeline) | **Internal** | Postgres | Важно для compliance/incident response. |

---

## 2. Trust boundaries

```
   [ пользователь-оператор ]                            [ внешний интернет ]
          │                                                      │
          │ HTTPS                                                │
          ▼                                                      ▼
   ┌──────────────────┐   ┌──────────────────┐   ┌──────────────────┐
   │   Next.js web    │◀──│ Telegram webhook │   │  WB API / LK     │
   │ (prod host)      │   │ /api/bot         │   │  seller.wb.ru    │
   └────────┬─────────┘   └────────┬─────────┘   └─────────▲────────┘
            │                      │                        │
            │                      │                        │
            ▼                      ▼                        │
   ┌──────────────────┐   ┌──────────────────┐              │
   │  Inngest worker  │──▶│  WB API client   │──────────────┘
   │  (prod host)     │   │  wb-api/index    │
   └────────┬─────────┘   └──────────────────┘
            │                      │
            │                      │
            ▼                      ▼
   ┌──────────────────┐   ┌──────────────────┐
   │   Postgres 17    │   │  Playwright RPA  │
   │  prod:5432       │   │  xvfb+x11vnc     │
   └──────────────────┘   └──────────────────┘
            │
            ▼
   ┌──────────────────┐
   │ Supabase self-   │
   │ hosted (Docker)  │
   │ auth + kong      │
   └──────────────────┘
```

**Границы доверия (trust boundaries):**

1. Браузер оператора ↔ Next.js — cookies HttpOnly/Secure, CSP TBD.
2. Next.js ↔ Postgres — localhost сокет/TCP, роль `enterprise_wb_analytics_user`.
3. Next.js ↔ Supabase — localhost HTTP через Kong, service role vs anon.
4. Next.js/Inngest ↔ WB API — HTTPS, per-tenant bearer token.
5. Next.js/Inngest ↔ Telegram API — HTTPS, bot token.
6. Next.js ↔ YandexGPT — HTTPS, API key.
7. Playwright RPA ↔ WB seller LK — headful-headless browser, persisted cookies.
8. Внешний мир → DNS/nginx ingress → Next.js web.
9. Telegram/automation agent → private agent API (`/api/agent/v1/report`) → Next.js.

---

## 3. STRIDE по границам

### 3.1 Пользователь → Next.js

| Threat | Описание | Mitigations | Gaps |
|---|---|---|---|
| **S**poofing | Подмена сессии Supabase | Supabase SSR с `getUser()` (real validation), HttpOnly cookie | P1-12 user enumeration; сессия не имеет principal-logging |
| **T**ampering | Подмена tenantId в query/body | `requireTenantAccess` DB-level check | P1-13: query-string tenantId; нет path-based isolation |
| **R**epudiation | Оператор отрицает действие | `signal_operator_timeline`, `advertising_cluster_actions`, audit trail для части операций | Нет единого audit log для всех мутаций; нет корреляции с Sentry |
| **I**nformation disclosure | Raw errors в response | В part routes есть, см. P0-02, P1-18 | **Открыто** |
| **D**oS | Flood API | In-memory rate limit на чувствительных write-routes | single-instance only; для multi-instance понадобится shared limiter |
| **E**oP | Privilege escalation через userTenants | `allowedRoles` в `requireTenantAccess` | Нет тестов на cross-role привилегии |

### 3.2 Telegram → Next.js webhook

| Threat | Описание | Mitigations | Gaps |
|---|---|---|---|
| **S**poofing | Подделка Telegram Update | `X-Telegram-Bot-Api-Secret-Token` + `timingSafeEqual` + production fail-closed при пустом/коротком секрете | Ротация секрета и observability webhook'а всё ещё операционный риск |
| **T**ampering | Replay старых updates | `update_id` dedupe в БД (`telegram_processed_updates`) | Нет отдельного timestamp-window контроля, rely on Telegram + update_id |
| **I** | Raw error leak | — | **P0-02** открыто |
| **D** | Flood webhook | rate limit per IP + secret check | limiter in-memory, shared store отсутствует |

### 3.2b Automation agent → private agent API

| Threat | Описание | Mitigations | Gaps |
|---|---|---|---|
| **S**poofing | Подделка сервисного клиента | `Authorization: Bearer` / `X-Agent-Api-Key`, timing-safe compare, endpoint disabled when key not configured | Пока env-based keys без UI-ротации |
| **T**ampering | Клиент пытается читать чужой tenant/report | Явный `tenantId`, allowlist по `tenantIds`/`reports`, чтение только через tenant-scoped backend services | Нет DB audit table, пока только structured logs |
| **I**nformation disclosure | Агент видит сырые чувствительные данные | Только whitelist report'ов, без произвольного SQL, без прямого доступа к `DATABASE_URL` | Если делать public API, понадобится field-level redaction review |
| **D**oS | Flood report endpoint | per-IP rate limit | limiter in-memory, нет per-key quotas/billing |

### 3.3 Inngest → Next.js

| Threat | Описание | Mitigations | Gaps |
|---|---|---|---|
| **S** | Подделка inngest events | Production runtime uses `INNGEST_EVENT_KEY` + `INNGEST_SIGNING_KEY`; route fail-closes in prod without signing key when `INNGEST_DEV` is unset | `INNGEST_DEV=1` must not be used in production |
| **T** | Replay inngest payload | Inngest SDK встроенная дедупликация | — |
| **D** | Flood fan-out | — | Нет concurrency limit, см. P1-16 |

### 3.4 Next.js → Postgres

| Threat | Mitigations | Gaps |
|---|---|---|
| **S** Роль app vs postgres superuser | Отдельная роль `enterprise_wb_analytics_user` ✓ | Неясно, какие привилегии реально выданы — проверить `\dp` в psql |
| **T** SQL injection | Drizzle параметризован, `sql.raw(user)` отсутствует ✓ | — |
| **I** Cross-tenant read | Application-level tenant checks + strict RLS with `SET LOCAL app.tenant_id` | Нужно избегать необоснованного использования admin sentinel / `withAdminContext` |
| **D** Connection exhaustion | — | **P0-05** нет pool config |

### 3.5 Next.js/Inngest → WB API

| Threat | Mitigations | Gaps |
|---|---|---|
| **S** Подмена WB API | HTTPS + bearer token | — |
| **T** MITM на проксях/DNS | HTTPS, certificate pinning? Нет. | Acceptable risk |
| **I** Утечка WB токена в логи | Нет явного `console.log(token)` обнаружено | Нужен unit-тест что redacted logger |
| **D** Rate limit от WB | 429/Retry-After handling в wb-api client ✓, retry/backoff ✓, proactive pacing for WB advertising and answer-publish endpoints ✓ | Tenant-level WB quotas still need tuning if WB returns sustained 429s |

### 3.6 Playwright RPA → WB LK

| Threat | Mitigations | Gaps |
|---|---|---|
| **S** Storage state theft | Session state хранится шифрованно в БД, runtime temp files удаляются после run | Legacy plaintext remnants и failure screenshots на сервере требуют cleanup/retention |
| **T** Инъекция в форму | Селекторы в env, nested вариации | WB может менять UI → хрупкость. Мониторить `rpa_failed` runs |
| **R** Оператор отрицает отправку | Audit trail в redistribution runs | ok |
| **I** Скриншоты с персональными данными | `output/wb-rpa-debug-*.png` | Проверить retention + .gitignore (есть в .gitignore) |
| **D** | — | — |
| **E** | — | — |

### 3.7 Next.js → Telegram / YandexGPT

| Threat | Mitigations | Gaps |
|---|---|---|
| **S** Подмена TG API | HTTPS | ok |
| **I** Leak токена в логи | Structured logger with redact list | Нужен regression-test на redaction чувствительных полей |
| **D** Cost abuse (YandexGPT) | rate limit на `/api/views/reviews-qa/reply` | Нет per-tenant budget/quotas |

---

## 4. Принятые риски (Accepted risks)

Ни одного сейчас. Как только появится решение по P1-21 (xlsx), P0-06 (infra), P3-36 (i18n) — зафиксировать здесь с датой и обоснованием.

---

## 5. Compliance-наблюдения

- **152-ФЗ (Россия):** проект собирает персональные данные (email, Telegram ID, возможно ФИО в связи с WB LK). Требуется Privacy Policy, договор-оферта, оповещение Роскомнадзора (если нет освобождения), согласие на обработку.
- **GDPR:** применимо только если есть клиенты в ЕС. При запросе удаления нужны:
  - CASCADE по `tenant_id` (P2-28 проверить консистентность)
  - Удаление из Supabase auth БД
  - Удаление RPA storage state
  - Очистка бэкапов (retention policy)
- **PCI DSS:** не применимо — нет хранения платежных данных.
- **SOC 2:** если целевые клиенты корпоративные, стоит планировать. Основные контроли: access control, change management, monitoring, incident response, backup & recovery. Все в P0/P1 аудита.

---

## 6. План пересмотра

- Обновлять при каждом новом `HIGH`/`CRITICAL` ассете или интеграции.
- Полный review — раз в квартал.
- Ретроспектива инцидентов (если происходили) — раздел в [`INCIDENT_RESPONSE.md`](./INCIDENT_RESPONSE.md).
