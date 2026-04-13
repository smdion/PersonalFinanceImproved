ALTER TABLE "account_performance" ALTER COLUMN "beginning_balance" SET DATA TYPE numeric(14, 2);--> statement-breakpoint
ALTER TABLE "account_performance" ALTER COLUMN "total_contributions" SET DATA TYPE numeric(14, 2);--> statement-breakpoint
ALTER TABLE "account_performance" ALTER COLUMN "yearly_gain_loss" SET DATA TYPE numeric(14, 2);--> statement-breakpoint
ALTER TABLE "account_performance" ALTER COLUMN "ending_balance" SET DATA TYPE numeric(14, 2);--> statement-breakpoint
ALTER TABLE "account_performance" ALTER COLUMN "employer_contributions" SET DATA TYPE numeric(14, 2);--> statement-breakpoint
ALTER TABLE "account_performance" ALTER COLUMN "employer_contributions" SET DEFAULT '0';--> statement-breakpoint
ALTER TABLE "account_performance" ALTER COLUMN "fees" SET DATA TYPE numeric(14, 2);--> statement-breakpoint
ALTER TABLE "account_performance" ALTER COLUMN "fees" SET DEFAULT '0';--> statement-breakpoint
ALTER TABLE "account_performance" ALTER COLUMN "distributions" SET DATA TYPE numeric(14, 2);--> statement-breakpoint
ALTER TABLE "account_performance" ALTER COLUMN "distributions" SET DEFAULT '0';--> statement-breakpoint
ALTER TABLE "account_performance" ALTER COLUMN "rollovers" SET DATA TYPE numeric(14, 2);--> statement-breakpoint
ALTER TABLE "account_performance" ALTER COLUMN "rollovers" SET DEFAULT '0';--> statement-breakpoint
ALTER TABLE "annual_performance" ALTER COLUMN "beginning_balance" SET DATA TYPE numeric(14, 2);--> statement-breakpoint
ALTER TABLE "annual_performance" ALTER COLUMN "total_contributions" SET DATA TYPE numeric(14, 2);--> statement-breakpoint
ALTER TABLE "annual_performance" ALTER COLUMN "yearly_gain_loss" SET DATA TYPE numeric(14, 2);--> statement-breakpoint
ALTER TABLE "annual_performance" ALTER COLUMN "ending_balance" SET DATA TYPE numeric(14, 2);--> statement-breakpoint
ALTER TABLE "annual_performance" ALTER COLUMN "employer_contributions" SET DATA TYPE numeric(14, 2);--> statement-breakpoint
ALTER TABLE "annual_performance" ALTER COLUMN "employer_contributions" SET DEFAULT '0';--> statement-breakpoint
ALTER TABLE "annual_performance" ALTER COLUMN "distributions" SET DATA TYPE numeric(14, 2);--> statement-breakpoint
ALTER TABLE "annual_performance" ALTER COLUMN "distributions" SET DEFAULT '0';--> statement-breakpoint
ALTER TABLE "annual_performance" ALTER COLUMN "fees" SET DATA TYPE numeric(14, 2);--> statement-breakpoint
ALTER TABLE "annual_performance" ALTER COLUMN "fees" SET DEFAULT '0';--> statement-breakpoint
ALTER TABLE "annual_performance" ALTER COLUMN "rollovers" SET DATA TYPE numeric(14, 2);--> statement-breakpoint
ALTER TABLE "annual_performance" ALTER COLUMN "rollovers" SET DEFAULT '0';--> statement-breakpoint
ALTER TABLE "annual_performance" ALTER COLUMN "lifetime_gains" SET DATA TYPE numeric(14, 2);--> statement-breakpoint
ALTER TABLE "annual_performance" ALTER COLUMN "lifetime_contributions" SET DATA TYPE numeric(14, 2);--> statement-breakpoint
ALTER TABLE "annual_performance" ALTER COLUMN "lifetime_match" SET DATA TYPE numeric(14, 2);--> statement-breakpoint
ALTER TABLE "brokerage_goals" ALTER COLUMN "target_amount" SET DATA TYPE numeric(14, 2);--> statement-breakpoint
ALTER TABLE "brokerage_planned_transactions" ALTER COLUMN "amount" SET DATA TYPE numeric(14, 2);--> statement-breakpoint
ALTER TABLE "contribution_accounts" ALTER COLUMN "contribution_value" SET DATA TYPE numeric(14, 2);--> statement-breakpoint
ALTER TABLE "contribution_accounts" ALTER COLUMN "employer_match_value" SET DATA TYPE numeric(14, 2);--> statement-breakpoint
ALTER TABLE "contribution_accounts" ALTER COLUMN "target_annual" SET DATA TYPE numeric(14, 2);--> statement-breakpoint
ALTER TABLE "contribution_accounts" ALTER COLUMN "prior_year_contrib_amount" SET DATA TYPE numeric(14, 2);--> statement-breakpoint
ALTER TABLE "contribution_accounts" ALTER COLUMN "prior_year_contrib_amount" SET DEFAULT '0';--> statement-breakpoint
ALTER TABLE "home_improvement_items" ALTER COLUMN "cost" SET DATA TYPE numeric(14, 2);--> statement-breakpoint
ALTER TABLE "jobs" ALTER COLUMN "annual_salary" SET DATA TYPE numeric(14, 2);--> statement-breakpoint
ALTER TABLE "jobs" ALTER COLUMN "bonus_override" SET DATA TYPE numeric(14, 2);--> statement-breakpoint
ALTER TABLE "jobs" ALTER COLUMN "additional_fed_withholding" SET DATA TYPE numeric(14, 2);--> statement-breakpoint
ALTER TABLE "jobs" ALTER COLUMN "additional_fed_withholding" SET DEFAULT '0';--> statement-breakpoint
ALTER TABLE "mortgage_extra_payments" ALTER COLUMN "amount" SET DATA TYPE numeric(14, 2);--> statement-breakpoint
ALTER TABLE "mortgage_loans" ALTER COLUMN "principal_and_interest" SET DATA TYPE numeric(14, 2);--> statement-breakpoint
ALTER TABLE "mortgage_loans" ALTER COLUMN "pmi" SET DATA TYPE numeric(14, 2);--> statement-breakpoint
ALTER TABLE "mortgage_loans" ALTER COLUMN "pmi" SET DEFAULT '0';--> statement-breakpoint
ALTER TABLE "mortgage_loans" ALTER COLUMN "insurance_and_taxes" SET DATA TYPE numeric(14, 2);--> statement-breakpoint
ALTER TABLE "mortgage_loans" ALTER COLUMN "insurance_and_taxes" SET DEFAULT '0';--> statement-breakpoint
ALTER TABLE "mortgage_loans" ALTER COLUMN "total_escrow" SET DATA TYPE numeric(14, 2);--> statement-breakpoint
ALTER TABLE "mortgage_loans" ALTER COLUMN "total_escrow" SET DEFAULT '0';--> statement-breakpoint
ALTER TABLE "mortgage_loans" ALTER COLUMN "original_loan_amount" SET DATA TYPE numeric(14, 2);--> statement-breakpoint
ALTER TABLE "mortgage_loans" ALTER COLUMN "property_value_purchase" SET DATA TYPE numeric(14, 2);--> statement-breakpoint
ALTER TABLE "mortgage_loans" ALTER COLUMN "property_value_estimated" SET DATA TYPE numeric(14, 2);--> statement-breakpoint
ALTER TABLE "mortgage_loans" ALTER COLUMN "api_balance" SET DATA TYPE numeric(14, 2);--> statement-breakpoint
ALTER TABLE "mortgage_what_if_scenarios" ALTER COLUMN "extra_monthly_principal" SET DATA TYPE numeric(14, 2);--> statement-breakpoint
ALTER TABLE "mortgage_what_if_scenarios" ALTER COLUMN "extra_one_time_payment" SET DATA TYPE numeric(14, 2);--> statement-breakpoint
ALTER TABLE "mortgage_what_if_scenarios" ALTER COLUMN "extra_one_time_payment" SET DEFAULT '0';--> statement-breakpoint
ALTER TABLE "net_worth_annual" ALTER COLUMN "gross_income" SET DATA TYPE numeric(14, 2);--> statement-breakpoint
ALTER TABLE "net_worth_annual" ALTER COLUMN "gross_income" SET DEFAULT '0';--> statement-breakpoint
ALTER TABLE "net_worth_annual" ALTER COLUMN "combined_agi" SET DATA TYPE numeric(14, 2);--> statement-breakpoint
ALTER TABLE "net_worth_annual" ALTER COLUMN "combined_agi" SET DEFAULT '0';--> statement-breakpoint
ALTER TABLE "net_worth_annual" ALTER COLUMN "ssa_earnings" SET DATA TYPE numeric(14, 2);--> statement-breakpoint
ALTER TABLE "net_worth_annual" ALTER COLUMN "taxes_paid" SET DATA TYPE numeric(14, 2);--> statement-breakpoint
ALTER TABLE "net_worth_annual" ALTER COLUMN "cash" SET DATA TYPE numeric(14, 2);--> statement-breakpoint
ALTER TABLE "net_worth_annual" ALTER COLUMN "cash" SET DEFAULT '0';--> statement-breakpoint
ALTER TABLE "net_worth_annual" ALTER COLUMN "house_value" SET DATA TYPE numeric(14, 2);--> statement-breakpoint
ALTER TABLE "net_worth_annual" ALTER COLUMN "house_value" SET DEFAULT '0';--> statement-breakpoint
ALTER TABLE "net_worth_annual" ALTER COLUMN "retirement_total" SET DATA TYPE numeric(14, 2);--> statement-breakpoint
ALTER TABLE "net_worth_annual" ALTER COLUMN "retirement_total" SET DEFAULT '0';--> statement-breakpoint
ALTER TABLE "net_worth_annual" ALTER COLUMN "hsa" SET DATA TYPE numeric(14, 2);--> statement-breakpoint
ALTER TABLE "net_worth_annual" ALTER COLUMN "hsa" SET DEFAULT '0';--> statement-breakpoint
ALTER TABLE "net_worth_annual" ALTER COLUMN "lt_brokerage" SET DATA TYPE numeric(14, 2);--> statement-breakpoint
ALTER TABLE "net_worth_annual" ALTER COLUMN "lt_brokerage" SET DEFAULT '0';--> statement-breakpoint
ALTER TABLE "net_worth_annual" ALTER COLUMN "espp" SET DATA TYPE numeric(14, 2);--> statement-breakpoint
ALTER TABLE "net_worth_annual" ALTER COLUMN "espp" SET DEFAULT '0';--> statement-breakpoint
ALTER TABLE "net_worth_annual" ALTER COLUMN "r_brokerage" SET DATA TYPE numeric(14, 2);--> statement-breakpoint
ALTER TABLE "net_worth_annual" ALTER COLUMN "r_brokerage" SET DEFAULT '0';--> statement-breakpoint
ALTER TABLE "net_worth_annual" ALTER COLUMN "other_assets" SET DATA TYPE numeric(14, 2);--> statement-breakpoint
ALTER TABLE "net_worth_annual" ALTER COLUMN "other_assets" SET DEFAULT '0';--> statement-breakpoint
ALTER TABLE "net_worth_annual" ALTER COLUMN "mortgage_balance" SET DATA TYPE numeric(14, 2);--> statement-breakpoint
ALTER TABLE "net_worth_annual" ALTER COLUMN "mortgage_balance" SET DEFAULT '0';--> statement-breakpoint
ALTER TABLE "net_worth_annual" ALTER COLUMN "other_liabilities" SET DATA TYPE numeric(14, 2);--> statement-breakpoint
ALTER TABLE "net_worth_annual" ALTER COLUMN "other_liabilities" SET DEFAULT '0';--> statement-breakpoint
ALTER TABLE "net_worth_annual" ALTER COLUMN "tax_free_total" SET DATA TYPE numeric(14, 2);--> statement-breakpoint
ALTER TABLE "net_worth_annual" ALTER COLUMN "tax_free_total" SET DEFAULT '0';--> statement-breakpoint
ALTER TABLE "net_worth_annual" ALTER COLUMN "tax_deferred_total" SET DATA TYPE numeric(14, 2);--> statement-breakpoint
ALTER TABLE "net_worth_annual" ALTER COLUMN "tax_deferred_total" SET DEFAULT '0';--> statement-breakpoint
ALTER TABLE "net_worth_annual" ALTER COLUMN "portfolio_total" SET DATA TYPE numeric(14, 2);--> statement-breakpoint
ALTER TABLE "net_worth_annual" ALTER COLUMN "portfolio_total" SET DEFAULT '0';--> statement-breakpoint
ALTER TABLE "net_worth_annual" ALTER COLUMN "home_improvements_cumulative" SET DATA TYPE numeric(14, 2);--> statement-breakpoint
ALTER TABLE "net_worth_annual" ALTER COLUMN "home_improvements_cumulative" SET DEFAULT '0';--> statement-breakpoint
ALTER TABLE "net_worth_annual" ALTER COLUMN "property_taxes" SET DATA TYPE numeric(14, 2);--> statement-breakpoint
ALTER TABLE "other_asset_items" ALTER COLUMN "value" SET DATA TYPE numeric(14, 2);--> statement-breakpoint
ALTER TABLE "paycheck_deductions" ALTER COLUMN "amount_per_period" SET DATA TYPE numeric(14, 2);--> statement-breakpoint
ALTER TABLE "performance_accounts" ALTER COLUMN "cost_basis" SET DATA TYPE numeric(14, 2);--> statement-breakpoint
ALTER TABLE "performance_accounts" ALTER COLUMN "cost_basis" SET DEFAULT '0';--> statement-breakpoint
ALTER TABLE "portfolio_accounts" ALTER COLUMN "amount" SET DATA TYPE numeric(14, 2);--> statement-breakpoint
ALTER TABLE "property_taxes" ALTER COLUMN "assessed_value" SET DATA TYPE numeric(14, 2);--> statement-breakpoint
ALTER TABLE "property_taxes" ALTER COLUMN "tax_amount" SET DATA TYPE numeric(14, 2);--> statement-breakpoint
ALTER TABLE "retirement_budget_overrides" ALTER COLUMN "override_monthly_budget" SET DATA TYPE numeric(14, 2);--> statement-breakpoint
ALTER TABLE "retirement_salary_overrides" ALTER COLUMN "override_salary" SET DATA TYPE numeric(14, 2);--> statement-breakpoint
ALTER TABLE "retirement_scenarios" ALTER COLUMN "target_annual_income" SET DATA TYPE numeric(14, 2);--> statement-breakpoint
ALTER TABLE "retirement_scenarios" ALTER COLUMN "lt_brokerage_annual_contribution" SET DATA TYPE numeric(14, 2);--> statement-breakpoint
ALTER TABLE "retirement_scenarios" ALTER COLUMN "lt_brokerage_annual_contribution" SET DEFAULT '0';--> statement-breakpoint
ALTER TABLE "retirement_settings" ALTER COLUMN "salary_cap" SET DATA TYPE numeric(14, 2);--> statement-breakpoint
ALTER TABLE "retirement_settings" ALTER COLUMN "social_security_monthly" SET DATA TYPE numeric(14, 2);--> statement-breakpoint
ALTER TABLE "retirement_settings" ALTER COLUMN "social_security_monthly" SET DEFAULT '2500';--> statement-breakpoint
ALTER TABLE "salary_changes" ALTER COLUMN "new_salary" SET DATA TYPE numeric(14, 2);--> statement-breakpoint
ALTER TABLE "savings_allocation_overrides" ALTER COLUMN "amount" SET DATA TYPE numeric(14, 2);--> statement-breakpoint
ALTER TABLE "savings_goals" ALTER COLUMN "target_amount" SET DATA TYPE numeric(14, 2);--> statement-breakpoint
ALTER TABLE "savings_goals" ALTER COLUMN "monthly_contribution" SET DATA TYPE numeric(14, 2);--> statement-breakpoint
ALTER TABLE "savings_goals" ALTER COLUMN "monthly_contribution" SET DEFAULT '0';--> statement-breakpoint
ALTER TABLE "savings_monthly" ALTER COLUMN "balance" SET DATA TYPE numeric(14, 2);--> statement-breakpoint
ALTER TABLE "savings_monthly" ALTER COLUMN "deposit_or_withdrawal" SET DATA TYPE numeric(14, 2);--> statement-breakpoint
ALTER TABLE "savings_planned_transactions" ALTER COLUMN "amount" SET DATA TYPE numeric(14, 2);--> statement-breakpoint
ALTER TABLE "self_loans" ALTER COLUMN "amount" SET DATA TYPE numeric(14, 2);--> statement-breakpoint
ALTER TABLE "self_loans" ALTER COLUMN "repaid_amount" SET DATA TYPE numeric(14, 2);--> statement-breakpoint
ALTER TABLE "self_loans" ALTER COLUMN "repaid_amount" SET DEFAULT '0';--> statement-breakpoint
ALTER TABLE "annual_performance" ADD COLUMN "is_immutable" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "api_connections_linked_profile_id_idx" ON "api_connections" USING btree ("linked_profile_id");--> statement-breakpoint
CREATE INDEX "budget_items_contribution_account_id_idx" ON "budget_items" USING btree ("contribution_account_id");--> statement-breakpoint
-- Data backfill: existing finalized annual_performance rows pre-date the
-- is_immutable flag and must be marked immutable on upgrade. Without this,
-- v4-era finalized rows would silently lose the immutability protection
-- that the v5 router-layer guard expects. Idempotent (safe to re-run).
UPDATE "annual_performance" SET "is_immutable" = true WHERE "is_finalized" = true;
