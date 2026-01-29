DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'conversations_new'
      AND column_name = 'id'
      AND data_type = 'uuid'
  ) THEN
    ALTER TABLE conversations_new
      ALTER COLUMN id SET DEFAULT gen_random_uuid();
  ELSE
    ALTER TABLE conversations_new
      ALTER COLUMN id SET DEFAULT gen_random_uuid()::text;
  END IF;
END $$;
