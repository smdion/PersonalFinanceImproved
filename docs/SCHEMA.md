# Database Schema

> **Auto-generated** by `scripts/gen-api-docs.ts` (`scripts/gen-schema-docs.ts`) from drizzle's own table config of `src/lib/db/schema-pg.ts`. Do not edit by hand. Run `pnpm docs:update` to regenerate.

**84 tables.** The PostgreSQL schema; the SQLite schema is generated from it (`scripts/gen-sqlite-schema.ts`). A jsonb column's shapes are listed in `scripts/schema-jsonb-shapes.ts`.

## Schema version

**Schema version: `0023_v0111_lump_sum_targets`** (the latest tag in both `drizzle/meta/_journal.json` and `drizzle-sqlite/meta/_journal.json`).

| Tag  | Name                      | PostgreSQL | SQLite |
| ---- | ------------------------- | ---------- | ------ |
| 0000 | v9_initial_schema         | yes        | yes    |
| 0001 | v090_tax_data_origin      | yes        | yes    |
| 0002 | v090_tax_data_updates     | yes        | yes    |
| 0003 | v090_utility_feed         | yes        | yes    |
| 0004 | v090_debts                | yes        | yes    |
| 0005 | v092_filing_status_auto   | yes        | yes    |
| 0006 | v095_milestones           | yes        | yes    |
| 0007 | v095_redact_change_log    | yes        | yes    |
| 0008 | v095_irmaa_budget         | yes        | yes    |
| 0009 | v095_holding_reports      | yes        | yes    |
| 0010 | v095_market_closes        | yes        | yes    |
| 0011 | v096_budget_mortgage_link | yes        | yes    |
| 0012 | v096_gap_year_settings    | yes        | yes    |
| 0013 | v097_loan_feed            | yes        | yes    |
| 0014 | v0102_display_name_custom | yes        | yes    |
| 0015 | v0102_dead_data           | yes        | yes    |
| 0016 | v0102_match_rate          | yes        | yes    |
| 0017 | v0102_match_value         | yes        | yes    |
| 0018 | v0106_money               | yes        | yes    |
| 0019 | v0106_credentials         | yes        | yes    |
| 0020 | v0106_stored_json         | yes        | yes    |
| 0021 | v0110_job_entries         | yes        | yes    |
| 0022 | v0111_roth_overlay        | yes        | yes    |
| 0023 | v0111_lump_sum_targets    | yes        | yes    |

## Relations

Each line is a foreign key, labelled by its column; `o|` marks one that may be null.

