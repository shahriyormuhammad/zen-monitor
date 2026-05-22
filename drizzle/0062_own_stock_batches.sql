-- P87 Этап 0: учёт собственного склада через партии (batches) + журнал
-- движений. Замещает legacy `stock_planning_inputs.own_stock` (одно число),
-- даёт полноценную историю поступлений/расходов как в InvenTree/Cin7.

-- Партия товара на собственном складе. Одна строка = одна партия одного SKU
-- (одна линия из production_order при поступлении, или ручной приход).
CREATE TABLE IF NOT EXISTS "own_stock_batches" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "nm_id" bigint NOT NULL,
  -- Сколько единиц поступило в эту партию (immutable после создания).
  "received_quantity" integer NOT NULL,
  -- Сколько осталось на складе сейчас (decreases on shipments / write-offs).
  "remaining_quantity" integer NOT NULL,
  -- Себестоимость единицы по этой партии (включая распределённый shipping/customs).
  "cost_per_unit" numeric(12, 2),
  -- Источник: 'production_order' (приход из Китая) или 'manual' (ручной).
  "source_type" varchar(32) DEFAULT 'manual' NOT NULL,
  -- FK на production_order, если партия из неё. Null если ручной приход.
  "source_production_order_id" uuid REFERENCES "production_orders"("id") ON DELETE SET NULL,
  -- Когда партия физически легла на склад.
  "received_at" timestamp with time zone DEFAULT now() NOT NULL,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "own_stock_batches_tenant_nm_idx"
  ON "own_stock_batches" ("tenant_id", "nm_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "own_stock_batches_tenant_received_idx"
  ON "own_stock_batches" ("tenant_id", "received_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "own_stock_batches_remaining_idx"
  ON "own_stock_batches" ("tenant_id", "nm_id")
  WHERE "remaining_quantity" > 0;
--> statement-breakpoint

-- Журнал движений: каждое поступление и расход — отдельная запись.
-- Позволяет строить историю и audit trail.
CREATE TABLE IF NOT EXISTS "own_stock_movements" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "batch_id" uuid REFERENCES "own_stock_batches"("id") ON DELETE SET NULL,
  "nm_id" bigint NOT NULL,
  -- Положительное — приход, отрицательное — расход.
  "delta_quantity" integer NOT NULL,
  -- 'receipt' (поступление из Китая или ручной приход),
  -- 'shipped_to_wb' (отгрузил на WB склад),
  -- 'fbs_sale' (продал по FBS со своего склада),
  -- 'write_off' (брак / списание),
  -- 'inventory_adjust' (корректировка после инвентаризации).
  "reason" varchar(32) NOT NULL,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "own_stock_movements_tenant_nm_idx"
  ON "own_stock_movements" ("tenant_id", "nm_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "own_stock_movements_tenant_created_idx"
  ON "own_stock_movements" ("tenant_id", "created_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "own_stock_movements_batch_idx"
  ON "own_stock_movements" ("batch_id");
