# Admin Panel And Billing Plan

Last updated: 2026-05-11

## Implementation Status

- `done` A0 foundation: `platform_admins`, `platform_audit_log`,
  `requirePlatformAdmin`, first-admin grant script.
- `done` A1 billing schema foundation: `plans`, `subscriptions`, `payments`,
  `billing_events`, subscription entitlement resolver, tariff seed script.
- `done` A2 read-only admin MVP UI: `/admin`, customers, customer detail,
  subscriptions, URL filters, pagination, account-level grouping and Russian UI.
- `todo` A3 manual billing operations.
- `todo` A4 YooKassa integration.

Bootstrap commands after migration:

```bash
npm run billing:seed-plans
npm run admin:grant -- <local-user-id-or-email> owner
```

Production access rule:

- current platform owner: `vitea_b@mail.ru`;
- do not add other platform admins without explicit approval.

## Context

`enterprise-wb-analytics` уже готов как multi-tenant SaaS-контур:

- пользователи входят через Supabase Auth;
- клиентские кабинеты живут в `tenants`;
- членство и роли клиента живут в `user_tenants`;
- tenant-level роли: `owner`, `admin`, `viewer`;
- данные WB защищаются через `requireTenantAccess`, `withTenantContext` и strict RLS;
- межтенантные backend-пути используют `withAdminContext`.

Сейчас нет:

- роли администратора платформы;
- billing/subscription таблиц;
- платежного провайдера;
- UI для просмотра клиентов, оплат, окончаний подписок и операционного здоровья.

Главный вывод: админку нельзя делать как обычную страницу для `owner/admin`.
`admin` сейчас означает администратора клиентского кабинета, а не сотрудника
нашей платформы.

## External Research Snapshot

Проверены актуальные подходы:

- React-admin: сильный CRUD-фреймворк поверх REST/GraphQL API, но приносит
  Material UI и отдельную data-provider архитектуру.
- Refine: ближе к Next.js, поддерживает Next.js router/access-control/data
  providers, но всё равно требует отдельного CRUD-слоя и client/server provider
  развязки.
- AdminJS: быстро поднимает Node.js admin panel поверх DB/ORM adapters, но для
  этого проекта опасен как прямой CRUD поверх таблиц с RLS, секретами и
  бизнес-инвариантами.
- Supabase: platform/admin операции через Auth Admin API должны идти только
  с server-side secret key; RBAC лучше отделять от клиентских tenant-ролей.
- YooKassa: для российского SaaS подходит как первый провайдер; webhooks нужны
  для статусов платежей, автоплатежи требуют сохраненного `payment_method_id`,
  а расписание подписки ведется на нашей стороне.

Полезные ссылки:

- React-admin GitHub: https://github.com/marmelab/react-admin
- React-admin docs: https://marmelab.com/react-admin/Readme.html
- Refine GitHub: https://github.com/refinedev/refine
- Refine Next.js docs: https://refine.dev/core/docs/routing/integrations/next-js/
- AdminJS docs: https://adminjs.co/docs
- Supabase RBAC/custom claims: https://supabase.com/docs/guides/api/custom-claims-and-role-based-access-control-rbac
- Supabase Auth Admin API: https://supabase.com/docs/reference/javascript/admin-api
- YooKassa webhooks: https://yookassa.ru/developers/using-api/webhooks
- YooKassa recurring payments: https://yookassa.ru/developers/payment-acceptance/scenario-extensions/recurring-payments/pay-with-saved

## Decision

Делать нативную админ-панель внутри текущего Next.js приложения:

- route group: `src/app/(admin)/admin`;
- отдельный layout без клиентского `TenantSwitcher`;
- server-first страницы с Drizzle queries;
- client components только для таблиц, фильтров и локальных действий;
- общий `requirePlatformAdmin()` guard;
- все cross-tenant queries только через server-only admin services;
- все мутации через typed server actions/API routes, не через generic DB CRUD.

Внешний admin framework пока не внедрять. Если позже понадобится отдельный
backoffice для десятков CRUD-ресурсов, повторно оценить Refine. AdminJS не
использовать для production-доступа к основной БД.

## Access Model

Новая таблица:

```ts
platformAdmins
```

Поля:

- `id`
- `userId` -> `users.id`
- `role`: `owner | finance | support | ops | readonly`
- `status`: `active | suspended`
- `createdAt`
- `createdBy`
- `lastSeenAt`