```mermaid
erDiagram
  account_basis {
    serial id PK
    integer performance_account_id FK
    integer owner_person_id FK
    integer year
    numeric_14_2 contribution_basis
    numeric_14_2 conversion_basis
    integer latest_conversion_year
    boolean is_finalized
    boolean is_seeded
    timestamptz updated_at
    text notes
  }
  account_performance {
    serial id PK
    integer year
    text institution
    text account_label
    integer owner_person_id FK
    numeric_14_2 beginning_balance
    numeric_14_2 total_contributions
    numeric_14_2 yearly_gain_loss
    numeric_14_2 ending_balance
    numeric_8_6 annual_return_pct
    numeric_14_2 employer_contributions
    numeric_14_2 fees
    numeric_14_2 distributions
    numeric_14_2 rollovers
    text parent_category
    boolean is_active
    boolean is_finalized
    integer performance_account_id FK
    text note
    jsonb estimated_fields
    jsonb accepted_checks
  }
  annual_performance {
    serial id PK
    integer year
    text category
    numeric_14_2 beginning_balance
    numeric_14_2 total_contributions
    numeric_14_2 yearly_gain_loss
    numeric_14_2 ending_balance
    numeric_8_6 annual_return_pct
    numeric_14_2 employer_contributions
    numeric_14_2 distributions
    numeric_14_2 fees
    numeric_14_2 rollovers
    numeric_14_2 lifetime_gains
    numeric_14_2 lifetime_contributions
    numeric_14_2 lifetime_match
    boolean is_current_year
    boolean is_finalized
    boolean is_immutable
  }
  api_connections {
    serial id PK
    text service UK
    jsonb config
    jsonb account_mappings
    jsonb skipped_category_ids
    integer linked_profile_id
    integer linked_column_index
    integer server_knowledge
    timestamptz last_synced_at
  }
  app_settings {
    serial id PK
    text key UK
    jsonb value
  }
  asset_class_buckets {
    text bucket PK
    integer asset_class_id FK
  }
  asset_class_correlations {
    serial id PK
    integer class_a_id FK
    integer class_b_id FK
    numeric_12_6 correlation
  }
  asset_class_params {
    serial id PK
    text name UK
    numeric_12_6 mean_return
    numeric_12_6 std_dev
    integer sort_order
    boolean is_active
  }
  brokerage_goals {
    serial id PK
    text name
    numeric_14_2 target_amount
    integer target_year
    integer priority
    boolean is_active
    text notes
    timestamptz created_at
  }
  brokerage_planned_transactions {
    serial id PK
    integer goal_id FK
    date transaction_date
    numeric_14_2 amount
    text description
    boolean is_recurring
    integer recurrence_months
  }
  budget_api_cache {
    serial id PK
    text service
    text cache_key
    jsonb data
    integer server_knowledge
    timestamptz fetched_at
  }
  budget_income_adjustments {
    serial id PK
    integer job_id FK
    date month_date
    numeric_12_2 amount
    text source
  }
  budget_item_category_links {
    serial id PK
    integer budget_item_id FK
    text service
    text category_id
    text category_name
    timestamptz last_synced_at
    text sync_direction
  }
  budget_items {
    serial id PK
    integer profile_id FK
    text category
    text subcategory
    jsonb amounts
    text api_category_name
    text api_category_id
    timestamptz api_last_synced_at
    text api_sync_direction
    integer contribution_account_id FK
    integer mortgage_loan_id FK
    boolean is_essential
    integer sort_order
  }
  budget_profiles {
    serial id PK
    text name UK
    text description
    jsonb column_labels
    jsonb column_months
    boolean is_active
    timestamptz created_at
  }
  change_log {
    serial id PK
    text table_name
    integer record_id
    text field_name
    jsonb old_value
    jsonb new_value
    text changed_by
    timestamptz changed_at
  }
  contribution_accounts {
    serial id PK
    integer job_id FK
    integer person_id FK
    text account_type
    text sub_type
    text label
    text parent_category
    text tax_treatment
    text employer_match_type
    numeric_14_2 employer_match_value
    numeric_12_6 employer_match_rate
    numeric_8_6 employer_max_match_pct
    text employer_match_tax_treatment
    text hsa_coverage_type
    boolean auto_maximize
    boolean is_active
    text ownership
    integer performance_account_id FK
    numeric_14_2 target_annual
    integer allocation_priority
    text notes
    boolean is_payroll_deducted
    numeric_14_2 prior_year_contrib_amount
    integer prior_year_contrib_year
  }
  contribution_limits {
    serial id PK
    integer tax_year
    text limit_type
    numeric_12_6 value
    text notes
    text origin
    integer source_version
    timestamptz confirmed_at
  }
  contribution_profiles {
    serial id PK
    text name UK
    text description
    jsonb contribution_active_fields
    timestamptz created_at
  }
  debts {
    serial id PK
    text name
    text kind
    integer owner_person_id FK
    numeric_14_2 balance
    date balance_as_of
    numeric_14_2 original_amount
    numeric_8_6 interest_rate
    numeric_14_2 monthly_payment
    date opened_date
    date paid_off_date
    text notes
    integer sort_order
    numeric_14_2 purchase_price
    integer term_months
    numeric_14_2 api_balance
    date api_balance_date
  }
  fpl_by_household {
    serial id PK
    integer tax_year UK
    jsonb amounts
    text origin
    integer source_version
    timestamptz confirmed_at
  }
  glide_path_allocations {
    serial id PK
    integer age
    integer asset_class_id FK
    numeric_12_6 allocation
  }
  historical_notes {
    serial id PK
    integer year
    text field
    text note
  }
  historical_salaries {
    serial id PK
    integer person_id FK
    integer year
    numeric_14_2 salary
    numeric_14_2 bonus
  }
  holding_observations {
    serial id PK
    integer simplefin_account_id FK
    integer security_id FK
    timestamptz balance_date
    date as_of
    numeric_20_8 shares
    numeric_14_2 reported_market_value
    numeric_20_8 avg_cost_per_share
    text source
    timestamptz created_at
  }
  holding_period_weights {
    serial id PK
    integer holding_period_id FK
    integer security_id FK
    numeric_12_6 weight
  }
  holding_periods {
    serial id PK
    integer performance_account_id FK
    text sub_key
    date start_date
    date end_date
    text basis
    numeric_12_6 fit_quality
    text notes
    timestamptz created_at
    timestamptz updated_at
  }
  home_improvement_items {
    serial id PK
    integer year
    text description
    numeric_14_2 cost
    text note
  }
  investment_transactions {
    serial id PK
    integer simplefin_account_id FK
    text external_id
    date posted
    date transacted
    numeric_14_2 amount
    text description
    boolean pending
    text kind_override
    timestamptz voided_at
    timestamptz first_seen_at
    timestamptz updated_at
  }
  irmaa_brackets {
    serial id PK
    integer tax_year
    text filing_status
    jsonb brackets
    text origin
    integer source_version
    timestamptz confirmed_at
  }
  jobs {
    serial id PK
    integer person_id FK
    text employer_name
    text title
    date start_date
    date end_date
    boolean is_speculative
  }
  local_admins {
    serial id PK
    text email UK
    text password_hash
    text name
    timestamptz created_at
  }
  ltcg_brackets {
    serial id PK
    integer tax_year
    text filing_status
    jsonb brackets
    text origin
    integer source_version
    timestamptz confirmed_at
  }
  market_closes {
    serial id PK
    text ticker
    date date
    numeric_18_6 close
    numeric_18_6 div_cash
    numeric_18_8 split_factor
    timestamptz fetched_at
  }
  mc_preset_glide_paths {
    serial id PK
    integer preset_id FK
    integer age
    integer asset_class_id FK
    numeric_12_6 allocation
  }
  mc_preset_return_overrides {
    serial id PK
    integer preset_id FK
    integer asset_class_id FK
    numeric_12_6 mean_return
  }
  mc_presets {
    serial id PK
    text key UK
    text label
    text description
    numeric_12_6 return_multiplier
    numeric_12_6 vol_multiplier
    numeric_12_6 inflation_mean
    numeric_12_6 inflation_std_dev
    integer default_trials
    numeric_12_6 return_clamp_min
    numeric_12_6 return_clamp_max
    integer sort_order
    boolean is_active
  }
  mc_user_presets {
    serial id PK
    text name
    integer simulations
    numeric_12_6 return_mean
    numeric_12_6 return_std_dev
    numeric_12_6 inflation_mean
    numeric_12_6 inflation_std_dev
    timestamptz created_at
    timestamptz updated_at
  }
  mortgage_extra_payments {
    serial id PK
    integer loan_id FK
    date payment_date
    date start_date
    date end_date
    numeric_14_2 amount
    boolean is_actual
    text notes
  }
  mortgage_loans {
    serial id PK
    text name
    boolean is_active
    integer refinanced_from_id FK
    date paid_off_date
    numeric_14_2 principal_and_interest
    numeric_14_2 pmi
    numeric_14_2 insurance_and_taxes
    numeric_14_2 total_escrow
    numeric_8_6 interest_rate
    integer term_years
    numeric_14_2 original_loan_amount
    date first_payment_date
    numeric_14_2 property_value_purchase
    numeric_14_2 property_value_estimated
    text use_purchase_or_estimated
    numeric_14_2 api_balance
    date api_balance_date
  }
  mortgage_what_if_scenarios {
    serial id PK
    integer loan_id FK
    text label
    numeric_14_2 extra_monthly_principal
    numeric_14_2 extra_one_time_payment
    numeric_8_6 refinance_rate
    integer refinance_term
    integer sort_order
  }
  net_worth_annual {
    serial id PK
    date year_end_date UK
    numeric_14_2 gross_income
    numeric_14_2 combined_agi
    numeric_14_2 ssa_earnings
    numeric_8_6 effective_tax_rate
    numeric_14_2 taxes_paid
    numeric_14_2 cash
    numeric_14_2 house_value
    numeric_14_2 retirement_total
    numeric_14_2 hsa
    numeric_14_2 lt_brokerage
    numeric_14_2 espp
    numeric_14_2 r_brokerage
    numeric_14_2 other_assets
    numeric_14_2 mortgage_balance
    numeric_14_2 other_liabilities
    numeric_14_2 tax_free_total
    numeric_14_2 tax_deferred_total
    numeric_14_2 portfolio_total
    numeric_14_2 property_taxes
    jsonb portfolio_by_tax_location
  }
  other_asset_items {
    serial id PK
    text name
    integer year
    numeric_14_2 value
    text note
  }
  paycheck_deductions {
    serial id PK
    integer job_id FK
    text deduction_name
    boolean is_pretax
    boolean fica_exempt
  }
  paycheck_earnings {
    serial id PK
    integer job_id FK
    text earning_name
    boolean is_cash
    boolean federal_taxable
    boolean fica_taxable
  }
  people {
    serial id PK
    text name
    date date_of_birth
    boolean is_primary_user
  }
  performance_accounts {
    serial id PK
    text institution
    text account_type
    text sub_type
    text label
    text account_label
    text display_name
    integer owner_person_id FK
    text ownership_type
    text retirement_behavior
    text contribution_scaling
    numeric_14_2 cost_basis
    date separation_date
    boolean allow_penalized_withdrawals
    text parent_category
    boolean is_active
    integer display_order
    timestamptz created_at
  }
  portfolio_accounts {
    serial id PK
    integer snapshot_id FK
    text institution
    text tax_type
    numeric_14_2 amount
    text account_type
    text sub_type
    text label
    text parent_category
    integer owner_person_id FK
    integer performance_account_id FK
    boolean is_active
  }
  portfolio_snapshots {
    serial id PK
    date snapshot_date UK
    timestamptz created_at
    text notes
  }
  projection_cache {
    serial id PK
    text input_hash
    integer seed
    jsonb result
    timestamptz computed_at
    timestamptz expires_at
    timestamptz last_read_at
    integer engine_version
  }
  projection_overrides {
    serial id PK
    text override_type UK
    jsonb overrides
    text created_by
    text updated_by
  }
  property_taxes {
    serial id PK
    integer loan_id FK
    integer year
    numeric_14_2 assessed_value
    numeric_14_2 tax_amount
    text note
  }
  relocation_scenarios {
    serial id PK
    text name
    jsonb params
    timestamptz created_at
    timestamptz updated_at
  }
  retirement_budget_overrides {
    serial id PK
    integer person_id FK
    integer projection_year
    numeric_14_2 override_monthly_budget
    text notes
    text created_by
    text updated_by
  }
  retirement_profile_people {
    serial id PK
    integer profile_id FK
    integer person_id FK
    integer retirement_age
    integer end_age
    numeric_14_2 social_security_monthly
    numeric_14_2 social_security_pia
    integer ss_start_age
    boolean rule_of_55_override
    numeric_8_6 salary_annual_increase
  }
  retirement_profiles {
    serial id PK
    text name UK
    text description
    integer tax_params_year
    timestamptz created_at
  }
  retirement_salary_overrides {
    serial id PK
    integer person_id FK
    integer projection_year
    numeric_14_2 override_salary
    integer contribution_profile_id FK
    integer salary_profile_id FK
    text notes
    text created_by
    text updated_by
  }
  retirement_scenarios {
    serial id PK
    text name
    numeric_8_6 withdrawal_rate
    numeric_14_2 target_annual_income
    numeric_8_6 annual_inflation
    numeric_8_6 distribution_tax_rate_traditional
    numeric_8_6 distribution_tax_rate_roth
    numeric_8_6 distribution_tax_rate_hsa
    numeric_8_6 distribution_tax_rate_brokerage
    boolean is_lt_brokerage_enabled
    numeric_14_2 lt_brokerage_annual_contribution
    boolean is_selected
    text notes
  }
  retirement_settings {
    serial id PK
    integer person_id FK
    integer retirement_age
    integer end_age
    numeric_8_6 return_after_retirement
    numeric_8_6 annual_inflation
    numeric_8_6 post_retirement_inflation
    numeric_8_6 salary_annual_increase
    numeric_14_2 salary_cap
    boolean raises_during_retirement
    boolean rule_of_55_override
    numeric_8_6 withdrawal_rate
    numeric_8_6 tax_multiplier
    boolean gross_up_for_taxes
    numeric_8_6 roth_bracket_target
    boolean roth_bracket_overlay
    numeric_14_2 social_security_monthly
    integer ss_start_age
    boolean enable_roth_conversions
    numeric_8_6 roth_conversion_target
    varchar_30 withdrawal_strategy
    varchar_20 discretionary_withdrawal_order
    varchar_20 withdrawal_routing_mode
    jsonb withdrawal_order
    jsonb withdrawal_splits
    numeric_8_6 gk_upper_guardrail
    numeric_8_6 gk_lower_guardrail
    numeric_8_6 gk_increase_pct
    numeric_8_6 gk_decrease_pct
    boolean gk_skip_inflation_after_loss
    numeric_12_6 sd_annual_decline_rate
    numeric_12_6 cp_withdrawal_percent
    numeric_12_6 cp_floor_percent
    numeric_12_6 en_withdrawal_percent
    integer en_rolling_years
    numeric_12_6 en_floor_percent
    numeric_12_6 vd_base_percent
    numeric_12_6 vd_ceiling_percent
    numeric_12_6 vd_floor_percent
    numeric_12_6 rmd_multiplier
    numeric_12_6 vpw_cap
    integer vpw_end_age
    boolean cp_ss_in_amount
    boolean en_ss_in_amount
    boolean vd_ss_in_amount
    boolean rmd_ss_in_amount
    boolean vpw_ss_in_amount
    varchar_20 rmd_excess_handling
    integer rmd_excess_target_performance_account_id FK
    boolean qcd_maximize
    boolean rmd_smoothing_enabled
    numeric_8_6 rmd_smoothing_max_bracket_target
    boolean enable_irmaa_awareness
    boolean gap_year_stop_saving
    boolean gap_year_draws
    boolean irmaa_on_top_of_budget
    boolean enable_aca_awareness
    integer household_size
    text filing_status
    integer profile_id FK
    numeric_8_6 distribution_tax_rate_traditional
    numeric_8_6 distribution_tax_rate_roth
    numeric_8_6 distribution_tax_rate_hsa
    numeric_8_6 distribution_tax_rate_brokerage
  }
  return_rate_table {
    serial id PK
    integer age UK
    numeric_8_6 rate_of_return
  }
  salary_profiles {
    serial id PK
    text name UK
    text description
    jsonb salaries
    timestamptz created_at
  }
  savings_allocation_overrides {
    serial id PK
    integer goal_id FK
    date month_date
    numeric_14_2 amount
    text source
  }
  savings_goal_category_links {
    serial id PK
    integer savings_goal_id FK
    text service
    text role
    text category_id
    text category_name
    timestamptz last_synced_at
  }
  savings_goal_profile_allocations {
    serial id PK
    integer goal_id FK
    integer budget_profile_id FK
    numeric_6_3 allocation_percent
    numeric_14_2 monthly_contribution
  }
  savings_goals {
    serial id PK
    text name UK
    integer parent_goal_id FK
    numeric_14_2 target_amount
    integer target_months
    date target_date
    integer priority
    boolean is_active
    boolean is_emergency_fund
    text api_category_id
    text api_category_name
    boolean is_api_sync_enabled
    text reimbursement_api_category_id
    text target_mode
  }
  savings_monthly {
    serial id PK
    integer goal_id FK
    date month_date
    numeric_14_2 balance
    numeric_14_2 deposit_or_withdrawal
    text notes
  }
  savings_planned_transactions {
    serial id PK
    integer goal_id FK
    date transaction_date
    numeric_14_2 amount
    text description
    boolean is_recurring
    integer recurrence_months
    text transfer_pair_id
    text source
  }
  savings_planned_tx_settlements {
    serial id PK
    integer planned_tx_id FK
    date occurrence_month
    timestamptz settled_at
  }
  scenarios {
    serial id PK
    text name UK
    text description
    integer budget_profile_id FK
    integer contribution_profile_id FK
    integer salary_profile_id FK
    integer retirement_profile_id FK
    timestamptz created_at
    timestamptz updated_at
  }
  sec_filing_cache {
    text accession PK
    text series_id
    date period_end
    numeric_12_6 us_equity_pct
    numeric_12_6 intl_equity_pct
    numeric_12_6 us_bond_pct
    numeric_12_6 intl_bond_pct
    numeric_12_6 tips_pct
    numeric_12_6 cash_pct
    numeric_12_6 other_pct
    numeric_12_6 coverage
    timestamptz fetched_at
  }
  securities {
    serial id PK
    text ticker
    text source_symbol
    text name
    text kind
    text institution
    text source_description
    text sec_series_id
    text sec_class_id
    text facts_series_id
    text facts_class_id
    text facts_series_name
    text facts_basis
    timestamptz standin_confirmed_at
    jsonb standin_preview
    timestamptz facts_checked_at
    timestamptz created_at
  }
  security_facts {
    serial id PK
    integer security_id FK
    date as_of
    text source
    text sec_series_id
    text accession
    numeric_12_6 expense_ratio
    numeric_12_6 us_equity_pct
    numeric_12_6 intl_equity_pct
    numeric_12_6 us_bond_pct
    numeric_12_6 intl_bond_pct
    numeric_12_6 tips_pct
    numeric_12_6 cash_pct
    numeric_12_6 other_pct
    numeric_12_6 coverage
    timestamptz fetched_at
  }
  self_loans {
    serial id PK
    integer from_goal_id FK
    integer to_goal_id FK
    numeric_14_2 amount
    date loan_date
    numeric_14_2 repaid_amount
    date repaid_date
  }
  simplefin_account_balances {
    serial id PK
    integer simplefin_account_id FK
    timestamptz balance_date
    numeric_14_2 balance
    timestamptz created_at
  }
  simplefin_accounts {
    serial id PK
    text external_account_id UK
    text org_name
    text account_name
    numeric_14_2 last_balance
    timestamptz last_balance_date
    boolean is_included
    timestamptz last_seen_at
    integer linked_performance_account_id FK
    text linked_sub_key
    integer linked_loan_id FK, UK
  }
  simplefin_balance_snapshots {
    serial id PK
    date snapshot_date UK
    numeric_14_2 total_balance
    integer account_count
    timestamptz created_at
  }
  state_version_tables {
    serial id PK
    integer version_id FK
    text table_name
    integer row_count
    jsonb data
  }
  state_versions {
    serial id PK
    text name
    text description
    text version_type
    text schema_version
    integer table_count
    integer total_rows
    integer size_estimate_bytes
    timestamptz created_at
    text created_by
  }
  sync_request_log {
    serial id PK
    text service
    timestamptz requested_at
    text endpoint
    integer http_status
    text outcome
  }
  tax_brackets {
    serial id PK
    integer tax_year
    text filing_status
    boolean w4_checkbox
    jsonb brackets
    text origin
    integer source_version
    timestamptz confirmed_at
  }
  tax_data_updates {
    integer data_version PK
    text file_text
    text signature
    timestamptz fetched_at
    text status
    text decided_by
    timestamptz decided_at
  }
  tax_params {
    serial id PK
    integer tax_year UK
    integer version
    text source
    text notes
    timestamptz updated_at
  }
  utility_reading {
    serial id PK
    integer service_id FK
    integer year
    integer month
    numeric_14_2 cost
    numeric_14_4 usage
    text note
    text source
  }
  utility_service {
    serial id PK
    text kind UK
    text provider_name
    text usage_unit
    integer sort_order
    boolean active
    text budget_api_category_id
    integer billing_lag_months
  }
  account_basis }o--|| performance_accounts : "performance_account_id"
  account_basis }o--|| people : "owner_person_id"
  account_performance }o--o| people : "owner_person_id"
  account_performance }o--|| performance_accounts : "performance_account_id"
  asset_class_buckets }o--|| asset_class_params : "asset_class_id"
  asset_class_correlations }o--|| asset_class_params : "class_a_id"
  asset_class_correlations }o--|| asset_class_params : "class_b_id"
  brokerage_planned_transactions }o--|| brokerage_goals : "goal_id"
  budget_income_adjustments }o--|| jobs : "job_id"
  budget_item_category_links }o--|| budget_items : "budget_item_id"
  budget_items }o--|| budget_profiles : "profile_id"
  budget_items }o--o| contribution_accounts : "contribution_account_id"
  budget_items }o--o| mortgage_loans : "mortgage_loan_id"
  contribution_accounts }o--o| jobs : "job_id"
  contribution_accounts }o--o| people : "person_id"
  contribution_accounts }o--o| performance_accounts : "performance_account_id"
  debts }o--o| people : "owner_person_id"
  glide_path_allocations }o--|| asset_class_params : "asset_class_id"
  historical_salaries }o--|| people : "person_id"
  holding_observations }o--|| simplefin_accounts : "simplefin_account_id"
  holding_observations }o--|| securities : "security_id"
  holding_period_weights }o--|| holding_periods : "holding_period_id"
  holding_period_weights }o--|| securities : "security_id"
  holding_periods }o--|| performance_accounts : "performance_account_id"
  investment_transactions }o--|| simplefin_accounts : "simplefin_account_id"
  jobs }o--|| people : "person_id"
  mc_preset_glide_paths }o--|| mc_presets : "preset_id"
  mc_preset_glide_paths }o--|| asset_class_params : "asset_class_id"
  mc_preset_return_overrides }o--|| mc_presets : "preset_id"
  mc_preset_return_overrides }o--|| asset_class_params : "asset_class_id"
  mortgage_extra_payments }o--|| mortgage_loans : "loan_id"
  mortgage_loans }o--o| mortgage_loans : "refinanced_from_id"
  mortgage_what_if_scenarios }o--o| mortgage_loans : "loan_id"
  paycheck_deductions }o--|| jobs : "job_id"
  paycheck_earnings }o--|| jobs : "job_id"
  performance_accounts }o--o| people : "owner_person_id"
  portfolio_accounts }o--|| portfolio_snapshots : "snapshot_id"
  portfolio_accounts }o--o| people : "owner_person_id"
  portfolio_accounts }o--o| performance_accounts : "performance_account_id"
  property_taxes }o--|| mortgage_loans : "loan_id"
  retirement_budget_overrides }o--|| people : "person_id"
  retirement_profile_people }o--|| retirement_profiles : "profile_id"
  retirement_profile_people }o--|| people : "person_id"
  retirement_salary_overrides }o--|| people : "person_id"
  retirement_salary_overrides }o--o| contribution_profiles : "contribution_profile_id"
  retirement_salary_overrides }o--o| salary_profiles : "salary_profile_id"
  retirement_settings }o--|| people : "person_id"
  retirement_settings }o--o| performance_accounts : "rmd_excess_target_performance_account_id"
  retirement_settings }o--o| retirement_profiles : "profile_id"
  savings_allocation_overrides }o--|| savings_goals : "goal_id"
  savings_goal_category_links }o--|| savings_goals : "savings_goal_id"
  savings_goal_profile_allocations }o--|| savings_goals : "goal_id"
  savings_goal_profile_allocations }o--|| budget_profiles : "budget_profile_id"
  savings_goals }o--o| savings_goals : "parent_goal_id"
  savings_monthly }o--|| savings_goals : "goal_id"
  savings_planned_transactions }o--|| savings_goals : "goal_id"
  savings_planned_tx_settlements }o--|| savings_planned_transactions : "planned_tx_id"
  scenarios }o--o| budget_profiles : "budget_profile_id"
  scenarios }o--o| contribution_profiles : "contribution_profile_id"
  scenarios }o--o| salary_profiles : "salary_profile_id"
  scenarios }o--o| retirement_profiles : "retirement_profile_id"
  security_facts }o--|| securities : "security_id"
  self_loans }o--|| savings_goals : "from_goal_id"
  self_loans }o--o| savings_goals : "to_goal_id"
  simplefin_account_balances }o--|| simplefin_accounts : "simplefin_account_id"
  simplefin_accounts }o--o| performance_accounts : "linked_performance_account_id"
  simplefin_accounts }o--o| mortgage_loans : "linked_loan_id"
  state_version_tables }o--|| state_versions : "version_id"
  utility_reading }o--|| utility_service : "service_id"
```

