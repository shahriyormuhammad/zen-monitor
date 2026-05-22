# Telegram Bot Product Plan

Last updated: 2026-05-19 MSK.

## Цель

Telegram-бот проекта — быстрый операционный слой над Procifry / Enterprise WB
Analytics. Он не заменяет веб-приложение, не хранит отдельную бизнес-логику и
не получает прямой доступ к произвольным данным. Бот должен:

- привязать Telegram к кабинету;
- отдавать короткие отчеты по проверенному tenant context;
- присылать критичные уведомления и digests;
- создавать заявки на действия, которые применяются через `/approvals`;
- не раскрывать данные кабинета случайным участникам чата.

## Внешние практики

- Telegram webhook подходит для этого сценария: `setWebhook` принимает HTTPS
  endpoint, `secret_token` для проверки источника и `max_connections` до 100.
  При не-`2xx` Telegram повторяет update, поэтому обработчик должен быть
  идемпотентным.
- grammY рекомендует не держать долгие операции прямо в webhook. Для тяжелых
  задач нужен быстрый ack + очередь/фоновые jobs. Для команд, которые только
  читают агрегированный отчет, допустим синхронный ответ, если он быстрый.
- Для масштабирования важна последовательная обработка внутри одного chat/user
  context, иначе возможны гонки состояния. Состояние нельзя хранить только в
  памяти Node.js процесса.
- WB не дает отдельного “Telegram bot guide”. Правильный источник данных —
  официальный WB API / уже загруженная БД продукта. Токены WB нельзя светить в
  боте, логах или клиентском payload.
- На GitHub большинство WB-ботов узкие: ставки рекламы, отзывы, price tracker.
  Для нашего продукта правильнее модель `Telegram -> app webhook -> tenant
  resolver -> report/action service`, а не отдельный бот с собственной БД.

Источники:

- Telegram Bot API: https://core.telegram.org/bots/api
- Telegram `setWebhook`: https://core.telegram.org/bots/api#setwebhook
- Telegram deep linking: https://core.telegram.org/bots/features#deep-linking
- grammY deployment: https://grammy.dev/advanced/deployment
- grammY scaling: https://grammy.dev/advanced/scaling
- WB API docs: https://dev.wildberries.ru/en/docs/openapi/api-information?locale=ru
- grammY GitHub: https://github.com/grammyjs/grammY
- Telegraf GitHub: https://github.com/telegraf/telegraf

## Масштаб 300-500 пользователей

Один бот нормально обслужит 300-500 пользователей, если:

- report-команды не запускают тяжелые backfill/sync внутри webhook;
- данные выбираются только через tenant-scoped read models;
- каждый Telegram chat/user привязан к одному tenant;
- дубли update от Telegram дедуплицируются;
- нет глобального in-memory состояния вида `currentTenant`;
- sensitive-команды по умолчанию доступны только в личном чате.

Узкие места на этом масштабе:

- WB API лимиты, если бот начнет дергать live API вместо локальных агрегатов;
- медленные отчеты в webhook;
- IP-based rate limit на Telegram webhook при всплесках;
- групповые чаты, где состав участников не равен команде кабинета.

## Security Model

Каноническая цепочка для отчета:

1. Telegram присылает update на `/api/bot`.
2. `/api/bot` проверяет `TELEGRAM_WEBHOOK_SECRET`.
3. update дедуплицируется по `update_id`.
4. Команда проверяет chat type.
5. Resolver находит активную связку `chat_id -> tenant_id`.
6. Report строится только для этого `tenant_id`.
7. Ответ форматируется без WB токенов, RAW payload и секретов.

Правила:

- Команды с бизнес-данными (`/dashboard`, `/unit`, `/economics`, `/sync`,
  будущие `/stock`, `/ads`, `/reviews`) по умолчанию работают только в личном
  чате с ботом.
- Группы и супергруппы используются для уведомлений. Report-команды в группах
  можно открыть только явным env-флагом `TELEGRAM_ALLOW_GROUP_REPORT_COMMANDS=true`
  и только для доверенных клиентов.
- Один активный Telegram chat id должен вести к одному tenant. Если обнаружена
  неоднозначность, бот обязан отказать, а не выбирать первый кабинет.
- Для будущих write/actions бот создает только approval-заявки. Фраза
  “изменение применено” допустима только после статуса `executed`.

## Data Model

Новый канонический слой привязки:

- `telegram_chat_links.id`
- `telegram_chat_links.tenant_id`
- `telegram_chat_links.chat_id`
- `telegram_chat_links.chat_type`
- `telegram_chat_links.telegram_user_id`
- `telegram_chat_links.telegram_username`
- `telegram_chat_links.status`: `active` / `revoked`
- `telegram_chat_links.linked_by_user_id`
- `telegram_chat_links.created_at`
- `telegram_chat_links.revoked_at`

`tenants.telegram_chat_id` остается legacy-полем для обратной совместимости.
Resolver сначала смотрит `telegram_chat_links`, затем legacy-поле. Новые
привязки должны постепенно переехать на `telegram_chat_links`.

Одноразовые deep-link токены хранятся отдельно:

- `telegram_link_tokens.tenant_id`
- `telegram_link_tokens.token_hash`
- `telegram_link_tokens.status`: `pending` / `used` / `revoked`
- `telegram_link_tokens.expires_at`
- `telegram_link_tokens.created_by_user_id`
- `telegram_link_tokens.used_chat_id`
- `telegram_link_tokens.used_telegram_user_id`

Settings показывает только исходный одноразовый токен/ссылку. В БД хранится
только SHA-256 hash, поэтому утечка таблицы токенов не даёт готовую ссылку
привязки.

## MVP Commands

Уже есть:

- `/start` — показывает chat id;
- `/help` — список команд;
- `/dashboard [days]` — сводка кабинета;
- `/unit <nmId> [days]` — юнит-экономика SKU;
- `/economics <nmId> [days]` — alias для `/unit`;
- `/stock <nmId>` — остатки по SKU;
- `/ads <nmId> [days]` — реклама по SKU;
- `/reviews [limit]` — отзывы без ответа;
- `/sync` — статус синков.
- `/support <text>` — обращение оператору.

Не входит в текущий релиз, parked до отдельного решения:

- `/questions [limit]` — вопросы без ответа;
- `/oos <nmId> [days]` — OOS и потерянные заказы;
- `/link` — отдельная команда привязки; текущий safe-link flow уже работает
  через Settings и `/start <token>`.

## Roadmap

1. **Hardening**: private-only report commands, `telegram_chat_links`,
   RLS/indexes, fallback на legacy `telegram_chat_id`.
2. **Safe linking**: deep link token из Settings вместо ручного копирования
   chat id. Статус: базовый flow готов.
3. **Report expansion**: `/stock`, `/ads`, `/reviews`, короткие форматтеры и
   unit tests.
4. **Support flow**: `/support`, запись обращения и уведомление ops/admin.
5. **Approval flow**: создание заявок из Telegram, подтверждение в `/approvals`.
6. **Scale pass**: queue for slow reports, per-chat throttling, webhook
   rate-limit review.

## Definition Of Done

- Нет команды, принимающей `tenantId` из текста Telegram.
- Для каждого sensitive report есть тест форматтера/парсера.
- В группах sensitive-команды заблокированы по умолчанию.
- Дубликат `chat_id` не приводит к выдаче данных случайного tenant.
- Новые actions не применяют изменения без approval.
- Docs обновлены: этот план, `AGENT_API_INTEGRATION.md`, backlog/changelog.
