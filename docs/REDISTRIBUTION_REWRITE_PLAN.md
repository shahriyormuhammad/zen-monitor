# Redistribution rewrite + WB ЛК Auth v2 — план и текущий статус

> **Статус:** 🟡 в процессе. Этап 1 (Auth v2) подтверждён HTTP-readiness,
> Этап 2 — частично сделан: read-session + slot probe,
> Этап 3 (новый UI `/redistribution`) — done без backend auto-submit.
> **Последнее обновление:** 2026-05-19.
> **Текущий SHA ориентира:** см. `docs/CHANGELOG.md`.

## TL;DR

Раздел `/redistribution` переписан простым языком («для школьника»),
серверную логику `getRedistributionPlan()` сохраняем. Параллельно переделали
авторизацию в WB ЛК (без 7-дневного TTL, с inline CAPTCHA/SMS flow и
сохранённым encrypted `storageState`). Это **критично**, потому что без
рабочей ЛК-сессии автоматическое заведение заявок на перераспределение не
работает.

Важно: старый план «HTTP через постоянный `WBTokenV3`» устарел. По свежей
проверке WB больше не обязан выдавать `WBTokenV3`; актуальный HTTP-путь —
через сохранённый `storageState`: `wbx-refresh` + `wbx-validation-key` +
`wb-eu-passport-v2.access-token` → короткий LK access-token через
`/ns/suppliers-auth/suppliers-portal-core/auth/token`. `WBTokenV3` остаётся
legacy/fallback, не основной архитектурой.

Работа разбита на **3 этапа**:

1. **Этап 1: Auth v2** (HTTP-readiness confirmed) — починить вход, отказаться от 7-дневного TTL.
2. **Этап 2: HTTP вместо Playwright** — переписать backend операций (slot-monitor,
   route-scan, redistribution submit) на HTTP через LK refresh-flow.
3. **Этап 3: Новый UI `/redistribution`** (done) — карточки рекомендаций, 3 KPI,
   Excel-экспорт, образовательный блок.

---

## Контекст: почему всё это делаем

### Жалобы пользователя

1. **Старый `/redistribution`** (1591 строка) — слишком сложный, жаргонный
   («КРП», «ИРП», «ИЛ», «Priority Score», «Coverage Days», «Slot Monitor»,
   «Route Scan», «Snapshot»). Школьник не разберётся.
2. **Авторизация в WB ЛК ломалась** — через 7 дней истекала, кривой UX
   с SMS, CAPTCHA нельзя пройти удалённо.
3. **Автоматическое заведение заявок на перемещение** — не работало.
   Без него пользователь не успевает за ботами WBCON, WBRocket, MPSTATS,
   которые разбирают слоты за 15 секунд в окнах 09:00 / 12:00 / 16:00 МСК.

### Research результаты (2026-05-07)