## Tables

### account_basis

| Column                 | Type                     | Not null | Default | Notes                                            |
| ---------------------- | ------------------------ | -------- | ------- | ------------------------------------------------ |
| id                     | serial                   | yes      |         | PK                                               |
| performance_account_id | integer                  | yes      |         | FK → performance_accounts.id (on delete cascade) |
| owner_person_id        | integer                  | yes      |         | FK → people.id (on delete restrict)              |
| year                   | integer                  | yes      |         |                                                  |
| contribution_basis     | numeric(14, 2)           | yes      | `'0'`   |                                                  |
| conversion_basis       | numeric(14, 2)           | yes      | `'0'`   |                                                  |
| latest_conversion_year | integer                  |          |         |                                                  |
| is_finalized           | boolean                  | yes      | `false` |                                                  |
| is_seeded              | boolean                  | yes      | `false` |                                                  |
| updated_at             | timestamp with time zone | yes      | `now()` |                                                  |
| notes                  | text                     |          |         |                                                  |

- Unique: (performance_account_id, owner_person_id, year)

### account_performance

| Column                 | Type           | Not null | Default | Notes                                             |
| ---------------------- | -------------- | -------- | ------- | ------------------------------------------------- |
| id                     | serial         | yes      |         | PK                                                |
| year                   | integer        | yes      |         |                                                   |
| institution            | text           | yes      |         |                                                   |
| account_label          | text           | yes      |         |                                                   |
| owner_person_id        | integer        |          |         | FK → people.id (on delete restrict)               |
| beginning_balance      | numeric(14, 2) | yes      |         |                                                   |
| total_contributions    | numeric(14, 2) | yes      |         |                                                   |
| yearly_gain_loss       | numeric(14, 2) | yes      |         |                                                   |
| ending_balance         | numeric(14, 2) | yes      |         |                                                   |
| annual_return_pct      | numeric(8, 6)  |          |         |                                                   |
| employer_contributions | numeric(14, 2) | yes      | `'0'`   |                                                   |
| fees                   | numeric(14, 2) | yes      | `'0'`   |                                                   |
| distributions          | numeric(14, 2) | yes      | `'0'`   |                                                   |
| rollovers              | numeric(14, 2) | yes      | `'0'`   |                                                   |
| parent_category        | text           | yes      |         |                                                   |
| is_active              | boolean        | yes      | `true`  |                                                   |
| is_finalized           | boolean        | yes      | `false` |                                                   |
| performance_account_id | integer        | yes      |         | FK → performance_accounts.id (on delete restrict) |
| note                   | text           |          |         |                                                   |
| estimated_fields       | jsonb          | yes      | `[]`    | shape below                                       |
| accepted_checks        | jsonb          | yes      | `{}`    | shape below                                       |

- Unique: (year, institution, account_label, owner_person_id)
- `estimated_fields`: type `string[]`; read through `parseEstimatedFields` (lib/pure/investments/performance-annotations.ts)
- `accepted_checks`: type `Record<string, unknown>`; read through `parseAcceptedChecks` (lib/pure/investments/performance-annotations.ts)

### annual_performance

| Column                 | Type           | Not null | Default | Notes |
| ---------------------- | -------------- | -------- | ------- | ----- |
| id                     | serial         | yes      |         | PK    |
| year                   | integer        | yes      |         |       |
| category               | text           | yes      |         |       |
| beginning_balance      | numeric(14, 2) | yes      |         |       |
| total_contributions    | numeric(14, 2) | yes      |         |       |
| yearly_gain_loss       | numeric(14, 2) | yes      |         |       |
| ending_balance         | numeric(14, 2) | yes      |         |       |
| annual_return_pct      | numeric(8, 6)  |          |         |       |
| employer_contributions | numeric(14, 2) | yes      | `'0'`   |       |
| distributions          | numeric(14, 2) | yes      | `'0'`   |       |
| fees                   | numeric(14, 2) | yes      | `'0'`   |       |
| rollovers              | numeric(14, 2) | yes      | `'0'`   |       |
| lifetime_gains         | numeric(14, 2) | yes      |         |       |
| lifetime_contributions | numeric(14, 2) | yes      |         |       |
| lifetime_match         | numeric(14, 2) | yes      |         |       |
| is_current_year        | boolean        | yes      | `false` |       |
| is_finalized           | boolean        | yes      | `false` |       |
| is_immutable           | boolean        | yes      | `false` |       |

- Unique: (year, category)

### api_connections

| Column               | Type                     | Not null | Default | Notes       |
| -------------------- | ------------------------ | -------- | ------- | ----------- |
| id                   | serial                   | yes      |         | PK          |
| service              | text                     | yes      |         | unique      |
| config               | jsonb                    | yes      |         | shape below |
| account_mappings     | jsonb                    |          |         | shape below |
| skipped_category_ids | jsonb                    |          |         | shape below |
| linked_profile_id    | integer                  |          |         |             |
| linked_column_index  | integer                  |          |         |             |
| server_knowledge     | integer                  |          |         |             |
| last_synced_at       | timestamp with time zone |          |         |             |

- `config`: type `ApiConfig`; shape `apiConfigSchema` (lib/db/shapes/json-schemas.ts), parsed nowhere; read through `decryptJson` (lib/crypto.ts); an encrypted envelope, since the credentials migration
- `account_mappings`: type `AccountMapping[]`; shape `accountMappingsSchema` (lib/db/shapes/json-schemas.ts), parsed nowhere; typed ids, since the credentials migration; a mapping without one is skipped with a warning
- `skipped_category_ids`: type `string[]`; shape `skippedCategoryIdsSchema` (lib/db/shapes/json-schemas.ts), parsed nowhere

### app_settings

| Column | Type   | Not null | Default | Notes       |
| ------ | ------ | -------- | ------- | ----------- |
| id     | serial | yes      |         | PK          |
| key    | text   | yes      |         | unique      |
| value  | jsonb  | yes      |         | shape below |

- `value`: type `unknown`; shape `settingValueSchema` (lib/db/shapes/json-schemas.ts), parsed on write; read through `readStoredSetting` (lib/db/stored-setting.ts); the reader checks a key against that key's own shape

### asset_class_buckets

| Column         | Type    | Not null | Default | Notes                                          |
| -------------- | ------- | -------- | ------- | ---------------------------------------------- |
| bucket         | text    | yes      |         | PK                                             |
| asset_class_id | integer | yes      |         | FK → asset_class_params.id (on delete cascade) |

### asset_class_correlations

| Column      | Type           | Not null | Default | Notes                                          |
| ----------- | -------------- | -------- | ------- | ---------------------------------------------- |
| id          | serial         | yes      |         | PK                                             |
| class_a_id  | integer        | yes      |         | FK → asset_class_params.id (on delete cascade) |
| class_b_id  | integer        | yes      |         | FK → asset_class_params.id (on delete cascade) |
| correlation | numeric(12, 6) | yes      |         |                                                |

- Unique: (class_a_id, class_b_id)

### asset_class_params

| Column      | Type           | Not null | Default | Notes  |
| ----------- | -------------- | -------- | ------- | ------ |
| id          | serial         | yes      |         | PK     |
| name        | text           | yes      |         | unique |
| mean_return | numeric(12, 6) | yes      |         |        |
| std_dev     | numeric(12, 6) | yes      |         |        |
| sort_order  | integer        | yes      | `0`     |        |
| is_active   | boolean        | yes      | `true`  |        |

