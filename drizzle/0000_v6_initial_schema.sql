-- v0.6.0 squashed schema
-- Generated from live prod schema (v0.5.12) — single source of truth for fresh installs.
-- Existing installs: db-migrate.ts detects count mismatch and runs handleSquashUpgrade().

CREATE TABLE "asset_class_params" (
  "id" serial NOT NULL,
  "name" text NOT NULL,
  "mean_return" numeric(12,6) NOT NULL,
  "std_dev" numeric(12,6) NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  CONSTRAINT "asset_class_params_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "asset_class_params_name_unique" UNIQUE ("name")
);
--> statement-breakpoint
CREATE TABLE "people" (
  "id" serial NOT NULL,
  "name" text NOT NULL,
  "date_of_birth" date NOT NULL,
  "is_primary_user" boolean DEFAULT false NOT NULL,
  CONSTRAINT "people_pkey" PRIMARY KEY ("id")
);
--> statement-breakpoint
CREATE TABLE "performance_accounts" (
  "id" serial NOT NULL,
  "institution" text NOT NULL,
  "account_type" text NOT NULL,
  "sub_type" text,
  "label" text,
  "account_label" text NOT NULL,
  "display_name" text,
  "owner_person_id" integer,
  "ownership_type" text NOT NULL,
  "parent_category" text NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "display_order" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "retirement_behavior" text DEFAULT 'stops_at_owner_retirement' NOT NULL,
  "contribution_scaling" text DEFAULT 'scales_with_salary' NOT NULL,
  "cost_basis" numeric(14,2) DEFAULT 0 NOT NULL,
  CONSTRAINT "performance_accounts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "performance_accounts_parent_cat_check" CHECK (((parent_category = ANY (ARRAY['Retirement'::text, 'Portfolio'::text])))),
  CONSTRAINT "performance_accounts_owner_person_id_people_id_fk"
    FOREIGN KEY ("owner_person_id") REFERENCES "people"("id") ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE "portfolio_snapshots" (
  "id" serial NOT NULL,
  "snapshot_date" date NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "notes" text,
  CONSTRAINT "portfolio_snapshots_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "portfolio_snapshots_snapshot_date_unique" UNIQUE ("snapshot_date")
);
--> statement-breakpoint
CREATE TABLE "account_holdings" (
  "id" serial NOT NULL,
  "performance_account_id" integer NOT NULL,
  "snapshot_id" integer NOT NULL,
  "ticker" text NOT NULL,
  "name" text NOT NULL,
  "weight_bps" integer NOT NULL,
  "expense_ratio" numeric(12,6),
  "asset_class_id" integer,
  "asset_class_source" text DEFAULT 'manual' NOT NULL,
  CONSTRAINT "account_holdings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "account_holdings_weight_range" CHECK ((((weight_bps >= 0) AND (weight_bps <= 10000)))),
  CONSTRAINT "account_holdings_asset_class_id_asset_class_params_id_fk"
    FOREIGN KEY ("asset_class_id") REFERENCES "asset_class_params"("id") ON DELETE set null,
  CONSTRAINT "account_holdings_performance_account_id_performance_accounts_id"
    FOREIGN KEY ("performance_account_id") REFERENCES "performance_accounts"("id") ON DELETE cascade,
  CONSTRAINT "account_holdings_snapshot_id_portfolio_snapshots_id_fk"
    FOREIGN KEY ("snapshot_id") REFERENCES "portfolio_snapshots"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE "account_performance" (
  "id" serial NOT NULL,
  "year" integer NOT NULL,
  "institution" text NOT NULL,
  "account_label" text NOT NULL,
  "owner_person_id" integer,
  "beginning_balance" numeric(14,2) NOT NULL,
  "total_contributions" numeric(14,2) NOT NULL,
  "yearly_gain_loss" numeric(14,2) NOT NULL,
  "ending_balance" numeric(14,2) NOT NULL,
  "annual_return_pct" numeric(8,6),
  "employer_contributions" numeric(14,2) DEFAULT 0 NOT NULL,
  "fees" numeric(14,2) DEFAULT 0 NOT NULL,
  "distributions" numeric(14,2) DEFAULT 0 NOT NULL,
  "parent_category" text NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "is_finalized" boolean DEFAULT false NOT NULL,
  "performance_account_id" integer NOT NULL,
  "rollovers" numeric(14,2) DEFAULT 0 NOT NULL,
  CONSTRAINT "account_performance_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "account_performance_owner_person_id_people_id_fk"
    FOREIGN KEY ("owner_person_id") REFERENCES "people"("id") ON DELETE restrict,
  CONSTRAINT "account_performance_performance_account_id_performance_accounts"
    FOREIGN KEY ("performance_account_id") REFERENCES "performance_accounts"("id") ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE "annual_performance" (
  "id" serial NOT NULL,
  "year" integer NOT NULL,
  "category" text NOT NULL,
  "beginning_balance" numeric(14,2) NOT NULL,
  "total_contributions" numeric(14,2) NOT NULL,
  "yearly_gain_loss" numeric(14,2) NOT NULL,
  "ending_balance" numeric(14,2) NOT NULL,
  "annual_return_pct" numeric(8,6),
  "employer_contributions" numeric(14,2) DEFAULT 0 NOT NULL,
  "distributions" numeric(14,2) DEFAULT 0 NOT NULL,
  "fees" numeric(14,2) DEFAULT 0 NOT NULL,
  "lifetime_gains" numeric(14,2) NOT NULL,
  "lifetime_contributions" numeric(14,2) NOT NULL,
  "lifetime_match" numeric(14,2) NOT NULL,
  "is_current_year" boolean DEFAULT false NOT NULL,
  "is_finalized" boolean DEFAULT false NOT NULL,
  "rollovers" numeric(14,2) DEFAULT 0 NOT NULL,
  "is_immutable" boolean DEFAULT false NOT NULL,
  CONSTRAINT "annual_performance_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "annual_perf_finalized_not_current" CHECK (((NOT (is_finalized AND is_current_year))))
);
--> statement-breakpoint
CREATE TABLE "api_connections" (
  "id" serial NOT NULL,
  "service" text NOT NULL,
  "config" jsonb NOT NULL,
  "account_mappings" jsonb,
  "skipped_category_ids" jsonb,
  "linked_profile_id" integer,
  "linked_column_index" integer,
  "server_knowledge" integer,
  "last_synced_at" timestamp with time zone,
  CONSTRAINT "api_connections_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "api_connections_service_unique" UNIQUE ("service")
);
--> statement-breakpoint
CREATE TABLE "app_settings" (
  "id" serial NOT NULL,
  "key" text NOT NULL,
  "value" jsonb NOT NULL,
  CONSTRAINT "app_settings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "app_settings_key_unique" UNIQUE ("key")
);
--> statement-breakpoint
CREATE TABLE "asset_class_correlations" (
  "id" serial NOT NULL,
  "class_a_id" integer NOT NULL,
  "class_b_id" integer NOT NULL,
  "correlation" numeric(12,6) NOT NULL,
  CONSTRAINT "asset_class_correlations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "asset_class_correlations_class_a_id_asset_class_params_id_fk"
    FOREIGN KEY ("class_a_id") REFERENCES "asset_class_params"("id") ON DELETE cascade,
  CONSTRAINT "asset_class_correlations_class_b_id_asset_class_params_id_fk"
    FOREIGN KEY ("class_b_id") REFERENCES "asset_class_params"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE "brokerage_goals" (
  "id" serial NOT NULL,
  "name" text NOT NULL,
  "target_amount" numeric(14,2) NOT NULL,
  "target_year" integer NOT NULL,
  "priority" integer DEFAULT 0 NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "brokerage_goals_pkey" PRIMARY KEY ("id")
);
--> statement-breakpoint
CREATE TABLE "brokerage_planned_transactions" (
  "id" serial NOT NULL,
  "goal_id" integer NOT NULL,
  "transaction_date" date NOT NULL,
  "amount" numeric(14,2) NOT NULL,
  "description" text NOT NULL,
  "is_recurring" boolean DEFAULT false NOT NULL,
  "recurrence_months" integer,
  CONSTRAINT "brokerage_planned_transactions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "brokerage_planned_transactions_goal_id_brokerage_goals_id_fk"
    FOREIGN KEY ("goal_id") REFERENCES "brokerage_goals"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE "budget_api_cache" (
  "id" serial NOT NULL,
  "service" text NOT NULL,
  "cache_key" text NOT NULL,
  "data" jsonb NOT NULL,
  "server_knowledge" integer,
  "fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "budget_api_cache_pkey" PRIMARY KEY ("id")
);
--> statement-breakpoint
CREATE TABLE "jobs" (
  "id" serial NOT NULL,
  "person_id" integer NOT NULL,
  "employer_name" text NOT NULL,
  "title" text,
  "annual_salary" numeric(14,2) NOT NULL,
  "pay_period" text NOT NULL,
  "pay_week" text NOT NULL,
  "start_date" date NOT NULL,
  "anchor_pay_date" date,
  "end_date" date,
  "bonus_percent" numeric(8,6) DEFAULT 0 NOT NULL,
  "bonus_multiplier" numeric(8,6) DEFAULT 1.0 NOT NULL,
  "months_in_bonus_year" integer DEFAULT 12 NOT NULL,
  "include_401k_in_bonus" boolean DEFAULT false NOT NULL,
  "include_bonus_in_contributions" boolean DEFAULT true NOT NULL,
  "bonus_override" numeric(14,2),
  "bonus_month" integer,
  "bonus_day_of_month" integer,
  "w4_filing_status" text NOT NULL,
  "w4_box2c_checked" boolean DEFAULT false NOT NULL,
  "additional_fed_withholding" numeric(14,2) DEFAULT 0 NOT NULL,
  "budget_periods_per_month" numeric(6,4),
  "extra_paycheck_routing" jsonb,
  CONSTRAINT "jobs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "jobs_person_id_people_id_fk"
    FOREIGN KEY ("person_id") REFERENCES "people"("id") ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE "contribution_accounts" (
  "id" serial NOT NULL,
  "job_id" integer,
  "person_id" integer NOT NULL,
  "account_type" text NOT NULL,
  "sub_type" text,
  "label" text,
  "parent_category" text DEFAULT 'Retirement' NOT NULL,
  "tax_treatment" text NOT NULL,
  "contribution_method" text NOT NULL,
  "contribution_value" numeric(14,2) NOT NULL,
  "employer_match_type" text NOT NULL,
  "employer_match_value" numeric(14,2),
  "employer_max_match_pct" numeric(8,6),
  "employer_match_tax_treatment" text DEFAULT 'pre_tax' NOT NULL,
  "hsa_coverage_type" text,
  "auto_maximize" boolean DEFAULT false NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "ownership" text DEFAULT 'individual' NOT NULL,
  "performance_account_id" integer,
  "target_annual" numeric(14,2),
  "allocation_priority" integer DEFAULT 0 NOT NULL,
  "notes" text,
  "is_payroll_deducted" boolean,
  "prior_year_contrib_amount" numeric(14,2) DEFAULT 0 NOT NULL,
  "prior_year_contrib_year" integer,
  CONSTRAINT "contribution_accounts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "contribution_accounts_parent_cat_check" CHECK (((parent_category = ANY (ARRAY['Retirement'::text, 'Portfolio'::text])))),
  CONSTRAINT "contribution_accounts_job_id_jobs_id_fk"
    FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE cascade,
  CONSTRAINT "contribution_accounts_performance_account_id_performance_accoun"
    FOREIGN KEY ("performance_account_id") REFERENCES "performance_accounts"("id") ON DELETE set null,
  CONSTRAINT "contribution_accounts_person_id_people_id_fk"
    FOREIGN KEY ("person_id") REFERENCES "people"("id") ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE "budget_profiles" (
  "id" serial NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "column_labels" jsonb NOT NULL,
  "column_months" jsonb,
  "column_contribution_profile_ids" jsonb,
  "is_active" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "budget_profiles_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "budget_profiles_name_unique" UNIQUE ("name")
);
--> statement-breakpoint
CREATE TABLE "budget_items" (
  "id" serial NOT NULL,
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
  "sort_order" integer DEFAULT 0 NOT NULL,
  CONSTRAINT "budget_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "budget_items_contribution_account_id_contribution_accounts_id_f"
    FOREIGN KEY ("contribution_account_id") REFERENCES "contribution_accounts"("id") ON DELETE set null,
  CONSTRAINT "budget_items_profile_id_budget_profiles_id_fk"
    FOREIGN KEY ("profile_id") REFERENCES "budget_profiles"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE "change_log" (
  "id" serial NOT NULL,
  "table_name" text NOT NULL,
  "record_id" integer NOT NULL,
  "field_name" text NOT NULL,
  "old_value" jsonb,
  "new_value" jsonb,
  "changed_by" text NOT NULL,
  "changed_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "change_log_pkey" PRIMARY KEY ("id")
);
--> statement-breakpoint
CREATE TABLE "contribution_limits" (
  "id" serial NOT NULL,
  "tax_year" integer NOT NULL,
  "limit_type" text NOT NULL,
  "value" numeric(12,6) NOT NULL,
  "notes" text,
  CONSTRAINT "contribution_limits_pkey" PRIMARY KEY ("id")
);
--> statement-breakpoint
CREATE TABLE "contribution_profiles" (
  "id" serial NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "salary_overrides" jsonb DEFAULT '{}' NOT NULL,
  "contribution_overrides" jsonb DEFAULT '{}' NOT NULL,
  "is_default" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "contribution_profiles_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "contribution_profiles_name_unique" UNIQUE ("name")
);
--> statement-breakpoint
CREATE TABLE "glide_path_allocations" (
  "id" serial NOT NULL,
  "age" integer NOT NULL,
  "asset_class_id" integer NOT NULL,
  "allocation" numeric(12,6) NOT NULL,
  CONSTRAINT "glide_path_allocations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "glide_path_allocations_asset_class_id_asset_class_params_id_fk"
    FOREIGN KEY ("asset_class_id") REFERENCES "asset_class_params"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE "historical_notes" (
  "id" serial NOT NULL,
  "year" integer NOT NULL,
  "field" text NOT NULL,
  "note" text NOT NULL,
  CONSTRAINT "historical_notes_pkey" PRIMARY KEY ("id")
);
--> statement-breakpoint
CREATE TABLE "home_improvement_items" (
  "id" serial NOT NULL,
  "year" integer NOT NULL,
  "description" text NOT NULL,
  "cost" numeric(14,2) NOT NULL,
  "note" text,
  CONSTRAINT "home_improvement_items_pkey" PRIMARY KEY ("id")
);
--> statement-breakpoint
CREATE TABLE "irmaa_brackets" (
  "id" serial NOT NULL,
  "tax_year" integer NOT NULL,
  "filing_status" text NOT NULL,
  "brackets" jsonb NOT NULL,
  CONSTRAINT "irmaa_brackets_pkey" PRIMARY KEY ("id")
);
--> statement-breakpoint
CREATE TABLE "local_admins" (
  "id" serial NOT NULL,
  "email" text NOT NULL,
  "password_hash" text NOT NULL,
  "name" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "local_admins_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "local_admins_email_unique" UNIQUE ("email")
);
--> statement-breakpoint
CREATE TABLE "ltcg_brackets" (
  "id" serial NOT NULL,
  "tax_year" integer NOT NULL,
  "filing_status" text NOT NULL,
  "brackets" jsonb NOT NULL,
  CONSTRAINT "ltcg_brackets_pkey" PRIMARY KEY ("id")
);
--> statement-breakpoint
CREATE TABLE "mc_presets" (
  "id" serial NOT NULL,
  "key" text NOT NULL,
  "label" text NOT NULL,
  "description" text NOT NULL,
  "return_multiplier" numeric(12,6) DEFAULT 1.000000 NOT NULL,
  "vol_multiplier" numeric(12,6) DEFAULT 1.000000 NOT NULL,
  "inflation_mean" numeric(12,6) DEFAULT 0.025000 NOT NULL,
  "inflation_std_dev" numeric(12,6) DEFAULT 0.012000 NOT NULL,
  "default_trials" integer DEFAULT 5000 NOT NULL,
  "return_clamp_min" numeric(12,6) DEFAULT '-0.500000' NOT NULL,
  "return_clamp_max" numeric(12,6) DEFAULT 1.000000 NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  CONSTRAINT "mc_presets_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "mc_presets_key_unique" UNIQUE ("key")
);
--> statement-breakpoint
CREATE TABLE "mc_preset_glide_paths" (
  "id" serial NOT NULL,
  "preset_id" integer NOT NULL,
  "age" integer NOT NULL,
  "asset_class_id" integer NOT NULL,
  "allocation" numeric(12,6) NOT NULL,
  CONSTRAINT "mc_preset_glide_paths_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "mc_preset_glide_paths_asset_class_id_asset_class_params_id_fk"
    FOREIGN KEY ("asset_class_id") REFERENCES "asset_class_params"("id") ON DELETE cascade,
  CONSTRAINT "mc_preset_glide_paths_preset_id_mc_presets_id_fk"
    FOREIGN KEY ("preset_id") REFERENCES "mc_presets"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE "mc_preset_return_overrides" (
  "id" serial NOT NULL,
  "preset_id" integer NOT NULL,
  "asset_class_id" integer NOT NULL,
  "mean_return" numeric(12,6) NOT NULL,
  CONSTRAINT "mc_preset_return_overrides_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "mc_preset_return_overrides_asset_class_id_asset_class_params_id"
    FOREIGN KEY ("asset_class_id") REFERENCES "asset_class_params"("id") ON DELETE cascade,
  CONSTRAINT "mc_preset_return_overrides_preset_id_mc_presets_id_fk"
    FOREIGN KEY ("preset_id") REFERENCES "mc_presets"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE "mc_user_presets" (
  "id" serial NOT NULL,
  "name" text NOT NULL,
  "simulations" integer DEFAULT 1000 NOT NULL,
  "return_mean" numeric(12,6) NOT NULL,
  "return_std_dev" numeric(12,6) NOT NULL,
  "inflation_mean" numeric(12,6) NOT NULL,
  "inflation_std_dev" numeric(12,6) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "mc_user_presets_pkey" PRIMARY KEY ("id")
);
--> statement-breakpoint
CREATE TABLE "mortgage_loans" (
  "id" serial NOT NULL,
  "name" text NOT NULL,
  "is_active" boolean DEFAULT false NOT NULL,
  "refinanced_from_id" integer,
  "paid_off_date" date,
  "principal_and_interest" numeric(14,2) NOT NULL,
  "pmi" numeric(14,2) DEFAULT 0 NOT NULL,
  "insurance_and_taxes" numeric(14,2) DEFAULT 0 NOT NULL,
  "total_escrow" numeric(14,2) DEFAULT 0 NOT NULL,
  "interest_rate" numeric(8,6) NOT NULL,
  "term_years" integer NOT NULL,
  "original_loan_amount" numeric(14,2) NOT NULL,
  "first_payment_date" date NOT NULL,
  "property_value_purchase" numeric(14,2) NOT NULL,
  "property_value_estimated" numeric(14,2),
  "use_purchase_or_estimated" text DEFAULT 'purchase' NOT NULL,
  "api_balance" numeric(14,2),
  "api_balance_date" date,
  CONSTRAINT "mortgage_loans_pkey" PRIMARY KEY ("id")
);
--> statement-breakpoint
CREATE TABLE "mortgage_extra_payments" (
  "id" serial NOT NULL,
  "loan_id" integer NOT NULL,
  "payment_date" date,
  "start_date" date,
  "end_date" date,
  "amount" numeric(14,2) NOT NULL,
  "is_actual" boolean DEFAULT false NOT NULL,
  "notes" text,
  CONSTRAINT "mortgage_extra_payments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "mortgage_extra_payments_loan_id_mortgage_loans_id_fk"
    FOREIGN KEY ("loan_id") REFERENCES "mortgage_loans"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE "mortgage_what_if_scenarios" (
  "id" serial NOT NULL,
  "loan_id" integer,
  "label" text NOT NULL,
  "extra_monthly_principal" numeric(14,2) NOT NULL,
  "extra_one_time_payment" numeric(14,2) DEFAULT 0 NOT NULL,
  "refinance_rate" numeric(8,6),
  "refinance_term" integer,
  "sort_order" integer DEFAULT 0 NOT NULL,
  CONSTRAINT "mortgage_what_if_scenarios_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "mortgage_what_if_scenarios_loan_id_mortgage_loans_id_fk"
    FOREIGN KEY ("loan_id") REFERENCES "mortgage_loans"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE "net_worth_annual" (
  "id" serial NOT NULL,
  "year_end_date" date NOT NULL,
  "gross_income" numeric(14,2) DEFAULT 0 NOT NULL,
  "combined_agi" numeric(14,2) DEFAULT 0 NOT NULL,
  "ssa_earnings" numeric(14,2),
  "effective_tax_rate" numeric(8,6),
  "taxes_paid" numeric(14,2),
  "cash" numeric(14,2) DEFAULT 0 NOT NULL,
  "house_value" numeric(14,2) DEFAULT 0 NOT NULL,
  "retirement_total" numeric(14,2) DEFAULT 0 NOT NULL,
  "hsa" numeric(14,2) DEFAULT 0 NOT NULL,
  "lt_brokerage" numeric(14,2) DEFAULT 0 NOT NULL,
  "espp" numeric(14,2) DEFAULT 0 NOT NULL,
  "r_brokerage" numeric(14,2) DEFAULT 0 NOT NULL,
  "other_assets" numeric(14,2) DEFAULT 0 NOT NULL,
  "mortgage_balance" numeric(14,2) DEFAULT 0 NOT NULL,
  "other_liabilities" numeric(14,2) DEFAULT 0 NOT NULL,
  "tax_free_total" numeric(14,2) DEFAULT 0 NOT NULL,
  "tax_deferred_total" numeric(14,2) DEFAULT 0 NOT NULL,
  "portfolio_total" numeric(14,2) DEFAULT 0 NOT NULL,
  "property_taxes" numeric(14,2),
  "portfolio_by_tax_location" jsonb NOT NULL,
  CONSTRAINT "net_worth_annual_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "net_worth_annual_year_end_date_unique" UNIQUE ("year_end_date")
);
--> statement-breakpoint
CREATE TABLE "other_asset_items" (
  "id" serial NOT NULL,
  "name" text NOT NULL,
  "year" integer NOT NULL,
  "value" numeric(14,2) NOT NULL,
  "note" text,
  CONSTRAINT "other_asset_items_pkey" PRIMARY KEY ("id")
);
--> statement-breakpoint
CREATE TABLE "paycheck_deductions" (
  "id" serial NOT NULL,
  "job_id" integer NOT NULL,
  "deduction_name" text NOT NULL,
  "amount_per_period" numeric(14,2) NOT NULL,
  "is_pretax" boolean NOT NULL,
  "fica_exempt" boolean DEFAULT false NOT NULL,
  CONSTRAINT "paycheck_deductions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "paycheck_deductions_job_id_jobs_id_fk"
    FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE "pending_rollovers" (
  "id" serial NOT NULL,
  "source_account_performance_id" integer NOT NULL,
  "destination_performance_account_id" integer NOT NULL,
  "amount" numeric(14,2) NOT NULL,
  "sale_date" date NOT NULL,
  "sale_year" integer NOT NULL,
  "apply_year" integer NOT NULL,
  "notes" text,
  "confirmed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "pending_rollovers_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pending_rollovers_destination_performance_account_id_performanc"
    FOREIGN KEY ("destination_performance_account_id") REFERENCES "performance_accounts"("id") ON DELETE restrict,
  CONSTRAINT "pending_rollovers_source_account_performance_id_account_perform"
    FOREIGN KEY ("source_account_performance_id") REFERENCES "account_performance"("id") ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE "portfolio_accounts" (
  "id" serial NOT NULL,
  "snapshot_id" integer NOT NULL,
  "institution" text NOT NULL,
  "tax_type" text NOT NULL,
  "amount" numeric(14,2) NOT NULL,
  "account_type" text NOT NULL,
  "sub_type" text,
  "label" text,
  "parent_category" text DEFAULT 'Retirement' NOT NULL,
  "owner_person_id" integer,
  "performance_account_id" integer,
  "is_active" boolean DEFAULT true NOT NULL,
  CONSTRAINT "portfolio_accounts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "portfolio_accounts_parent_cat_check" CHECK (((parent_category = ANY (ARRAY['Retirement'::text, 'Portfolio'::text])))),
  CONSTRAINT "portfolio_accounts_owner_person_id_people_id_fk"
    FOREIGN KEY ("owner_person_id") REFERENCES "people"("id") ON DELETE restrict,
  CONSTRAINT "portfolio_accounts_performance_account_id_performance_accounts_"
    FOREIGN KEY ("performance_account_id") REFERENCES "performance_accounts"("id") ON DELETE set null,
  CONSTRAINT "portfolio_accounts_snapshot_id_portfolio_snapshots_id_fk"
    FOREIGN KEY ("snapshot_id") REFERENCES "portfolio_snapshots"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE "projection_overrides" (
  "id" serial NOT NULL,
  "override_type" text NOT NULL,
  "overrides" jsonb NOT NULL,
  "created_by" text,
  "updated_by" text,
  CONSTRAINT "projection_overrides_pkey" PRIMARY KEY ("id")
);
--> statement-breakpoint
CREATE TABLE "property_taxes" (
  "id" serial NOT NULL,
  "loan_id" integer NOT NULL,
  "year" integer NOT NULL,
  "assessed_value" numeric(14,2),
  "tax_amount" numeric(14,2) NOT NULL,
  "note" text,
  CONSTRAINT "property_taxes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "property_taxes_loan_id_mortgage_loans_id_fk"
    FOREIGN KEY ("loan_id") REFERENCES "mortgage_loans"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE "relocation_scenarios" (
  "id" serial NOT NULL,
  "name" text NOT NULL,
  "params" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "relocation_scenarios_pkey" PRIMARY KEY ("id")
);
--> statement-breakpoint
CREATE TABLE "retirement_budget_overrides" (
  "id" serial NOT NULL,
  "person_id" integer NOT NULL,
  "projection_year" integer NOT NULL,
  "override_monthly_budget" numeric(14,2) NOT NULL,
  "notes" text,
  "created_by" text,
  "updated_by" text,
  CONSTRAINT "retirement_budget_overrides_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "retirement_budget_overrides_person_id_people_id_fk"
    FOREIGN KEY ("person_id") REFERENCES "people"("id") ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE "retirement_salary_overrides" (
  "id" serial NOT NULL,
  "person_id" integer NOT NULL,
  "projection_year" integer NOT NULL,
  "override_salary" numeric(14,2) NOT NULL,
  "notes" text,
  "contribution_profile_id" integer,
  "created_by" text,
  "updated_by" text,
  CONSTRAINT "retirement_salary_overrides_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "retirement_salary_overrides_contribution_profile_id_contributio"
    FOREIGN KEY ("contribution_profile_id") REFERENCES "contribution_profiles"("id") ON DELETE set null,
  CONSTRAINT "retirement_salary_overrides_person_id_people_id_fk"
    FOREIGN KEY ("person_id") REFERENCES "people"("id") ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE "retirement_scenarios" (
  "id" serial NOT NULL,
  "name" text NOT NULL,
  "withdrawal_rate" numeric(8,6) NOT NULL,
  "target_annual_income" numeric(14,2) NOT NULL,
  "annual_inflation" numeric(8,6) NOT NULL,
  "distribution_tax_rate_traditional" numeric(8,6) DEFAULT 0.22 NOT NULL,
  "distribution_tax_rate_roth" numeric(8,6) DEFAULT 0 NOT NULL,
  "distribution_tax_rate_hsa" numeric(8,6) DEFAULT 0 NOT NULL,
  "distribution_tax_rate_brokerage" numeric(8,6) DEFAULT 0.15 NOT NULL,
  "is_lt_brokerage_enabled" boolean DEFAULT true NOT NULL,
  "lt_brokerage_annual_contribution" numeric(14,2) DEFAULT 0 NOT NULL,
  "is_selected" boolean DEFAULT false NOT NULL,
  "notes" text,
  CONSTRAINT "retirement_scenarios_pkey" PRIMARY KEY ("id")
);
--> statement-breakpoint
CREATE TABLE "retirement_settings" (
  "id" serial NOT NULL,
  "person_id" integer NOT NULL,
  "retirement_age" integer NOT NULL,
  "end_age" integer NOT NULL,
  "return_after_retirement" numeric(8,6) NOT NULL,
  "annual_inflation" numeric(8,6) NOT NULL,
  "post_retirement_inflation" numeric(8,6),
  "salary_annual_increase" numeric(8,6) NOT NULL,
  "salary_cap" numeric(14,2),
  "raises_during_retirement" boolean DEFAULT false NOT NULL,
  "withdrawal_rate" numeric(8,6) DEFAULT 0.04 NOT NULL,
  "tax_multiplier" numeric(8,6) DEFAULT 1.0 NOT NULL,
  "gross_up_for_taxes" boolean DEFAULT true NOT NULL,
  "roth_bracket_target" numeric(8,6) DEFAULT 0.12,
  "social_security_monthly" numeric(14,2) DEFAULT 2500 NOT NULL,
  "ss_start_age" integer DEFAULT 67 NOT NULL,
  "enable_roth_conversions" boolean DEFAULT false NOT NULL,
  "roth_conversion_target" numeric(8,6),
  "withdrawal_strategy" varchar(30) DEFAULT 'fixed'::character varying NOT NULL,
  "gk_upper_guardrail" numeric(8,6) DEFAULT 0.80,
  "gk_lower_guardrail" numeric(8,6) DEFAULT 1.20,
  "gk_increase_pct" numeric(8,6) DEFAULT 0.10,
  "gk_decrease_pct" numeric(8,6) DEFAULT 0.10,
  "gk_skip_inflation_after_loss" boolean DEFAULT true NOT NULL,
  "sd_annual_decline_rate" numeric(12,6) DEFAULT 0.02,
  "cp_withdrawal_percent" numeric(12,6) DEFAULT 0.05,
  "cp_floor_percent" numeric(12,6) DEFAULT 0.90,
  "en_withdrawal_percent" numeric(12,6) DEFAULT 0.05,
  "en_rolling_years" integer DEFAULT 10,
  "en_floor_percent" numeric(12,6) DEFAULT 0.90,
  "vd_base_percent" numeric(12,6) DEFAULT 0.05,
  "vd_ceiling_percent" numeric(12,6) DEFAULT 0.05,
  "vd_floor_percent" numeric(12,6) DEFAULT 0.025,
  "rmd_multiplier" numeric(12,6) DEFAULT 1.0,
  "enable_irmaa_awareness" boolean DEFAULT false NOT NULL,
  "enable_aca_awareness" boolean DEFAULT false NOT NULL,
  "household_size" integer DEFAULT 2 NOT NULL,
  "filing_status" varchar(10),
  CONSTRAINT "retirement_settings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "retirement_settings_person_id_unique" UNIQUE ("person_id"),
  CONSTRAINT "retirement_settings_person_id_people_id_fk"
    FOREIGN KEY ("person_id") REFERENCES "people"("id") ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE "return_rate_table" (
  "id" serial NOT NULL,
  "age" integer NOT NULL,
  "rate_of_return" numeric(8,6) NOT NULL,
  CONSTRAINT "return_rate_table_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "return_rate_table_age_unique" UNIQUE ("age")
);
--> statement-breakpoint
CREATE TABLE "salary_changes" (
  "id" serial NOT NULL,
  "job_id" integer NOT NULL,
  "effective_date" date NOT NULL,
  "new_salary" numeric(14,2) NOT NULL,
  "raise_percent" numeric(8,6),
  "notes" text,
  CONSTRAINT "salary_changes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "salary_changes_job_id_jobs_id_fk"
    FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE "savings_goals" (
  "id" serial NOT NULL,
  "name" text NOT NULL,
  "parent_goal_id" integer,
  "target_amount" numeric(14,2),
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
  "monthly_contribution" numeric(14,2) DEFAULT 0 NOT NULL,
  "allocation_percent" numeric(6,3),
  CONSTRAINT "savings_goals_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "savings_goals_name_unique" UNIQUE ("name"),
  CONSTRAINT "savings_goals_parent_goal_id_fk"
    FOREIGN KEY ("parent_goal_id") REFERENCES "savings_goals"("id") ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE "savings_allocation_overrides" (
  "id" serial NOT NULL,
  "goal_id" integer NOT NULL,
  "month_date" date NOT NULL,
  "amount" numeric(14,2) NOT NULL,
  "source" text DEFAULT 'manual' NOT NULL,
  CONSTRAINT "savings_allocation_overrides_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "savings_allocation_overrides_goal_id_savings_goals_id_fk"
    FOREIGN KEY ("goal_id") REFERENCES "savings_goals"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE "savings_monthly" (
  "id" serial NOT NULL,
  "goal_id" integer NOT NULL,
  "month_date" date NOT NULL,
  "balance" numeric(14,2) NOT NULL,
  "deposit_or_withdrawal" numeric(14,2),
  "notes" text,
  CONSTRAINT "savings_monthly_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "savings_monthly_goal_id_savings_goals_id_fk"
    FOREIGN KEY ("goal_id") REFERENCES "savings_goals"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE "savings_planned_transactions" (
  "id" serial NOT NULL,
  "goal_id" integer NOT NULL,
  "transaction_date" date NOT NULL,
  "amount" numeric(14,2) NOT NULL,
  "description" text NOT NULL,
  "is_recurring" boolean DEFAULT false NOT NULL,
  "recurrence_months" integer,
  "transfer_pair_id" text,
  CONSTRAINT "savings_planned_transactions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "savings_planned_transactions_goal_id_savings_goals_id_fk"
    FOREIGN KEY ("goal_id") REFERENCES "savings_goals"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE "scenarios" (
  "id" serial NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "overrides" jsonb DEFAULT '{}' NOT NULL,
  "is_baseline" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "scenarios_pkey" PRIMARY KEY ("id")
);
--> statement-breakpoint
CREATE TABLE "self_loans" (
  "id" serial NOT NULL,
  "from_goal_id" integer NOT NULL,
  "to_goal_id" integer,
  "amount" numeric(14,2) NOT NULL,
  "loan_date" date NOT NULL,
  "repaid_amount" numeric(14,2) DEFAULT 0 NOT NULL,
  "repaid_date" date,
  CONSTRAINT "self_loans_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "self_loans_from_goal_id_savings_goals_id_fk"
    FOREIGN KEY ("from_goal_id") REFERENCES "savings_goals"("id") ON DELETE restrict,
  CONSTRAINT "self_loans_to_goal_id_savings_goals_id_fk"
    FOREIGN KEY ("to_goal_id") REFERENCES "savings_goals"("id") ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE "state_versions" (
  "id" serial NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "version_type" text NOT NULL,
  "schema_version" text NOT NULL,
  "table_count" integer NOT NULL,
  "total_rows" integer NOT NULL,
  "size_estimate_bytes" integer,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_by" text NOT NULL,
  CONSTRAINT "state_versions_pkey" PRIMARY KEY ("id")
);
--> statement-breakpoint
CREATE TABLE "state_version_tables" (
  "id" serial NOT NULL,
  "version_id" integer NOT NULL,
  "table_name" text NOT NULL,
  "row_count" integer NOT NULL,
  "data" jsonb NOT NULL,
  CONSTRAINT "state_version_tables_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "state_version_tables_version_id_state_versions_id_fk"
    FOREIGN KEY ("version_id") REFERENCES "state_versions"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE "tax_brackets" (
  "id" serial NOT NULL,
  "tax_year" integer NOT NULL,
  "filing_status" text NOT NULL,
  "w4_checkbox" boolean NOT NULL,
  "brackets" jsonb NOT NULL,
  CONSTRAINT "tax_brackets_pkey" PRIMARY KEY ("id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "account_holdings_acct_snap_ticker_idx" ON "account_holdings" ("performance_account_id", "snapshot_id", "ticker");
--> statement-breakpoint
CREATE INDEX "account_holdings_asset_class_idx" ON "account_holdings" ("asset_class_id");
--> statement-breakpoint
CREATE INDEX "account_holdings_perf_acct_idx" ON "account_holdings" ("performance_account_id");
--> statement-breakpoint
CREATE INDEX "account_holdings_snapshot_idx" ON "account_holdings" ("snapshot_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "account_perf_year_inst_label_owner_idx" ON "account_performance" ("year", "institution", "account_label", "owner_person_id");
--> statement-breakpoint
CREATE INDEX "account_performance_is_active_idx" ON "account_performance" ("is_active");
--> statement-breakpoint
CREATE INDEX "account_performance_owner_id_idx" ON "account_performance" ("owner_person_id");
--> statement-breakpoint
CREATE INDEX "account_performance_perf_acct_idx" ON "account_performance" ("performance_account_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "annual_performance_year_cat_idx" ON "annual_performance" ("year", "category");
--> statement-breakpoint
CREATE INDEX "api_connections_linked_profile_id_idx" ON "api_connections" ("linked_profile_id");
--> statement-breakpoint
CREATE INDEX "asset_class_correlations_class_a_idx" ON "asset_class_correlations" ("class_a_id");
--> statement-breakpoint
CREATE INDEX "asset_class_correlations_class_b_idx" ON "asset_class_correlations" ("class_b_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "asset_class_correlations_pair_idx" ON "asset_class_correlations" ("class_a_id", "class_b_id");
--> statement-breakpoint
CREATE INDEX "asset_class_params_is_active_idx" ON "asset_class_params" ("is_active");
--> statement-breakpoint
CREATE INDEX "brokerage_goals_is_active_idx" ON "brokerage_goals" ("is_active");
--> statement-breakpoint
CREATE INDEX "brokerage_planned_tx_goal_id_idx" ON "brokerage_planned_transactions" ("goal_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "budget_api_cache_service_key_idx" ON "budget_api_cache" ("service", "cache_key");
--> statement-breakpoint
CREATE INDEX "budget_items_contribution_account_id_idx" ON "budget_items" ("contribution_account_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "budget_items_profile_cat_sub_idx" ON "budget_items" ("profile_id", "category", "subcategory");
--> statement-breakpoint
CREATE INDEX "budget_items_profile_id_idx" ON "budget_items" ("profile_id");
--> statement-breakpoint
CREATE INDEX "budget_profiles_is_active_idx" ON "budget_profiles" ("is_active");
--> statement-breakpoint
CREATE INDEX "change_log_changed_at_idx" ON "change_log" ("changed_at");
--> statement-breakpoint
CREATE INDEX "change_log_table_record_idx" ON "change_log" ("table_name", "record_id");
--> statement-breakpoint
CREATE INDEX "contribution_accounts_acct_type_idx" ON "contribution_accounts" ("account_type");
--> statement-breakpoint
CREATE INDEX "contribution_accounts_is_active_idx" ON "contribution_accounts" ("is_active");
--> statement-breakpoint
CREATE INDEX "contribution_accounts_job_id_idx" ON "contribution_accounts" ("job_id");
--> statement-breakpoint
CREATE INDEX "contribution_accounts_parent_cat_idx" ON "contribution_accounts" ("parent_category");
--> statement-breakpoint
CREATE INDEX "contribution_accounts_person_id_idx" ON "contribution_accounts" ("person_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "contribution_limits_year_type_idx" ON "contribution_limits" ("tax_year", "limit_type");
--> statement-breakpoint
CREATE UNIQUE INDEX "glide_path_age_class_idx" ON "glide_path_allocations" ("age", "asset_class_id");
--> statement-breakpoint
CREATE INDEX "glide_path_asset_class_idx" ON "glide_path_allocations" ("asset_class_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "historical_notes_year_field_idx" ON "historical_notes" ("year", "field");
--> statement-breakpoint
CREATE UNIQUE INDEX "irmaa_brackets_year_status_idx" ON "irmaa_brackets" ("tax_year", "filing_status");
--> statement-breakpoint
CREATE INDEX "jobs_person_id_idx" ON "jobs" ("person_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "ltcg_brackets_year_status_idx" ON "ltcg_brackets" ("tax_year", "filing_status");
--> statement-breakpoint
CREATE UNIQUE INDEX "mc_preset_gp_idx" ON "mc_preset_glide_paths" ("preset_id", "age", "asset_class_id");
--> statement-breakpoint
CREATE INDEX "mc_preset_gp_preset_idx" ON "mc_preset_glide_paths" ("preset_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "mc_preset_ro_idx" ON "mc_preset_return_overrides" ("preset_id", "asset_class_id");
--> statement-breakpoint
CREATE INDEX "mc_presets_is_active_idx" ON "mc_presets" ("is_active");
--> statement-breakpoint
CREATE INDEX "mortgage_extra_payments_loan_id_idx" ON "mortgage_extra_payments" ("loan_id");
--> statement-breakpoint
CREATE INDEX "mortgage_loans_is_active_idx" ON "mortgage_loans" ("is_active");
--> statement-breakpoint
CREATE INDEX "mortgage_what_if_loan_id_idx" ON "mortgage_what_if_scenarios" ("loan_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "other_asset_items_name_year_idx" ON "other_asset_items" ("name", "year");
--> statement-breakpoint
CREATE INDEX "paycheck_deductions_job_id_idx" ON "paycheck_deductions" ("job_id");
--> statement-breakpoint
CREATE INDEX "pending_rollovers_confirmed_idx" ON "pending_rollovers" ("confirmed_at");
--> statement-breakpoint
CREATE INDEX "pending_rollovers_dest_idx" ON "pending_rollovers" ("destination_performance_account_id");
--> statement-breakpoint
CREATE INDEX "pending_rollovers_sale_year_idx" ON "pending_rollovers" ("sale_year");
--> statement-breakpoint
CREATE INDEX "pending_rollovers_source_idx" ON "pending_rollovers" ("source_account_performance_id");
--> statement-breakpoint
CREATE INDEX "idx_perf_accounts_inst_label" ON "performance_accounts" ("institution", "account_label");
--> statement-breakpoint
CREATE INDEX "performance_accounts_category_idx" ON "performance_accounts" ("parent_category");
--> statement-breakpoint
CREATE UNIQUE INDEX "performance_accounts_inst_type_idx" ON "performance_accounts" ("institution", "account_type", "sub_type", "label", "owner_person_id");
--> statement-breakpoint
CREATE INDEX "performance_accounts_is_active_idx" ON "performance_accounts" ("is_active");
--> statement-breakpoint
CREATE INDEX "idx_portfolio_accounts_owner" ON "portfolio_accounts" ("owner_person_id");
--> statement-breakpoint
CREATE INDEX "portfolio_accounts_acct_type_idx" ON "portfolio_accounts" ("account_type");
--> statement-breakpoint
CREATE INDEX "portfolio_accounts_is_active_idx" ON "portfolio_accounts" ("is_active");
--> statement-breakpoint
CREATE INDEX "portfolio_accounts_owner_id_idx" ON "portfolio_accounts" ("owner_person_id");
--> statement-breakpoint
CREATE INDEX "portfolio_accounts_parent_cat_idx" ON "portfolio_accounts" ("parent_category");
--> statement-breakpoint
CREATE INDEX "portfolio_accounts_perf_acct_idx" ON "portfolio_accounts" ("performance_account_id");
--> statement-breakpoint
CREATE INDEX "portfolio_accounts_snapshot_id_idx" ON "portfolio_accounts" ("snapshot_id");
--> statement-breakpoint
CREATE INDEX "portfolio_snapshots_date_idx" ON "portfolio_snapshots" ("snapshot_date");
--> statement-breakpoint
CREATE UNIQUE INDEX "projection_overrides_type_idx" ON "projection_overrides" ("override_type");
--> statement-breakpoint
CREATE UNIQUE INDEX "property_taxes_loan_year_idx" ON "property_taxes" ("loan_id", "year");
--> statement-breakpoint
CREATE INDEX "retirement_budget_overrides_person_id_idx" ON "retirement_budget_overrides" ("person_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "retirement_budget_overrides_person_year_idx" ON "retirement_budget_overrides" ("person_id", "projection_year");
--> statement-breakpoint
CREATE INDEX "retirement_salary_overrides_person_id_idx" ON "retirement_salary_overrides" ("person_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "retirement_salary_overrides_person_year_idx" ON "retirement_salary_overrides" ("person_id", "projection_year");
--> statement-breakpoint
CREATE INDEX "retirement_settings_person_id_idx" ON "retirement_settings" ("person_id");
--> statement-breakpoint
CREATE INDEX "salary_changes_job_id_idx" ON "salary_changes" ("job_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "savings_alloc_override_goal_month_idx" ON "savings_allocation_overrides" ("goal_id", "month_date");
--> statement-breakpoint
CREATE INDEX "savings_goals_is_active_idx" ON "savings_goals" ("is_active");
--> statement-breakpoint
CREATE INDEX "savings_goals_parent_goal_id_idx" ON "savings_goals" ("parent_goal_id");
--> statement-breakpoint
CREATE INDEX "savings_monthly_goal_id_idx" ON "savings_monthly" ("goal_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "savings_monthly_goal_month_idx" ON "savings_monthly" ("goal_id", "month_date");
--> statement-breakpoint
CREATE INDEX "savings_planned_tx_goal_id_idx" ON "savings_planned_transactions" ("goal_id");
--> statement-breakpoint
CREATE INDEX "self_loans_from_goal_id_idx" ON "self_loans" ("from_goal_id");
--> statement-breakpoint
CREATE INDEX "self_loans_to_goal_id_idx" ON "self_loans" ("to_goal_id");
--> statement-breakpoint
CREATE INDEX "state_version_tables_version_id_idx" ON "state_version_tables" ("version_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "state_version_tables_version_table_idx" ON "state_version_tables" ("version_id", "table_name");
--> statement-breakpoint
CREATE INDEX "state_versions_created_at_idx" ON "state_versions" ("created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "tax_brackets_year_status_checkbox_idx" ON "tax_brackets" ("tax_year", "filing_status", "w4_checkbox");
--> statement-breakpoint
UPDATE "annual_performance" SET "is_immutable" = true WHERE "is_finalized" = true;
