# Procifry — запросы от Jarvis на 2026-05-12

Last updated: 2026-05-12

Текст для передачи разработчикам Procifry. Тестировали кабинеты
`lavrov-main` и `berbeka-main`. Воркеры читают reports и пишут drafts /
approvals через стандартный Procifry Agent API.

С нашей стороны на 2026-05-12 сделано:

- новые Jarvis `worker_id` добавлены в RBAC и training layer;
- helper `scripts/procifry-agent.mjs` добавлен для `catalog`, `report`,
  `unit-economics-indices-action`;
- лимит `oos_history` поднят до 5000, `reviews_summary` /
  `questions_summary` до 500;
- baseline URL RPA уже
  `https://seller.wildberries.ru/analytics-reports/warehouse-remains`;
- RPA-селекторы расширены под кнопку `Перераспределить`;
- реальные внешние фиды и бэкфиллы ниже остаются задачей Procifry/data-source.

## P0 — без этого 4 воркера слепые

### 1. Подключить внешние feeds

Сейчас по обоим кабинетам reports возвращают `ok=true`, `items=[]`,
`sourceUpdatedAt=null`, `coverage=none`:

- `search_positions_summary` — позиции наших SKU в поиске WB по ключам;
- `competitor_cards_summary` — карточки конкурентов;
- `ab_tests_summary` — официальные WB A/B тесты;
- `niche_category_summary` — сейчас `source=internal_wb_data_only`,
  `mpstatsAvailable=false`.

Из-за этого `wb-content`, `wb-market` и `wb-ads` могут давать только гипотезы.

Просьба: подключить фид MPstats / собственный парсер / WB Adv API для A/B,
хотя бы по 5-10 топ-SKU каждого кабинета для старта.

Важно по контракту: если данных за период нет, report должен возвращать
`ok=true`, `items=[]`, `freshness/dateCoverage/sourceUpdatedAt`.
`available=false` допустим только когда источник/таблица реально не подключены.

Минимальные поля:

- `search_positions_summary`: `keyword`, `nmId`, `position`, `date`,
  `frequency/impressions` если есть, `organicOrAd`, `source_updated_at`,
  `confidence`;
- `competitor_cards_summary`: `competitorNmId`, `ourNmId`, `subject`,
  `keyword`, `price`, `rating`, `reviews`, `orders/revenue` если есть,
  `stocks`, `photos`, `videos`, `positions`;
- `ab_tests_summary`: `testId`, `nmId`, `variant`, `impressions`, `clicks`,
  `ctr`, `carts`, `orders`, `revenue`, `profit`, `significance`, `status`.

### 2. RPA перераспределения товаров

`sync_status` показывает `rpa_failed` с 2026-04-15. 20 рекомендаций / цикл,
оценочная экономия около 3537 руб. / цикл — не применяется ни на Лаврове, ни
на Бербеке.

На нашей стороне URL и дефолтные селекторы обновлены:

- URL: `seller.wildberries.ru/analytics-reports/warehouse-remains`;
- trigger: кнопки/ссылки с текстом `Перераспределить остатки` или
  `Перераспределить`, плюс `role=button`, `data-testid*="redistribution"`,
  `class*="redistribution"`.

Просьба Procifry: проверить RPA на живой WB DOM и при необходимости дать
актуальный точный CSS-селектор кнопки и модалки.

## P1 — частично работает, но с провалами

### 3. Зарегистрировать 8 новых worker_id в keys file

Новые ID уже поддержаны кодом RBAC. Нужно добавить API clients / ключи в
runtime `AGENT_API_CLIENTS`.

| Новый ID | Наследует scope legacy worker | Зона |
|---|---|---|
| `wb-chief` | `wb-growth-manager` | оркестратор, P0/P1/P2, финальный отчет штаба |
| `wb-data` | `wb-data-integrator` | источники + WB API мониторинг |
| `wb-economics` | `wb-economics-analyst` | прибыль + цены + промо |
| `wb-ads` | `wb-ads-analyst` | реклама + оценка креативов |
| `wb-content` | `wb-seo-card-analyst` | SEO + брифы визуала |
| `wb-ops` | `wb-assortment-ops` | остатки + поставки + Procifry write |
| `wb-reviews` | `wb-reviews-qna-manager` | отзывы + вопросы |
| `wb-market` | `wb-niche-researcher` + competitor read reports | ниши + конкуренты |

Доступ: `cabinetOids: [berbeka-main, lavrov-main]`. Scope reports /
approval_actions — как у соответствующего legacy ID.

### 4. Рабочий `unit_economics_indices_update`

Endpoint на нашей стороне:

- `POST /api/agent/v1/unit-economics-indices/action`

Helper:

```bash
node scripts/procifry-agent.mjs unit-economics-indices-action \
  --tenant-id <uuid> \
  --cabinet-oid <oid> \
  --worker-id wb-economics \
  --scope all_active_skus \
  --locality-index-percent 1.01 \
  --irp-percent 0.31
```

Action approval-required: вызов создает заявку, реальные значения применяются
после подтверждения в `/approvals`.

Если Procifry возвращает ошибку, нужен пример фактического payload/response,
который падает.

### 5. Бэкфилл пропущенных периодов

Нужно дозалить источники, если WB API еще отдает данные:

- `tariffs_rules_summary` до 2026-05-10 включительно:
  `rowCount=0`; нужна ретроспектива апрель + 2026-05-01 — 2026-05-10;
- Лавров `advertising_by_nm_summary`: нет дней 2026-04-10 — 2026-04-20;
- Бербека `questions_summary`: последний вопрос 2026-04-17, май пустой.

## P2 — улучшения качества жизни

### 6. Лимиты строк

На нашей стороне:

- `oos_history` теперь принимает `limit` до 5000;
- `reviews_summary` и `questions_summary` теперь по умолчанию дают 100 строк,
  максимум 500.

Если нужно больше, следующий шаг — pagination `offset/limit`.

### 7. Lead time из «Поставки» WB Seller

Нужен read report / endpoint по данным раздела «Поставки» WB Seller:
даты создания, приемки, доступности на WB, склад, `nmId`, количество, статус.

### 8. `contentRating` в `card_content_summary`

Сейчас у карточек `contentRating=null`. Если WB начнет отдавать оценку контента
через новый endpoint, нужно пробросить поле в report.

### 9. Разбивка `nmId=0` у Бербеки

`unit_economics_summary` Бербеки содержит хранение около 90 761 руб./мес с
`nmId=0`. Нужен `unit_economics_drill` или `breakdown` по партиям / складам /
типам хранения, чтобы понять источник расхода.

## Как ответить

- Если ок: нужен список endpoint-ов / actions с примерами или дата готовности.
- Если что-то не делается с вашей стороны: напишите, что нужно сделать руками в
  Procifry UI / WB Seller.
- Связь через владельца, он передал этот документ.
