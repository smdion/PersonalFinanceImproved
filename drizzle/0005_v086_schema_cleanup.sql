-- v0.8.6: bring databases that predate the v0.8 squash in line with a fresh
-- install, and give every install the savings_goals self-reference that
-- 0000_v8_initial_schema left out (its old 0001_add_parent_goal_fk was not
-- carried into the squash). Every step is guarded: a no-op where already done.
-- Sub-goals left pointing at a deleted goal (possible on installs without
-- the key) become top-level again, as the app now does on delete.
UPDATE "savings_goals" SET "parent_goal_id" = NULL
  WHERE "parent_goal_id" IS NOT NULL
    AND "parent_goal_id" NOT IN (SELECT "id" FROM "savings_goals");
--> statement-breakpoint
DO $$
DECLARE
  tbl oid := to_regclass(quote_ident(current_schema()) || '.savings_goals');
BEGIN
  -- Older installs carry the key twice under two historical names; replace
  -- both with the one the schema declares.
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = tbl AND conname = 'savings_goals_parent_fk') THEN
    ALTER TABLE "savings_goals" DROP CONSTRAINT "savings_goals_parent_fk";
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = tbl AND conname = 'savings_goals_parent_goal_id_fk') THEN
    ALTER TABLE "savings_goals" DROP CONSTRAINT "savings_goals_parent_goal_id_fk";
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = tbl AND conname = 'savings_goals_parent_goal_id_savings_goals_id_fk') THEN
    ALTER TABLE "savings_goals" ADD CONSTRAINT "savings_goals_parent_goal_id_savings_goals_id_fk"
      FOREIGN KEY ("parent_goal_id") REFERENCES "savings_goals"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "savings_goals_parent_goal_id_idx" ON "savings_goals" USING btree ("parent_goal_id");
--> statement-breakpoint
DO $$
BEGIN
  -- account_basis was renamed from roth_basis; its sequence and primary key kept the old names.
  IF to_regclass(quote_ident(current_schema()) || '.roth_basis_id_seq') IS NOT NULL
     AND to_regclass(quote_ident(current_schema()) || '.account_basis_id_seq') IS NULL THEN
    ALTER SEQUENCE "roth_basis_id_seq" RENAME TO "account_basis_id_seq";
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint
             WHERE conrelid = to_regclass(quote_ident(current_schema()) || '.account_basis')
               AND conname = 'roth_basis_pkey') THEN
    ALTER TABLE "account_basis" RENAME CONSTRAINT "roth_basis_pkey" TO "account_basis_pkey";
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = current_schema() AND table_name = 'retirement_settings'
               AND column_name = 'filing_status' AND data_type = 'character varying') THEN
    ALTER TABLE "retirement_settings" ALTER COLUMN "filing_status" TYPE text;
  END IF;
END $$;
