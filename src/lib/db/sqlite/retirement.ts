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
import { decimalText } from "../sqlite-decimal";

import { DEFAULT_WITHDRAWAL_RATE } from "@/lib/constants";
import type { ReturnFilingStatus } from "@/lib/config/filing-status";
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
    // One row per person per profile (composite unique index below), so each retirement
    // profile holds its own household settings.
    personId: integer("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "restrict" }),
    retirementAge: integer("retirement_age").notNull(),
    endAge: integer("end_age").notNull(),
    returnAfterRetirement: decimalText("return_after_retirement").notNull(),
    annualInflation: decimalText("annual_inflation").notNull(),
    postRetirementInflation: decimalText("post_retirement_inflation"),
    salaryAnnualIncrease: decimalText("salary_annual_increase").notNull(),
    salaryCap: decimalText("salary_cap"),
    raisesDuringRetirement: integer("raises_during_retirement", {
      mode: "boolean",
    })
      .notNull()
      .default(false),
    /** Per-person Rule of 55 override: true (default) = use the computed status; false = force
     *  this person's employer plans ineligible ("what if I'm not at a qualifying job"). Never
     *  forces eligibility on. */
    ruleOf55Override: integer("rule_of_55_override", { mode: "boolean" })
      .notNull()
      .default(true),
    withdrawalRate: decimalText("withdrawal_rate")
      .notNull()
      .default(DEFAULT_WITHDRAWAL_RATE.toString()),
    taxMultiplier: decimalText("tax_multiplier").notNull().default("1.0"),
    grossUpForTaxes: integer("gross_up_for_taxes", { mode: "boolean" })
      .notNull()
      .default(true),
    /** Target marginal rate for Roth optimization (e.g. 0.12 = stay in 12% bracket); writers keep it set. */
    rothBracketTarget: decimalText("roth_bracket_target").default("0.12"),
    /** Waterfall's Roth bracket overlay on/off. No DB default: null only before tag 0022 sets it. */
    rothBracketOverlay: integer("roth_bracket_overlay", { mode: "boolean" }),
    /** Monthly Social Security benefit estimate in today's dollars. */
    socialSecurityMonthly: decimalText("social_security_monthly")
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
    rothConversionTarget: decimalText("roth_conversion_target"),
    /** Withdrawal/spending strategy (see withdrawal-strategies.ts registry). */
    withdrawalStrategy: text("withdrawal_strategy").notNull().default("fixed"),
    /** Within the cost-ranked tier, whether Roth basis or brokerage 0%-LTCG room drains first.
     *  "brokerage_first" is a household opt-in: those gains still count toward MAGI for ACA/IRMAA,
     *  trading that cost for using the annual 0%-LTCG room sooner. */
    discretionaryWithdrawalOrder: text("discretionary_withdrawal_order")
      .notNull()
      .default("roth_first"),
    /** Household default `withdrawalRoutingMode` (WHICH accounts fund a year; `withdrawalStrategy`
     *  is HOW MUCH): `buildDecumulationDefaults`'s fallback when the client sends none. An enum in
     *  zod (`retirementSettingsInput`), not a CHECK (that forces SQLite's table recreate). */
    withdrawalRoutingMode: text("withdrawal_routing_mode")
      .notNull()
      .default("bracket_filling"),
    /** Household default withdrawal ORDER (Waterfall's; bracket_filling's Traditional order), same
     *  fallback role. NULL = `getDefaultDecumulationOrder()`; zod refuses repeats, the engine completes it. */
    withdrawalOrder: text("withdrawal_order", { mode: "json" }).$type<
      string[]
    >(),
    /** Household default percentage-mode splits (per-account fractions); same fallback role, NULL =
     *  `DEFAULT_WITHDRAWAL_SPLITS`. A missing account is 0; the router scales a year's sum to 100%. */
    withdrawalSplits: text("withdrawal_splits", { mode: "json" }).$type<
      Record<string, number>
    >(),
    /** G-K: upper guardrail — if currentRate < initialRate × this, increase spending (e.g. 0.80). */
    gkUpperGuardrail: decimalText("gk_upper_guardrail").default("0.80"),
    /** G-K: lower guardrail — if currentRate > initialRate × this, decrease spending (e.g. 1.20). */
    gkLowerGuardrail: decimalText("gk_lower_guardrail").default("1.20"),
    /** G-K: spending increase percentage when upper guardrail triggers (e.g. 0.10 = 10%). */
    gkIncreasePct: decimalText("gk_increase_pct").default("0.10"),
    /** G-K: spending decrease percentage when lower guardrail triggers (e.g. 0.10 = 10%). */
    gkDecreasePct: decimalText("gk_decrease_pct").default("0.10"),
    /** G-K: skip inflation adjustment in years following a portfolio loss. */
    gkSkipInflationAfterLoss: integer("gk_skip_inflation_after_loss", {
      mode: "boolean",
    })
      .notNull()
      .default(true),
    /** Spending Decline: annual real decline rate (e.g. 0.02 = 2%). */
    sdAnnualDeclineRate: decimalText("sd_annual_decline_rate").default("0.02"),
    /** Constant Percentage: withdrawal % of current balance. */
    cpWithdrawalPercent: decimalText("cp_withdrawal_percent").default("0.05"),
    /** Constant Percentage: floor as % of initial withdrawal. */
    cpFloorPercent: decimalText("cp_floor_percent").default("0.90"),
    /** Endowment: withdrawal % of rolling average balance. */
    enWithdrawalPercent: decimalText("en_withdrawal_percent").default("0.05"),
    /** Endowment: rolling window in years. */
    enRollingYears: integer("en_rolling_years").default(10),
    /** Endowment: floor as % of initial withdrawal. */
    enFloorPercent: decimalText("en_floor_percent").default("0.90"),
    /** Vanguard Dynamic: base withdrawal %. */
    vdBasePercent: decimalText("vd_base_percent").default("0.05"),
    /** Vanguard Dynamic: max YoY spending increase. */
    vdCeilingPercent: decimalText("vd_ceiling_percent").default("0.05"),
    /** Vanguard Dynamic: max YoY spending decrease. */
    vdFloorPercent: decimalText("vd_floor_percent").default("0.025"),
    /** RMD Spending: multiplier on IRS RMD amount. */
    rmdMultiplier: decimalText("rmd_multiplier").default("1.0"),
    /** VPW: the most the yearly percentage reaches (null = config default). */
    vpwCap: decimalText("vpw_cap"),
    /** VPW: the age the table runs to (null = config default). */
    vpwEndAge: integer("vpw_end_age"),
    /**
     * Per portfolio-sized strategy: true = Social Security pays part of the strategy's amount
     * (spending); false = the amount is what leaves the portfolio (the published definition).
     * Null = the strategy's config default (false).
     */
    cpSsInAmount: integer("cp_ss_in_amount", { mode: "boolean" }),
    enSsInAmount: integer("en_ss_in_amount", { mode: "boolean" }),
    vdSsInAmount: integer("vd_ss_in_amount", { mode: "boolean" }),
    rmdSsInAmount: integer("rmd_ss_in_amount", { mode: "boolean" }),
    vpwSsInAmount: integer("vpw_ss_in_amount", { mode: "boolean" }),
    /** RMD-forced withdrawal beyond spending need (after QCD): "reinvest" into brokerage
     *  (default) or "spend" (consumed, so net worth ends lower). */
    rmdExcessHandling: text("rmd_excess_handling")
      .notNull()
      .default("reinvest"),
    /** The Retirement brokerage reinvested RMD money goes to (never a Portfolio account). Null =
     *  spread over Retirement brokerages by balance, also the fallback (with a warning) for an
     *  invalid account. Household-grain per profile, on the primary person's row. */
    rmdExcessTargetPerformanceAccountId: integer(
      "rmd_excess_target_performance_account_id",
    ).references(() => performanceAccounts.id, { onDelete: "set null" }),
    /** Apply the largest QCD the RMD allows each year (capped by qcd_annual_limit and the
     *  IRA-only Traditional balance; approximated in qcd.ts), excluded from taxable income. */
    qcdMaximize: integer("qcd_maximize", { mode: "boolean" })
      .notNull()
      .default(false),
    /** Size Roth conversions to shrink a future RMD toward spending need, not just fill this
     *  year's bracket (pay tax sooner). Default false; per person, needs individual accounts. */
    rmdSmoothingEnabled: integer("rmd_smoothing_enabled", { mode: "boolean" })
      .notNull()
      .default(false),
    /** How far smoothing may raise the effective conversion target above `rothBracketTarget` /
     *  `rothConversionTarget`; never lowers it. Null = not set: the UI seeds it from the current
     *  `rothBracketTarget`, not a hardcoded value. */
    rmdSmoothingMaxBracketTarget: decimalText(
      "rmd_smoothing_max_bracket_target",
    ),
    /** Enable IRMAA awareness — constrain Roth conversions/withdrawals near Medicare surcharge cliffs (65+). */
    enableIrmaaAwareness: integer("enable_irmaa_awareness", { mode: "boolean" })
      .notNull()
      .default(false),
    /** Years someone with a job has stopped: stop saving altogether. */
    gapYearStopSaving: integer("gap_year_stop_saving", { mode: "boolean" })
      .notNull()
      .default(false),
    /** Those years, draw what pay doesn't cover; off, spending is cut to it. */
    gapYearDraws: integer("gap_year_draws", { mode: "boolean" })
      .notNull()
      .default(true),
    /** IRMAA surcharges are paid on top of the retirement budget, not inside
     *  it. The surcharge only: base Part B and D premiums aren't modeled. */
    irmaaOnTopOfBudget: integer("irmaa_on_top_of_budget", { mode: "boolean" })
      .notNull()
      .default(false),
    /** Enable ACA subsidy awareness (pre-65): report MAGI headroom below the subsidy cliff and warn when a year crosses it; never caps MAGI. */
    enableAcaAwareness: integer("enable_aca_awareness", { mode: "boolean" })
      .notNull()
      .default(false),
    /** Household size for ACA FPL calculation. */
    householdSize: integer("household_size").notNull().default(2),
    /** Filing status for retirement projections. Null = "Auto": follow
     *  this year's filing status (lib/pure/tax/filing-status.ts — the household
     *  setting, else a W-4). Resolved by resolveRetirementFilingStatus. */
    filingStatus: text("filing_status").$type<ReturnFilingStatus>(),

    // --- Retirement Profiles migration, step A (expand) ---------------------
    // Added additively; nothing reads them yet (step B switches the reads).

    /** The profile this row belongs to; with person_id, the row's key (unique index below).
     *  Nullable only because SQLite can't SET NOT NULL without a table recreate: every write
     *  sets it, and a NULL can't weaken the unique index. */
    profileId: integer("profile_id").references(() => retirementProfiles.id, {
      onDelete: "cascade",
    }),

    /** Distribution tax rates, household-grain (same on every person's row). Nullable on
     *  purpose: null = never set and reads as 0 (`!= null ? rate : 0`), kept distinct from a
     *  chosen 0%. */
    distributionTaxRateTraditional: decimalText(
      "distribution_tax_rate_traditional",
    ),
    distributionTaxRateRoth: decimalText("distribution_tax_rate_roth"),
    distributionTaxRateHsa: decimalText("distribution_tax_rate_hsa"),
    distributionTaxRateBrokerage: decimalText(
      "distribution_tax_rate_brokerage",
    ),
  },
  (table) => [
    index("retirement_settings_person_id_idx").on(table.personId),
    index("retirement_settings_profile_id_idx").on(table.profileId),
    index("retirement_settings_rmd_excess_target_idx").on(
      table.rmdExcessTargetPerformanceAccountId,
    ),
    // profile_id stays nullable (avoids SQLite's table recreate); NULLs are never equal in a
    // unique index and every write sets one, so this holds one row per person per profile.
    uniqueIndex("retirement_settings_profile_person_unq").on(
      table.profileId,
      table.personId,
    ),
  ],
);

