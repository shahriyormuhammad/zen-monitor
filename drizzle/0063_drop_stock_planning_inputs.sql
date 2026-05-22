-- P87 Этап 6: удаляем legacy таблицу stock_planning_inputs.
-- Её данные (одно число «свой склад» + одно «в пути» per nmId) полностью
-- замещены полноценным учётом партий: own_stock_batches + own_stock_movements
-- (свой склад) и production_orders + production_order_lines (в пути / в
-- производстве). Все потребители (UI /stocks, getStocksPlanner, stock-alerts)
-- мигрированы или удалены в Этапе 6. Таблица пуста в проде на момент
-- миграции, перенос данных не нужен.

DROP TABLE IF EXISTS "stock_planning_inputs";
