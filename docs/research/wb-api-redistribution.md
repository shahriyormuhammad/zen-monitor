# WB Seller API — reverse engineering для редистрибуции

> **Статус:** HTTP read/slot probe confirmed; submit endpoint identified,
> real submit не выполняли.
> **Дата capture:** 2026-05-09, обновлено 2026-05-19.
> **Тенант для тестов:** ИП Бербека (`ae0b36db-1b98-44e0-bda3-0014691824c0`).
> **Источники:** HAR от пользователя + автоматический capture через
> [`scripts/inspect-wb-api.ts`](../../scripts/inspect-wb-api.ts) + live
> Playwright capture на production storageState.

## TL;DR

**Auth-схема WB обновлена:** долгоживущий `WBTokenV3` cookie больше не выдаётся.
Вместо него — двухуровневая схема:

- `wbx-refresh` (cookie на `.seller-auth.wildberries.ru`) — refresh-токен, выдаётся при login.
- **`POST seller.wildberries.ru/ns/suppliers-auth/suppliers-portal-core/auth/token`** — обмен refresh → JWT access-токен (живёт **5 минут**, JSON-RPC 2.0).

API раздела перераспределения остатков лежит на хосте
`seller-weekly-report.wildberries.ru`, путь `/ns/shifts/analytics-back/api/v1/`.

Обновление 2026-05-19: прямой HTTP через `storageState` работает для
`auth/token`, `balances`, `nms`, `stocks`, `quota`. На production добавлен
безопасный probe `/api/views/redistribution/http-slot-probe`: проверяет квоты
по плану, но **не создаёт заявки**.

Обновление 2026-05-19 21:10 MSK: по live `/stocks` для `nmID=198753748`
WB сейчас не отдаёт `Воронеж` как `src`-склад. `Сарапул` найден:
как `dst` доступен, как `src` содержит размеры `38-39` и `36-37`, но не
`40-41`. `Воронеж` при этом есть в balance/stock matrix, но отсутствует в
официальном списке складов, где работает перераспределение. Поэтому строка
`Воронеж WB -> Сарапул WB / 40-41` не проходит проверку: проблема в
source-складе `Воронеж`, а не в destination `Сарапул`.

Обновление 2026-05-19 21:45 MSK: включён HTTP slot-monitor с автосозданием
заявок через `/api/v1/order` для уже сформированных `redistribution_items`.
Монитор фиксирует не только проверенные маршруты, но и квоты `src/dst` по всем
складам, которые WB возвращает в `/stocks` для проверяемых артикулов. Это
пишется в `redistribution_route_availability_events` с source
`http_quota_monitor`, чтобы потом строить статистику по часам открытия лимитов.

## Хосты и группировка

| Хост | Назначение | Ключевые пути |
|---|---|---|
| `seller.wildberries.ru` | core: auth, abac, suppliers, страницы | `/ns/suppliers-auth/.../auth/token`, `/ns/abac/...`, `/ns/suppliers/...`, `/ns/passport-portal/.../validate` |
| `seller-weekly-report.wildberries.ru` | analytics-back: остатки, квоты, балансы | `/ns/balances/.../balances`, `/ns/shifts/analytics-back/api/v1/{nms,stocks,quota}`, `/ns/abac/suppliers-portal-analytics/` |
| `seller-services.wildberries.ru` | sec/anti-bot fingerprint | `/sec/api/fl`, `/sec/api/fl/idw-wb` |
| `seller-communications.wildberries.ru` | уведомления, баннеры | `/ns/notifications/...`, `/ns/banner-homepage/...` |

## Auth flow

### 1. Получить access-token

```
POST https://seller.wildberries.ru/ns/suppliers-auth/suppliers-portal-core/auth/token
Content-Type: application/json
authorizev3: <localStorage["wb-eu-passport-v2.access-token"]>
root-version: <localStorage["@root/latest-app-version"]>
Cookie: wbx-refresh=...; wbx-validation-key=...; cfidsw-wb=...; ...

Body:
{"params":{},"jsonrpc":"2.0","id":"json-rpc_1"}

Response 200:
{
  "id":"json-rpc_1",
  "jsonrpc":"2.0",
  "result":{
    "data":{
      "token":"<JWT>",
      "userID":26949727,
      "exp":1778281861   // unix-секунды; iat + 300
    }
  }
}
```