**Как WB реально работает с перераспределением** ([1seller.ru гайд 2026](https://1seller.ru/raspredelenie-po-skladam-wildberries-v-2026-godu-polnyj-gajd)):

- В кабинете WB: «Конструктор тарифов» → включить «Перераспределение остатков»
- «Отчёт по остаткам на складе» → кнопка «Перераспределить остатки»
- Артикул на 72 часа скрывается из продаж, доставка между складами 4-7 дней
- WB берёт **+0.5%** к продажам всех товаров за услугу
- Окна броней: **09:00, 12:00, 16:00 МСК**
- Лимиты складов (январь 2026): Краснодар/Котовск 500к шт/сут, Коледино/Тула
  100к, Новосиб/Екб 5к. По факту квот может не быть неделями.

**WB API НЕ ИМЕЕТ публичного эндпоинта** для перераспределения. Все коммерческие
боты (WBCON, WBRocket) работают через RPA в кабинете WB через авторизацию по
телефону. Лимит ~3 запроса в секунду на номер.

**WB LK auth в текущей реализации (2026-05-19)** — сохранённый encrypted
`storageState` с cookies и `localStorage` продавца. Для HTTP-запросов сначала
делаем read-session:

- берём `wb-eu-passport-v2.access-token` из localStorage seller origin;
- берём `wbx-refresh` и `wbx-validation-key` из cookies;
- вызываем seller `auth/token`;
- получаем короткий `wb-seller-lk` token и проверяем read-only probe.

`WBTokenV3` может встретиться в старых сессиях, но не должен считаться
обязательным или долгосрочным основанием для нового HTTP-контура.

**Yandex SmartCaptcha** — иногда показывается WB, интерактивная (не картинка).
Через простой screenshot+input не работает. Решение Уровня 2 (live noVNC)
отложено.

### Что у нас уже было до начала рефакторинга

**Серверная логика хорошая** ([redistribution.ts:268](../src/server/analytics/redistribution.ts:268)):

- `getRedistributionPlan(tenantId, dateFrom, dateTo)` — матричный расчёт
  donor→deficit pairing, целевой запас 14 дней, симуляция КРП до/после,
  ранжирование по приоритету, учёт размеров (sizeName).
- БД-схема: `redistribution_runs`, `redistribution_items`,
  `redistribution_route_availability`, `redistribution_warehouse_registry`,
  `redistribution_slot_monitor_runs`.
- 8 API endpoints: `/run-create`, `/run-status`, `/run-preview`, `/run-action`,
  `/run-csv`, `/route-scan`, `/slot-monitor`.

**RPA-инфраструктура** (~2700 строк, частично работает):

- [`slot-monitor.ts`](../src/server/redistribution/slot-monitor.ts) (315 строк)
  — мониторит блокированные маршруты раз в 1-3 мин, агрессивный режим в
  окнах 08:55-10:30 МСК.
- [`route-scan.ts`](../src/server/redistribution/route-scan.ts) (897 строк)
  — ежедневный скан в 06:35 МСК, обновляет реестр складов.
- [`redistribution-rpa.ts`](../src/server/jobs/redistribution-rpa.ts) (1359
  строк) — основной Inngest job через Playwright.

**Old auth flow** имел жёсткий TTL 7 дней через
[`storage-state.ts:STORAGE_STATE_TTL_DAYS`](../src/lib/wb-rpa/storage-state.ts).
WB-куки сами по себе живут гораздо дольше — это была наша собственная
ограничение.

---

## Этап 1: WB ЛК Auth v2 — IN PROGRESS

**Цель:** надёжная авторизация в WB ЛК без 7-дневного TTL, с inline CAPTCHA
прямо в UI, с извлечением WBTokenV3.

### Сделано (✅)

#### 1A: убран жёсткий TTL 7 дней (SHA `0dfa353`)

[`src/lib/wb-rpa/storage-state.ts`](../src/lib/wb-rpa/storage-state.ts):

```ts
STORAGE_STATE_TTL_DAYS = 7   →  STORAGE_STATE_HARD_TTL_DAYS = 90
                                STORAGE_STATE_STALE_DAYS = 30 (UI-warning)
```

Добавлена `getSessionFreshness(refreshedAt)` → `{ageDays, status: 'fresh' |
'stale' | 'very-old' | 'missing'}`. Сессия живёт пока WB-куки внутри
валидны; валидность теперь определяется реальным запросом, не таймстампом.

#### 1B: in-memory channel для CAPTCHA (SHA `b5289ff`)

[`src/lib/wb-rpa/auth-channel.ts`](../src/lib/wb-rpa/auth-channel.ts) +
[тесты](../src/lib/wb-rpa/auth-channel.test.ts) (11/11 passing):

- `createAuthSession(tenantId)` → sessionId
- `pushEvent(sessionId, AuthEvent)` — события для UI
- `subscribeEvents(sessionId)` — async-iterable для SSE (подписка происходит
  СИНХРОННО при вызове, иначе события между созданием и first .next()
  теряются)
- `pushUserResponse(sessionId, UserResponse)` — ответы юзера
- `awaitUserResponse(sessionId, timeoutMs)` — Promise для Playwright
- TTL сессии 30 мин, ответа 5 мин.
- Состояния: `connecting → awaiting_phone → awaiting_captcha → awaiting_sms
  → finalizing → success/failed`.
- Replay buffer для race condition (commit `c6dc4e5`).

#### 1C+1D+1E: Playwright login flow + SSE/POST endpoints + UI (SHA `600c135`)

**Backend:** [`wb-lk-interactive-login.ts`](../src/lib/wb-rpa/wb-lk-interactive-login.ts)
— `runInteractiveWbLkLogin({sessionId, tenantId, phone})`:

- Открывает Chromium → идёт на `WB_RPA_LOGIN_URL`
- В цикле детектит CAPTCHA / SMS / phone_again / success
- При CAPTCHA — `element.screenshot()` → push в channel → ждёт ответ
- При SMS — push event → ждёт код
- На success — `extractAndPersistWbTokenV3()` + `persistStorageState()` +
  `tenants.wbLkSessionStatus = 'active'`

**API endpoints** под `/api/admin/wb-lk-auth/`:

- `POST /start` — принимает `{phone}`, создаёт session, запускает Playwright
  в background, возвращает `{sessionId}`
- `GET /stream/[sessionId]` — Server-Sent Events стрим
- `POST /respond/[sessionId]` — приём `sms_code` / `captcha_answer` / `cancel`

Все защищены `requireActiveTenant(['owner', 'admin'])`.

**UI:** [`WbLkAuthFlow.tsx`](../src/app/(dashboard)/settings/WbLkAuthFlow.tsx)
— модальный flow:

- Phase machine: `idle → starting → connecting → awaiting_phone →
  awaiting_captcha → awaiting_sms → finalizing → success/failed`
- Подключается через `EventSource`
- При CAPTCHA рендерит `<img src={dataUrl}>` + поле ввода
- Логи под спойлером (auto-open при failed)
- Cancel при закрытии чистит сессию на сервере
- Интегрирован в Settings как «🆕 Новый способ»

#### 1F: WBTokenV3 extraction (SHA `b5289ff`)

[`src/lib/wb-rpa/token-v3.ts`](../src/lib/wb-rpa/token-v3.ts) + миграция
`drizzle/0065_wb_lk_token_v3.sql`:

- `findWbTokenV3InCookies(cookies)` — pure-функция
- `extractAndPersistWbTokenV3(tenantId, context)` — снимает с Playwright
  context'а, шифрует, сохраняет в БД
- `loadWbTokenV3(tenantId)` — для HTTP клиентов
- `clearWbTokenV3(tenantId)` — на logout
- Поля `tenants.wb_lk_token_v3` (text, encrypted) +
  `wb_lk_token_v3_refreshed_at` (timestamptz)
- 6 unit-тестов, все проходят

#### Полировка ввода-вывода

| SHA | Что |
|---|---|
| `0dfa353` | TTL 7 дней → 90, getSessionFreshness() |
| `b5289ff` | Channel + WBTokenV3 foundation |
| `600c135` | Playwright login + SSE + UI |
| `96ef8fa` | UI с детальной error-карточкой + Playwright `--no-sandbox` |
| `c6dc4e5` | Replay buffer в channel против race condition |
| `23157f2` | Screenshot на unknown-state + keep `+` в телефоне |
| `60005e0` | normalizePhone → 10 цифр без `+7` (WB маска уже добавляет) |
| `c4114b8` | submitForm: enabled-only кнопки (skip disabled phone-submit после SMS) |
| `ec44469` | Phone-again outcome (двухступенчатая wb-partners auth) |
| `5a9e759` | CodeInputContentView в Portal-modal (split-input) |
| `ada1271` | CodeInput: nth(i).fill(digit) по одной + scope-aware submit |
| `cf561b0` | Auth-cookies verification + loop protection (no-progress-loop) |
| `cdb025c` | Specific testid selectors + anti-bot stealth + wait for enabled |

### Текущая известная проблема (как остановились)

После всех фиксов, при попытке входа возникал
**`no-progress-loop`** — WB-страница не реагировала на наш submit. Возможные
причины (по убыванию вероятности):

1. **Playwright детектится anti-bot'ом WB** — фикс в `cdb025c`:
   - `args: ['--disable-blink-features=AutomationControlled']`
   - `userAgent: 'Mozilla/5.0 ... Chrome/130.0.0.0 ...'`
   - `addInitScript: navigator.webdriver = undefined`
2. **Кликали не ту кнопку** (например, language switcher) — фикс в `cdb025c`:
   submitForm сначала ищет `button[data-testid*="submit-phone"]:not([disabled])`,
   потом общие.
3. **Submit нажимался до активации** — фикс в `cdb025c`: `waitForSelector
   button[data-testid*="submit"]:not([disabled])` с 5s timeout.
4. **WB не успевал отреагировать** — фикс в `cdb025c`: `waitForTimeout(2000)`
   после клика.

**После `cdb025c` пользователь должен ретестить** — там накопилось 4 фикса
которые точно нужны.

### Auth-cookies verification

После `cf561b0` перед `success` мы проверяем что в `context.cookies()` есть
хотя бы один из:

```ts
const AUTH_COOKIE_NAMES = ['WBTokenV3', 'WBToken', 'wbx-validation-key',
                            'x-supplier-id-external'];
```

Если нет — closeSession(failed) с финальным скриншотом + понятным reason
+ `tenants.wbLkSessionStatus = 'invalid'`. Это страхует от false-positive
success когда URL случайно содержал `seller.wildberries.ru` после редиректа.

### Что осталось от Этапа 1

- ✅ Backend (channel + Playwright + endpoints)
- ✅ UI (WbLkAuthFlow.tsx)
- ✅ WBTokenV3 extraction
- ⏳ **Подтверждение от пользователя что вход реально проходит** (ждём
  следующий тест после `cdb025c`)
- ⏳ Telegram CAPTCHA fallback (если Yandex SmartCaptcha — наш Screenshot
  не работает; решение — Уровень 2 live noVNC, отложено)

---

## Этап 2: HTTP вместо Playwright — TODO

**Цель:** перенести 90% операций (slot-monitor, route-scan, проверки статусов)
с Playwright на HTTP-запросы через WB LK refresh-flow.

Актуальная auth-модель:

1. `storageState` остаётся источником правды: cookies + seller localStorage.
2. Сервер строит short-lived read-session через
   `createWbLkReadSessionFromStorageState()`.
3. Запросы в private LK API идут с headers `authorizev3`, `cookie`,
   `root-version`, `wb-seller-lk`.
4. `WBTokenV3` не используем как базовое требование: WB уже может его не
   выдавать.

### Зачем

- Playwright тяжёлый: ~150 МБ памяти, ~2 сек на операцию.
- HTTP цикл: 333 ms (как WBCON), сильно меньше памяти.
- Меньше точек отказа (DOM селекторы могут ломаться при апдейте WB).
- Для read/slot checks не нужен живой браузер, если `storageState` проходит
  `auth/token` и read-only probe.

### Что нужно сделать

#### 2A: HTTP readiness contract (~1-2 ч)

Добавить отдельный слой для `/redistribution`, который не знает конкретных
endpoint'ов перемещения, но умеет сказать:

- есть ли `storageState`;
- проходит ли `auth/token`;
- проходит ли read-only probe;
- можно ли включать HTTP slot/route/submission flow или нужен повторный вход.

Это уже можно проверять без reverse engineering submit endpoint'а.

Текущий результат:

- `src/server/redistribution/http-readiness.ts` — нормализует результат
  `checkTenantWbLkRefreshFlow()` в статусы `ready / needs_login / warning /
  blocked`.
- `POST /api/views/redistribution/http-readiness` — owner/admin endpoint для
  ручной проверки и сохранения health-status в `tenants`.
- `/redistribution` → «Расширенно» → «HTTP-доступ WB ЛК» — операторская кнопка
  для запуска этой проверки после входа в WB ЛК.
- `src/server/redistribution/http-readiness.test.ts` — unit-тесты
  классификации.
- Production live-check 2026-05-19: пользователь нажал кнопку, результат
  `auth=200`, `read=200`, `ok`.

#### 2B: Reverse engineering WB endpoints (~1 день)

Через Chrome DevTools Network tab на живом WB кабинете:
- Какой endpoint отдаёт список слотов?
- Какой endpoint отдаёт остатки по складам?
- Какой endpoint создаёт заявку на перераспределение?
- Какие headers требуются (`wb-seller-lk`, `authorizev3`, `root-version`,
  Cookie, CSRF/validation headers)?
- Какой формат body?

**Нужна помощь пользователя** — снять Network capture в его кабинете.
Альтернатива: запустить нашу live-Chromium-сессию и снимать через CDP.

Текущий результат 2026-05-19:

- `POST /ns/suppliers-auth/suppliers-portal-core/auth/token` — short-lived
  LK token.
- `POST /ns/balances/analytics-back/api/v2/balances` — read-only probe.
- `GET /ns/shifts/analytics-back/api/v1/nms?pattern={nmID}` — поиск артикула.
- `GET /ns/shifts/analytics-back/api/v1/stocks?nmID={nmID}` — склады и
  размеры по артикулу.
- `GET /ns/shifts/analytics-back/api/v1/quota?officeID={officeID}&type=src|dst`
  — квоты исходящего/входящего склада.
- `POST /ns/shifts/analytics-back/api/v1/order` — endpoint создания заявки,
  найден в WB JS, но реальный submit пока не запускали.

#### 2C: HTTP client (~3 ч)

Новый файл `src/server/redistribution/lk-http-client.ts` или расширение
существующего `src/server/wb/lk-refresh-flow.ts`:

- `WbLkHttpClient` класс
- короткая read-session из `createWbLkReadSessionFromStorageState()`
- headers: `wb-seller-lk`, `authorizev3`, `root-version`, `cookie`
- Rate limiter: max 3 req/sec на токен (как WBCON)
- Retry с exponential backoff (errors 5xx, network)
- 401/403 → `wbLkSessionStatus=invalid` или `warning` + понятная подсказка
  пользователю

Текущий результат:

- `src/server/redistribution/wb-lk-http.ts` — safe HTTP client для `/stocks`
  и `/quota`, сопоставление складов/размеров, сохранение статуса маршрута.
- `POST /api/views/redistribution/http-slot-probe` — проверяет топ маршрутов
  текущего плана, заявки не создаёт.
- `/redistribution` → «Расширенно» → «HTTP-проверка слотов по плану».
- `src/server/redistribution/wb-lk-http.test.ts` — unit-тесты сопоставления и
  классификации статусов.

#### 2D: Slot Monitor на HTTP (~2 ч)

Текущий `slot-monitor.ts` ещё через Playwright. Следующий шаг — перевести
регулярный мониторинг на уже реализованный HTTP probe:

```ts
const blockedRoutes = await client.getBlockedRoutes();
for (const route of blockedRoutes) {
  const status = await client.checkRouteAvailability(route);
  await db.update(redistributionRouteAvailability).set({status, expiresAt})...
}
```

#### 2E: Route Scan на HTTP (~2 ч)

Аналогично — через `client.getWarehouseRegistry()`.

#### 2F: Redistribution submit на HTTP (~1-2 дня)

Endpoint и body найдены:

```json
{
  "order": {
    "src": 301987,
    "dst": 301805,
    "nmID": 183690498,
    "count": [{ "count": 4, "chrtID": 302767855 }]
  }
}
```

До явного controlled теста production не должен отправлять `/order`. Сначала
одна ручная проверка с подтверждением пользователя, затем включение auto-submit.

### Открытый вопрос

WB private API часто использует **CSRF-токен** + **header `x-validation`**
+ **httpOnly cookies**. Может потребоваться проксировать запросы через
наш сервер (а не делать с клиента).

---

## Этап 3: Новый UI `/redistribution` — DONE

**Цель:** простой и понятный экран — карточки рекомендаций, без жаргона.

### Что выкидываем

| Из старого `/redistribution` (1591 строка) | Зачем |
|---|---|
| 8 KPI-карточек | Объединяем в 3 |
| Таблица «Рекомендации» + Simulation cards (дубли) | Сливаем в одну ленту карточек |
| RPA approval workflow на главной | Прячем в «Расширенно» |
| Slot Monitor section | Прячем в «Расширенно» |
| Route Scan section | Прячем в «Расширенно» |
| Жаргон: КРП/ИЛ/snapshot/priority score | «доплата за дальность», «локализация», «дата данных», «выгода ₽» |
| DataFreshness banner | Маленькая надпись внизу |
| Маршруты как badges в Simulation | Удаляем (дублирование) |

### Структура нового UI

```
┌─────────────────────────────────────────────────────────────────┐
│ ← Дашборд      Что куда везти                                   │
│                Программа сама посчитала, что и куда перевезти,  │
│                чтобы товары лежали ближе к покупателям          │
│                                                                 │
│ ┌─ Сэкономите/мес ┐ ┌─ Перемещений ─┐ ┌─ Локализация ──────┐   │
│ │  +18 540 ₽      │ │  12 шт         │ │  62% → 71%         │   │
│ │  на доплате WB  │ │  по 8 товарам  │ │  +9 п.п. (хорошо)  │   │
│ └─────────────────┘ └────────────────┘ └────────────────────┘   │
│                                                                 │
│ ┌─ Статус робота ────────────────────────────────────────────┐ │
│ │ 🟢 Робот готов · сессия с WB до 12.05.2026                │ │
│ │ Последний запуск: 4 ч назад (12 заявок в WB)              │ │
│ │ ↓                                                          │ │
│ │ 🟡 Сессия истекает завтра — обновите в Settings           │ │
│ │ ↓                                                          │ │
│ │ 🔴 Сессия упала · [Войти в WB ЛК заново →]                │ │
│ └────────────────────────────────────────────────────────────┘ │
│                                                                 │
│ [📥 Скачать Excel] [🤖 Завести в WB автоматически]              │
│                                                                 │
│ ┌─ Что нужно сделать (топ-15 по выгоде) ────────────────────┐ │
│ │ ┌── #1 Расческа Малышки — чёрная (один) ─────────────┐    │ │
│ │ │ Электросталь → Краснодар    [10 шт]                  │    │ │
│ │ │ 💰 4 800 ₽/мес  📍 +23%  ⏱ хватит ~14 дней           │    │ │
│ │ └──────────────────────────────────────────────────────┘    │ │
│ │ ...                                                          │ │
│ │ [Показать ещё]                                               │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                 │
│ ┌─ Как пользоваться ────────────────────────────────────────┐ │
│ │ Вариант 1 (просто): Скачайте Excel → в кабинете WB         │ │
│ │ заведите заявки вручную                                     │ │
│ │ Вариант 2 (быстро): Кликните «Завести в WB автоматически» │ │
│ │ — робот сам зайдёт в кабинет и оформит заявки               │ │
│ │                                                              │ │
│ │ ⚠️ Важно: WB +0.5%, артикул скрывается на 72ч, доставка    │ │
│ │ 4-7 дней                                                     │ │
│ │ ⏰ Лучшее время: 09:00 / 12:00 / 16:00 МСК                   │ │
│ └────────────────────────────────────────────────────────────┘ │
│                                                                 │
│ ▼ Расширенно (свёрнуто): Slot Monitor, Route Scan, История    │
└─────────────────────────────────────────────────────────────────┘
```

### Что переиспользуем

- ✅ `src/server/analytics/redistribution.ts` (785 строк) — серверная логика
  donor-deficit pairing, ничего не меняем
- ✅ API endpoints `/api/views/redistribution/*` — переиспользуем
- ✅ Серверная RPA-инфраструктура (под капотом для «Завести в WB
  автоматически»)
- ✅ `getRedistributionPlan()` payload — все поля уже есть

### Что добавлено

- 🆕 Excel-экспорт через ExcelJS (по образцу
  [`stocks-v2/purchaseListExport.ts`](../src/app/(dashboard)/stocks-v2/purchaseListExport.ts))
- 🆕 Карточка SKU «человеческая» (~80 строк JSX на одну)
- 🆕 Образовательный блок «Как пользоваться» с шагами WB-кабинета
- 🆕 Свёрнутый блок «Расширенно» с Slot Monitor / Route Scan / Историей
- 🆕 Статус робота прямо на странице (читает
  `tenants.wbLkSessionStatus` + `wb_lk_storage_state_refreshed_at` через
  `getSessionFreshness()`)

### Объём

~700-900 строк нового клиента + удаление 1591 старого. Один focused коммит.

---

## Технические детали

### БД-поля (`tenants` таблица)

```sql
wb_lk_phone                           varchar(32)
wb_lk_session_status                  varchar(50)  -- unknown / active / invalid
wb_lk_session_checked_at              timestamptz
wb_lk_session_error                   text
wb_lk_storage_state_path              text          -- legacy file path
wb_lk_storage_state                   text          -- encrypted JSON cookies+localStorage
wb_lk_storage_state_refreshed_at      timestamptz
wb_lk_token_v3                        text          -- legacy encrypted WBTokenV3, если WB выдал
wb_lk_token_v3_refreshed_at           timestamptz
```

### ENV-переменные WB RPA

```bash
WB_RPA_LOGIN_URL=https://seller-auth.wildberries.ru/ru/?redirect_url=...
WB_RPA_LOGIN_SELECTOR=input[inputmode=numeric],input[placeholder*="999"],...
WB_RPA_SUBMIT_SELECTOR=button[type=submit]
WB_RPA_SMS_CODE_SELECTOR=input[autocomplete=one-time-code],...
WB_RPA_SMS_SUBMIT_SELECTOR=
WB_RPA_HEADLESS=true
WB_RPA_TIMEOUT_MS=90000
WB_RPA_INTERACTIVE_STEP_TIMEOUT_MS=300000
```

### Auth flow detection (приоритет)

1. **Success URL** — `seller.wildberries.ru` или `cmp.wildberries.ru` БЕЗ
   `login/auth/passport`
2. **CAPTCHA** — `iframe[src*="captcha"]`, `[class*="captcha"]`, `img[alt*="капч"]`
3. **SMS** (приоритет — модалки):
   - `div[id*="Portal-modal"] [class*="CodeInput"] input` (split-input в WB Партнёры)
   - `[class*="CodeInput"] input`
   - `input[autocomplete="one-time-code"]`
   - + общие fallback'и
4. **Phone-again** (только если **нет** Portal-modal):
   - `input[type=tel]`, `input[inputmode=numeric][placeholder*="999"]`
   - **+ текст страницы** содержит «введите номер» / «отправим на него код»
5. **Unknown** — fallback с full-page screenshot для диагностики

### Submit button (приоритет)

1. Specific testid: `button[data-testid*="submit-phone"]:not([disabled])`,
   `submit-sms`, `submit-code`, `submit`
2. Общие:
   - `button[type=submit]:not([disabled])`
   - `button[type=submit][aria-disabled="false"]`
3. Fallback на `Enter` из input

### Anti-bot stealth (cdb025c)

```ts
chromium.launch({
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-blink-features=AutomationControlled',
  ],
});

context = browser.newContext({
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ...',
});

context.addInitScript(() => {
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
});
```

### Auth cookies verification (cf561b0)

```ts
const AUTH_COOKIE_NAMES = [
  'WBTokenV3',         // legacy, если WB ещё выдаёт
  'WBToken',           // старый cookie
  'wbx-validation-key', // текущий modern-cookie контур
  'x-supplier-id-external',
];
```

Если **ни одного** в `context.cookies()` после «success URL» — это
false-positive, отмечаем `wbLkSessionStatus = 'invalid'`.

### Loop protection (cf561b0)

Максимум 6 раундов в цикле. Если `phone_again` или `unknown` повторяются
≥ 2 раз И URL не меняется → выход с `'no-progress-loop'`.

### Phone normalization

WB seller-auth страница имеет встроенный «+7» префикс в маске. Передавать
**только последние 10 цифр без кода страны** (`60005e0`). WB маска сама
форматирует.

### CodeInputContentView (модалки)

WB Партнёры использует split-input — **N отдельных** `<input>` (по 1 цифре):

```ts
const allInputs = page.locator(smsSel);
const count = await allInputs.count();
for (let i = 0; i < response.code.length; i++) {
  await allInputs.nth(i).click();
  await allInputs.nth(i).fill(response.code[i]);
}
```

Submit ищется ВНУТРИ Portal-modal:
`div[id*="Portal-modal"] button:not([disabled])`.

### Двухступенчатая авторизация WB Партнёры

После первого SMS WB иногда показывает **второй экран** с phone-input
(«Введите номер мобильного, мы отправим на него код»). Детектится как
`phone_again` outcome → автоматически вводим тот же телефон + submit
→ ждём второй SMS (опять SMS handler).

ВАЖНО: phone-input под Portal-modal не должен путаться с реальной
phone-again формой. Поэтому `phone_again` срабатывает только если
**нет** видимой Portal-modal.

---

## Что делать в следующей сессии

### Если пользователь подтвердил что вход v2 работает

Этап 2:

```
Продолжаем redistribution rewrite. Auth v2 готов и работает.
Следующий этап — HTTP вместо Playwright (см. docs/REDISTRIBUTION_REWRITE_PLAN.md
этап 2). Сначала проверь HTTP readiness через LK refresh-flow, затем
переходи к reverse-engineering WB endpoints: мне нужно снять Network capture
в моём кабинете, скажи что именно.
```

### Если auth v2 всё ещё падает

Сессия дебага продолжается. Контекст:
- Последний SHA `cdb025c0` со всеми anti-bot stealth + specific testid
- Известные проблемы: Yandex SmartCaptcha (нужен Уровень 2 live noVNC)
- БД-таблицы и поля — см. выше
- Селекторы и логика — см. выше

```
Продолжаем дебаг auth v2 (см. docs/REDISTRIBUTION_REWRITE_PLAN.md).
Покажу новый скрин ошибки — ты понимаешь логи и архитектуру.
```

### Если пользователь спрашивает про UI

Этап 3 уже закрыт без backend auto-submit:

```
Новый UI /redistribution уже сделан: карточки топ-рекомендаций, 3 KPI,
Excel-экспорт и блок «Как пользоваться». Auth v2/HTTP auto-submit пока не
закончены, поэтому основной flow — Excel, а автоматическое заведение в WB
остается будущей интеграцией Этапа 2.
```

---

## Ссылки на коммиты (для git log -p)

- `0dfa353` — TTL 7 → 90 дней
- `b5289ff` — Channel + WBTokenV3 foundation + 17 unit-тестов
- `600c135` — Playwright login + SSE/POST endpoints + UI
- `96ef8fa` — Better error UI + `--no-sandbox`
- `c6dc4e5` — Replay buffer
- `23157f2` — Screenshot on unknown-state
- `60005e0` — Correct phone normalization (10 digits)
- `c4114b8` — Submit only enabled buttons
- `ec44469` — Phone-again outcome
- `5a9e759` — CodeInputContentView modal
- `ada1271` — N inputs by 1 digit + scope-aware submit
- `cf561b0` — Auth cookies verification + loop protection
- `cdb025c` — Specific testid + anti-bot stealth + wait for enabled

## Memory sync

После любого правки `docs/operations/*` запустить:
```bash
node scripts/sync-claude-memory.mjs
```

(Этот файл `REDISTRIBUTION_REWRITE_PLAN.md` НЕ синхронизируется в
auto-memory — он живёт в `docs/` и читается explicitly через
`AGENT_FULL_GUIDE.md` reference.)