### brokerage_goals

| Column        | Type                     | Not null | Default | Notes |
| ------------- | ------------------------ | -------- | ------- | ----- |
| id            | serial                   | yes      |         | PK    |
| name          | text                     | yes      |         |       |
| target_amount | numeric(14, 2)           | yes      |         |       |
| target_year   | integer                  | yes      |         |       |
| priority      | integer                  | yes      | `0`     |       |
| is_active     | boolean                  | yes      | `true`  |       |
| notes         | text                     |          |         |       |
| created_at    | timestamp with time zone | yes      | `now()` |       |

### brokerage_planned_transactions

| Column            | Type           | Not null | Default | Notes                                       |
| ----------------- | -------------- | -------- | ------- | ------------------------------------------- |
| id                | serial         | yes      |         | PK                                          |
| goal_id           | integer        | yes      |         | FK → brokerage_goals.id (on delete cascade) |
| transaction_date  | date           | yes      |         |                                             |
| amount            | numeric(14, 2) | yes      |         |                                             |
| description       | text           | yes      |         |                                             |
| is_recurring      | boolean        | yes      | `false` |                                             |
| recurrence_months | integer        |          |         |                                             |

### budget_api_cache

| Column           | Type                     | Not null | Default | Notes       |
| ---------------- | ------------------------ | -------- | ------- | ----------- |
| id               | serial                   | yes      |         | PK          |
| service          | text                     | yes      |         |             |
| cache_key        | text                     | yes      |         |             |
| data             | jsonb                    | yes      |         | shape below |
| server_knowledge | integer                  |          |         |             |
| fetched_at       | timestamp with time zone | yes      | `now()` |             |

- Unique: (service, cache_key)
- `data`: type `unknown`; shape `budgetApiCacheDataSchema` (lib/db/shapes/json-schemas.ts), parsed nowhere; read through `readCachedMonthBalances` (lib/budget-api/cached-month.ts); cache, loose by design

### budget_income_adjustments

| Column     | Type           | Not null | Default  | Notes                            |
| ---------- | -------------- | -------- | -------- | -------------------------------- |
| id         | serial         | yes      |          | PK                               |
| job_id     | integer        | yes      |          | FK → jobs.id (on delete cascade) |
| month_date | date           | yes      |          |                                  |
| amount     | numeric(12, 2) | yes      |          |                                  |
| source     | text           | yes      | `'rule'` |                                  |

- Unique: (job_id, month_date)

### budget_item_category_links

| Column         | Type                     | Not null | Default | Notes                                    |
| -------------- | ------------------------ | -------- | ------- | ---------------------------------------- |
| id             | serial                   | yes      |         | PK                                       |
| budget_item_id | integer                  | yes      |         | FK → budget_items.id (on delete cascade) |
| service        | text                     | yes      |         |                                          |
| category_id    | text                     | yes      |         |                                          |
| category_name  | text                     |          |         |                                          |
| last_synced_at | timestamp with time zone |          |         |                                          |
| sync_direction | text                     |          |         |                                          |

- Unique: (budget_item_id, service)

### budget_items

| Column                  | Type                     | Not null | Default  | Notes                                              |
| ----------------------- | ------------------------ | -------- | -------- | -------------------------------------------------- |
| id                      | serial                   | yes      |          | PK                                                 |
| profile_id              | integer                  | yes      |          | FK → budget_profiles.id (on delete cascade)        |
| category                | text                     | yes      |          |                                                    |
| subcategory             | text                     | yes      |          |                                                    |
| amounts                 | jsonb                    | yes      |          | shape below                                        |
| api_category_name       | text                     |          |          |                                                    |
| api_category_id         | text                     |          |          |                                                    |
| api_last_synced_at      | timestamp with time zone |          |          |                                                    |
| api_sync_direction      | text                     |          | `'pull'` |                                                    |
| contribution_account_id | integer                  |          |          | FK → contribution_accounts.id (on delete set null) |
| mortgage_loan_id        | integer                  |          |          | FK → mortgage_loans.id (on delete set null)        |
| is_essential            | boolean                  | yes      | `true`   |                                                    |
| sort_order              | integer                  | yes      | `0`      |                                                    |

- Unique: (profile_id, category, subcategory)
- `amounts`: type `number[]`; shape `budgetAmountsSchema` (lib/db/shapes/json-schemas.ts), parsed on read and write; one amount per column of its profile

### budget_profiles

| Column        | Type                     | Not null | Default | Notes       |
| ------------- | ------------------------ | -------- | ------- | ----------- |
| id            | serial                   | yes      |         | PK          |
| name          | text                     | yes      |         | unique      |
| description   | text                     |          |         |             |
| column_labels | jsonb                    | yes      |         | shape below |
| column_months | jsonb                    |          |         | shape below |
| is_active     | boolean                  | yes      | `false` |             |
| created_at    | timestamp with time zone | yes      | `now()` |             |

- `column_labels`: type `string[]`; shape `columnLabelsSchema` (lib/db/shapes/json-schemas.ts), parsed on write
- `column_months`: type `number[]`; shape `columnMonthsSchema` (lib/db/shapes/json-schemas.ts), parsed on write

### change_log

| Column     | Type                     | Not null | Default | Notes       |
| ---------- | ------------------------ | -------- | ------- | ----------- |
| id         | serial                   | yes      |         | PK          |
| table_name | text                     | yes      |         |             |
| record_id  | integer                  | yes      |         |             |
| field_name | text                     | yes      |         |             |
| old_value  | jsonb                    |          |         | shape below |
| new_value  | jsonb                    |          |         | shape below |
| changed_by | text                     | yes      |         |             |
| changed_at | timestamp with time zone | yes      | `now()` |             |

- `old_value`: shape `changeLogValueSchema` (lib/db/shapes/json-schemas.ts), parsed nowhere; audit, loose by design
- `new_value`: shape `changeLogValueSchema` (lib/db/shapes/json-schemas.ts), parsed nowhere; audit, loose by design

### contribution_accounts

| Column                       | Type           | Not null | Default        | Notes                                             |
| ---------------------------- | -------------- | -------- | -------------- | ------------------------------------------------- |
| id                           | serial         | yes      |                | PK                                                |
| job_id                       | integer        |          |                | FK → jobs.id (on delete cascade)                  |
| person_id                    | integer        |          |                | FK → people.id (on delete restrict)               |
| account_type                 | text           | yes      |                |                                                   |
| sub_type                     | text           |          |                |                                                   |
| label                        | text           |          |                |                                                   |
| parent_category              | text           | yes      | `'Retirement'` |                                                   |
| tax_treatment                | text           | yes      |                |                                                   |
| employer_match_type          | text           | yes      |                |                                                   |
| employer_match_value         | numeric(14, 2) |          |                |                                                   |
| employer_match_rate          | numeric(12, 6) |          |                |                                                   |
| employer_max_match_pct       | numeric(8, 6)  |          |                |                                                   |
| employer_match_tax_treatment | text           | yes      | `'pre_tax'`    |                                                   |
| hsa_coverage_type            | text           |          |                |                                                   |
| auto_maximize                | boolean        | yes      | `false`        |                                                   |
| is_active                    | boolean        | yes      | `true`         |                                                   |
| ownership                    | text           | yes      | `'individual'` |                                                   |
| performance_account_id       | integer        |          |                | FK → performance_accounts.id (on delete set null) |
| target_annual                | numeric(14, 2) |          |                |                                                   |
| allocation_priority          | integer        | yes      | `0`            |                                                   |
| notes                        | text           |          |                |                                                   |
| is_payroll_deducted          | boolean        |          |                |                                                   |
| prior_year_contrib_amount    | numeric(14, 2) | yes      | `'0'`          |                                                   |
| prior_year_contrib_year      | integer        |          |                |                                                   |

- Unique: (job_id, account_type, parent_category) where employer_match_type <> 'none' AND job_id IS NOT NULL AND is_active = true
- Unique: (person_id, account_type, parent_category) where employer_match_type <> 'none' AND job_id IS NULL AND is_active = true

### contribution_limits

| Column         | Type                     | Not null | Default  | Notes |
| -------------- | ------------------------ | -------- | -------- | ----- |
| id             | serial                   | yes      |          | PK    |
| tax_year       | integer                  | yes      |          |       |
| limit_type     | text                     | yes      |          |       |
| value          | numeric(12, 6)           | yes      |          |       |
| notes          | text                     |          |          |       |
| origin         | text                     | yes      | `'user'` |       |
| source_version | integer                  |          |          |       |
| confirmed_at   | timestamp with time zone |          |          |       |

- Unique: (tax_year, limit_type)

### contribution_profiles

| Column                     | Type                     | Not null | Default | Notes       |
| -------------------------- | ------------------------ | -------- | ------- | ----------- |
| id                         | serial                   | yes      |         | PK          |
| name                       | text                     | yes      |         | unique      |
| description                | text                     |          |         |             |
| contribution_active_fields | jsonb                    | yes      | `{}`    | shape below |
| created_at                 | timestamp with time zone | yes      | `now()` |             |

- `contribution_active_fields`: type `EntityFieldMap`; shape `contributionActiveFieldsSchema` (lib/db/shapes/json-schemas.ts), parsed on read and write; read through `readContributionActiveFields` (lib/db/stored-active-fields.ts)

### debts

| Column           | Type           | Not null | Default | Notes                               |
| ---------------- | -------------- | -------- | ------- | ----------------------------------- |
| id               | serial         | yes      |         | PK                                  |
| name             | text           | yes      |         |                                     |
| kind             | text           | yes      |         |                                     |
| owner_person_id  | integer        |          |         | FK → people.id (on delete restrict) |
| balance          | numeric(14, 2) | yes      |         |                                     |
| balance_as_of    | date           | yes      |         |                                     |
| original_amount  | numeric(14, 2) |          |         |                                     |
| interest_rate    | numeric(8, 6)  |          |         |                                     |
| monthly_payment  | numeric(14, 2) |          |         |                                     |
| opened_date      | date           |          |         |                                     |
| paid_off_date    | date           |          |         |                                     |
| notes            | text           |          |         |                                     |
| sort_order       | integer        | yes      | `0`     |                                     |
| purchase_price   | numeric(14, 2) |          |         |                                     |
| term_months      | integer        |          |         |                                     |
| api_balance      | numeric(14, 2) |          |         |                                     |
| api_balance_date | date           |          |         |                                     |

### fpl_by_household

| Column         | Type                     | Not null | Default  | Notes       |
| -------------- | ------------------------ | -------- | -------- | ----------- |
| id             | serial                   | yes      |          | PK          |
| tax_year       | integer                  | yes      |          | unique      |
| amounts        | jsonb                    | yes      |          | shape below |
| origin         | text                     | yes      | `'user'` |             |
| source_version | integer                  |          |          |             |
| confirmed_at   | timestamp with time zone |          |          |             |

- `amounts`: type `Record<string, number>`; shape `fplByHouseholdAmountsSchema` (lib/db/shapes/json-schemas.ts), parsed on write

### glide_path_allocations

| Column         | Type           | Not null | Default | Notes                                          |
| -------------- | -------------- | -------- | ------- | ---------------------------------------------- |
| id             | serial         | yes      |         | PK                                             |
| age            | integer        | yes      |         |                                                |
| asset_class_id | integer        | yes      |         | FK → asset_class_params.id (on delete cascade) |
| allocation     | numeric(12, 6) | yes      |         |                                                |

- Unique: (age, asset_class_id)

### historical_notes

| Column | Type    | Not null | Default | Notes |
| ------ | ------- | -------- | ------- | ----- |
| id     | serial  | yes      |         | PK    |
| year   | integer | yes      |         |       |
| field  | text    | yes      |         |       |
| note   | text    | yes      |         |       |

- Unique: (year, field)

### historical_salaries

| Column    | Type           | Not null | Default | Notes                              |
| --------- | -------------- | -------- | ------- | ---------------------------------- |
| id        | serial         | yes      |         | PK                                 |
| person_id | integer        | yes      |         | FK → people.id (on delete cascade) |
| year      | integer        | yes      |         |                                    |
| salary    | numeric(14, 2) | yes      |         |                                    |
| bonus     | numeric(14, 2) | yes      | `'0'`   |                                    |