JWT payload (decoded):
```json
{
  "data":{
    "Z-Sccode":"ru",       // country
    "Z-Scurr":"RUB",       // currency
    "Z-Sfid":"68340",      // supplier old ID (numeric)
    "Z-Sid":"<UUID>",      // supplier ID
    "Z-Slfid":"12",        // legalFormID
    "Z-Soid":"68340"       // supplier oldID (= Z-Sfid)
  },
  "exp":1778281861,
  "iat":1778281561
}
```

**TTL: 300 секунд (5 минут).** На клиенте нужен lazy-refresh: при 401 либо за 30 сек до `exp` — повторить `POST auth/token`.

### 2. Сделать API-запрос

WB-фронт отправляет короткий access-токен в заголовке `wb-seller-lk`.
Для прямого read-only HTTP нужно отправлять одновременно:

- `authorizev3` из `localStorage["wb-eu-passport-v2.access-token"]`;
- `wb-seller-lk: <JWT из auth/token>`;
- `root-version`;
- сохранённые cookies из WB LK `storageState`.

### 3. Sec/anti-fingerprint (открытый вопрос)

Браузер постоянно дёргает `POST seller-services.wildberries.ru/sec/api/fl?u={uuid}&cfidsw-wb={token}`
с зашифрованным fingerprint в body (text/plain, base64-like) — сервер
возвращает свежий `cfidsw-wb` token. За сессию это происходит много раз
(каждые ~2-5 секунд при загрузке страницы).

**Гипотезы:**
1. Можно игнорировать для read-only операций — WB будет блокировать
   только при подозрительной активности.
2. cfids ротация нужна только для submit-операций (создание заявок).
3. Без свежего cfids API скоро вернёт 403/блок.

**Action item:** прямой fetch-тест к `auth/token` со старым cfids из
storageState — если получим 200, можно работать без sec-эмуляции.

## Endpoints (reverse-engineered)

### Auth

| Метод | URL | Body | Ответ |
|---|---|---|---|
| POST | `seller.wildberries.ru/ns/suppliers-auth/suppliers-portal-core/auth/token` | `{"params":{},"jsonrpc":"2.0","id":"<rpc-id>"}` | `{result:{data:{token,userID,exp}}}` |
| GET | `seller.wildberries.ru/ns/passport-portal/suppliers-portal-ru/validate` | — | проверка сессии |
| POST | `seller.wildberries.ru/ns/suppliers/suppliers-portal-core/suppliers` | `[{"method":"getUserSuppliers","params":{},"id":"...","jsonrpc":"2.0"}, {"method":"listCountries"...}]` | список саплайров (JSON-RPC 2.0 batch) |

### Перераспределение и остатки

| Метод | URL | Назначение |
|---|---|---|
| POST | `seller-weekly-report.wildberries.ru/ns/balances/analytics-back/api/v2/balances?limit=10&offset=0&total=0` | список товаров с остатками по складам (страничный) |
| GET | `seller-weekly-report.wildberries.ru/ns/shifts/analytics-back/api/v1/nms?pattern={nmID}` | поиск артикула по nmID |
| GET | `seller-weekly-report.wildberries.ru/ns/shifts/analytics-back/api/v1/stocks?nmID={nmID}` | остатки по складам для одного артикула |
| GET | `seller-weekly-report.wildberries.ru/ns/shifts/analytics-back/api/v1/quota?officeID={склад}&type=src` | квота на исходящий со склада |
| GET | `seller-weekly-report.wildberries.ru/ns/shifts/analytics-back/api/v1/quota?officeID={склад}&type=dst` | квота на входящий склад |
| POST | `seller-weekly-report.wildberries.ru/ns/shifts/analytics-back/api/v1/order` | создание заявки на перераспределение; endpoint найден в WB JS, реальный submit не запускали |

`quota` запрос делается отдельно для склада-источника и склада-получателя.
Если quota=0, WB UI блокирует дальнейшее оформление.

### Balances request body (тип объекта от фронта WB)

