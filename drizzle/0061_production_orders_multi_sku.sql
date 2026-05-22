-- P87 Этап 0: расширяем production_orders на модель «header + lines»,
-- чтобы одна партия из Китая могла содержать много SKU (как в реальном карго).
-- Старые поля nmId/quantity/costPerUnit/totalCost больше не нужны на уровне
-- header — они теперь в production_order_lines. Поскольку обе таблицы
-- (production_orders, stock_planning_inputs) пусты в проде на момент миграции,
-- данные перенeсти не нужно.

-- 1) Drop старых per-SKU полей из header'а.
ALTER TABLE "production_orders"
  DROP COLUMN IF EXISTS "nm_id";
--> statement-breakpoint
ALTER TABLE "production_orders"
  DROP COLUMN IF EXISTS "quantity";
--> statement-breakpoint
ALTER TABLE "production_orders"
  DROP COLUMN IF EXISTS "cost_per_unit";
--> statement-breakpoint
ALTER TABLE "production_orders"
  DROP COLUMN IF EXISTS "total_cost";
--> statement-breakpoint
DROP INDEX IF EXISTS "production_orders_tenant_nm_status_idx";
--> statement-breakpoint

-- 2) Добавляем header-уровневые поля для партии: имя/код, валюта закупки,
-- стоимость доставки и таможни (распределяется на line items пропорц.).
ALTER TABLE "production_orders"
  ADD COLUMN IF NOT EXISTS "title" varchar(255);
--> statement-breakpoint
ALTER TABLE "production_orders"
  ADD COLUMN IF NOT EXISTS "currency" varchar(8) DEFAULT 'RUB' NOT NULL;
--> statement-breakpoint
ALTER TABLE "production_orders"
  ADD COLUMN IF NOT EXISTS "shipping_cost" numeric(14, 2) DEFAULT '0' NOT NULL;
--> statement-breakpoint
ALTER TABLE "production_orders"
  ADD COLUMN IF NOT EXISTS "customs_cost" numeric(14, 2) DEFAULT '0' NOT NULL;
--> statement-breakpoint

-- 3) Новая таблица production_order_lines: одна строка = один SKU в партии.
CREATE TABLE IF NOT EXISTS "production_order_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "production_order_id" uuid NOT NULL REFERENCES "production_orders"("id") ON DELETE CASCADE,
  "nm_id" bigint NOT NULL,
  "quantity" integer NOT NULL,
  "received_quantity" integer DEFAULT 0 NOT NULL,
  "cost_per_unit" numeric(12, 2),
  "total_cost" numeric(14, 2),
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "production_order_lines_tenant_nm_idx"
  ON "production_order_lines" ("tenant_id", "nm_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "production_order_lines_order_idx"
  ON "production_order_lines" ("production_order_id");