- Unique: (person_id, year)

### holding_observations

| Column                | Type                     | Not null | Default | Notes                                           |
| --------------------- | ------------------------ | -------- | ------- | ----------------------------------------------- |
| id                    | serial                   | yes      |         | PK                                              |
| simplefin_account_id  | integer                  | yes      |         | FK → simplefin_accounts.id (on delete restrict) |
| security_id           | integer                  | yes      |         | FK → securities.id (on delete restrict)         |
| balance_date          | timestamp with time zone |          |         |                                                 |
| as_of                 | date                     | yes      |         |                                                 |
| shares                | numeric(20, 8)           | yes      |         |                                                 |
| reported_market_value | numeric(14, 2)           |          |         |                                                 |
| avg_cost_per_share    | numeric(20, 8)           |          |         |                                                 |
| source                | text                     | yes      |         |                                                 |
| created_at            | timestamp with time zone | yes      | `now()` |                                                 |

- Unique: (simplefin_account_id, security_id, as_of) where simplefin_account_id IS NOT NULL AND balance_date IS NULL
- Unique: (simplefin_account_id, security_id, balance_date) where simplefin_account_id IS NOT NULL AND balance_date IS NOT NULL

### holding_period_weights

| Column            | Type           | Not null | Default | Notes                                       |
| ----------------- | -------------- | -------- | ------- | ------------------------------------------- |
| id                | serial         | yes      |         | PK                                          |
| holding_period_id | integer        | yes      |         | FK → holding_periods.id (on delete cascade) |
| security_id       | integer        | yes      |         | FK → securities.id (on delete restrict)     |
| weight            | numeric(12, 6) | yes      |         |                                             |

- Unique: (holding_period_id, security_id)

### holding_periods

| Column                 | Type                     | Not null | Default | Notes                                             |
| ---------------------- | ------------------------ | -------- | ------- | ------------------------------------------------- |
| id                     | serial                   | yes      |         | PK                                                |
| performance_account_id | integer                  | yes      |         | FK → performance_accounts.id (on delete restrict) |
| sub_key                | text                     |          |         |                                                   |
| start_date             | date                     | yes      |         |                                                   |
| end_date               | date                     |          |         |                                                   |
| basis                  | text                     | yes      |         |                                                   |
| fit_quality            | numeric(12, 6)           |          |         |                                                   |
| notes                  | text                     |          |         |                                                   |
| created_at             | timestamp with time zone | yes      | `now()` |                                                   |
| updated_at             | timestamp with time zone | yes      | `now()` |                                                   |

### home_improvement_items

| Column      | Type           | Not null | Default | Notes |
| ----------- | -------------- | -------- | ------- | ----- |
| id          | serial         | yes      |         | PK    |
| year        | integer        | yes      |         |       |
| description | text           | yes      |         |       |
| cost        | numeric(14, 2) | yes      |         |       |
| note        | text           |          |         |       |

### investment_transactions

| Column               | Type                     | Not null | Default | Notes                                           |
| -------------------- | ------------------------ | -------- | ------- | ----------------------------------------------- |
| id                   | serial                   | yes      |         | PK                                              |
| simplefin_account_id | integer                  | yes      |         | FK → simplefin_accounts.id (on delete restrict) |
| external_id          | text                     | yes      |         |                                                 |
| posted               | date                     | yes      |         |                                                 |
| transacted           | date                     |          |         |                                                 |
| amount               | numeric(14, 2)           | yes      |         |                                                 |
| description          | text                     | yes      |         |                                                 |
| pending              | boolean                  | yes      | `false` |                                                 |
| kind_override        | text                     |          |         |                                                 |
| voided_at            | timestamp with time zone |          |         |                                                 |
| first_seen_at        | timestamp with time zone | yes      | `now()` |                                                 |
| updated_at           | timestamp with time zone | yes      | `now()` |                                                 |

- Unique: (simplefin_account_id, external_id)

### irmaa_brackets

| Column         | Type                     | Not null | Default  | Notes       |
| -------------- | ------------------------ | -------- | -------- | ----------- |
| id             | serial                   | yes      |          | PK          |
| tax_year       | integer                  | yes      |          |             |
| filing_status  | text                     | yes      |          |             |
| brackets       | jsonb                    | yes      |          | shape below |
| origin         | text                     | yes      | `'user'` |             |
| source_version | integer                  |          |          |             |
| confirmed_at   | timestamp with time zone |          |          |             |

- Unique: (tax_year, filing_status)
- `brackets`: type `IrmaaBracketEntry[]`; shape `irmaaBracketsSchema` (lib/db/shapes/json-schemas.ts), parsed on write

### jobs

| Column         | Type    | Not null | Default | Notes                               |
| -------------- | ------- | -------- | ------- | ----------------------------------- |
| id             | serial  | yes      |         | PK                                  |
| person_id      | integer | yes      |         | FK → people.id (on delete restrict) |
| employer_name  | text    | yes      |         |                                     |
| title          | text    |          |         |                                     |
| start_date     | date    | yes      |         |                                     |
| end_date       | date    |          |         |                                     |
| is_speculative | boolean | yes      | `false` |                                     |

- Unique: (person_id) where is_speculative = true

### local_admins

| Column        | Type                     | Not null | Default | Notes  |
| ------------- | ------------------------ | -------- | ------- | ------ |
| id            | serial                   | yes      |         | PK     |
| email         | text                     | yes      |         | unique |
| password_hash | text                     | yes      |         |        |
| name          | text                     | yes      |         |        |
| created_at    | timestamp with time zone | yes      | `now()` |        |

### ltcg_brackets

| Column         | Type                     | Not null | Default  | Notes       |
| -------------- | ------------------------ | -------- | -------- | ----------- |
| id             | serial                   | yes      |          | PK          |
| tax_year       | integer                  | yes      |          |             |
| filing_status  | text                     | yes      |          |             |
| brackets       | jsonb                    | yes      |          | shape below |
| origin         | text                     | yes      | `'user'` |             |
| source_version | integer                  |          |          |             |
| confirmed_at   | timestamp with time zone |          |          |             |

- Unique: (tax_year, filing_status)
- `brackets`: type `LtcgBracketEntry[]`; shape `ltcgBracketsSchema` (lib/db/shapes/json-schemas.ts), parsed on write

### market_closes

| Column       | Type                     | Not null | Default | Notes |
| ------------ | ------------------------ | -------- | ------- | ----- |
| id           | serial                   | yes      |         | PK    |
| ticker       | text                     | yes      |         |       |
| date         | date                     | yes      |         |       |
| close        | numeric(18, 6)           | yes      |         |       |
| div_cash     | numeric(18, 6)           | yes      | `'0'`   |       |
| split_factor | numeric(18, 8)           | yes      | `'1'`   |       |
| fetched_at   | timestamp with time zone | yes      | `now()` |       |

- Unique: (ticker, date)

### mc_preset_glide_paths

| Column         | Type           | Not null | Default | Notes                                          |
| -------------- | -------------- | -------- | ------- | ---------------------------------------------- |
| id             | serial         | yes      |         | PK                                             |
| preset_id      | integer        | yes      |         | FK → mc_presets.id (on delete cascade)         |
| age            | integer        | yes      |         |                                                |
| asset_class_id | integer        | yes      |         | FK → asset_class_params.id (on delete cascade) |
| allocation     | numeric(12, 6) | yes      |         |                                                |

- Unique: (preset_id, age, asset_class_id)

### mc_preset_return_overrides

| Column         | Type           | Not null | Default | Notes                                          |
| -------------- | -------------- | -------- | ------- | ---------------------------------------------- |
| id             | serial         | yes      |         | PK                                             |
| preset_id      | integer        | yes      |         | FK → mc_presets.id (on delete cascade)         |
| asset_class_id | integer        | yes      |         | FK → asset_class_params.id (on delete cascade) |
| mean_return    | numeric(12, 6) | yes      |         |                                                |

- Unique: (preset_id, asset_class_id)

### mc_presets

| Column            | Type           | Not null | Default       | Notes  |
| ----------------- | -------------- | -------- | ------------- | ------ |
| id                | serial         | yes      |               | PK     |
| key               | text           | yes      |               | unique |
| label             | text           | yes      |               |        |
| description       | text           | yes      |               |        |
| return_multiplier | numeric(12, 6) | yes      | `'1.000000'`  |        |
| vol_multiplier    | numeric(12, 6) | yes      | `'1.000000'`  |        |
| inflation_mean    | numeric(12, 6) | yes      | `'0.025000'`  |        |
| inflation_std_dev | numeric(12, 6) | yes      | `'0.012000'`  |        |
| default_trials    | integer        | yes      | `5000`        |        |
| return_clamp_min  | numeric(12, 6) | yes      | `'-0.500000'` |        |
| return_clamp_max  | numeric(12, 6) | yes      | `'1.000000'`  |        |
| sort_order        | integer        | yes      | `0`           |        |
| is_active         | boolean        | yes      | `true`        |        |

### mc_user_presets

| Column            | Type                     | Not null | Default | Notes |
| ----------------- | ------------------------ | -------- | ------- | ----- |
| id                | serial                   | yes      |         | PK    |
| name              | text                     | yes      |         |       |
| simulations       | integer                  | yes      | `1000`  |       |
| return_mean       | numeric(12, 6)           | yes      |         |       |
| return_std_dev    | numeric(12, 6)           | yes      |         |       |
| inflation_mean    | numeric(12, 6)           | yes      |         |       |
| inflation_std_dev | numeric(12, 6)           | yes      |         |       |
| created_at        | timestamp with time zone | yes      | `now()` |       |
| updated_at        | timestamp with time zone | yes      | `now()` |       |

### mortgage_extra_payments

| Column       | Type           | Not null | Default | Notes                                      |
| ------------ | -------------- | -------- | ------- | ------------------------------------------ |
| id           | serial         | yes      |         | PK                                         |
| loan_id      | integer        | yes      |         | FK → mortgage_loans.id (on delete cascade) |
| payment_date | date           |          |         |                                            |
| start_date   | date           |          |         |                                            |
| end_date     | date           |          |         |                                            |
| amount       | numeric(14, 2) | yes      |         |                                            |
| is_actual    | boolean        | yes      | `false` |                                            |
| notes        | text           |          |         |                                            |

### mortgage_loans

| Column                    | Type           | Not null | Default      | Notes                                       |
| ------------------------- | -------------- | -------- | ------------ | ------------------------------------------- |
| id                        | serial         | yes      |              | PK                                          |
| name                      | text           | yes      |              |                                             |
| is_active                 | boolean        | yes      | `false`      |                                             |
| refinanced_from_id        | integer        |          |              | FK → mortgage_loans.id (on delete set null) |
| paid_off_date             | date           |          |              |                                             |
| principal_and_interest    | numeric(14, 2) | yes      |              |                                             |
| pmi                       | numeric(14, 2) | yes      | `'0'`        |                                             |
| insurance_and_taxes       | numeric(14, 2) | yes      | `'0'`        |                                             |
| total_escrow              | numeric(14, 2) | yes      | `'0'`        |                                             |
| interest_rate             | numeric(8, 6)  | yes      |              |                                             |
| term_years                | integer        | yes      |              |                                             |
| original_loan_amount      | numeric(14, 2) | yes      |              |                                             |
| first_payment_date        | date           | yes      |              |                                             |
| property_value_purchase   | numeric(14, 2) | yes      |              |                                             |
| property_value_estimated  | numeric(14, 2) |          |              |                                             |
| use_purchase_or_estimated | text           | yes      | `'purchase'` |                                             |
| api_balance               | numeric(14, 2) |          |              |                                             |
| api_balance_date          | date           |          |              |                                             |

### mortgage_what_if_scenarios