```json
{
  "groups":["brand","subject"],
  "filters":{
    "brands":[],
    "subjects":[],
    "warehouses":[],
    "kiz":0,
    "dimension":0
  }
}
```

Response — таблица с заголовком (имена складов) и строками (товар × склад).
Из ответа видны имена реальных складов: Коледино, Казань, Электросталь,
Краснодар, Екатеринбург - Перспективная 14, Тула, Невинномысск, Рязань
(Тюшевское), Котовск, Самара (Новосемейкино), Волгоград, Актобе, Владимир,
Сарапул, Воронеж, Владивосток, Пенза.

### Submit заявки на перераспределение

Endpoint найден в `analytics-front/v3.86.0/3715.chunk...js`:

```http
POST https://seller-weekly-report.wildberries.ru/ns/shifts/analytics-back/api/v1/order
```

Body:

```json
{
  "order": {
    "src": 301987,
    "dst": 301805,
    "nmID": 183690498,
    "count": [
      {
        "count": 4,
        "chrtID": 302767855
      }
    ]
  }
}
```

Где:
- `src` — officeID склада-источника;
- `dst` — officeID склада-получателя;
- `nmID` — артикул WB;
- `count[].chrtID` — размер из `/stocks`;
- `count[].count` — количество к перемещению.

Важно: реальный submit пока не делали. До явного разрешения пользователя
production-код только проверяет слоты и сохраняет статусы маршрутов.

## Cookies (актуальный список)

После login + navigate на `seller.wildberries.ru/`:

| Cookie | Domain | Назначение |
|---|---|---|
| `wbx-refresh` | `.seller-auth.wildberries.ru` | refresh-токен (long-lived) |
| `wbx-validation-key` | `.wildberries.ru` | валидация |
| `wbx-seller-device-id` | `.seller-auth.wildberries.ru` | device fingerprint |
| `cfidsw-wb` | разные | sec/anti-bot, ротируется через `/sec/api/fl` |
| `__zzatw-wb` | разные | Yandex-related anti-bot |
| `_wbauid` | `.wildberries.ru` | analytics user id |
| `external-locale` | `.wildberries.ru` | язык |
| `x-supplier-id-external` | `seller.wildberries.ru` | id текущего поставщика (выдаётся ПОСЛЕ navigate в кабинет) |
| `current_feature_version`, `locale` | `seller.wildberries.ru` | UI state |

## Observations

1. **Все RPC endpoints WB используют JSON-RPC 2.0** — `{method, params, id, jsonrpc:"2.0"}`. Многие принимают batch (массив запросов).
2. **`accessMSC` permission** в abac response = `false` — нужно проверить доступ к перераспределению через abac feature flag перед submit.
3. **Authorization header не используется** — auth идёт через `authorizev3` + cookies, а LK access-token идёт в `wb-seller-lk`, не в `Bearer`.
4. **Sec/api/fl** возможно опционально — нужна проверка прямым fetch-тестом.

## Внешние источники по слотам и лимитам

- Официальная инструкция WB по конструктору тарифов подтверждает: у каждого
  склада есть суточный входящий и исходящий лимит, они могут отличаться; если
  суточный лимит исчерпан, заявку можно создать только в другой день. Точное
  время открытия слотов WB в публичной инструкции не фиксирует.
- Практические сервисы/инструкции для автоброни дают рабочие окна:
  Weeby указывает ежедневное обновление лимитов в `09:00 МСК`, запуск заранее
  около `08:40`, и постоянный мониторинг в течение дня; Graspes указывает окна
  `09:00` и `18:00 МСК`; 1Seller дополнительно называет пики `12:00` и
  `16:00 МСК`. Это не официальный SLA WB, но полезная операционная гипотеза.
- На GitHub релевантных публичных реализаций по endpoint'ам
  `/ns/shifts/analytics-back/api/v1/{stocks,quota,order}` не найдено.
  Найденные репозитории по "перераспределению" носят демонстрационный характер
  и не раскрывают рабочий polling/submit flow.

Принятое расписание мониторинга: агрессивно проверять `08:40-10:30`,
`11:55-12:20`, `15:55-16:20`, `17:55-18:20` по Москве; вне этих окон
оставлять фоновую проверку раз в несколько минут.

