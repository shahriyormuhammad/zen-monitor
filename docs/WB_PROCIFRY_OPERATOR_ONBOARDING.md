# WB Procifry Operator — Onboarding

Last updated: 2026-05-10

Цель: обучить `wb-procifry-operator` работать как единый шлюз изменений в
Procifry через approval flow.

## 1) Роль оператора (строго)

- Оператор **не делает бизнес-анализ вместо профильных воркеров**.
- Оператор принимает от них “что поменять”, проверяет текущее состояние через
  `catalog/report`, ставит заявку на изменение в approval.
- Оператор пишет “применено” только когда статус заявки в `/approvals` =
  `executed`.

## 2) Минимальные доступы (обязательно)

### UI

- Рабочий аккаунт в `https://про-цифры.рф` (лучше отдельный service-account).
- Доступ к кабинетам: Лавров и Бербека.
- Доступ к экранам: `/economics-v2`, `/approvals`, `/stocks-v2`, `/overview`.

### API (Agent)

- `AGENT_API_CLIENTS` с клиентом:
  - `workerId=wb-procifry-operator`
  - `roles`: `read_all_wb_digitization`, `write_analysis`, `write_tasks`,
    `write_drafts`, `write_scenarios`, `request_approval`
  - `tenantIds`: целевые tenant UUID
  - `cabinetOids`: целевые cabinet oid
- Endpoints:
  - `GET /api/agent/v1/catalog`
  - `POST /api/agent/v1/report`
  - `POST /api/agent/v1/warehouse-delivery/action`
  - `POST /api/agent/v1/unit-economics-indices/action`
  - `POST /api/agent/v1/fulfillment/action`

## 3) Программа обучения (4 этапа)

## Этап A — UI-карта

Оператор фиксирует “что где находится”:

1. `economics-v2`: где блок “Склады / доставка до ВБ”, где ИЛ/ИРП.
2. `approvals`: где статус `requested/executed/rejected`, где payload.
3. `stocks-v2`: где ФФ/партии в пути.
4. `overview`: где сигнал по данным и свежести.

Результат: короткая шпаргалка “Экран → что проверять перед заявкой”.

## Этап B — API-карта

На каждый кабинет:

1. `catalog` — убедиться, что видны нужные reports/actions.
2. `report` — прочитать текущие значения перед изменением.
3. Зафиксировать `freshness.sourceUpdatedAt` и `dateCoverage`.

Результат: таблица `report/action -> есть/нет -> причины блокера`.

## Этап C — dry-run (без применения)

Тренировочные кейсы:

1. Складская доставка:
   `warehouse_delivery_cost_update` (заявка created, без approve).
2. ИЛ/ИРП:
   `unit_economics_indices_update` (заявка created, без approve).
3. ФФ/Китай:
   `fulfillment_stock_update` (заявка created, без approve).

Результат: `approvalRequestId` по каждому кейсу + статус `requested`.

## Этап D — controlled apply

1. Ручное одобрение в `/approvals` владельцем.
2. Оператор делает post-check через `report`.
3. Пишет итог в формате: “что было -> что стало -> когда applied -> by approvalId”.

## 4) Формат ответа оператора (единый)

- `Задача`
- `Проверил` (catalog/report/freshness/dateCoverage)
- `Поставил в согласование` (`actionType`, `approvalRequestId`, `status`)
- `Применено?` (`нет, ждёт approve` или `да, executed`)
- `Следующий шаг`

## 5) Критерии “оператор готов”

- Не путает `заявка создана` и `изменение применено`.
- Для каждого изменения сначала читает текущие данные (`report`), потом action.
- Не делает изменения мимо `/approvals`.
- По 3 тренировочным кейсам выдает корректный `approvalRequestId`.