| Column                  | Type           | Not null | Default | Notes                                      |
| ----------------------- | -------------- | -------- | ------- | ------------------------------------------ |
| id                      | serial         | yes      |         | PK                                         |
| loan_id                 | integer        |          |         | FK → mortgage_loans.id (on delete cascade) |
| label                   | text           | yes      |         |                                            |
| extra_monthly_principal | numeric(14, 2) | yes      |         |                                            |
| extra_one_time_payment  | numeric(14, 2) | yes      | `'0'`   |                                            |
| refinance_rate          | numeric(8, 6)  |          |         |                                            |
| refinance_term          | integer        |          |         |                                            |
| sort_order              | integer        | yes      | `0`     |                                            |

### net_worth_annual

| Column                    | Type           | Not null | Default | Notes       |
| ------------------------- | -------------- | -------- | ------- | ----------- |
| id                        | serial         | yes      |         | PK          |
| year_end_date             | date           | yes      |         | unique      |
| gross_income              | numeric(14, 2) | yes      | `'0'`   |             |
| combined_agi              | numeric(14, 2) | yes      | `'0'`   |             |
| ssa_earnings              | numeric(14, 2) |          |         |             |
| effective_tax_rate        | numeric(8, 6)  |          |         |             |
| taxes_paid                | numeric(14, 2) |          |         |             |
| cash                      | numeric(14, 2) | yes      | `'0'`   |             |
| house_value               | numeric(14, 2) | yes      | `'0'`   |             |
| retirement_total          | numeric(14, 2) | yes      | `'0'`   |             |
| hsa                       | numeric(14, 2) | yes      | `'0'`   |             |
| lt_brokerage              | numeric(14, 2) | yes      | `'0'`   |             |
| espp                      | numeric(14, 2) | yes      | `'0'`   |             |
| r_brokerage               | numeric(14, 2) | yes      | `'0'`   |             |
| other_assets              | numeric(14, 2) | yes      | `'0'`   |             |
| mortgage_balance          | numeric(14, 2) | yes      | `'0'`   |             |
| other_liabilities         | numeric(14, 2) | yes      | `'0'`   |             |
| tax_free_total            | numeric(14, 2) | yes      | `'0'`   |             |
| tax_deferred_total        | numeric(14, 2) | yes      | `'0'`   |             |
| portfolio_total           | numeric(14, 2) | yes      | `'0'`   |             |
| property_taxes            | numeric(14, 2) |          |         |             |
| portfolio_by_tax_location | jsonb          | yes      |         | shape below |

- `portfolio_by_tax_location`: type `{ retirement: Record<string, number>; portfolio: Record<string, number> }`; unchecked

### other_asset_items

| Column | Type           | Not null | Default | Notes |
| ------ | -------------- | -------- | ------- | ----- |
| id     | serial         | yes      |         | PK    |
| name   | text           | yes      |         |       |
| year   | integer        | yes      |         |       |
| value  | numeric(14, 2) | yes      |         |       |
| note   | text           |          |         |       |

- Unique: (name, year)

### paycheck_deductions

| Column         | Type    | Not null | Default | Notes                            |
| -------------- | ------- | -------- | ------- | -------------------------------- |
| id             | serial  | yes      |         | PK                               |
| job_id         | integer | yes      |         | FK → jobs.id (on delete cascade) |
| deduction_name | text    | yes      |         |                                  |
| is_pretax      | boolean | yes      |         |                                  |
| fica_exempt    | boolean | yes      | `false` |                                  |

### paycheck_earnings

| Column          | Type    | Not null | Default | Notes                            |
| --------------- | ------- | -------- | ------- | -------------------------------- |
| id              | serial  | yes      |         | PK                               |
| job_id          | integer | yes      |         | FK → jobs.id (on delete cascade) |
| earning_name    | text    | yes      |         |                                  |
| is_cash         | boolean | yes      | `true`  |                                  |
| federal_taxable | boolean | yes      | `true`  |                                  |
| fica_taxable    | boolean | yes      | `true`  |                                  |

### people

| Column          | Type    | Not null | Default | Notes |
| --------------- | ------- | -------- | ------- | ----- |
| id              | serial  | yes      |         | PK    |
| name            | text    | yes      |         |       |
| date_of_birth   | date    | yes      |         |       |
| is_primary_user | boolean | yes      | `false` |       |

### performance_accounts

| Column                      | Type                     | Not null | Default                       | Notes                               |
| --------------------------- | ------------------------ | -------- | ----------------------------- | ----------------------------------- |
| id                          | serial                   | yes      |                               | PK                                  |
| institution                 | text                     | yes      |                               |                                     |
| account_type                | text                     | yes      |                               |                                     |
| sub_type                    | text                     |          |                               |                                     |
| label                       | text                     |          |                               |                                     |
| account_label               | text                     | yes      |                               |                                     |
| display_name                | text                     |          |                               |                                     |
| owner_person_id             | integer                  |          |                               | FK → people.id (on delete restrict) |
| ownership_type              | text                     | yes      |                               |                                     |
| retirement_behavior         | text                     | yes      | `'stops_at_owner_retirement'` |                                     |
| contribution_scaling        | text                     | yes      | `'scales_with_salary'`        |                                     |
| cost_basis                  | numeric(14, 2)           | yes      | `'0'`                         |                                     |
| separation_date             | date                     |          |                               |                                     |
| allow_penalized_withdrawals | boolean                  | yes      | `false`                       |                                     |
| parent_category             | text                     | yes      |                               |                                     |
| is_active                   | boolean                  | yes      | `true`                        |                                     |
| display_order               | integer                  | yes      | `0`                           |                                     |
| created_at                  | timestamp with time zone | yes      | `now()`                       |                                     |

- Unique: (institution, account_type, sub_type, label, owner_person_id)

### portfolio_accounts

| Column                 | Type           | Not null | Default        | Notes                                             |
| ---------------------- | -------------- | -------- | -------------- | ------------------------------------------------- |
| id                     | serial         | yes      |                | PK                                                |
| snapshot_id            | integer        | yes      |                | FK → portfolio_snapshots.id (on delete cascade)   |
| institution            | text           | yes      |                |                                                   |
| tax_type               | text           | yes      |                |                                                   |
| amount                 | numeric(14, 2) | yes      |                |                                                   |
| account_type           | text           | yes      |                |                                                   |
| sub_type               | text           |          |                |                                                   |
| label                  | text           |          |                |                                                   |
| parent_category        | text           | yes      | `'Retirement'` |                                                   |
| owner_person_id        | integer        |          |                | FK → people.id (on delete restrict)               |
| performance_account_id | integer        |          |                | FK → performance_accounts.id (on delete set null) |
| is_active              | boolean        | yes      | `true`         |                                                   |

### portfolio_snapshots

| Column        | Type                     | Not null | Default | Notes  |
| ------------- | ------------------------ | -------- | ------- | ------ |
| id            | serial                   | yes      |         | PK     |
| snapshot_date | date                     | yes      |         | unique |
| created_at    | timestamp with time zone | yes      | `now()` |        |
| notes         | text                     |          |         |        |

### projection_cache

| Column         | Type                     | Not null | Default | Notes       |
| -------------- | ------------------------ | -------- | ------- | ----------- |
| id             | serial                   | yes      |         | PK          |
| input_hash     | text                     | yes      |         |             |
| seed           | integer                  |          |         |             |
| result         | jsonb                    | yes      |         | shape below |
| computed_at    | timestamp with time zone | yes      | `now()` |             |
| expires_at     | timestamp with time zone | yes      |         |             |
| last_read_at   | timestamp with time zone | yes      | `now()` |             |
| engine_version | integer                  | yes      |         |             |

- Unique: (input_hash, engine_version)
- `result`: type `unknown`; unchecked; cache, loose by design

### projection_overrides

| Column        | Type   | Not null | Default | Notes       |
| ------------- | ------ | -------- | ------- | ----------- |
| id            | serial | yes      |         | PK          |
| override_type | text   | yes      |         | unique      |
| overrides     | jsonb  | yes      |         | shape below |
| created_by    | text   |          |         |             |
| updated_by    | text   |          |         |             |

- `overrides`: type `Record<string, unknown>[]`; read through `resolveProjectionOverrides` (server/services/projection/projection-run.ts); parsed by override_type; a set that fails is dropped, logged once

### property_taxes

| Column         | Type           | Not null | Default | Notes                                      |
| -------------- | -------------- | -------- | ------- | ------------------------------------------ |
| id             | serial         | yes      |         | PK                                         |
| loan_id        | integer        | yes      |         | FK → mortgage_loans.id (on delete cascade) |
| year           | integer        | yes      |         |                                            |
| assessed_value | numeric(14, 2) |          |         |                                            |
| tax_amount     | numeric(14, 2) | yes      |         |                                            |
| note           | text           |          |         |                                            |

- Unique: (loan_id, year)

### relocation_scenarios

| Column     | Type                     | Not null | Default | Notes       |
| ---------- | ------------------------ | -------- | ------- | ----------- |
| id         | serial                   | yes      |         | PK          |
| name       | text                     | yes      |         |             |
| params     | jsonb                    | yes      |         | shape below |
| created_at | timestamp with time zone | yes      | `now()` |             |
| updated_at | timestamp with time zone | yes      | `now()` |             |

- `params`: type `RelocationScenarioParams`; shape `relocationScenarioParamsSchema` (lib/db/shapes/json-schemas.ts), parsed on write

### retirement_budget_overrides

| Column                  | Type           | Not null | Default | Notes                               |
| ----------------------- | -------------- | -------- | ------- | ----------------------------------- |
| id                      | serial         | yes      |         | PK                                  |
| person_id               | integer        | yes      |         | FK → people.id (on delete restrict) |
| projection_year         | integer        | yes      |         |                                     |
| override_monthly_budget | numeric(14, 2) | yes      |         |                                     |
| notes                   | text           |          |         |                                     |
| created_by              | text           |          |         |                                     |
| updated_by              | text           |          |         |                                     |

- Unique: (person_id, projection_year)

### retirement_profile_people

| Column                  | Type           | Not null | Default | Notes                                           |
| ----------------------- | -------------- | -------- | ------- | ----------------------------------------------- |
| id                      | serial         | yes      |         | PK                                              |
| profile_id              | integer        | yes      |         | FK → retirement_profiles.id (on delete cascade) |
| person_id               | integer        | yes      |         | FK → people.id (on delete cascade)              |
| retirement_age          | integer        | yes      |         |                                                 |
| end_age                 | integer        | yes      |         |                                                 |
| social_security_monthly | numeric(14, 2) |          |         |                                                 |
| social_security_pia     | numeric(14, 2) |          |         |                                                 |
| ss_start_age            | integer        |          |         |                                                 |
| rule_of_55_override     | boolean        |          |         |                                                 |
| salary_annual_increase  | numeric(8, 6)  |          |         |                                                 |

- Unique: (profile_id, person_id)

### retirement_profiles

| Column          | Type                     | Not null | Default | Notes  |
| --------------- | ------------------------ | -------- | ------- | ------ |
| id              | serial                   | yes      |         | PK     |
| name            | text                     | yes      |         | unique |
| description     | text                     |          |         |        |
| tax_params_year | integer                  |          |         |        |
| created_at      | timestamp with time zone | yes      | `now()` |        |

### retirement_salary_overrides

| Column                  | Type           | Not null | Default | Notes                                              |
| ----------------------- | -------------- | -------- | ------- | -------------------------------------------------- |
| id                      | serial         | yes      |         | PK                                                 |
| person_id               | integer        | yes      |         | FK → people.id (on delete restrict)                |
| projection_year         | integer        | yes      |         |                                                    |
| override_salary         | numeric(14, 2) | yes      |         |                                                    |
| contribution_profile_id | integer        |          |         | FK → contribution_profiles.id (on delete set null) |
| salary_profile_id       | integer        |          |         | FK → salary_profiles.id (on delete set null)       |
| notes                   | text           |          |         |                                                    |
| created_by              | text           |          |         |                                                    |
| updated_by              | text           |          |         |                                                    |

- Unique: (person_id, projection_year)

### retirement_scenarios