Официальный список складов, где работает функция на 18.05.2026:
Электросталь, Тула, Коледино, Шушары, Казань, Краснодар — Тихорецкая,
Невинномысск, Белые Столбы, Рязань — Тюшевское, Котовск, Волгоград,
Владимир Воршинское, Новосемейкино, Екатеринбург Перспективная, Сарапул,
Пенза, плюс food-варианты для части складов. `Воронеж` в официальном списке
отсутствует, поэтому рекомендации с ним как source/destination фильтруются до
создания заявок.

## Открытые вопросы

- [x] **Работает ли `POST auth/token` через чистый fetch (без Playwright fingerprint), только со storageState cookies?** → **НЕТ.** Тест 2026-05-09 (см. `scripts/test-wb-fetch.ts`): после ~30 минут после login все 4 варианта дали 401:
  1. Pure Node fetch со всеми cookies из storageState — 401.
  2. Playwright `context.request.post()` (Chromium TLS, без navigation) — 401.
  3. Playwright `context.request.post()` после `page.goto('seller.wildberries.ru/')` — 401.
  4. `page.evaluate(window.fetch())` на `seller.wildberries.ru/` после navigate — 401.
  5. `page.evaluate(window.fetch())` на `/analytics-reports/warehouse-remains` после navigate — 401.

  При том что 30 минут назад тот же `inspect-wb-api.ts` (page navigation + capture спонтанных WB-фронт XHR) получал auth/token = 200. Это говорит о двух эффектах:

  - **WB активно инвалидирует сессию при подозрительных паттернах.** Многократные probe `auth/token` POST от не-фронт-кода триггерят антибот.
  - **WB-фронт делает что-то особенное при загрузке страницы**, чего мы не воспроизводим (возможно sec/api/fl последовательность с правильным fingerprint в body, JS-генерируемые headers, или session activation handshake).

- [ ] Куда WB кладёт access-token после `auth/token`? Для нашего HTTP-контура
  это не блокер: короткий JWT берём из JSON response и отправляем в
  `wb-seller-lk`.
- [x] **Обновление 2026-05-18:** прямой refresh-flow работает без Playwright, если брать
  `authorizev3` из seller localStorage и отправлять cookies. После `auth/token`
  read-only probe `balances` проходит с заголовком `wb-seller-lk: <JWT>`.
  Реализовано в `src/server/wb/lk-refresh-flow.ts`; безопасная проверка:
  `npx tsx scripts/check-wb-lk-refresh-flow.ts --tenant-id <UUID>`.
- [x] Можно ли пропустить `sec/api/fl` для read/slot checks? **Да**, на
  `auth/token`, `balances`, `nms`, `stocks`, `quota` прямой HTTP прошёл.
- [x] URL и body submit-эндпоинта найдены в JS.
- [ ] Реальный submit через `/order` — не запускали, нужен отдельный
  controlled тест с явным разрешением.
- [ ] Лимит rate-limit.

## Архитектурный вывод

**Чистый HTTP-клиент теперь реалистичен** минимум для read-only и slot checks:

- `src/server/wb/lk-refresh-flow.ts` строит short-lived LK session из
  сохранённого `storageState`.
- `src/server/redistribution/wb-lk-http.ts` использует `/stocks` и `/quota`
  для безопасной проверки слотов по рекомендациям.
- `/api/views/redistribution/http-slot-probe` обновляет
  `redistribution_route_availability`, но не отправляет `/order`.

Submit через HTTP технически понятен, но включать его в автопилот можно
только после отдельного controlled теста: одна заявка, явное подтверждение
пользователя, затем проверка в WB ЛК.

## Captured-файл

Полный capture с request/response headers и body:
- На сервере: `/srv/projects/enterprise-wb-analytics/tmp/wb-api-capture-1778281616247.json`
- На сервере: `/srv/projects/enterprise-wb-analytics/tmp/wb-redistribution-click-1779204972217.json`
- На сервере: `/srv/projects/enterprise-wb-analytics/tmp/wb-redistribution-select-from-1779205389662.json`
- Локально: `tmp/wb-api-capture.json` (gitignored)

Содержит auth/token, abac, suppliers, balances, nms, stocks, quota,
sec/api/fl и DOM-состояние WB-модалки.