Guard:

```ts
requirePlatformAdmin(allowedRoles?: PlatformAdminRole[])
```

Правила:

- Supabase session обязательна.
- Проверка идет по `platform_admins`, а не по `user_tenants`.
- `withAdminContext` не экспортировать в UI и не вызывать из client-side кода.
- Все platform-admin мутации пишутся в audit log.

## Billing Data Model

Минимальные таблицы:

### `plans`

- `id`
- `code`: `solo | growth | team | ops`
- `name`
- `priceRub`
- `billingPeriod`: `month | year | custom`
- `maxTenants`
- `maxUsers`
- `features` jsonb
- `isActive`
- `createdAt`

Первые тарифы уже описаны в `docs/MARKETING_SITE_BLUEPRINT.md` и
`src/app/page.tsx`: `Solo`, `Growth`, `Team`, `Ops`.

### `subscriptions`

- `id`
- `tenantId`
- `planId`
- `status`: `trialing | active | past_due | grace | canceled | expired`
- `currentPeriodStart`
- `currentPeriodEnd`
- `trialEndsAt`
- `graceUntil`
- `cancelAtPeriodEnd`
- `canceledAt`
- `provider`: `manual | yookassa | cloudpayments | stripe`
- `providerCustomerId`
- `providerSubscriptionId`
- `providerPaymentMethodId`
- `createdAt`
- `updatedAt`

### `payments`

- `id`
- `tenantId`
- `subscriptionId`
- `provider`
- `providerPaymentId`
- `idempotencyKey`
- `amountRub`
- `currency`
- `status`: `pending | waiting_for_capture | succeeded | canceled | refunded`
- `paidAt`
- `dueAt`
- `failureCode`
- `failureMessage`
- `rawPayload` jsonb
- `createdAt`
- `updatedAt`

### `billingEvents`

- `id`
- `provider`
- `providerEventId`
- `eventType`
- `paymentId`
- `subscriptionId`
- `processingStatus`: `received | processed | ignored | failed`
- `rawPayload` jsonb
- `errorMessage`
- `receivedAt`
- `processedAt`

### `platformAuditLog`

- `id`
- `actorUserId`
- `actorRole`
- `action`
- `entityType`
- `entityId`
- `tenantId`
- `before` jsonb
- `after` jsonb
- `reason`
- `createdAt`

## Entitlement Enforcement

Админ-панель сама по себе не решает production-доступ. Нужен отдельный
entitlement layer:

```ts
requireActiveSubscription(tenantId, feature?: string)
```

Где применять:

- dashboard pages/layout;
- `/api/views/**`;
- mutation routes with paid features;
- Inngest scheduled jobs, если выполнение платное;
- private Agent API, если он станет клиентским тарифным контуром.

Стартовая политика:

- `trialing`, `active`, `grace` -> доступ есть;
- `past_due` -> read-only или grace, решение перед запуском оплат;
- `expired`, `canceled` -> закрыть платные screens, оставить billing/settings;
- ручной override только через platform admin с reason и audit log.

## Admin Screens

### `/admin`

Сводка:

- всего аккаунтов владельцев;
- всего магазинов/кабинетов (`tenants`);
- active/trial/past_due/expired;
- MRR вручную из `subscriptions + plans`;
- оплаты за 30 дней;
- подписки заканчиваются за 7 дней;
- failed payments;
- tenants без успешного sync;
- WB token invalid/warning.

### `/admin/customers`

В интерфейсе этот раздел называется `Аккаунты`.

Таблица аккаунтов:

- owner email;
- количество магазинов в аккаунте;
- магазины внутри аккаунта;
- тариф и статус подписки по каждому магазину;
- конец периода;
- последняя синхронизация;
- состояние токена ВБ;
- состояние ЛК ВБ.

Фильтры:

- статус подписки;
- тариф;
- заканчивается скоро;
- unpaid/past_due;
- token invalid;
- no sync.

### `/admin/customers/[tenantId]`

Карточка клиента:

- tenant profile;
- owners/admins/viewers;
- subscription timeline;
- payments;
- sync runs;
- WB token/LK health без показа секретов;
- последние critical signals;
- ручные действия: продлить trial, сменить тариф, дать grace, отменить,
  создать payment link/invoice, пометить manual payment.

### `/admin/billing`

Операционная платежная таблица:

- pending payments;
- succeeded payments;
- failed/canceled payments;
- refunds;
- webhook errors;
- replay webhook event;
- reconcile payment by provider id.