| Column                            | Type           | Not null | Default  | Notes |
| --------------------------------- | -------------- | -------- | -------- | ----- |
| id                                | serial         | yes      |          | PK    |
| name                              | text           | yes      |          |       |
| withdrawal_rate                   | numeric(8, 6)  | yes      |          |       |
| target_annual_income              | numeric(14, 2) | yes      |          |       |
| annual_inflation                  | numeric(8, 6)  | yes      |          |       |
| distribution_tax_rate_traditional | numeric(8, 6)  | yes      | `'0.22'` |       |
| distribution_tax_rate_roth        | numeric(8, 6)  | yes      | `'0'`    |       |
| distribution_tax_rate_hsa         | numeric(8, 6)  | yes      | `'0'`    |       |
| distribution_tax_rate_brokerage   | numeric(8, 6)  | yes      | `'0.15'` |       |
| is_lt_brokerage_enabled           | boolean        | yes      | `true`   |       |
| lt_brokerage_annual_contribution  | numeric(14, 2) | yes      | `'0'`    |       |
| is_selected                       | boolean        | yes      | `false`  |       |
| notes                             | text           |          |          |       |

### retirement_settings

| Column                                   | Type           | Not null | Default             | Notes                                             |
| ---------------------------------------- | -------------- | -------- | ------------------- | ------------------------------------------------- |
| id                                       | serial         | yes      |                     | PK                                                |
| person_id                                | integer        | yes      |                     | FK → people.id (on delete restrict)               |
| retirement_age                           | integer        | yes      |                     |                                                   |
| end_age                                  | integer        | yes      |                     |                                                   |
| return_after_retirement                  | numeric(8, 6)  | yes      |                     |                                                   |
| annual_inflation                         | numeric(8, 6)  | yes      |                     |                                                   |
| post_retirement_inflation                | numeric(8, 6)  |          |                     |                                                   |
| salary_annual_increase                   | numeric(8, 6)  | yes      |                     |                                                   |
| salary_cap                               | numeric(14, 2) |          |                     |                                                   |
| raises_during_retirement                 | boolean        | yes      | `false`             |                                                   |
| rule_of_55_override                      | boolean        | yes      | `true`              |                                                   |
| withdrawal_rate                          | numeric(8, 6)  | yes      | `'0.04'`            |                                                   |
| tax_multiplier                           | numeric(8, 6)  | yes      | `'1.0'`             |                                                   |
| gross_up_for_taxes                       | boolean        | yes      | `true`              |                                                   |
| roth_bracket_target                      | numeric(8, 6)  |          | `'0.12'`            |                                                   |
| roth_bracket_overlay                     | boolean        |          |                     |                                                   |
| social_security_monthly                  | numeric(14, 2) | yes      | `'2500'`            |                                                   |
| ss_start_age                             | integer        | yes      | `67`                |                                                   |
| enable_roth_conversions                  | boolean        | yes      | `false`             |                                                   |
| roth_conversion_target                   | numeric(8, 6)  |          |                     |                                                   |
| withdrawal_strategy                      | varchar(30)    | yes      | `'fixed'`           |                                                   |
| discretionary_withdrawal_order           | varchar(20)    | yes      | `'roth_first'`      |                                                   |
| withdrawal_routing_mode                  | varchar(20)    | yes      | `'bracket_filling'` |                                                   |
| withdrawal_order                         | jsonb          |          |                     | shape below                                       |
| withdrawal_splits                        | jsonb          |          |                     | shape below                                       |
| gk_upper_guardrail                       | numeric(8, 6)  |          | `'0.80'`            |                                                   |
| gk_lower_guardrail                       | numeric(8, 6)  |          | `'1.20'`            |                                                   |
| gk_increase_pct                          | numeric(8, 6)  |          | `'0.10'`            |                                                   |
| gk_decrease_pct                          | numeric(8, 6)  |          | `'0.10'`            |                                                   |
| gk_skip_inflation_after_loss             | boolean        | yes      | `true`              |                                                   |
| sd_annual_decline_rate                   | numeric(12, 6) |          | `'0.02'`            |                                                   |
| cp_withdrawal_percent                    | numeric(12, 6) |          | `'0.05'`            |                                                   |
| cp_floor_percent                         | numeric(12, 6) |          | `'0.90'`            |                                                   |
| en_withdrawal_percent                    | numeric(12, 6) |          | `'0.05'`            |                                                   |
| en_rolling_years                         | integer        |          | `10`                |                                                   |
| en_floor_percent                         | numeric(12, 6) |          | `'0.90'`            |                                                   |
| vd_base_percent                          | numeric(12, 6) |          | `'0.05'`            |                                                   |
| vd_ceiling_percent                       | numeric(12, 6) |          | `'0.05'`            |                                                   |
| vd_floor_percent                         | numeric(12, 6) |          | `'0.025'`           |                                                   |
| rmd_multiplier                           | numeric(12, 6) |          | `'1.0'`             |                                                   |
| vpw_cap                                  | numeric(12, 6) |          |                     |                                                   |
| vpw_end_age                              | integer        |          |                     |                                                   |
| cp_ss_in_amount                          | boolean        |          |                     |                                                   |
| en_ss_in_amount                          | boolean        |          |                     |                                                   |
| vd_ss_in_amount                          | boolean        |          |                     |                                                   |
| rmd_ss_in_amount                         | boolean        |          |                     |                                                   |
| vpw_ss_in_amount                         | boolean        |          |                     |                                                   |
| rmd_excess_handling                      | varchar(20)    | yes      | `'reinvest'`        |                                                   |
| rmd_excess_target_performance_account_id | integer        |          |                     | FK → performance_accounts.id (on delete set null) |
| qcd_maximize                             | boolean        | yes      | `false`             |                                                   |
| rmd_smoothing_enabled                    | boolean        | yes      | `false`             |                                                   |
| rmd_smoothing_max_bracket_target         | numeric(8, 6)  |          |                     |                                                   |
| enable_irmaa_awareness                   | boolean        | yes      | `false`             |                                                   |
| gap_year_stop_saving                     | boolean        | yes      | `false`             |                                                   |
| gap_year_draws                           | boolean        | yes      | `true`              |                                                   |
| irmaa_on_top_of_budget                   | boolean        | yes      | `false`             |                                                   |
| enable_aca_awareness                     | boolean        | yes      | `false`             |                                                   |
| household_size                           | integer        | yes      | `2`                 |                                                   |
| filing_status                            | text           |          |                     |                                                   |
| profile_id                               | integer        |          |                     | FK → retirement_profiles.id (on delete cascade)   |
| distribution_tax_rate_traditional        | numeric(8, 6)  |          |                     |                                                   |
| distribution_tax_rate_roth               | numeric(8, 6)  |          |                     |                                                   |
| distribution_tax_rate_hsa                | numeric(8, 6)  |          |                     |                                                   |
| distribution_tax_rate_brokerage          | numeric(8, 6)  |          |                     |                                                   |

- Unique: (profile_id, person_id)
- `withdrawal_order`: type `string[]`; shape `storedWithdrawalOrderSchema` (lib/pure/engine/types/overrides.schema.ts), parsed on read
- `withdrawal_splits`: type `Record<string, number>`; shape `storedWithdrawalSplitsSchema` (lib/pure/engine/types/overrides.schema.ts), parsed on read

### return_rate_table

| Column         | Type          | Not null | Default | Notes  |
| -------------- | ------------- | -------- | ------- | ------ |
| id             | serial        | yes      |         | PK     |
| age            | integer       | yes      |         | unique |
| rate_of_return | numeric(8, 6) | yes      |         |        |

### salary_profiles

| Column      | Type                     | Not null | Default | Notes       |
| ----------- | ------------------------ | -------- | ------- | ----------- |
| id          | serial                   | yes      |         | PK          |
| name        | text                     | yes      |         | unique      |
| description | text                     |          |         |             |
| salaries    | jsonb                    | yes      | `{}`    | shape below |
| created_at  | timestamp with time zone | yes      | `now()` |             |

- `salaries`: type `Record<string, SalaryEntry>`; shape `salaryEntriesSchema` (lib/db/shapes/json-schemas.ts), parsed on read and write; read through `checkSalaryEntries` (lib/db/stored-salary-entries.ts)

### savings_allocation_overrides

| Column     | Type           | Not null | Default    | Notes                                     |
| ---------- | -------------- | -------- | ---------- | ----------------------------------------- |
| id         | serial         | yes      |            | PK                                        |
| goal_id    | integer        | yes      |            | FK → savings_goals.id (on delete cascade) |
| month_date | date           | yes      |            |                                           |
| amount     | numeric(14, 2) | yes      |            |                                           |
| source     | text           | yes      | `'manual'` |                                           |

- Unique: (goal_id, month_date)

### savings_goal_category_links

| Column          | Type                     | Not null | Default     | Notes                                     |
| --------------- | ------------------------ | -------- | ----------- | ----------------------------------------- |
| id              | serial                   | yes      |             | PK                                        |
| savings_goal_id | integer                  | yes      |             | FK → savings_goals.id (on delete cascade) |
| service         | text                     | yes      |             |                                           |
| role            | text                     | yes      | `'primary'` |                                           |
| category_id     | text                     | yes      |             |                                           |
| category_name   | text                     |          |             |                                           |
| last_synced_at  | timestamp with time zone |          |             |                                           |

- Unique: (savings_goal_id, service, role)

### savings_goal_profile_allocations

| Column               | Type           | Not null | Default | Notes                                       |
| -------------------- | -------------- | -------- | ------- | ------------------------------------------- |
| id                   | serial         | yes      |         | PK                                          |
| goal_id              | integer        | yes      |         | FK → savings_goals.id (on delete cascade)   |
| budget_profile_id    | integer        | yes      |         | FK → budget_profiles.id (on delete cascade) |
| allocation_percent   | numeric(6, 3)  |          |         |                                             |
| monthly_contribution | numeric(14, 2) | yes      |         |                                             |

- Unique: (goal_id, budget_profile_id)

### savings_goals

| Column                        | Type           | Not null | Default   | Notes                                      |
| ----------------------------- | -------------- | -------- | --------- | ------------------------------------------ |
| id                            | serial         | yes      |           | PK                                         |
| name                          | text           | yes      |           | unique                                     |
| parent_goal_id                | integer        |          |           | FK → savings_goals.id (on delete set null) |
| target_amount                 | numeric(14, 2) |          |           |                                            |
| target_months                 | integer        |          |           |                                            |
| target_date                   | date           |          |           |                                            |
| priority                      | integer        | yes      | `0`       |                                            |
| is_active                     | boolean        | yes      | `true`    |                                            |
| is_emergency_fund             | boolean        | yes      | `false`   |                                            |
| api_category_id               | text           |          |           |                                            |
| api_category_name             | text           |          |           |                                            |
| is_api_sync_enabled           | boolean        | yes      | `false`   |                                            |
| reimbursement_api_category_id | text           |          |           |                                            |
| target_mode                   | text           | yes      | `'fixed'` |                                            |

### savings_monthly

| Column                | Type           | Not null | Default | Notes                                     |
| --------------------- | -------------- | -------- | ------- | ----------------------------------------- |
| id                    | serial         | yes      |         | PK                                        |
| goal_id               | integer        | yes      |         | FK → savings_goals.id (on delete cascade) |
| month_date            | date           | yes      |         |                                           |
| balance               | numeric(14, 2) | yes      |         |                                           |
| deposit_or_withdrawal | numeric(14, 2) |          |         |                                           |
| notes                 | text           |          |         |                                           |

- Unique: (goal_id, month_date)

### savings_planned_transactions

| Column            | Type           | Not null | Default    | Notes                                     |
| ----------------- | -------------- | -------- | ---------- | ----------------------------------------- |
| id                | serial         | yes      |            | PK                                        |
| goal_id           | integer        | yes      |            | FK → savings_goals.id (on delete cascade) |
| transaction_date  | date           | yes      |            |                                           |
| amount            | numeric(14, 2) | yes      |            |                                           |
| description       | text           | yes      |            |                                           |
| is_recurring      | boolean        | yes      | `false`    |                                           |
| recurrence_months | integer        |          |            |                                           |
| transfer_pair_id  | text           |          |            |                                           |
| source            | text           | yes      | `'manual'` |                                           |

