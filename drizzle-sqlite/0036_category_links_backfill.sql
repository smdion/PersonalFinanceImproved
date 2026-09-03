-- Hand-written SQLite twin of drizzle/0036_category_links_backfill.sql —
-- see that file's comment. The real backfill logic + counting/logging
-- lives in db-migrate.ts's backfillCategoryLinksSQLite(), gated on this
-- migration's tag exactly like backfillHistoricalSalariesSQLite() is
-- gated on 0016_drop_salary_ledger_tables.
SELECT 1;
