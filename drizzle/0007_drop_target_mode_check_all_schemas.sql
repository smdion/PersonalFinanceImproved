-- Drop the target_mode check constraint from all schemas (public + any demo schemas).
-- Migration 0006 only removed it from the public schema; demo schemas set via
-- search_path each have their own copy of the savings_goals table.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT n.nspname
    FROM pg_namespace n
    JOIN pg_class c ON c.relnamespace = n.oid AND c.relname = 'savings_goals'
    JOIN pg_constraint con ON con.conrelid = c.oid
      AND con.conname = 'savings_goals_target_mode_check'
  LOOP
    EXECUTE format(
      'ALTER TABLE %I.savings_goals DROP CONSTRAINT IF EXISTS savings_goals_target_mode_check',
      r.nspname
    );
  END LOOP;
END $$;