### savings_planned_tx_settlements

| Column           | Type                     | Not null | Default | Notes                                                    |
| ---------------- | ------------------------ | -------- | ------- | -------------------------------------------------------- |
| id               | serial                   | yes      |         | PK                                                       |
| planned_tx_id    | integer                  | yes      |         | FK → savings_planned_transactions.id (on delete cascade) |
| occurrence_month | date                     | yes      |         |                                                          |
| settled_at       | timestamp with time zone | yes      | `now()` |                                                          |

- Unique: (planned_tx_id, occurrence_month)

### scenarios

| Column                  | Type                     | Not null | Default | Notes                                              |
| ----------------------- | ------------------------ | -------- | ------- | -------------------------------------------------- |
| id                      | serial                   | yes      |         | PK                                                 |
| name                    | text                     | yes      |         | unique                                             |
| description             | text                     |          |         |                                                    |
| budget_profile_id       | integer                  |          |         | FK → budget_profiles.id (on delete set null)       |
| contribution_profile_id | integer                  |          |         | FK → contribution_profiles.id (on delete set null) |
| salary_profile_id       | integer                  |          |         | FK → salary_profiles.id (on delete set null)       |
| retirement_profile_id   | integer                  |          |         | FK → retirement_profiles.id (on delete set null)   |
| created_at              | timestamp with time zone | yes      | `now()` |                                                    |
| updated_at              | timestamp with time zone | yes      | `now()` |                                                    |

### sec_filing_cache

| Column          | Type                     | Not null | Default | Notes |
| --------------- | ------------------------ | -------- | ------- | ----- |
| accession       | text                     | yes      |         | PK    |
| series_id       | text                     | yes      |         |       |
| period_end      | date                     | yes      |         |       |
| us_equity_pct   | numeric(12, 6)           |          |         |       |
| intl_equity_pct | numeric(12, 6)           |          |         |       |
| us_bond_pct     | numeric(12, 6)           |          |         |       |
| intl_bond_pct   | numeric(12, 6)           |          |         |       |
| tips_pct        | numeric(12, 6)           |          |         |       |
| cash_pct        | numeric(12, 6)           |          |         |       |
| other_pct       | numeric(12, 6)           |          |         |       |
| coverage        | numeric(12, 6)           |          |         |       |
| fetched_at      | timestamp with time zone | yes      | `now()` |       |

### securities

| Column               | Type                     | Not null | Default | Notes       |
| -------------------- | ------------------------ | -------- | ------- | ----------- |
| id                   | serial                   | yes      |         | PK          |
| ticker               | text                     |          |         |             |
| source_symbol        | text                     |          |         |             |
| name                 | text                     | yes      |         |             |
| kind                 | text                     | yes      |         |             |
| institution          | text                     |          |         |             |
| source_description   | text                     |          |         |             |
| sec_series_id        | text                     |          |         |             |
| sec_class_id         | text                     |          |         |             |
| facts_series_id      | text                     |          |         |             |
| facts_class_id       | text                     |          |         |             |
| facts_series_name    | text                     |          |         |             |
| facts_basis          | text                     |          |         |             |
| standin_confirmed_at | timestamp with time zone |          |         |             |
| standin_preview      | jsonb                    |          |         | shape below |
| facts_checked_at     | timestamp with time zone |          |         |             |
| created_at           | timestamp with time zone | yes      | `now()` |             |

- Unique: (institution, source_description) where ticker IS NULL
- Unique: (ticker) where ticker IS NOT NULL
- `standin_preview`: type `StandInPreview`; unchecked

### security_facts

| Column          | Type                     | Not null | Default | Notes                                   |
| --------------- | ------------------------ | -------- | ------- | --------------------------------------- |
| id              | serial                   | yes      |         | PK                                      |
| security_id     | integer                  | yes      |         | FK → securities.id (on delete restrict) |
| as_of           | date                     | yes      |         |                                         |
| source          | text                     | yes      |         |                                         |
| sec_series_id   | text                     |          |         |                                         |
| accession       | text                     |          |         |                                         |
| expense_ratio   | numeric(12, 6)           |          |         |                                         |
| us_equity_pct   | numeric(12, 6)           |          |         |                                         |
| intl_equity_pct | numeric(12, 6)           |          |         |                                         |
| us_bond_pct     | numeric(12, 6)           |          |         |                                         |
| intl_bond_pct   | numeric(12, 6)           |          |         |                                         |
| tips_pct        | numeric(12, 6)           |          |         |                                         |
| cash_pct        | numeric(12, 6)           |          |         |                                         |
| other_pct       | numeric(12, 6)           |          |         |                                         |
| coverage        | numeric(12, 6)           |          |         |                                         |
| fetched_at      | timestamp with time zone | yes      | `now()` |                                         |

- Unique: (security_id, source, as_of)

### self_loans

| Column        | Type           | Not null | Default | Notes                                      |
| ------------- | -------------- | -------- | ------- | ------------------------------------------ |
| id            | serial         | yes      |         | PK                                         |
| from_goal_id  | integer        | yes      |         | FK → savings_goals.id (on delete restrict) |
| to_goal_id    | integer        |          |         | FK → savings_goals.id (on delete restrict) |
| amount        | numeric(14, 2) | yes      |         |                                            |
| loan_date     | date           | yes      |         |                                            |
| repaid_amount | numeric(14, 2) | yes      | `'0'`   |                                            |
| repaid_date   | date           |          |         |                                            |

### simplefin_account_balances

| Column               | Type                     | Not null | Default | Notes                                           |
| -------------------- | ------------------------ | -------- | ------- | ----------------------------------------------- |
| id                   | serial                   | yes      |         | PK                                              |
| simplefin_account_id | integer                  | yes      |         | FK → simplefin_accounts.id (on delete restrict) |
| balance_date         | timestamp with time zone | yes      |         |                                                 |
| balance              | numeric(14, 2)           | yes      |         |                                                 |
| created_at           | timestamp with time zone | yes      | `now()` |                                                 |

- Unique: (simplefin_account_id, balance_date)

### simplefin_accounts

| Column                        | Type                     | Not null | Default | Notes                                               |
| ----------------------------- | ------------------------ | -------- | ------- | --------------------------------------------------- |
| id                            | serial                   | yes      |         | PK                                                  |
| external_account_id           | text                     | yes      |         | unique                                              |
| org_name                      | text                     | yes      |         |                                                     |
| account_name                  | text                     | yes      |         |                                                     |
| last_balance                  | numeric(14, 2)           | yes      |         |                                                     |
| last_balance_date             | timestamp with time zone |          |         |                                                     |
| is_included                   | boolean                  | yes      | `true`  |                                                     |
| last_seen_at                  | timestamp with time zone | yes      | `now()` |                                                     |
| linked_performance_account_id | integer                  |          |         | FK → performance_accounts.id (on delete set null)   |
| linked_sub_key                | text                     |          |         |                                                     |
| linked_loan_id                | integer                  |          |         | unique; FK → mortgage_loans.id (on delete set null) |

### simplefin_balance_snapshots

| Column        | Type                     | Not null | Default | Notes  |
| ------------- | ------------------------ | -------- | ------- | ------ |
| id            | serial                   | yes      |         | PK     |
| snapshot_date | date                     | yes      |         | unique |
| total_balance | numeric(14, 2)           | yes      |         |        |
| account_count | integer                  | yes      |         |        |
| created_at    | timestamp with time zone | yes      | `now()` |        |

### state_version_tables

| Column     | Type    | Not null | Default | Notes                                      |
| ---------- | ------- | -------- | ------- | ------------------------------------------ |
| id         | serial  | yes      |         | PK                                         |
| version_id | integer | yes      |         | FK → state_versions.id (on delete cascade) |
| table_name | text    | yes      |         |                                            |
| row_count  | integer | yes      |         |                                            |
| data       | jsonb   | yes      |         | shape below                                |

- Unique: (version_id, table_name)
- `data`: type `unknown[]`; shape `stateVersionDataSchema` (lib/db/shapes/json-schemas.ts), parsed nowhere; backup blob, loose by design

### state_versions

| Column              | Type                     | Not null | Default | Notes |
| ------------------- | ------------------------ | -------- | ------- | ----- |
| id                  | serial                   | yes      |         | PK    |
| name                | text                     | yes      |         |       |
| description         | text                     |          |         |       |
| version_type        | text                     | yes      |         |       |
| schema_version      | text                     | yes      |         |       |
| table_count         | integer                  | yes      |         |       |
| total_rows          | integer                  | yes      |         |       |
| size_estimate_bytes | integer                  |          |         |       |
| created_at          | timestamp with time zone | yes      | `now()` |       |
| created_by          | text                     | yes      |         |       |

### sync_request_log

| Column       | Type                     | Not null | Default | Notes |
| ------------ | ------------------------ | -------- | ------- | ----- |
| id           | serial                   | yes      |         | PK    |
| service      | text                     | yes      |         |       |
| requested_at | timestamp with time zone | yes      | `now()` |       |
| endpoint     | text                     | yes      |         |       |
| http_status  | integer                  |          |         |       |
| outcome      | text                     | yes      |         |       |

### tax_brackets

| Column         | Type                     | Not null | Default  | Notes       |
| -------------- | ------------------------ | -------- | -------- | ----------- |
| id             | serial                   | yes      |          | PK          |
| tax_year       | integer                  | yes      |          |             |
| filing_status  | text                     | yes      |          |             |
| w4_checkbox    | boolean                  | yes      |          |             |
| brackets       | jsonb                    | yes      |          | shape below |
| origin         | text                     | yes      | `'user'` |             |
| source_version | integer                  |          |          |             |
| confirmed_at   | timestamp with time zone |          |          |             |

- Unique: (tax_year, filing_status, w4_checkbox)
- `brackets`: type `TaxBracketEntry[]`; shape `taxBracketsSchema` (lib/db/shapes/json-schemas.ts), parsed on write

### tax_data_updates

| Column       | Type                     | Not null | Default | Notes |
| ------------ | ------------------------ | -------- | ------- | ----- |
| data_version | integer                  | yes      |         | PK    |
| file_text    | text                     | yes      |         |       |
| signature    | text                     | yes      |         |       |
| fetched_at   | timestamp with time zone | yes      | `now()` |       |
| status       | text                     | yes      |         |       |
| decided_by   | text                     |          |         |       |
| decided_at   | timestamp with time zone |          |         |       |

### tax_params

| Column     | Type                     | Not null | Default | Notes  |
| ---------- | ------------------------ | -------- | ------- | ------ |
| id         | serial                   | yes      |         | PK     |
| tax_year   | integer                  | yes      |         | unique |
| version    | integer                  | yes      | `1`     |        |
| source     | text                     |          |         |        |
| notes      | text                     |          |         |        |
| updated_at | timestamp with time zone | yes      | `now()` |        |

### utility_reading

| Column     | Type           | Not null | Default | Notes                                       |
| ---------- | -------------- | -------- | ------- | ------------------------------------------- |
| id         | serial         | yes      |         | PK                                          |
| service_id | integer        | yes      |         | FK → utility_service.id (on delete cascade) |
| year       | integer        | yes      |         |                                             |
| month      | integer        | yes      |         |                                             |
| cost       | numeric(14, 2) | yes      |         |                                             |
| usage      | numeric(14, 4) |          |         |                                             |
| note       | text           |          |         |                                             |
| source     | text           |          |         |                                             |

- Unique: (service_id, year, month)

### utility_service

| Column                 | Type    | Not null | Default | Notes  |
| ---------------------- | ------- | -------- | ------- | ------ |
| id                     | serial  | yes      |         | PK     |
| kind                   | text    | yes      |         | unique |
| provider_name          | text    | yes      |         |        |
| usage_unit             | text    |          |         |        |
| sort_order             | integer | yes      | `0`     |        |
| active                 | boolean | yes      | `true`  |        |
| budget_api_category_id | text    |          |         |        |
| billing_lag_months     | integer | yes      | `0`     |        |