/**
 * Retirement Profiles: a thin parent like contribution/salary profiles; the assumptions stay
 * on `retirement_settings`' typed decimal columns (keyed by profile_id), not JSON. Each profile
 * is a complete world: no baseline, default, inheritance or read-time merge.
 */
export const retirementProfiles = sqliteTable("retirement_profiles", {
  id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  description: text("description"),
  /**
   * Tax-law year this profile is priced under: `resolveTaxParams`'s base year (`onMissing:
   * "nearest"`). NULL = the latest enacted tax data ("Latest = current law" in the UI).
   */
  taxParamsYear: integer("tax_params_year"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

/**
 * Per-person retirement assumptions within a profile (only what the engine reads per person,
 * e.g. end_age). Every profile holds a row for every person (kept on profile create/duplicate,
 * person create/delete): with no baseline, a missing row is a missing retirement age.
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
    socialSecurityMonthly: decimalText("social_security_monthly"),
    /** PIA (monthly benefit at Full Retirement Age), entered by the user;
     *  the claiming-age optimizer computes from it. Opt-in and independent
     *  of socialSecurityMonthly: null until the household fills it in. */
    socialSecurityPia: decimalText("social_security_pia"),
    ssStartAge: integer("ss_start_age"),
    ruleOf55Override: integer("rule_of_55_override", { mode: "boolean" }),
    salaryAnnualIncrease: decimalText("salary_annual_increase"),
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
    overrideSalary: decimalText("override_salary").notNull(),
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
    overrideMonthlyBudget: decimalText("override_monthly_budget").notNull(),
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
  withdrawalRate: decimalText("withdrawal_rate").notNull(),
  targetAnnualIncome: decimalText("target_annual_income").notNull(),
  annualInflation: decimalText("annual_inflation").notNull(),
  distributionTaxRateTraditional: decimalText(
    "distribution_tax_rate_traditional",
  )
    .notNull()
    .default("0.22"),
  distributionTaxRateRoth: decimalText("distribution_tax_rate_roth")
    .notNull()
    .default("0"),
  distributionTaxRateHsa: decimalText("distribution_tax_rate_hsa")
    .notNull()
    .default("0"),
  distributionTaxRateBrokerage: decimalText("distribution_tax_rate_brokerage")
    .notNull()
    .default("0.15"),
  isLtBrokerageEnabled: integer("is_lt_brokerage_enabled", { mode: "boolean" })
    .notNull()
    .default(true),
  ltBrokerageAnnualContribution: decimalText("lt_brokerage_annual_contribution")
    .notNull()
    .default("0"),
  isSelected: integer("is_selected", { mode: "boolean" })
    .notNull()
    .default(false),
  notes: text("notes"),
});
