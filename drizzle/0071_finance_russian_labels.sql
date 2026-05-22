-- Rename visible finance defaults to fully Russian labels.

UPDATE "finance_accounts" fa
SET
  "name" = CASE
    WHEN EXISTS (
      SELECT 1
      FROM "finance_accounts" existing
      WHERE existing."tenant_id" = fa."tenant_id"
        AND existing."name" = 'Баланс Вайлдберриз'
    )
      THEN 'Баланс Вайлдберриз — старая запись'
    ELSE 'Баланс Вайлдберриз'
  END,
  "notes" = 'Деньги и удержания на стороне Вайлдберриз',
  "updated_at" = now()
WHERE fa."name" = 'WB баланс';
--> statement-breakpoint

UPDATE "finance_categories" fc
SET
  "name" = CASE
    WHEN EXISTS (
      SELECT 1 FROM "finance_categories" existing
      WHERE existing."tenant_id" = fc."tenant_id"
        AND existing."name" = 'Выплаты Вайлдберриз'
    )
      THEN 'Выплаты Вайлдберриз — старая запись'
    ELSE 'Выплаты Вайлдберриз'
  END,
  "updated_at" = now()
WHERE fc."name" = 'WB выплаты';
--> statement-breakpoint

UPDATE "finance_categories" fc
SET
  "name" = CASE
    WHEN EXISTS (
      SELECT 1 FROM "finance_categories" existing
      WHERE existing."tenant_id" = fc."tenant_id"
        AND existing."name" = 'Доставка до фулфилмента/Вайлдберриз'
    )
      THEN 'Доставка до фулфилмента/Вайлдберриз — старая запись'
    ELSE 'Доставка до фулфилмента/Вайлдберриз'
  END,
  "updated_at" = now()
WHERE fc."name" = 'Доставка до ФФ/ВБ';
--> statement-breakpoint

UPDATE "finance_categories" fc
SET
  "name" = CASE
    WHEN EXISTS (
      SELECT 1 FROM "finance_categories" existing
      WHERE existing."tenant_id" = fc."tenant_id"
        AND existing."name" = 'Комиссия Вайлдберриз'
    )
      THEN 'Комиссия Вайлдберриз — старая запись'
    ELSE 'Комиссия Вайлдберриз'
  END,
  "updated_at" = now()
WHERE fc."name" = 'Комиссия WB';
--> statement-breakpoint

UPDATE "finance_categories" fc
SET
  "name" = CASE
    WHEN EXISTS (
      SELECT 1 FROM "finance_categories" existing
      WHERE existing."tenant_id" = fc."tenant_id"
        AND existing."name" = 'Логистика Вайлдберриз'
    )
      THEN 'Логистика Вайлдберриз — старая запись'
    ELSE 'Логистика Вайлдберриз'
  END,
  "updated_at" = now()
WHERE fc."name" = 'Логистика WB';
--> statement-breakpoint

UPDATE "finance_categories" fc
SET
  "name" = CASE
    WHEN EXISTS (
      SELECT 1 FROM "finance_categories" existing
      WHERE existing."tenant_id" = fc."tenant_id"
        AND existing."name" = 'Хранение Вайлдберриз'
    )
      THEN 'Хранение Вайлдберриз — старая запись'
    ELSE 'Хранение Вайлдберриз'
  END,
  "updated_at" = now()
WHERE fc."name" = 'Хранение WB';
--> statement-breakpoint

UPDATE "finance_categories" fc
SET
  "name" = CASE
    WHEN EXISTS (
      SELECT 1 FROM "finance_categories" existing
      WHERE existing."tenant_id" = fc."tenant_id"
        AND existing."name" = 'Реклама Вайлдберриз'
    )
      THEN 'Реклама Вайлдберриз — старая запись'
    ELSE 'Реклама Вайлдберриз'
  END,
  "updated_at" = now()
WHERE fc."name" = 'Реклама WB';
