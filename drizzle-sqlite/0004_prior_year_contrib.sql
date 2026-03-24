ALTER TABLE "contribution_accounts" ADD COLUMN "prior_year_contrib_amount" text NOT NULL DEFAULT '0';
ALTER TABLE "contribution_accounts" ADD COLUMN "prior_year_contrib_year" integer;
