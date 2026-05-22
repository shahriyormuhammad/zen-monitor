DO $$
BEGIN
  -- Production grant is applied by the deploy operator because the app migrator
  -- role is intentionally not allowed to grant privileges on this legacy table.
  PERFORM 1
  FROM information_schema.tables
  WHERE table_name = 'telegram_processed_updates';
END $$;
