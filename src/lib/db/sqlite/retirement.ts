// AUTO-GENERATED from ../pg/ by scripts/gen-sqlite-schema.ts — do not edit.
// Part of the Drizzle schema (SQLite) — see schema-pg.ts.

import {
  sqliteTable,
  text,
  integer,
  uniqueIndex,
  index,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

import { DEFAULT_WITHDRAWAL_RATE } from "@/lib/constants";
import type { W4FilingStatus } from "@/lib/config/enum-values";
import { contributionProfiles, salaryProfiles } from "./contribution-profiles";
import { people } from "./people";
import { performanceAccounts } from "./performance";

// ────────────────────────────────────────────────────────────────────────────
// 10. Retirement settings
// ────────────────────────────────────────────────────────────────────────────

export const retirementSettings = sqliteTable(
  "retirement_settings",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    // NOT bare .unique() any more. One row per person, PER PROFILE, not one row
    // per person system-wide — see the composite unique index below. This
    // is what makes a second retirement profile able to hold genuinely
    // different household settings; without it there was nowhere to put a
    // duplicated profile's row (unique(person_id) forbade the INSERT).
    personId: integer("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "restrict" }),
    retirementAge: integer("retirement_age").notNull(),
    endAge: integer("end_age").notNull(),
    returnAfterRetirement: text("return_after_retirement").notNull(),
    annualInflation: text("annual_inflation").notNull(),
    postRetirementInflation: text("post_retirement_inflation"),
    salaryAnnualIncrease: text("salary_annual_increase").notNull(),
    salaryCap: text("salary_cap"),
    raisesDuringRetirement: integer("raises_during_retirement", {
      mode: "boolean",
    })
      .notNull()
      .default(false),
    /** Per-person Rule of 55 forecasting override. True (default)
     *  ⇒ no override — the engine's computed Rule of 55 status (from real
     *  job separation data) is used unchanged. False ⇒ force this person's
     *  employer-plan accounts ineligible for Rule of 55, regardless of what
     *  the computed status says — for forecasting "what if I'm not at a
     *  qualifying job when I retire." Deliberately one-directional: this
     *  never forces eligibility TRUE, only FALSE, so a default-true row can
     *  never silently paint an account eligible when the real computed
     *  status says otherwise. */
    ruleOf55Override: integer("rule_of_55_override", { mode: "boolean" })
      .notNull()
      .default(true),
    withdrawalRate: text("withdrawal_rate")
      .notNull()
      .default(DEFAULT_WITHDRAWAL_RATE.toString()),
    taxMultiplier: text("tax_multiplier").notNull().default("1.0"),
    grossUpForTaxes: integer("gross_up_for_taxes", { mode: "boolean" })
      .notNull()
      .default(true),
    /** Target marginal rate for Roth optimization (e.g. 0.12 = stay in 12% bracket). Null = disabled. */
    rothBracketTarget: text("roth_bracket_target").default("0.12"),
    /** Monthly Social Security benefit estimate in today's dollars. */
    socialSecurityMonthly: text("social_security_monthly")
      .notNull()
      .default("2500"),
    /** Age at which Social Security income begins. */
    ssStartAge: integer("ss_start_age").notNull().default(67),
    /** Enable automatic Roth conversions during decumulation (fills target bracket). */
    enableRothConversions: integer("enable_roth_conversions", {
      mode: "boolean",
    })
      .notNull()
      .default(false),
    /** Target marginal rate for Roth conversions (null = inherit from rothBracketTarget). */
    rothConversionTarget: text("roth_conversion_target"),
    /** Withdrawal/spending strategy (see withdrawal-strategies.ts registry). */
    withdrawalStrategy: text("withdrawal_strategy").notNull().default("fixed"),
    /** Within the cost-ranked tier (beyond the Traditional
     *  bracket-fill target), which of Roth basis / brokerage's 0%-LTCG room
     *  drains first. "roth_first" (default) matches all pre-existing
     *  behavior. "brokerage_first" is an explicit household opt-in — a
     *  brokerage LTCG gain still counts toward MAGI for ACA/IRMAA purposes
     *  even when taxed at 0% federally, so this trades a real ACA/IRMAA
     *  cost (when either awareness setting is on) for using the "use it or
     *  lose it" annual 0%-LTCG allowance sooner — an explicit, user-chosen
     *  tradeoff (with UI warning text), not an automatic optimization. */
    discretionaryWithdrawalOrder: text("discretionary_withdrawal_order")
      .notNull()
      .default("roth_first"),
    /** Household default for `withdrawalRoutingMode` ("bracket_filling" |
     *  "waterfall" | "percentage") — WHICH accounts fund a year's
     *  withdrawal, as opposed to `withdrawalStrategy` (HOW MUCH). Read as
     *  the DB fallback in `buildDecumulationDefaults`
     *  (server/routers/projection/_shared.ts) — a client-supplied
     *  `decumulationDefaults.withdrawalRoutingMode` still wins when
     *  present (the Retirement page's per-session Configure toggle), this
     *  only fills in when the caller sends none (Tax Optimization's
     *  comparison + "your current plan" baseline, and any future caller
     *  that wants the household's real default rather than a hardcoded
     *  one). Validated as an enum in zod (retirement.ts's
     *  retirementSettingsInput), not a CHECK constraint — see
     *  gen-sqlite-schema.ts's header on why a CHECK forces the SQLite
     *  recreate path this schema otherwise avoids. */
    withdrawalRoutingMode: text("withdrawal_routing_mode")
      .notNull()
      .default("bracket_filling"),
    /** Household default for the withdrawal ORDER — the account sequence
     *  Waterfall mode drains in, and (filtered to 401k/403b/IRA) the
     *  Traditional Account Order bracket_filling's Phase 1 consults first.
     *  Same DB-fallback role as `withdrawalRoutingMode` above: read in
     *  `buildDecumulationDefaults` (server/routers/projection/_shared.ts),
     *  a client-supplied `decumulationDefaults.withdrawalOrder` still wins
     *  when the Retirement page's Configure toggle sends one.
     *  NULL = "use `getDefaultDecumulationOrder()`" — never store a copy of
     *  the config default (same "null means absent" convention
     *  `distributionTaxRateTraditional` documents in this table). Element
     *  type + no-duplicates enforced in zod (retirement.ts's
     *  retirementSettingsInput); a partial list is allowed (the engine's
     *  `ensureCompleteWithdrawalOrder` backfills the rest). jsonb array,
     *  auto-converted to SQLite `text({ mode: "json" })` by
     *  gen-sqlite-schema.ts, matching `budgetProfileColumns.columnLabels`. */
    withdrawalOrder: text("withdrawal_order", { mode: "json" }).$type<
      string[]
    >(),
    /** Household default for the percentage-mode splits — how a year's total
     *  withdrawal divides across accounts. Same DB-fallback role and NULL
     *  convention as `withdrawalOrder` above; NULL = "use
     *  `DEFAULT_WITHDRAWAL_SPLITS`." Per-account fractions, roughly summing
     *  to 1.0 (loose bound checked in zod, retirement.ts); a partial record
     *  is legal — a missing account resolves to 0 and the engine
     *  redistributes proportionally. */
    withdrawalSplits: text("withdrawal_splits", { mode: "json" }).$type<
      Record<string, number>
    >(),
    /** G-K: upper guardrail — if currentRate < initialRate × this, increase spending (e.g. 0.80). */
    gkUpperGuardrail: text("gk_upper_guardrail").default("0.80"),
    /** G-K: lower guardrail — if currentRate > initialRate × this, decrease spending (e.g. 1.20). */
    gkLowerGuardrail: text("gk_lower_guardrail").default("1.20"),
    /** G-K: spending increase percentage when upper guardrail triggers (e.g. 0.10 = 10%). */
    gkIncreasePct: text("gk_increase_pct").default("0.10"),
    /** G-K: spending decrease percentage when lower guardrail triggers (e.g. 0.10 = 10%). */
    gkDecreasePct: text("gk_decrease_pct").default("0.10"),
    /** G-K: skip inflation adjustment in years following a portfolio loss. */
    gkSkipInflationAfterLoss: integer("gk_skip_inflation_after_loss", {
      mode: "boolean",
    })
      .notNull()
      .default(true),
    /** Spending Decline: annual real decline rate (e.g. 0.02 = 2%). */
    sdAnnualDeclineRate: text("sd_annual_decline_rate").default("0.02"),
    /** Constant Percentage: withdrawal % of current balance. */
    cpWithdrawalPercent: text("cp_withdrawal_percent").default("0.05"),
    /** Constant Percentage: floor as % of initial withdrawal. */
    cpFloorPercent: text("cp_floor_percent").default("0.90"),
    /** Endowment: withdrawal % of rolling average balance. */
    enWithdrawalPercent: text("en_withdrawal_percent").default("0.05"),
    /** Endowment: rolling window in years. */
    enRollingYears: integer("en_rolling_years").default(10),
    /** Endowment: floor as % of initial withdrawal. */
    enFloorPercent: text("en_floor_percent").default("0.90"),
    /** Vanguard Dynamic: base withdrawal %. */
    vdBasePercent: text("vd_base_percent").default("0.05"),
    /** Vanguard Dynamic: max YoY spending increase. */
    vdCeilingPercent: text("vd_ceiling_percent").default("0.05"),
    /** Vanguard Dynamic: max YoY spending decrease. */
    vdFloorPercent: text("vd_floor_percent").default("0.025"),
    /** RMD Spending: multiplier on IRS RMD amount. */
    rmdMultiplier: text("rmd_multiplier").default("1.0"),
    /** What to do with RMD-forced withdrawal beyond stated spending
     *  need (after any QCD reduces the taxable RMD first) — "reinvest"
     *  into brokerage (default, matches prior behavior) or "spend"
     *  (household consumes it; net worth ends up lower, by design). */
    rmdExcessHandling: text("rmd_excess_handling")
      .notNull()
      .default("reinvest"),
    /** Where reinvested RMD money goes: a Retirement-parented brokerage
     *  account. Null = spread across the household's Retirement brokerages
     *  by balance (the default); an account that is gone or no longer a
     *  Retirement brokerage falls back to that with a warning. Never a
     *  Portfolio account — retirement money stays retirement money.
     *  Household-grain like rmdExcessHandling (stored on the primary
     *  person's row, which pickProfileSettingsRow reads), per Retirement
     *  Profile. */
    rmdExcessTargetPerformanceAccountId: integer(
      "rmd_excess_target_performance_account_id",
    ).references(() => performanceAccounts.id, { onDelete: "set null" }),
    /** Automatically apply the largest Qualified Charitable
     *  Distribution the household's RMD situation allows each year
     *  (capped by the year's qcd_annual_limit and the person's IRA-only
     *  Traditional balance — see qcd.ts for the approximation this uses).
     *  Excludes that portion of RMD from taxable income entirely. */
    qcdMaximize: integer("qcd_maximize", { mode: "boolean" })
      .notNull()
      .default(false),
    /** Proactively size Roth conversions to shrink a FUTURE RMD
     *  toward projected spending need, not just fill this year's bracket
     *  room opportunistically — default false, byte-identical for every
     *  existing household until explicitly turned on (converting more
     *  Traditional-to-Roth earlier is a real pay-tax-now-vs-later
     *  tradeoff). Per-person, requires individual-account tracking. */
    rmdSmoothingEnabled: integer("rmd_smoothing_enabled", { mode: "boolean" })
      .notNull()
      .default(false),
    /** How far smoothing may raise the EFFECTIVE conversion target
     *  rate above the household's own `rothBracketTarget`/
     *  `rothConversionTarget` when it needs more room than those provide
     *  — can only RAISE the effective ceiling, never lower it (a
     *  household's existing, separately-configured target always wins if
     *  it's already higher). Null = not yet set; UI should seed a new
     *  household's default from their current `rothBracketTarget`, not a
     *  hardcoded value, so opting into smoothing can never look like it
     *  silently lowered an existing target. */
    rmdSmoothingMaxBracketTarget: text("rmd_smoothing_max_bracket_target"),
    /** Enable IRMAA awareness — constrain Roth conversions/withdrawals near Medicare surcharge cliffs (65+). */
    enableIrmaaAwareness: integer("enable_irmaa_awareness", { mode: "boolean" })
      .notNull()
      .default(false),
    /** Enable ACA subsidy awareness — cap MAGI to preserve health insurance subsidies (pre-65). */
    enableAcaAwareness: integer("enable_aca_awareness", { mode: "boolean" })
      .notNull()
      .default(false),
    /** Household size for ACA FPL calculation. */
    householdSize: integer("household_size").notNull().default(2),
    /** Filing status for retirement projections. Backfilled from the
     *  person's active job's W-4 filing status (drizzle/0021), then made
     *  NOT NULL — the job-facts fallback tier in build-engine-payload.ts
     *  stays in place until this column is reliably non-null for every
     *  household, but no new row can be inserted without one. */
    filingStatus: text("filing_status").$type<W4FilingStatus>().notNull(),

    // --- Retirement Profiles migration, step A (expand) ---------------------
    // Added additively; nothing reads them yet (step B switches the reads).

    /** The profile this row belongs to. Together with `person_id` this is
     *  now the row's real key (see the composite unique index below,
     *  replacing the old bare unique(person_id)): one
     *  row per person PER PROFILE, which is what lets two profiles hold
     *  genuinely different household settings.
     *
     *  Still nullable, not NOT NULL — `retirementSettings.upsert`
     *  (server/routers/retirement.ts) explicitly resolves and sets it on
     *  every write (falling back to `isNull` scoping, never a bare
     *  personId match, when no profile resolves), and a null value can't
     *  weaken the unique index (Postgres/SQLite both treat NULL as
     *  non-equal there), so there is no correctness gap. Made NOT NULL
     *  ONLY as part of the next schema squash: SQLite has no ALTER COLUMN SET
     *  NOT NULL, so tightening this now would force the exact table-recreate
     *  path this schema has otherwise avoided. */
    profileId: integer("profile_id").references(() => retirementProfiles.id, {
      onDelete: "cascade",
    }),

    /** Distribution tax rates, relocated from `retirement_scenarios` — a
     *  table with live engine reads but ZERO UI (its CRUD router has no
     *  callers), so these values changed every projection while being
     *  invisible and uneditable. Backfilled from the `is_selected` row.
     *
     *  Household-grain, so every person's row carries the same value, matching
     *  how the other household columns here already behave.
     *
     *  DELIBERATELY NULLABLE, against the usual "NOT NULL on financial amount
     *  columns" convention. Today's read is `selectedScenario ? rate : 0` —
     *  i.e. no selected row means 0, NOT the DEFAULT_TAX_RATE_* constants.
     *  Backfilling a literal 0 would preserve behaviour but permanently
     *  destroy the difference between "the household chose 0%" and "there was
     *  no row", and the open question of whether these should actually be the
     *  defaults needs that distinction to remain answerable. So: null means
     *  absent, and the read stays `!= null ? rate : 0` — byte-identical
     *  output, no information laundered away.
     *
     *  NOTE: `retirement_scenarios.withdrawal_rate` is deliberately NOT
     *  relocated here. `retirement_settings.withdrawal_rate` (line ~1400)
     *  already exists, is NOT NULL, and is read in eight+ places; the
     *  scenarios one is a different value overriding it in exactly one
     *  consumer (the relocation tool). Collapsing them is correct eventually
     *  but is a user-visible behaviour change, not a behaviour-neutral
     *  relocation, so it gets its own change and its own justification. */
    distributionTaxRateTraditional: text("distribution_tax_rate_traditional"),
    distributionTaxRateRoth: text("distribution_tax_rate_roth"),
    distributionTaxRateHsa: text("distribution_tax_rate_hsa"),
    distributionTaxRateBrokerage: text("distribution_tax_rate_brokerage"),
  },
  (table) => [
    index("retirement_settings_person_id_idx").on(table.personId),
    index("retirement_settings_profile_id_idx").on(table.profileId),
    index("retirement_settings_rmd_excess_target_idx").on(
      table.rmdExcessTargetPerformanceAccountId,
    ),
    // Replaces the old bare unique(person_id). profile_id stays nullable
    // (Postgres/SQLite both treat NULL as non-equal in a unique index, so
    // this can't be weakened by a null profile_id — every write path sets
    // one) rather than made NOT NULL now, which would force SQLite's
    // recreate-table path for no benefit; that tightening folds into the
    // next schema squash alongside the rest of the deferred contract step.
    uniqueIndex("retirement_settings_profile_person_unq").on(
      table.profileId,
      table.personId,
    ),
  ],
);

/**
 * Retirement Profiles — the named, swappable entity.
 *
 * Thin parent matching `contribution_profiles` / `salary_profiles`: id, name,
 * description, created_at. The assumptions themselves stay on
 * `retirement_settings` (re-keyed to `profile_id`) rather than moving into a
 * JSON payload like its siblings, because 24 of those columns are typed
 * decimals with explicit precision — moving them to JSON would turn financial
 * rates into floats and discard every validator and default binding.
 *
 * Each profile is a COMPLETE world: no baseline, no default profile, no
 * inheritance, no merge at read time. Same contract Salary Profiles already
 * state ("no fallback to a job record: if you want a different number, use a
 * different profile").
 */
export const retirementProfiles = sqliteTable("retirement_profiles", {
  id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  description: text("description"),
  /**
   * Tax-law year this profile's projections are priced under.
   * NULL = track the latest enacted tax data — the historical behaviour, so
   * every profile predating this column is byte-identical after the migration adds this
   * column. A non-null value pins the `resolveTaxParams` base year (with
   * `onMissing: "nearest"`); "Latest = current law" in the profile
   * assumptions UI.
   */
  taxParamsYear: integer("tax_params_year"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

/**
 * Per-person retirement assumptions within a profile.
 *
 * Only the fields the engine genuinely reads per person live here. Everything
 * else is household-grain and stays on `retirement_settings` — see the design
 * plan's §01 for why the household/per-person line falls where it does.
 *
 * `end_age` is here because the engine reads it per person
 * (`Math.max(...perPersonSettings.map(p => p.endAge))` →
 * `projectionEndAge`), which is also what made the household "Plan Through"
 * control silently discard edits before commit 0b5d5fe.
 *
 * COMPLETENESS INVARIANT: every profile must hold a row for every person.
 * With no baseline to fall back to, a missing row is a missing retirement
 * age — not a number the engine can invent. Enforced on profile create,
 * duplicate, person create (fan a row into every existing profile — the one
 * that gets forgotten), and person delete.
 */
export const retirementProfilePeople = sqliteTable(
  "retirement_profile_people",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    profileId: integer("profile_id")
      .notNull()
      .references(() => retirementProfiles.id, { onDelete: "cascade" }),
    personId: integer("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    retirementAge: integer("retirement_age").notNull(),
    endAge: integer("end_age").notNull(),
    socialSecurityMonthly: text("social_security_monthly"),
    /** PIA (Primary Insurance Amount, monthly benefit at Full Retirement
     *  Age) — the direct user input the claiming-age optimizer computes
     *  from, per SOCIAL-SECURITY-OPTIMIZATION-PLAN.md decision #1 (not
     *  derived from an earnings history). Independent of
     *  socialSecurityMonthly on purpose: existing rows are left untouched
     *  (decision #5, opt-in) — a household only starts using PIA-based
     *  claiming-age optimization once they explicitly fill this in. */
    socialSecurityPia: text("social_security_pia"),
    ssStartAge: integer("ss_start_age"),
    ruleOf55Override: integer("rule_of_55_override", { mode: "boolean" }),
    salaryAnnualIncrease: text("salary_annual_increase"),
  },
  (table) => [
    uniqueIndex("retirement_profile_people_profile_person_unq").on(
      table.profileId,
      table.personId,
    ),
    index("retirement_profile_people_profile_id_idx").on(table.profileId),
    index("retirement_profile_people_person_id_idx").on(table.personId),
  ],
);

export const retirementSalaryOverrides = sqliteTable(
  "retirement_salary_overrides",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    personId: integer("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "restrict" }),
    projectionYear: integer("projection_year").notNull(),
    overrideSalary: text("override_salary").notNull(),
    /** Contribution Profile this year switches to (contribution side only). */
    contributionProfileId: integer("contribution_profile_id").references(
      () => contributionProfiles.id,
      { onDelete: "set null" },
    ),
    /** Salary Profile this year switches to. Independent of
     *  contributionProfileId — only this row's own personId's entry from the
     *  referenced profile is injected (the table's grain is per person-year). */
    salaryProfileId: integer("salary_profile_id").references(
      () => salaryProfiles.id,
      { onDelete: "set null" },
    ),
    notes: text("notes"),
    createdBy: text("created_by"),
    updatedBy: text("updated_by"),
  },
  (table) => [
    uniqueIndex("retirement_salary_overrides_person_year_idx").on(
      table.personId,
      table.projectionYear,
    ),
    index("retirement_salary_overrides_person_id_idx").on(table.personId),
    index("retirement_salary_overrides_contribution_profile_id_idx").on(
      table.contributionProfileId,
    ),
    index("retirement_salary_overrides_salary_profile_id_idx").on(
      table.salaryProfileId,
    ),
  ],
);

export const retirementBudgetOverrides = sqliteTable(
  "retirement_budget_overrides",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    personId: integer("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "restrict" }),
    projectionYear: integer("projection_year").notNull(),
    overrideMonthlyBudget: text("override_monthly_budget").notNull(),
    notes: text("notes"),
    createdBy: text("created_by"),
    updatedBy: text("updated_by"),
  },
  (table) => [
    uniqueIndex("retirement_budget_overrides_person_year_idx").on(
      table.personId,
      table.projectionYear,
    ),
    index("retirement_budget_overrides_person_id_idx").on(table.personId),
  ],
);

export const projectionOverrides = sqliteTable(
  "projection_overrides",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    overrideType: text("override_type").notNull(),
    overrides: text("overrides", { mode: "json" })
      .$type<Record<string, unknown>[]>()
      .notNull(),
    createdBy: text("created_by"),
    updatedBy: text("updated_by"),
  },
  (table) => [
    uniqueIndex("projection_overrides_type_idx").on(table.overrideType),
  ],
);

export const retirementScenarios = sqliteTable("retirement_scenarios", {
  id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  withdrawalRate: text("withdrawal_rate").notNull(),
  targetAnnualIncome: text("target_annual_income").notNull(),
  annualInflation: text("annual_inflation").notNull(),
  distributionTaxRateTraditional: text("distribution_tax_rate_traditional")
    .notNull()
    .default("0.22"),
  distributionTaxRateRoth: text("distribution_tax_rate_roth")
    .notNull()
    .default("0"),
  distributionTaxRateHsa: text("distribution_tax_rate_hsa")
    .notNull()
    .default("0"),
  distributionTaxRateBrokerage: text("distribution_tax_rate_brokerage")
    .notNull()
    .default("0.15"),
  isLtBrokerageEnabled: integer("is_lt_brokerage_enabled", { mode: "boolean" })
    .notNull()
    .default(true),
  ltBrokerageAnnualContribution: text("lt_brokerage_annual_contribution")
    .notNull()
    .default("0"),
  isSelected: integer("is_selected", { mode: "boolean" })
    .notNull()
    .default(false),
  notes: text("notes"),
});
