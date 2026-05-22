# Procifry data backfill / feed checklist

Актуально на 2026-05-15. Канонический Agent API контракт описан в
`docs/WB_PROCIFRY_AGENT_API.md`.

## Что теперь есть в коде

- `search_positions_summary`, `competitor_cards_summary`, `ab_tests_summary`
  читают persisted-таблицы `procifry_search_positions`,
  `procifry_competitor_cards`, `procifry_ab_tests`.
- Для наполнения этих таблиц добавлен импортёр:

```bash
npm run import:procifry-feeds -- \
  --report search_positions_summary \
  --file ./data/search.csv \
  --tenant-id <uuid> \
  --cabinet-oid lavrov-main \
  --source mpstats
```

- Для тарифов WB добавлен backfill:

```bash
npm run backfill:tariffs -- --from 2026-04-16 --to 2026-05-10
```

- Для отзывов/вопросов добавлен persisted слой
  `wb_feedback_snapshots` и backfill:

```bash
npm run backfill:reviews-qa -- \
  --tenant-id <berbeka-uuid> \
  --from 2026-05-01 \
  --to 2026-05-31 \
  --kind questions
```

## Что нужно дозалить

1. Тарифы WB: `2026-04-16..2026-05-10`.
2. Реклама Лаврова: `2026-04-10..2026-04-20`.
   Уже есть скрипт:

```bash
npx tsx scripts/backfill_ads_costs.ts \
  --tenant-id <lavrov-uuid> \
  --from 2026-04-10 \
  --to 2026-04-20 \
  --source auto
```

3. Вопросы Бербеки за май:

```bash
npm run backfill:reviews-qa -- \
  --tenant-id <berbeka-uuid> \
  --from 2026-05-01 \
  --to 2026-05-31 \
  --kind questions \
  --answer-status all
```

4. Внешние фиды:
   - `search_positions_summary`: keyword, nmId, position, date.
   - `competitor_cards_summary`: competitorNmId, ourNmId/keyword, price,
     rating, reviews, orders/revenue, stock, date.
   - `ab_tests_summary`: testId, nmId, variant, periodFrom, periodTo,
     impressions, clicks, carts, orders, revenue, status, significance.

Если внешний файл не передан, эти 3 отчёта останутся
`sourceStatus=source_not_populated`: контракт и таблицы есть, но данных нет.

## Почему тарифы не обновлялись

Плановый `sync-tariffs` сохранял только снимок на текущую дату и раньше
глушил ошибки WB API через `catch(() => null)`. Поэтому исторические даты
после `2026-04-16` сами не появлялись, а причина провала была плохо видна в
`sync_status`. Сейчас ошибки пишутся в meta/logs, а историю закрывает
отдельный `backfill:tariffs`.