### `/admin/subscriptions`

Очередь подписок:

- ending in 7/3/1 days;
- past_due;
- grace expiring;
- expired today;
- manual overrides.

### `/admin/ops`

Операционный экран:

- failed sync runs by tenant;
- stale sync tenants;
- Inngest/job health;
- RPA failures;
- route scan/slot monitor failures;
- app health snapshots.

## Billing Provider Plan

Для первого российского запуска рекомендован порядок:

1. `manual` provider: вручную создать подписку и платеж в админке.
2. YooKassa one-time payments: checkout/payment link + webhook
   `payment.succeeded/payment.canceled`.
3. YooKassa recurrent payments: сохранить `payment_method_id`, расписание
   списаний вести у нас через Inngest.
4. Dunning: уведомления за 7/3/1 дней, failed payment, grace expiration.

Почему не начинать сразу с полного recurring:

- сейчас нет billing model;
- первый прод может идти через ручные счета/ранний доступ;
- нужно сначала правильно заложить audit, idempotency и access enforcement.

## Implementation Slices

### A0. Platform admin foundation

- migration: `platform_admins`, `platform_audit_log`;
- `requirePlatformAdmin`;
- `/admin` layout;
- seed script для первого platform owner;
- tests for access denial and role allowlist.

Status: `done` for schema, guard, audit helper, grant script and tests.
`/admin` layout moves to A2 with the read-only UI slice.

### A1. Billing schema without provider

- migration: `plans`, `subscriptions`, `payments`, `billing_events`;
- seed tariffs `Solo/Growth/Team/Ops`;
- `resolveTenantSubscriptionStatus`;
- `requireActiveSubscription`;
- unit tests for expiry/grace/past_due logic.

Status: `done` for schema, seed script, `resolveSubscriptionEntitlement`,
`requireActiveSubscription` and unit tests.

### A2. Read-only admin MVP

- `/admin`;
- `/admin/customers`;
- `/admin/customers/[tenantId]`;
- `/admin/subscriptions`;
- filters and pagination;
- no destructive mutations.

Status: `done` for server-first read-only pages, platform-admin layout/guard,
account/subscription filters, pagination and detail drilldown. Production
UI now groups stores by owner account and uses Russian labels for visible admin
text.

### A3. Manual billing operations

- create/extend/cancel subscription;
- mark manual payment;
- add grace;
- change plan;
- every mutation requires reason and writes `platform_audit_log`.

Onboarding dependency: package selection in the user flow must write through the
same `subscriptions`, `payments` and `billing_events` tables used by admin. No
separate onboarding-only tariff state.

### A4. YooKassa integration

- env: `YOOKASSA_SHOP_ID`, `YOOKASSA_SECRET_KEY`, `YOOKASSA_WEBHOOK_SECRET`;
- route: `/api/billing/yookassa/webhook`;
- idempotent event processing;
- payment create/reconcile service;
- admin action to create payment link/invoice.

### A5. Automation and notifications

- subscription expiry sweep;
- failed payment sweep;
- ops Telegram alerts;
- optional customer email/Telegram notifications.

### A6. Hardening before broad launch

- rate limit billing/webhook routes;
- audit export;
- provider reconciliation script;
- tests for webhook replay/out-of-order events;
- docs: threat model, incident response, release checklist.

## Security Rules

- Не показывать WB API token, RPA storage state, provider secrets.
- Не делать raw table editor.
- Не делать impersonation в MVP.
- Не удалять tenants из админки в MVP; только suspend/cancel/expire.
- Все provider webhooks обрабатывать идемпотентно.
- Все billing decisions хранить у себя, provider raw payload использовать как
  evidence, а не как единственный источник truth.
- Все manual overrides требуют `reason`.

## Minimum Definition Of Done For MVP

Админка считается production-MVP, когда есть:

- platform admin login/guard;
- список клиентов и карточка tenant;
- статусы `paid/unpaid/ending soon/past_due/expired`;
- ручное создание и продление подписки;
- платежная история;
- audit log для ручных действий;
- subscription enforcement в пользовательском продукте;
- тесты guard + billing resolver + critical mutations;
- обновлены `THREAT_MODEL.md`, `INCIDENT_RESPONSE.md`, `.env.example`,
  `docs/IMPLEMENTATION_BACKLOG.md`, `docs/CHANGELOG.md`.
