-- Rename the account-type performance category from 'Retirement' to '401k/IRA'
UPDATE "annual_performance" SET "category" = '401k/IRA' WHERE "category" = 'Retirement';
