# Карта проекта Procifry

## Суть

Procifry - аналитика Wildberries для кабинетов, где ключевая ценность строится вокруг финансовой картины: себестоимость, PnL, юнит-экономика, склады, склейки, остатки и агентские отчеты.

Эта страница нужна, чтобы быстро понять, где искать источник правды перед изменениями.

## Основные контуры

- `Себестоимость` (`/costs`) - источник ручной себестоимости и доставок. Отсюда должны питаться расчеты в дашбордах, PnL, склейках и остатках.
- `Юнит-экономика` (`/economics`) - калькулятор сценариев и заказа партии. Это рабочий расчетный инструмент, а не главный справочник себестоимости.
- `Дашборды / PnL / расходы` - финансовая витрина по продажам, выручке, налогам, расходам, рекламе и прибыли.
- `Склейки` (`/dynamics`) - группировка и анализ связанных SKU.
- `Остатки 2.0` (`/stocks-v2`) - остатки, спрос, прогноз, рекомендация к закупке и стоимость партии.
- `Procifry Agent API` - внешний/агентский контур отчетов и согласований.
- `Operations` - deploy, smoke, backups, incident response.

## Что читать перед задачей

- Себестоимость или юнит-экономика: [Себестоимость и юнит-экономика](costing-and-unit-economics.md), `docs/STOCKS_AND_COST_SOURCE.md`.
- Финансовые формулы: [Финансовые формулы](finance-formulas.md).
- WB-источники: [Источники данных Wildberries](wildberries-data-sources.md).
- Agent API или согласования: [Agent API и согласования](agent-api-approvals.md), `docs/WB_PROCIFRY_AGENT_API.md`, `docs/WB_PROCIFRY_OPERATOR_ONBOARDING.md`.
- Deploy или production-проверки: `docs/operations/DEPLOY_PROCEDURE.md`, `docs/RELEASE_CHECKLIST.md`.
- Инциденты: `docs/INCIDENT_RESPONSE.md`.
- Новый старт сессии: `docs/SESSION_BOOTSTRAP.md`.

## Правила изменения

- Не менять источник правды без decision record.
- Не смешивать пользовательскую "юнит-экономику для заказа" и справочник себестоимости.
- Если меняется финансовая формула, проверить все потребители: dashboard, PnL, dynamics, stocks-v2, Agent API.
- Если меняется WB-интеграция, обновить docs по Procifry Agent API или операции синхронизации.

## Риски

- Исторические имена таблиц могут вводить в заблуждение: `unit_economics_*` сейчас содержит и данные себестоимости.
- Ручные поля в JSONB легко расширять, но нужно документировать новые ключи.
- Финансовые изменения без smoke/test быстро дают тихие расхождения в дашбордах.

## Источники

- `docs/PROJECT_GUIDE.md`
- `docs/SESSION_BOOTSTRAP.md`
- `docs/STOCKS_AND_COST_SOURCE.md`
- `docs/WB_PROCIFRY_AGENT_API.md`
- `docs/operations/DEPLOY_PROCEDURE.md`
- `src/app/(dashboard)/costs/page.tsx`
- `src/app/(dashboard)/economics/page.tsx`
- `src/app/(dashboard)/stocks-v2/page.tsx`
- `src/app/(dashboard)/dynamics/page.tsx`
