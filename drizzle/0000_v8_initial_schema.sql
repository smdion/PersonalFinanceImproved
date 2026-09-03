CREATE TABLE "account_basis" (
	"id" serial PRIMARY KEY NOT NULL,
	"performance_account_id" integer NOT NULL,
	"owner_person_id" integer NOT NULL,
	"year" integer NOT NULL,
	"contribution_basis" numeric(14, 2) DEFAULT '0' NOT NULL,
	"conversion_basis" numeric(14, 2) DEFAULT '0' NOT NULL,
	"latest_conversion_year" integer,
	"is_finalized" boolean DEFAULT false NOT NULL,
	"is_seeded" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "account_holdings" (
	"id" serial PRIMARY KEY NOT NULL,
	"performance_account_id" integer NOT NULL,
	"snapshot_id" integer NOT NULL,
	"ticker" text NOT NULL,
	"name" text NOT NULL,
	"weight_bps" integer NOT NULL,
	"expense_ratio" numeric(12, 6),
	"asset_class_id" integer,
	"asset_class_source" text DEFAULT 'manual' NOT NULL,
	CONSTRAINT "account_holdings_weight_range" CHECK (weight_bps >= 0 AND weight_bps <= 10000)
);
--> statement-breakpoint
CREATE TABLE "account_performance" (
	"id" serial PRIMARY KEY NOT NULL,
	"year" integer NOT NULL,
	"institution" text NOT NULL,
	"account_label" text NOT NULL,
	"owner_person_id" integer,
	"beginning_balance" numeric(14, 2) NOT NULL,
	"total_contributions" numeric(14, 2) NOT NULL,
	"yearly_gain_loss" numeric(14, 2) NOT NULL,
	"ending_balance" numeric(14, 2) NOT NULL,
	"annual_return_pct" numeric(8, 6),
	"employer_contributions" numeric(14, 2) DEFAULT '0' NOT NULL,
	"fees" numeric(14, 2) DEFAULT '0' NOT NULL,
	"distributions" numeric(14, 2) DEFAULT '0' NOT NULL,
	"rollovers" numeric(14, 2) DEFAULT '0' NOT NULL,
	"parent_category" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_finalized" boolean DEFAULT false NOT NULL,
	"performance_account_id" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "annual_performance" (
	"id" serial PRIMARY KEY NOT NULL,
	"year" integer NOT NULL,
	"category" text NOT NULL,
	"beginning_balance" numeric(14, 2) NOT NULL,
	"total_contributions" numeric(14, 2) NOT NULL,
	"yearly_gain_loss" numeric(14, 2) NOT NULL,
	"ending_balance" numeric(14, 2) NOT NULL,
	"annual_return_pct" numeric(8, 6),
	"employer_contributions" numeric(14, 2) DEFAULT '0' NOT NULL,
	"distributions" numeric(14, 2) DEFAULT '0' NOT NULL,
	"fees" numeric(14, 2) DEFAULT '0' NOT NULL,
	"rollovers" numeric(14, 2) DEFAULT '0' NOT NULL,
	"lifetime_gains" numeric(14, 2) NOT NULL,
	"lifetime_contributions" numeric(14, 2) NOT NULL,
	"lifetime_match" numeric(14, 2) NOT NULL,
	"is_current_year" boolean DEFAULT false NOT NULL,
	"is_finalized" boolean DEFAULT false NOT NULL,
	"is_immutable" boolean DEFAULT false NOT NULL,
	CONSTRAINT "annual_perf_finalized_not_current" CHECK (NOT ("annual_performance"."is_finalized" AND "annual_performance"."is_current_year"))
);
--> statement-breakpoint
CREATE TABLE "api_connections" (
	"id" serial PRIMARY KEY NOT NULL,
	"service" text NOT NULL,
	"config" jsonb NOT NULL,
	"account_mappings" jsonb,
	"skipped_category_ids" jsonb,
	"linked_profile_id" integer,
	"linked_column_index" integer,
	"server_knowledge" integer,
	"last_synced_at" timestamp with time zone,
	CONSTRAINT "api_connections_service_unique" UNIQUE("service")
);
--> statement-breakpoint
CREATE TABLE "app_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	CONSTRAINT "app_settings_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "asset_class_correlations" (
	"id" serial PRIMARY KEY NOT NULL,
	"class_a_id" integer NOT NULL,
	"class_b_id" integer NOT NULL,
	"correlation" numeric(12, 6) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "asset_class_params" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"mean_return" numeric(12, 6) NOT NULL,
	"std_dev" numeric(12, 6) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "asset_class_params_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "brokerage_goals" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"target_amount" numeric(14, 2) NOT NULL,
	"target_year" integer NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brokerage_planned_transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"goal_id" integer NOT NULL,
	"transaction_date" date NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"description" text NOT NULL,
	"is_recurring" boolean DEFAULT false NOT NULL,
	"recurrence_months" integer
);
--> statement-breakpoint
CREATE TABLE "budget_api_cache" (
	"id" serial PRIMARY KEY NOT NULL,
	"service" text NOT NULL,
	"cache_key" text NOT NULL,
	"data" jsonb NOT NULL,
	"server_knowledge" integer,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "budget_income_adjustments" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_id" integer NOT NULL,
	"month_date" date NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"source" text DEFAULT 'rule' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "budget_item_category_links" (
	"id" serial PRIMARY KEY NOT NULL,
	"budget_item_id" integer NOT NULL,
	"service" text NOT NULL,
	"category_id" text NOT NULL,
	"category_name" text,
	"last_synced_at" timestamp with time zone,
	"sync_direction" text
);
--> statement-breakpoint
CREATE TABLE "budget_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"profile_id" integer NOT NULL,
	"category" text NOT NULL,
	"subcategory" text NOT NULL,
	"amounts" jsonb NOT NULL,
	"api_category_name" text,
	"api_category_id" text,
	"api_last_synced_at" timestamp with time zone,
	"api_sync_direction" text DEFAULT 'pull',
	"contribution_account_id" integer,
	"is_essential" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "budget_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"column_labels" jsonb NOT NULL,
	"column_months" jsonb,
	"column_contribution_profile_ids" jsonb,
	"column_salary_profile_ids" jsonb,
	"is_active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budget_profiles_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "change_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"table_name" text NOT NULL,
	"record_id" integer NOT NULL,
	"field_name" text NOT NULL,
	"old_value" jsonb,
	"new_value" jsonb,
	"changed_by" text NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contribution_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_id" integer,
	"person_id" integer,
	"account_type" text NOT NULL,
	"sub_type" text,
	"label" text,
	"parent_category" text DEFAULT 'Retirement' NOT NULL,
	"tax_treatment" text NOT NULL,
	"employer_match_type" text NOT NULL,
	"employer_match_value" numeric(14, 2),
	"employer_max_match_pct" numeric(8, 6),
	"employer_match_tax_treatment" text DEFAULT 'pre_tax' NOT NULL,
	"hsa_coverage_type" text,
	"auto_maximize" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"ownership" text DEFAULT 'individual' NOT NULL,
	"performance_account_id" integer,
	"target_annual" numeric(14, 2),
	"allocation_priority" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"is_payroll_deducted" boolean,
	"prior_year_contrib_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"prior_year_contrib_year" integer,
	CONSTRAINT "contribution_accounts_parent_cat_check" CHECK (parent_category IN ('Retirement', 'Portfolio'))
);
--> statement-breakpoint
CREATE TABLE "contribution_limits" (
	"id" serial PRIMARY KEY NOT NULL,
	"tax_year" integer NOT NULL,
	"limit_type" text NOT NULL,
	"value" numeric(12, 6) NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "contribution_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"contribution_active_fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contribution_profiles_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "fpl_by_household" (
	"id" serial PRIMARY KEY NOT NULL,
	"tax_year" integer NOT NULL,
	"amounts" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "glide_path_allocations" (
	"id" serial PRIMARY KEY NOT NULL,
	"age" integer NOT NULL,
	"asset_class_id" integer NOT NULL,
	"allocation" numeric(12, 6) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "historical_notes" (
	"id" serial PRIMARY KEY NOT NULL,
	"year" integer NOT NULL,
	"field" text NOT NULL,
	"note" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "historical_salaries" (
	"id" serial PRIMARY KEY NOT NULL,
	"person_id" integer NOT NULL,
	"year" integer NOT NULL,
	"salary" numeric(14, 2) NOT NULL,
	"bonus" numeric(14, 2) DEFAULT '0' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "home_improvement_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"year" integer NOT NULL,
	"description" text NOT NULL,
	"cost" numeric(14, 2) NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "irmaa_brackets" (
	"id" serial PRIMARY KEY NOT NULL,
	"tax_year" integer NOT NULL,
	"filing_status" text NOT NULL,
	"brackets" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"person_id" integer NOT NULL,
	"employer_name" text NOT NULL,
	"title" text,
	"start_date" date NOT NULL,
	"end_date" date,
	"is_speculative" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "local_admins" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "local_admins_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "ltcg_brackets" (
	"id" serial PRIMARY KEY NOT NULL,
	"tax_year" integer NOT NULL,
	"filing_status" text NOT NULL,
	"brackets" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mc_preset_glide_paths" (
	"id" serial PRIMARY KEY NOT NULL,
	"preset_id" integer NOT NULL,
	"age" integer NOT NULL,
	"asset_class_id" integer NOT NULL,
	"allocation" numeric(12, 6) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mc_preset_return_overrides" (
	"id" serial PRIMARY KEY NOT NULL,
	"preset_id" integer NOT NULL,
	"asset_class_id" integer NOT NULL,
	"mean_return" numeric(12, 6) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mc_presets" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"description" text NOT NULL,
	"return_multiplier" numeric(12, 6) DEFAULT '1.000000' NOT NULL,
	"vol_multiplier" numeric(12, 6) DEFAULT '1.000000' NOT NULL,
	"inflation_mean" numeric(12, 6) DEFAULT '0.025000' NOT NULL,
	"inflation_std_dev" numeric(12, 6) DEFAULT '0.012000' NOT NULL,
	"default_trials" integer DEFAULT 5000 NOT NULL,
	"return_clamp_min" numeric(12, 6) DEFAULT '-0.500000' NOT NULL,
	"return_clamp_max" numeric(12, 6) DEFAULT '1.000000' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "mc_presets_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "mc_user_presets" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"simulations" integer DEFAULT 1000 NOT NULL,
	"return_mean" numeric(12, 6) NOT NULL,
	"return_std_dev" numeric(12, 6) NOT NULL,
	"inflation_mean" numeric(12, 6) NOT NULL,
	"inflation_std_dev" numeric(12, 6) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mortgage_extra_payments" (
	"id" serial PRIMARY KEY NOT NULL,
	"loan_id" integer NOT NULL,
	"payment_date" date,
	"start_date" date,
	"end_date" date,
	"amount" numeric(14, 2) NOT NULL,
	"is_actual" boolean DEFAULT false NOT NULL,
	"notes" text,
	CONSTRAINT "date_pattern_check" CHECK ((payment_date IS NOT NULL AND start_date IS NULL AND end_date IS NULL) OR (payment_date IS NULL AND start_date IS NOT NULL AND end_date IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "mortgage_loans" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"refinanced_from_id" integer,
	"paid_off_date" date,
	"principal_and_interest" numeric(14, 2) NOT NULL,
	"pmi" numeric(14, 2) DEFAULT '0' NOT NULL,
	"insurance_and_taxes" numeric(14, 2) DEFAULT '0' NOT NULL,
	"total_escrow" numeric(14, 2) DEFAULT '0' NOT NULL,
	"interest_rate" numeric(8, 6) NOT NULL,
	"term_years" integer NOT NULL,
	"original_loan_amount" numeric(14, 2) NOT NULL,
	"first_payment_date" date NOT NULL,
	"property_value_purchase" numeric(14, 2) NOT NULL,
	"property_value_estimated" numeric(14, 2),
	"use_purchase_or_estimated" text DEFAULT 'purchase' NOT NULL,
	"api_balance" numeric(14, 2),
	"api_balance_date" date
);
--> statement-breakpoint
CREATE TABLE "mortgage_what_if_scenarios" (
	"id" serial PRIMARY KEY NOT NULL,
	"loan_id" integer,
	"label" text NOT NULL,
	"extra_monthly_principal" numeric(14, 2) NOT NULL,
	"extra_one_time_payment" numeric(14, 2) DEFAULT '0' NOT NULL,
	"refinance_rate" numeric(8, 6),
	"refinance_term" integer,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "net_worth_annual" (
	"id" serial PRIMARY KEY NOT NULL,
	"year_end_date" date NOT NULL,
	"gross_income" numeric(14, 2) DEFAULT '0' NOT NULL,
	"combined_agi" numeric(14, 2) DEFAULT '0' NOT NULL,
	"ssa_earnings" numeric(14, 2),
	"effective_tax_rate" numeric(8, 6),
	"taxes_paid" numeric(14, 2),
	"cash" numeric(14, 2) DEFAULT '0' NOT NULL,
	"house_value" numeric(14, 2) DEFAULT '0' NOT NULL,
	"retirement_total" numeric(14, 2) DEFAULT '0' NOT NULL,
	"hsa" numeric(14, 2) DEFAULT '0' NOT NULL,
	"lt_brokerage" numeric(14, 2) DEFAULT '0' NOT NULL,
	"espp" numeric(14, 2) DEFAULT '0' NOT NULL,
	"r_brokerage" numeric(14, 2) DEFAULT '0' NOT NULL,
	"other_assets" numeric(14, 2) DEFAULT '0' NOT NULL,
	"mortgage_balance" numeric(14, 2) DEFAULT '0' NOT NULL,
	"other_liabilities" numeric(14, 2) DEFAULT '0' NOT NULL,
	"tax_free_total" numeric(14, 2) DEFAULT '0' NOT NULL,
	"tax_deferred_total" numeric(14, 2) DEFAULT '0' NOT NULL,
	"portfolio_total" numeric(14, 2) DEFAULT '0' NOT NULL,
	"property_taxes" numeric(14, 2),
	"portfolio_by_tax_location" jsonb NOT NULL,
	CONSTRAINT "net_worth_annual_year_end_date_unique" UNIQUE("year_end_date")
);
--> statement-breakpoint
CREATE TABLE "other_asset_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"year" integer NOT NULL,
	"value" numeric(14, 2) NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "paycheck_deductions" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_id" integer NOT NULL,
	"deduction_name" text NOT NULL,
	"is_pretax" boolean NOT NULL,
	"fica_exempt" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pending_rollovers" (
	"id" serial PRIMARY KEY NOT NULL,
	"source_account_performance_id" integer NOT NULL,
	"destination_performance_account_id" integer NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"sale_date" date NOT NULL,
	"sale_year" integer NOT NULL,
	"apply_year" integer NOT NULL,
	"notes" text,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "people" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"date_of_birth" date NOT NULL,
	"is_primary_user" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "performance_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution" text NOT NULL,
	"account_type" text NOT NULL,
	"sub_type" text,
	"label" text,
	"account_label" text NOT NULL,
	"display_name" text,
	"owner_person_id" integer,
	"ownership_type" text NOT NULL,
	"retirement_behavior" text DEFAULT 'stops_at_owner_retirement' NOT NULL,
	"contribution_scaling" text DEFAULT 'scales_with_salary' NOT NULL,
	"cost_basis" numeric(14, 2) DEFAULT '0' NOT NULL,
	"separation_date" date,
	"allow_penalized_withdrawals" boolean DEFAULT false NOT NULL,
	"parent_category" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "performance_accounts_parent_cat_check" CHECK (parent_category IN ('Retirement', 'Portfolio'))
);
--> statement-breakpoint
CREATE TABLE "portfolio_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"snapshot_id" integer NOT NULL,
	"institution" text NOT NULL,
	"tax_type" text NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"account_type" text NOT NULL,
	"sub_type" text,
	"label" text,
	"parent_category" text DEFAULT 'Retirement' NOT NULL,
	"owner_person_id" integer,
	"performance_account_id" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "portfolio_accounts_parent_cat_check" CHECK (parent_category IN ('Retirement', 'Portfolio'))
);
--> statement-breakpoint
CREATE TABLE "portfolio_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"snapshot_date" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notes" text,
	CONSTRAINT "portfolio_snapshots_snapshot_date_unique" UNIQUE("snapshot_date")
);
--> statement-breakpoint
CREATE TABLE "projection_cache" (
	"id" serial PRIMARY KEY NOT NULL,
	"input_hash" text NOT NULL,
	"seed" integer,
	"result" jsonb NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_read_at" timestamp with time zone DEFAULT now() NOT NULL,
	"engine_version" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projection_overrides" (
	"id" serial PRIMARY KEY NOT NULL,
	"override_type" text NOT NULL,
	"overrides" jsonb NOT NULL,
	"created_by" text,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "property_taxes" (
	"id" serial PRIMARY KEY NOT NULL,
	"loan_id" integer NOT NULL,
	"year" integer NOT NULL,
	"assessed_value" numeric(14, 2),
	"tax_amount" numeric(14, 2) NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "relocation_scenarios" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"params" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "retirement_budget_overrides" (
	"id" serial PRIMARY KEY NOT NULL,
	"person_id" integer NOT NULL,
	"projection_year" integer NOT NULL,
	"override_monthly_budget" numeric(14, 2) NOT NULL,
	"notes" text,
	"created_by" text,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "retirement_profile_people" (
	"id" serial PRIMARY KEY NOT NULL,
	"profile_id" integer NOT NULL,
	"person_id" integer NOT NULL,
	"retirement_age" integer NOT NULL,
	"end_age" integer NOT NULL,
	"social_security_monthly" numeric(14, 2),
	"ss_start_age" integer,
	"rule_of_55_override" boolean,
	"salary_annual_increase" numeric(8, 6)
);
--> statement-breakpoint
CREATE TABLE "retirement_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"tax_params_year" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "retirement_profiles_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "retirement_salary_overrides" (
	"id" serial PRIMARY KEY NOT NULL,
	"person_id" integer NOT NULL,
	"projection_year" integer NOT NULL,
	"override_salary" numeric(14, 2) NOT NULL,
	"contribution_profile_id" integer,
	"salary_profile_id" integer,
	"notes" text,
	"created_by" text,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "retirement_scenarios" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"withdrawal_rate" numeric(8, 6) NOT NULL,
	"target_annual_income" numeric(14, 2) NOT NULL,
	"annual_inflation" numeric(8, 6) NOT NULL,
	"distribution_tax_rate_traditional" numeric(8, 6) DEFAULT '0.22' NOT NULL,
	"distribution_tax_rate_roth" numeric(8, 6) DEFAULT '0' NOT NULL,
	"distribution_tax_rate_hsa" numeric(8, 6) DEFAULT '0' NOT NULL,
	"distribution_tax_rate_brokerage" numeric(8, 6) DEFAULT '0.15' NOT NULL,
	"is_lt_brokerage_enabled" boolean DEFAULT true NOT NULL,
	"lt_brokerage_annual_contribution" numeric(14, 2) DEFAULT '0' NOT NULL,
	"is_selected" boolean DEFAULT false NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "retirement_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"person_id" integer NOT NULL,
	"retirement_age" integer NOT NULL,
	"end_age" integer NOT NULL,
	"return_after_retirement" numeric(8, 6) NOT NULL,
	"annual_inflation" numeric(8, 6) NOT NULL,
	"post_retirement_inflation" numeric(8, 6),
	"salary_annual_increase" numeric(8, 6) NOT NULL,
	"salary_cap" numeric(14, 2),
	"raises_during_retirement" boolean DEFAULT false NOT NULL,
	"rule_of_55_override" boolean DEFAULT true NOT NULL,
	"withdrawal_rate" numeric(8, 6) DEFAULT '0.04' NOT NULL,
	"tax_multiplier" numeric(8, 6) DEFAULT '1.0' NOT NULL,
	"gross_up_for_taxes" boolean DEFAULT true NOT NULL,
	"roth_bracket_target" numeric(8, 6) DEFAULT '0.12',
	"social_security_monthly" numeric(14, 2) DEFAULT '2500' NOT NULL,
	"ss_start_age" integer DEFAULT 67 NOT NULL,
	"enable_roth_conversions" boolean DEFAULT false NOT NULL,
	"roth_conversion_target" numeric(8, 6),
	"withdrawal_strategy" varchar(30) DEFAULT 'fixed' NOT NULL,
	"discretionary_withdrawal_order" varchar(20) DEFAULT 'roth_first' NOT NULL,
	"gk_upper_guardrail" numeric(8, 6) DEFAULT '0.80',
	"gk_lower_guardrail" numeric(8, 6) DEFAULT '1.20',
	"gk_increase_pct" numeric(8, 6) DEFAULT '0.10',
	"gk_decrease_pct" numeric(8, 6) DEFAULT '0.10',
	"gk_skip_inflation_after_loss" boolean DEFAULT true NOT NULL,
	"sd_annual_decline_rate" numeric(12, 6) DEFAULT '0.02',
	"cp_withdrawal_percent" numeric(12, 6) DEFAULT '0.05',
	"cp_floor_percent" numeric(12, 6) DEFAULT '0.90',
	"en_withdrawal_percent" numeric(12, 6) DEFAULT '0.05',
	"en_rolling_years" integer DEFAULT 10,
	"en_floor_percent" numeric(12, 6) DEFAULT '0.90',
	"vd_base_percent" numeric(12, 6) DEFAULT '0.05',
	"vd_ceiling_percent" numeric(12, 6) DEFAULT '0.05',
	"vd_floor_percent" numeric(12, 6) DEFAULT '0.025',
	"rmd_multiplier" numeric(12, 6) DEFAULT '1.0',
	"rmd_excess_handling" varchar(20) DEFAULT 'reinvest' NOT NULL,
	"qcd_maximize" boolean DEFAULT false NOT NULL,
	"rmd_smoothing_enabled" boolean DEFAULT false NOT NULL,
	"rmd_smoothing_max_bracket_target" numeric(8, 6),
	"enable_irmaa_awareness" boolean DEFAULT false NOT NULL,
	"enable_aca_awareness" boolean DEFAULT false NOT NULL,
	"household_size" integer DEFAULT 2 NOT NULL,
	"filing_status" text NOT NULL,
	"profile_id" integer,
	"distribution_tax_rate_traditional" numeric(8, 6),
	"distribution_tax_rate_roth" numeric(8, 6),
	"distribution_tax_rate_hsa" numeric(8, 6),
	"distribution_tax_rate_brokerage" numeric(8, 6)
);
--> statement-breakpoint
CREATE TABLE "return_rate_table" (
	"id" serial PRIMARY KEY NOT NULL,
	"age" integer NOT NULL,
	"rate_of_return" numeric(8, 6) NOT NULL,
	CONSTRAINT "return_rate_table_age_unique" UNIQUE("age")
);
--> statement-breakpoint
CREATE TABLE "salary_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"salaries" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "salary_profiles_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "savings_allocation_overrides" (
	"id" serial PRIMARY KEY NOT NULL,
	"goal_id" integer NOT NULL,
	"month_date" date NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "savings_goal_category_links" (
	"id" serial PRIMARY KEY NOT NULL,
	"savings_goal_id" integer NOT NULL,
	"service" text NOT NULL,
	"role" text DEFAULT 'primary' NOT NULL,
	"category_id" text NOT NULL,
	"category_name" text,
	"last_synced_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "savings_goal_profile_allocations" (
	"id" serial PRIMARY KEY NOT NULL,
	"goal_id" integer NOT NULL,
	"budget_profile_id" integer NOT NULL,
	"allocation_percent" numeric(6, 3),
	"monthly_contribution" numeric(14, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "savings_goals" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"parent_goal_id" integer,
	"target_amount" numeric(14, 2),
	"target_months" integer,
	"target_date" date,
	"priority" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_emergency_fund" boolean DEFAULT false NOT NULL,
	"api_category_id" text,
	"api_category_name" text,
	"is_api_sync_enabled" boolean DEFAULT false NOT NULL,
	"reimbursement_api_category_id" text,
	"target_mode" text DEFAULT 'fixed' NOT NULL,
	CONSTRAINT "savings_goals_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "savings_monthly" (
	"id" serial PRIMARY KEY NOT NULL,
	"goal_id" integer NOT NULL,
	"month_date" date NOT NULL,
	"balance" numeric(14, 2) NOT NULL,
	"deposit_or_withdrawal" numeric(14, 2),
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "savings_planned_transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"goal_id" integer NOT NULL,
	"transaction_date" date NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"description" text NOT NULL,
	"is_recurring" boolean DEFAULT false NOT NULL,
	"recurrence_months" integer,
	"transfer_pair_id" text,
	"source" text DEFAULT 'manual' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "savings_planned_tx_settlements" (
	"id" serial PRIMARY KEY NOT NULL,
	"planned_tx_id" integer NOT NULL,
	"occurrence_month" date NOT NULL,
	"settled_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scenarios" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"overrides" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_baseline" boolean DEFAULT false NOT NULL,
	"budget_profile_id" integer,
	"contribution_profile_id" integer,
	"salary_profile_id" integer,
	"retirement_profile_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "self_loans" (
	"id" serial PRIMARY KEY NOT NULL,
	"from_goal_id" integer NOT NULL,
	"to_goal_id" integer,
	"amount" numeric(14, 2) NOT NULL,
	"loan_date" date NOT NULL,
	"repaid_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"repaid_date" date
);
--> statement-breakpoint
CREATE TABLE "simplefin_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"external_account_id" text NOT NULL,
	"org_name" text NOT NULL,
	"account_name" text NOT NULL,
	"last_balance" numeric(14, 2) NOT NULL,
	"is_included" boolean DEFAULT true NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"linked_performance_account_id" integer,
	CONSTRAINT "simplefin_accounts_external_account_id_unique" UNIQUE("external_account_id")
);
--> statement-breakpoint
CREATE TABLE "simplefin_balance_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"snapshot_date" date NOT NULL,
	"total_balance" numeric(14, 2) NOT NULL,
	"account_count" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "simplefin_balance_snapshots_snapshot_date_unique" UNIQUE("snapshot_date")
);
--> statement-breakpoint
CREATE TABLE "state_version_tables" (
	"id" serial PRIMARY KEY NOT NULL,
	"version_id" integer NOT NULL,
	"table_name" text NOT NULL,
	"row_count" integer NOT NULL,
	"data" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "state_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"version_type" text NOT NULL,
	"schema_version" text NOT NULL,
	"table_count" integer NOT NULL,
	"total_rows" integer NOT NULL,
	"size_estimate_bytes" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tax_brackets" (
	"id" serial PRIMARY KEY NOT NULL,
	"tax_year" integer NOT NULL,
	"filing_status" text NOT NULL,
	"w4_checkbox" boolean NOT NULL,
	"brackets" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tax_params" (
	"id" serial PRIMARY KEY NOT NULL,
	"tax_year" integer NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"source" text,
	"notes" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tax_params_version_positive" CHECK (version > 0)
);
--> statement-breakpoint
CREATE TABLE "utility_reading" (
	"id" serial PRIMARY KEY NOT NULL,
	"service_id" integer NOT NULL,
	"year" integer NOT NULL,
	"month" integer NOT NULL,
	"cost" numeric(14, 2) NOT NULL,
	"usage" numeric(14, 4),
	"note" text
);
--> statement-breakpoint
CREATE TABLE "utility_service" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"provider_name" text NOT NULL,
	"usage_unit" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account_basis" ADD CONSTRAINT "account_basis_performance_account_id_performance_accounts_id_fk" FOREIGN KEY ("performance_account_id") REFERENCES "public"."performance_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_basis" ADD CONSTRAINT "account_basis_owner_person_id_people_id_fk" FOREIGN KEY ("owner_person_id") REFERENCES "public"."people"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_holdings" ADD CONSTRAINT "account_holdings_performance_account_id_performance_accounts_id_fk" FOREIGN KEY ("performance_account_id") REFERENCES "public"."performance_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_holdings" ADD CONSTRAINT "account_holdings_snapshot_id_portfolio_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."portfolio_snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_holdings" ADD CONSTRAINT "account_holdings_asset_class_id_asset_class_params_id_fk" FOREIGN KEY ("asset_class_id") REFERENCES "public"."asset_class_params"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_performance" ADD CONSTRAINT "account_performance_owner_person_id_people_id_fk" FOREIGN KEY ("owner_person_id") REFERENCES "public"."people"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_performance" ADD CONSTRAINT "account_performance_performance_account_id_performance_accounts_id_fk" FOREIGN KEY ("performance_account_id") REFERENCES "public"."performance_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_class_correlations" ADD CONSTRAINT "asset_class_correlations_class_a_id_asset_class_params_id_fk" FOREIGN KEY ("class_a_id") REFERENCES "public"."asset_class_params"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_class_correlations" ADD CONSTRAINT "asset_class_correlations_class_b_id_asset_class_params_id_fk" FOREIGN KEY ("class_b_id") REFERENCES "public"."asset_class_params"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brokerage_planned_transactions" ADD CONSTRAINT "brokerage_planned_transactions_goal_id_brokerage_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."brokerage_goals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_income_adjustments" ADD CONSTRAINT "budget_income_adjustments_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_item_category_links" ADD CONSTRAINT "budget_item_category_links_budget_item_id_budget_items_id_fk" FOREIGN KEY ("budget_item_id") REFERENCES "public"."budget_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_items" ADD CONSTRAINT "budget_items_profile_id_budget_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."budget_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_items" ADD CONSTRAINT "budget_items_contribution_account_id_contribution_accounts_id_fk" FOREIGN KEY ("contribution_account_id") REFERENCES "public"."contribution_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contribution_accounts" ADD CONSTRAINT "contribution_accounts_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contribution_accounts" ADD CONSTRAINT "contribution_accounts_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contribution_accounts" ADD CONSTRAINT "contribution_accounts_performance_account_id_performance_accounts_id_fk" FOREIGN KEY ("performance_account_id") REFERENCES "public"."performance_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "glide_path_allocations" ADD CONSTRAINT "glide_path_allocations_asset_class_id_asset_class_params_id_fk" FOREIGN KEY ("asset_class_id") REFERENCES "public"."asset_class_params"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "historical_salaries" ADD CONSTRAINT "historical_salaries_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mc_preset_glide_paths" ADD CONSTRAINT "mc_preset_glide_paths_preset_id_mc_presets_id_fk" FOREIGN KEY ("preset_id") REFERENCES "public"."mc_presets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mc_preset_glide_paths" ADD CONSTRAINT "mc_preset_glide_paths_asset_class_id_asset_class_params_id_fk" FOREIGN KEY ("asset_class_id") REFERENCES "public"."asset_class_params"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mc_preset_return_overrides" ADD CONSTRAINT "mc_preset_return_overrides_preset_id_mc_presets_id_fk" FOREIGN KEY ("preset_id") REFERENCES "public"."mc_presets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mc_preset_return_overrides" ADD CONSTRAINT "mc_preset_return_overrides_asset_class_id_asset_class_params_id_fk" FOREIGN KEY ("asset_class_id") REFERENCES "public"."asset_class_params"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mortgage_extra_payments" ADD CONSTRAINT "mortgage_extra_payments_loan_id_mortgage_loans_id_fk" FOREIGN KEY ("loan_id") REFERENCES "public"."mortgage_loans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mortgage_loans" ADD CONSTRAINT "mortgage_loans_refinanced_from_id_mortgage_loans_id_fk" FOREIGN KEY ("refinanced_from_id") REFERENCES "public"."mortgage_loans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mortgage_what_if_scenarios" ADD CONSTRAINT "mortgage_what_if_scenarios_loan_id_mortgage_loans_id_fk" FOREIGN KEY ("loan_id") REFERENCES "public"."mortgage_loans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paycheck_deductions" ADD CONSTRAINT "paycheck_deductions_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_rollovers" ADD CONSTRAINT "pending_rollovers_source_account_performance_id_account_performance_id_fk" FOREIGN KEY ("source_account_performance_id") REFERENCES "public"."account_performance"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_rollovers" ADD CONSTRAINT "pending_rollovers_destination_performance_account_id_performance_accounts_id_fk" FOREIGN KEY ("destination_performance_account_id") REFERENCES "public"."performance_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performance_accounts" ADD CONSTRAINT "performance_accounts_owner_person_id_people_id_fk" FOREIGN KEY ("owner_person_id") REFERENCES "public"."people"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_accounts" ADD CONSTRAINT "portfolio_accounts_snapshot_id_portfolio_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."portfolio_snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_accounts" ADD CONSTRAINT "portfolio_accounts_owner_person_id_people_id_fk" FOREIGN KEY ("owner_person_id") REFERENCES "public"."people"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_accounts" ADD CONSTRAINT "portfolio_accounts_performance_account_id_performance_accounts_id_fk" FOREIGN KEY ("performance_account_id") REFERENCES "public"."performance_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_taxes" ADD CONSTRAINT "property_taxes_loan_id_mortgage_loans_id_fk" FOREIGN KEY ("loan_id") REFERENCES "public"."mortgage_loans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retirement_budget_overrides" ADD CONSTRAINT "retirement_budget_overrides_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retirement_profile_people" ADD CONSTRAINT "retirement_profile_people_profile_id_retirement_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."retirement_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retirement_profile_people" ADD CONSTRAINT "retirement_profile_people_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retirement_salary_overrides" ADD CONSTRAINT "retirement_salary_overrides_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retirement_salary_overrides" ADD CONSTRAINT "retirement_salary_overrides_contribution_profile_id_contribution_profiles_id_fk" FOREIGN KEY ("contribution_profile_id") REFERENCES "public"."contribution_profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retirement_salary_overrides" ADD CONSTRAINT "retirement_salary_overrides_salary_profile_id_salary_profiles_id_fk" FOREIGN KEY ("salary_profile_id") REFERENCES "public"."salary_profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retirement_settings" ADD CONSTRAINT "retirement_settings_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retirement_settings" ADD CONSTRAINT "retirement_settings_profile_id_retirement_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."retirement_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "savings_allocation_overrides" ADD CONSTRAINT "savings_allocation_overrides_goal_id_savings_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."savings_goals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "savings_goal_category_links" ADD CONSTRAINT "savings_goal_category_links_savings_goal_id_savings_goals_id_fk" FOREIGN KEY ("savings_goal_id") REFERENCES "public"."savings_goals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "savings_goal_profile_allocations" ADD CONSTRAINT "savings_goal_profile_allocations_goal_id_savings_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."savings_goals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "savings_goal_profile_allocations" ADD CONSTRAINT "savings_goal_profile_allocations_budget_profile_id_budget_profiles_id_fk" FOREIGN KEY ("budget_profile_id") REFERENCES "public"."budget_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "savings_monthly" ADD CONSTRAINT "savings_monthly_goal_id_savings_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."savings_goals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "savings_planned_transactions" ADD CONSTRAINT "savings_planned_transactions_goal_id_savings_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."savings_goals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "savings_planned_tx_settlements" ADD CONSTRAINT "savings_planned_tx_settlements_planned_tx_id_savings_planned_transactions_id_fk" FOREIGN KEY ("planned_tx_id") REFERENCES "public"."savings_planned_transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenarios" ADD CONSTRAINT "scenarios_budget_profile_id_budget_profiles_id_fk" FOREIGN KEY ("budget_profile_id") REFERENCES "public"."budget_profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenarios" ADD CONSTRAINT "scenarios_contribution_profile_id_contribution_profiles_id_fk" FOREIGN KEY ("contribution_profile_id") REFERENCES "public"."contribution_profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenarios" ADD CONSTRAINT "scenarios_salary_profile_id_salary_profiles_id_fk" FOREIGN KEY ("salary_profile_id") REFERENCES "public"."salary_profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenarios" ADD CONSTRAINT "scenarios_retirement_profile_id_retirement_profiles_id_fk" FOREIGN KEY ("retirement_profile_id") REFERENCES "public"."retirement_profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "self_loans" ADD CONSTRAINT "self_loans_from_goal_id_savings_goals_id_fk" FOREIGN KEY ("from_goal_id") REFERENCES "public"."savings_goals"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "self_loans" ADD CONSTRAINT "self_loans_to_goal_id_savings_goals_id_fk" FOREIGN KEY ("to_goal_id") REFERENCES "public"."savings_goals"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "simplefin_accounts" ADD CONSTRAINT "simplefin_accounts_linked_performance_account_id_performance_accounts_id_fk" FOREIGN KEY ("linked_performance_account_id") REFERENCES "public"."performance_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "state_version_tables" ADD CONSTRAINT "state_version_tables_version_id_state_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."state_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "utility_reading" ADD CONSTRAINT "utility_reading_service_id_utility_service_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."utility_service"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "account_basis_account_owner_year_idx" ON "account_basis" USING btree ("performance_account_id","owner_person_id","year");--> statement-breakpoint
CREATE INDEX "account_basis_owner_person_id_idx" ON "account_basis" USING btree ("owner_person_id");--> statement-breakpoint
CREATE INDEX "account_basis_year_idx" ON "account_basis" USING btree ("year");--> statement-breakpoint
CREATE UNIQUE INDEX "account_holdings_acct_snap_ticker_idx" ON "account_holdings" USING btree ("performance_account_id","snapshot_id","ticker");--> statement-breakpoint
CREATE INDEX "account_holdings_perf_acct_idx" ON "account_holdings" USING btree ("performance_account_id");--> statement-breakpoint
CREATE INDEX "account_holdings_snapshot_idx" ON "account_holdings" USING btree ("snapshot_id");--> statement-breakpoint
CREATE INDEX "account_holdings_asset_class_idx" ON "account_holdings" USING btree ("asset_class_id");--> statement-breakpoint
CREATE UNIQUE INDEX "account_perf_year_inst_label_owner_idx" ON "account_performance" USING btree ("year","institution","account_label","owner_person_id");--> statement-breakpoint
CREATE INDEX "account_performance_owner_id_idx" ON "account_performance" USING btree ("owner_person_id");--> statement-breakpoint
CREATE INDEX "account_performance_perf_acct_idx" ON "account_performance" USING btree ("performance_account_id");--> statement-breakpoint
CREATE INDEX "account_performance_is_active_idx" ON "account_performance" USING btree ("is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "annual_performance_year_cat_idx" ON "annual_performance" USING btree ("year","category");--> statement-breakpoint
CREATE INDEX "api_connections_linked_profile_id_idx" ON "api_connections" USING btree ("linked_profile_id");--> statement-breakpoint
CREATE UNIQUE INDEX "asset_class_correlations_pair_idx" ON "asset_class_correlations" USING btree ("class_a_id","class_b_id");--> statement-breakpoint
CREATE INDEX "asset_class_correlations_class_a_idx" ON "asset_class_correlations" USING btree ("class_a_id");--> statement-breakpoint
CREATE INDEX "asset_class_correlations_class_b_idx" ON "asset_class_correlations" USING btree ("class_b_id");--> statement-breakpoint
CREATE INDEX "asset_class_params_is_active_idx" ON "asset_class_params" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "brokerage_goals_is_active_idx" ON "brokerage_goals" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "brokerage_planned_tx_goal_id_idx" ON "brokerage_planned_transactions" USING btree ("goal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "budget_api_cache_service_key_idx" ON "budget_api_cache" USING btree ("service","cache_key");--> statement-breakpoint
CREATE UNIQUE INDEX "budget_income_adjustments_job_month_idx" ON "budget_income_adjustments" USING btree ("job_id","month_date");--> statement-breakpoint
CREATE INDEX "budget_item_category_links_budget_item_id_idx" ON "budget_item_category_links" USING btree ("budget_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "budget_item_category_links_item_service_idx" ON "budget_item_category_links" USING btree ("budget_item_id","service");--> statement-breakpoint
CREATE INDEX "budget_items_profile_id_idx" ON "budget_items" USING btree ("profile_id");--> statement-breakpoint
CREATE INDEX "budget_items_contribution_account_id_idx" ON "budget_items" USING btree ("contribution_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "budget_items_profile_cat_sub_idx" ON "budget_items" USING btree ("profile_id","category","subcategory");--> statement-breakpoint
CREATE INDEX "budget_profiles_is_active_idx" ON "budget_profiles" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "change_log_table_record_idx" ON "change_log" USING btree ("table_name","record_id");--> statement-breakpoint
CREATE INDEX "change_log_changed_at_idx" ON "change_log" USING btree ("changed_at");--> statement-breakpoint
CREATE INDEX "contribution_accounts_job_id_idx" ON "contribution_accounts" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "contribution_accounts_person_id_idx" ON "contribution_accounts" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "contribution_accounts_perf_acct_idx" ON "contribution_accounts" USING btree ("performance_account_id");--> statement-breakpoint
CREATE INDEX "contribution_accounts_acct_type_idx" ON "contribution_accounts" USING btree ("account_type");--> statement-breakpoint
CREATE INDEX "contribution_accounts_parent_cat_idx" ON "contribution_accounts" USING btree ("parent_category");--> statement-breakpoint
CREATE INDEX "contribution_accounts_is_active_idx" ON "contribution_accounts" USING btree ("is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "contribution_accounts_job_match_unq" ON "contribution_accounts" USING btree ("job_id","account_type","parent_category") WHERE "contribution_accounts"."employer_match_type" <> 'none' AND "contribution_accounts"."job_id" IS NOT NULL AND "contribution_accounts"."is_active" = true;--> statement-breakpoint
CREATE UNIQUE INDEX "contribution_accounts_person_match_unq" ON "contribution_accounts" USING btree ("person_id","account_type","parent_category") WHERE "contribution_accounts"."employer_match_type" <> 'none' AND "contribution_accounts"."job_id" IS NULL AND "contribution_accounts"."is_active" = true;--> statement-breakpoint
CREATE UNIQUE INDEX "contribution_limits_year_type_idx" ON "contribution_limits" USING btree ("tax_year","limit_type");--> statement-breakpoint
CREATE UNIQUE INDEX "fpl_by_household_year_idx" ON "fpl_by_household" USING btree ("tax_year");--> statement-breakpoint
CREATE UNIQUE INDEX "glide_path_age_class_idx" ON "glide_path_allocations" USING btree ("age","asset_class_id");--> statement-breakpoint
CREATE INDEX "glide_path_asset_class_idx" ON "glide_path_allocations" USING btree ("asset_class_id");--> statement-breakpoint
CREATE UNIQUE INDEX "historical_notes_year_field_idx" ON "historical_notes" USING btree ("year","field");--> statement-breakpoint
CREATE UNIQUE INDEX "historical_salaries_person_year_idx" ON "historical_salaries" USING btree ("person_id","year");--> statement-breakpoint
CREATE UNIQUE INDEX "irmaa_brackets_year_status_idx" ON "irmaa_brackets" USING btree ("tax_year","filing_status");--> statement-breakpoint
CREATE INDEX "jobs_person_id_idx" ON "jobs" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "jobs_is_speculative_idx" ON "jobs" USING btree ("is_speculative");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_one_speculative_per_person_idx" ON "jobs" USING btree ("person_id") WHERE "jobs"."is_speculative" = true;--> statement-breakpoint
CREATE UNIQUE INDEX "ltcg_brackets_year_status_idx" ON "ltcg_brackets" USING btree ("tax_year","filing_status");--> statement-breakpoint
CREATE UNIQUE INDEX "mc_preset_gp_idx" ON "mc_preset_glide_paths" USING btree ("preset_id","age","asset_class_id");--> statement-breakpoint
CREATE INDEX "mc_preset_gp_preset_idx" ON "mc_preset_glide_paths" USING btree ("preset_id");--> statement-breakpoint
CREATE INDEX "mc_preset_gp_asset_class_idx" ON "mc_preset_glide_paths" USING btree ("asset_class_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mc_preset_ro_idx" ON "mc_preset_return_overrides" USING btree ("preset_id","asset_class_id");--> statement-breakpoint
CREATE INDEX "mc_preset_ro_asset_class_idx" ON "mc_preset_return_overrides" USING btree ("asset_class_id");--> statement-breakpoint
CREATE INDEX "mc_presets_is_active_idx" ON "mc_presets" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "mortgage_extra_payments_loan_id_idx" ON "mortgage_extra_payments" USING btree ("loan_id");--> statement-breakpoint
CREATE INDEX "mortgage_loans_is_active_idx" ON "mortgage_loans" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "mortgage_loans_refinanced_from_id_idx" ON "mortgage_loans" USING btree ("refinanced_from_id");--> statement-breakpoint
CREATE INDEX "mortgage_what_if_loan_id_idx" ON "mortgage_what_if_scenarios" USING btree ("loan_id");--> statement-breakpoint
CREATE UNIQUE INDEX "other_asset_items_name_year_idx" ON "other_asset_items" USING btree ("name","year");--> statement-breakpoint
CREATE INDEX "paycheck_deductions_job_id_idx" ON "paycheck_deductions" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "pending_rollovers_source_idx" ON "pending_rollovers" USING btree ("source_account_performance_id");--> statement-breakpoint
CREATE INDEX "pending_rollovers_dest_idx" ON "pending_rollovers" USING btree ("destination_performance_account_id");--> statement-breakpoint
CREATE INDEX "pending_rollovers_sale_year_idx" ON "pending_rollovers" USING btree ("sale_year");--> statement-breakpoint
CREATE INDEX "pending_rollovers_confirmed_idx" ON "pending_rollovers" USING btree ("confirmed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "performance_accounts_inst_type_idx" ON "performance_accounts" USING btree ("institution","account_type","sub_type","label","owner_person_id");--> statement-breakpoint
CREATE INDEX "idx_perf_accounts_inst_label" ON "performance_accounts" USING btree ("institution","account_label");--> statement-breakpoint
CREATE INDEX "performance_accounts_owner_id_idx" ON "performance_accounts" USING btree ("owner_person_id");--> statement-breakpoint
CREATE INDEX "performance_accounts_category_idx" ON "performance_accounts" USING btree ("parent_category");--> statement-breakpoint
CREATE INDEX "performance_accounts_is_active_idx" ON "performance_accounts" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "portfolio_accounts_snapshot_id_idx" ON "portfolio_accounts" USING btree ("snapshot_id");--> statement-breakpoint
CREATE INDEX "portfolio_accounts_owner_id_idx" ON "portfolio_accounts" USING btree ("owner_person_id");--> statement-breakpoint
CREATE INDEX "portfolio_accounts_perf_acct_idx" ON "portfolio_accounts" USING btree ("performance_account_id");--> statement-breakpoint
CREATE INDEX "portfolio_accounts_acct_type_idx" ON "portfolio_accounts" USING btree ("account_type");--> statement-breakpoint
CREATE INDEX "portfolio_accounts_parent_cat_idx" ON "portfolio_accounts" USING btree ("parent_category");--> statement-breakpoint
CREATE INDEX "portfolio_accounts_is_active_idx" ON "portfolio_accounts" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "portfolio_snapshots_date_idx" ON "portfolio_snapshots" USING btree ("snapshot_date");--> statement-breakpoint
CREATE UNIQUE INDEX "projection_cache_hash_version_idx" ON "projection_cache" USING btree ("input_hash","engine_version");--> statement-breakpoint
CREATE INDEX "projection_cache_expires_at_idx" ON "projection_cache" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "projection_overrides_type_idx" ON "projection_overrides" USING btree ("override_type");--> statement-breakpoint
CREATE UNIQUE INDEX "property_taxes_loan_year_idx" ON "property_taxes" USING btree ("loan_id","year");--> statement-breakpoint
CREATE UNIQUE INDEX "retirement_budget_overrides_person_year_idx" ON "retirement_budget_overrides" USING btree ("person_id","projection_year");--> statement-breakpoint
CREATE INDEX "retirement_budget_overrides_person_id_idx" ON "retirement_budget_overrides" USING btree ("person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "retirement_profile_people_profile_person_unq" ON "retirement_profile_people" USING btree ("profile_id","person_id");--> statement-breakpoint
CREATE INDEX "retirement_profile_people_profile_id_idx" ON "retirement_profile_people" USING btree ("profile_id");--> statement-breakpoint
CREATE INDEX "retirement_profile_people_person_id_idx" ON "retirement_profile_people" USING btree ("person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "retirement_salary_overrides_person_year_idx" ON "retirement_salary_overrides" USING btree ("person_id","projection_year");--> statement-breakpoint
CREATE INDEX "retirement_salary_overrides_person_id_idx" ON "retirement_salary_overrides" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "retirement_salary_overrides_contribution_profile_id_idx" ON "retirement_salary_overrides" USING btree ("contribution_profile_id");--> statement-breakpoint
CREATE INDEX "retirement_salary_overrides_salary_profile_id_idx" ON "retirement_salary_overrides" USING btree ("salary_profile_id");--> statement-breakpoint
CREATE INDEX "retirement_settings_person_id_idx" ON "retirement_settings" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "retirement_settings_profile_id_idx" ON "retirement_settings" USING btree ("profile_id");--> statement-breakpoint
CREATE UNIQUE INDEX "retirement_settings_profile_person_unq" ON "retirement_settings" USING btree ("profile_id","person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "savings_alloc_override_goal_month_idx" ON "savings_allocation_overrides" USING btree ("goal_id","month_date");--> statement-breakpoint
CREATE INDEX "savings_goal_category_links_savings_goal_id_idx" ON "savings_goal_category_links" USING btree ("savings_goal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "savings_goal_category_links_goal_service_role_idx" ON "savings_goal_category_links" USING btree ("savings_goal_id","service","role");--> statement-breakpoint
CREATE UNIQUE INDEX "savings_goal_profile_alloc_goal_profile_idx" ON "savings_goal_profile_allocations" USING btree ("goal_id","budget_profile_id");--> statement-breakpoint
CREATE INDEX "savings_goal_profile_alloc_profile_idx" ON "savings_goal_profile_allocations" USING btree ("budget_profile_id");--> statement-breakpoint
CREATE INDEX "savings_goals_is_active_idx" ON "savings_goals" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "savings_monthly_goal_id_idx" ON "savings_monthly" USING btree ("goal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "savings_monthly_goal_month_idx" ON "savings_monthly" USING btree ("goal_id","month_date");--> statement-breakpoint
CREATE INDEX "savings_planned_tx_goal_id_idx" ON "savings_planned_transactions" USING btree ("goal_id");--> statement-breakpoint
CREATE INDEX "savings_planned_tx_source_idx" ON "savings_planned_transactions" USING btree ("source");--> statement-breakpoint
CREATE UNIQUE INDEX "savings_planned_tx_settlements_occurrence_idx" ON "savings_planned_tx_settlements" USING btree ("planned_tx_id","occurrence_month");--> statement-breakpoint
CREATE INDEX "scenarios_budget_profile_id_idx" ON "scenarios" USING btree ("budget_profile_id");--> statement-breakpoint
CREATE INDEX "scenarios_contribution_profile_id_idx" ON "scenarios" USING btree ("contribution_profile_id");--> statement-breakpoint
CREATE INDEX "scenarios_salary_profile_id_idx" ON "scenarios" USING btree ("salary_profile_id");--> statement-breakpoint
CREATE INDEX "scenarios_retirement_profile_id_idx" ON "scenarios" USING btree ("retirement_profile_id");--> statement-breakpoint
CREATE INDEX "self_loans_from_goal_id_idx" ON "self_loans" USING btree ("from_goal_id");--> statement-breakpoint
CREATE INDEX "self_loans_to_goal_id_idx" ON "self_loans" USING btree ("to_goal_id");--> statement-breakpoint
CREATE INDEX "simplefin_accounts_org_name_idx" ON "simplefin_accounts" USING btree ("org_name","account_name");--> statement-breakpoint
CREATE INDEX "simplefin_accounts_linked_perf_account_idx" ON "simplefin_accounts" USING btree ("linked_performance_account_id");--> statement-breakpoint
CREATE INDEX "simplefin_balance_snapshots_date_idx" ON "simplefin_balance_snapshots" USING btree ("snapshot_date");--> statement-breakpoint
CREATE INDEX "state_version_tables_version_id_idx" ON "state_version_tables" USING btree ("version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "state_version_tables_version_table_idx" ON "state_version_tables" USING btree ("version_id","table_name");--> statement-breakpoint
CREATE INDEX "state_versions_created_at_idx" ON "state_versions" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "tax_brackets_year_status_checkbox_idx" ON "tax_brackets" USING btree ("tax_year","filing_status","w4_checkbox");--> statement-breakpoint
CREATE UNIQUE INDEX "tax_params_year_idx" ON "tax_params" USING btree ("tax_year");--> statement-breakpoint
CREATE UNIQUE INDEX "utility_reading_service_year_month_idx" ON "utility_reading" USING btree ("service_id","year","month");--> statement-breakpoint
CREATE UNIQUE INDEX "utility_service_kind_idx" ON "utility_service" USING btree ("kind");
--> statement-breakpoint
-- ─────────────────────────────────────────────────────────────────────────────
-- HAND-EDITED — do not regenerate this file blindly. Everything above is
-- `drizzle-kit generate` output; everything below is carried forward by hand
-- through the v0.8.0 squash and must be re-applied after any regenerate.
-- ─────────────────────────────────────────────────────────────────────────────
-- Baseline profile seed (from 0008_kill_live_sentinel steps 3-6; the column
-- reshapes that migration also did are baked into the CREATE TABLEs above).
-- Idempotent: on a fresh install this seeds the "Current" Salary and
-- Contribution profiles and points the active-profile settings at them; on a
-- squash-recovery replay against an existing v0.7.x database every statement
-- guards to a no-op (app_settings.active_*_profile_id already holds a real id
-- / the profile tables are already populated).
WITH seeded AS (
	INSERT INTO "salary_profiles" ("name", "description", "salaries")
	SELECT
		(
			SELECT c.candidate FROM (
				          SELECT 'Current' AS candidate, 1 AS ord
				UNION ALL SELECT 'Current (2)', 2
				UNION ALL SELECT 'Current (3)', 3
				UNION ALL SELECT 'Current (4)', 4
				UNION ALL SELECT 'Current (5)', 5
			) c
			WHERE NOT EXISTS (
				SELECT 1 FROM "salary_profiles" existing WHERE existing."name" = c.candidate
			)
			ORDER BY c.ord
			LIMIT 1
		),
		'Every salary follows its job record',
		COALESCE(
			(SELECT jsonb_object_agg(p."id"::text, jsonb_build_object('mode', 'job')) FROM "people" p),
			'{}'::jsonb
		)
	WHERE NOT EXISTS (
		SELECT 1 FROM "app_settings" a
		WHERE a."key" = 'active_salary_profile_id'
			AND jsonb_typeof(a."value") != 'null'
			AND a."value" != '0'::jsonb
	)
	RETURNING "id"
)
INSERT INTO "app_settings" ("key", "value")
SELECT 'active_salary_profile_id', to_jsonb(seeded."id") FROM seeded
ON CONFLICT ("key") DO UPDATE
	SET "value" = EXCLUDED."value"
	WHERE jsonb_typeof("app_settings"."value") = 'null'
		OR "app_settings"."value" = to_jsonb(0);
--> statement-breakpoint
INSERT INTO "contribution_profiles" ("name", "description", "contribution_active_fields")
SELECT 'Current', 'Contribution settings as they stand', '{}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM "contribution_profiles");
--> statement-breakpoint
INSERT INTO "app_settings" ("key", "value")
SELECT 'active_contrib_profile_id', to_jsonb(cp."id")
FROM (
	SELECT "id" FROM "contribution_profiles"
	ORDER BY "created_at" ASC, "id" ASC
	LIMIT 1
) cp
ON CONFLICT ("key") DO UPDATE
	SET "value" = EXCLUDED."value"
	WHERE jsonb_typeof("app_settings"."value") = 'null'
		OR "app_settings"."value" = to_jsonb(0);
