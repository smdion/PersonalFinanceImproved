ALTER TABLE "contribution_accounts" ADD COLUMN "prior_year_contrib_amount" decimal(12,2) NOT NULL DEFAULT '0';
ALTER TABLE "contribution_accounts" ADD COLUMN "prior_year_contrib_year" integer;
