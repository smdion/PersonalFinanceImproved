-- Rename the account-type performance category from 'Retirement' to '401k/IRA'
-- to distinguish it from the parentCategory 'Retirement' on performance_accounts.
-- Only affects annual_performance.category (the account-type grouping),
-- NOT performance_accounts.parent_category (the goal-based grouping).
UPDATE "annual_performance" SET "category" = '401k/IRA' WHERE "category" = 'Retirement';
