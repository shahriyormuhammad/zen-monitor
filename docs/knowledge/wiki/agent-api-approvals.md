# Agent API и согласования

## Суть

Procifry Agent API разделяет чтение отчетов и изменения данных. Опасные или внешние действия проходят через approval flow: агент создает заявку, а фактическое применение происходит только после подтверждения в `/approvals`.

## Как работает сейчас

Ключевые action-типы с ручным подтверждением:

- `cost_update` - изменение себестоимости.
- `warehouse_delivery_cost_update` - изменение блока складов и доставки до ВБ.
- `unit_economics_indices_update` - изменение ИЛ/ИРП.
- `fulfillment_stock_update` - изменения fulfillment/stock контура.

Первый вызов action endpoint создает `approval_request` со статусом `requested`. Он не должен менять production-данные до approve.

После approve:

- `approveProcifryApproval(...)` выбирает executor по `actionType`.
- executor валидирует payload;
- пишет изменения в нужные таблицы;
- ставит статус `executed`;
- пишет worker artifact с результатом;
- revalidate нужных страниц.

Reject:

- разрешен только для статуса `requested`;
- ставит статус `rejected`;
- пишет artifact с outcome `rejected`;
- не меняет целевые данные.

## Правила изменения

- Агент не должен писать "применил", если заявка только создана и имеет статус `requested`.
- UI `/approvals` должен показывать parse error payload, если заявка не может быть применена.
- Новые action-типы нужно добавить в policy, catalog, endpoint, approval executor и документацию.
- Для cost/warehouse/indices изменений обязательно сохранять исходник, freshness, confidence и period.
- Payload должен поддерживать batch `items[]`, чтобы не создавать десятки заявок по одному SKU.

## Риски

- Если action обходит `/approvals`, оператор теряет контроль над деньгами и складами.
- Если approve падает на одном item из batch без понятной ошибки, заявка зависает и ее нельзя нормально одобрить/отклонить.
- Если UI не показывает parse error, пользователь не понимает, почему нельзя нажать approve/reject.

## Источники

- `docs/WB_PROCIFRY_AGENT_API.md`
- `docs/WB_PROCIFRY_OPERATOR_ONBOARDING.md`
- `src/lib/agent-api.ts`
- `src/server/agent/catalog.ts`
- `src/server/agent/procifry-approvals.ts`
- `src/server/agent/procifry-approval-cost.ts`
- `src/server/agent/procifry-warehouse-delivery.ts`
- `src/server/agent/procifry-unit-economics-indices.ts`
- `src/app/(dashboard)/approvals/ApprovalsPageClient.tsx`
- `src/app/api/agent/v1/warehouse-delivery/action/route.ts`
- `src/app/api/agent/v1/unit-economics-indices/action/route.ts`
