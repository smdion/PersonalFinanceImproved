// Part of the Drizzle schema (PostgreSQL) — see schema-pg.ts.

import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  timestamp,
  decimal,
  varchar,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { DEFAULT_WITHDRAWAL_RATE } from "@/lib/constants";
import type { ReturnFilingStatus } from "@/lib/config/filing-status";
import { contributionProfiles, salaryProfiles } from "./contribution-profiles";
import { people } from "./people";
import { performanceAccounts } from "./performance";

// ────────────────────────────────────────────────────────────────────────────
// 10. Retirement settings
// ────────────────────────────────────────────────────────────────────────────

export const retirementSettings = pgTable(
  "retirement_settings",
  {
    id: serial("id").primaryKey(),
    // One row per person per profile (composite unique index below), so each retirement
    // profile holds its own household settings.
    personId: integer("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "restrict" }),
    retirementAge: integer("retirement_age").notNull(),
    endAge: integer("end_age").notNull(),
    returnAfterRetirement: decimal("return_after_retirement", {
      precision: 8,
      scale: 6,
    }).notNull(),
    annualInflation: decimal("annual_inflation", {
      precision: 8,
      scale: 6,
    }).notNull(),
    postRetirementInflation: decimal("post_retirement_inflation", {
      precision: 8,
      scale: 6,
    }),
    salaryAnnualIncrease: decimal("salary_annual_increase", {
      precision: 8,
      scale: 6,
    }).notNull(),
    salaryCap: decimal("salary_cap", { precision: 14, scale: 2 }),
    raisesDuringRetirement: boolean("raises_during_retirement")
      .notNull()
      .default(false),
    /** Per-person Rule of 55 override: true (default) = use the computed status; false = force
     *  this person's employer plans ineligible ("what if I'm not at a qualifying job"). Never
     *  forces eligibility on. */
    ruleOf55Override: boolean("rule_of_55_override").notNull().default(true),
    withdrawalRate: decimal("withdrawal_rate", { precision: 8, scale: 6 })
      .notNull()
      .default(DEFAULT_WITHDRAWAL_RATE.toString()),
    taxMultiplier: decimal("tax_multiplier", { precision: 8, scale: 6 })
      .notNull()
      .default("1.0"),
    grossUpForTaxes: boolean("gross_up_for_taxes").notNull().default(true),
    /** Target marginal rate for Roth optimization (e.g. 0.12 = stay in 12% bracket). Null = disabled. */
    rothBracketTarget: decimal("roth_bracket_target", {
      precision: 8,
      scale: 6,
    }).default("0.12"),
    /** Monthly Social Security benefit estimate in today's dollars. */
    socialSecurityMonthly: decimal("social_security_monthly", {
      precision: 14,
      scale: 2,
    })
      .notNull()
      .default("2500"),
    /** Age at which Social Security income begins. */
    ssStartAge: integer("ss_start_age").notNull().default(67),
    /** Enable automatic Roth conversions during decumulation (fills target bracket). */
    enableRothConversions: boolean("enable_roth_conversions")
      .notNull()
      .default(false),
    /** Target marginal rate for Roth conversions (null = inherit from rothBracketTarget). */
    rothConversionTarget: decimal("roth_conversion_target", {
      precision: 8,
      scale: 6,
    }),
    /** Withdrawal/spending strategy (see withdrawal-strategies.ts registry). */
    withdrawalStrategy: varchar("withdrawal_strategy", { length: 30 })
      .notNull()
      .default("fixed"),
    /** Within the cost-ranked tier, whether Roth basis or brokerage 0%-LTCG room drains first.
     *  "brokerage_first" is a household opt-in: those gains still count toward MAGI for ACA/IRMAA,
     *  trading that cost for using the annual 0%-LTCG room sooner. */
    discretionaryWithdrawalOrder: varchar("discretionary_withdrawal_order", {
      length: 20,
    })
      .notNull()
      .default("roth_first"),
    /** Household default `withdrawalRoutingMode` (WHICH accounts fund a year; `withdrawalStrategy`
     *  is HOW MUCH): `buildDecumulationDefaults`'s fallback when the client sends none. An enum in
     *  zod (`retirementSettingsInput`), not a CHECK (that forces SQLite's table recreate). */
    withdrawalRoutingMode: varchar("withdrawal_routing_mode", { length: 20 })
      .notNull()
      .default("bracket_filling"),
    /** Household default withdrawal ORDER (Waterfall's sequence; bracket_filling's Traditional
     *  order); same fallback role as above. NULL = `getDefaultDecumulationOrder()`, never a copy.
     *  Zod rejects bad or duplicate entries; the engine completes a partial list. */
    withdrawalOrder: jsonb("withdrawal_order").$type<string[]>(),
    /** Household default percentage-mode splits (per-account fractions, roughly summing to 1);
     *  same fallback role, NULL = `DEFAULT_WITHDRAWAL_SPLITS`. A missing account is 0 and the
     *  engine redistributes proportionally. */
    withdrawalSplits:
      jsonb("withdrawal_splits").$type<Record<string, number>>(),
    /** G-K: upper guardrail — if currentRate < initialRate × this, increase spending (e.g. 0.80). */
    gkUpperGuardrail: decimal("gk_upper_guardrail", {
      precision: 8,
      scale: 6,
    }).default("0.80"),
    /** G-K: lower guardrail — if currentRate > initialRate × this, decrease spending (e.g. 1.20). */
    gkLowerGuardrail: decimal("gk_lower_guardrail", {
      precision: 8,
      scale: 6,
    }).default("1.20"),
    /** G-K: spending increase percentage when upper guardrail triggers (e.g. 0.10 = 10%). */
    gkIncreasePct: decimal("gk_increase_pct", {
      precision: 8,
      scale: 6,
    }).default("0.10"),
    /** G-K: spending decrease percentage when lower guardrail triggers (e.g. 0.10 = 10%). */
    gkDecreasePct: decimal("gk_decrease_pct", {
      precision: 8,
      scale: 6,
    }).default("0.10"),
    /** G-K: skip inflation adjustment in years following a portfolio loss. */
    gkSkipInflationAfterLoss: boolean("gk_skip_inflation_after_loss")
      .notNull()
      .default(true),
    /** Spending Decline: annual real decline rate (e.g. 0.02 = 2%). */
    sdAnnualDeclineRate: decimal("sd_annual_decline_rate", {
      precision: 12,
      scale: 6,
    }).default("0.02"),
    /** Constant Percentage: withdrawal % of current balance. */
    cpWithdrawalPercent: decimal("cp_withdrawal_percent", {
      precision: 12,
      scale: 6,
    }).default("0.05"),
    /** Constant Percentage: floor as % of initial withdrawal. */
    cpFloorPercent: decimal("cp_floor_percent", {
      precision: 12,
      scale: 6,
    }).default("0.90"),
    /** Endowment: withdrawal % of rolling average balance. */
    enWithdrawalPercent: decimal("en_withdrawal_percent", {
      precision: 12,
      scale: 6,
    }).default("0.05"),
    /** Endowment: rolling window in years. */
    enRollingYears: integer("en_rolling_years").default(10),
    /** Endowment: floor as % of initial withdrawal. */
    enFloorPercent: decimal("en_floor_percent", {
      precision: 12,
      scale: 6,
    }).default("0.90"),
    /** Vanguard Dynamic: base withdrawal %. */
    vdBasePercent: decimal("vd_base_percent", {
      precision: 12,
      scale: 6,
    }).default("0.05"),
    /** Vanguard Dynamic: max YoY spending increase. */
    vdCeilingPercent: decimal("vd_ceiling_percent", {
      precision: 12,
      scale: 6,
    }).default("0.05"),
    /** Vanguard Dynamic: max YoY spending decrease. */
    vdFloorPercent: decimal("vd_floor_percent", {
      precision: 12,
      scale: 6,
    }).default("0.025"),
    /** RMD Spending: multiplier on IRS RMD amount. */
    rmdMultiplier: decimal("rmd_multiplier", {
      precision: 12,
      scale: 6,
    }).default("1.0"),
    /** VPW: the most the yearly percentage reaches (null = config default). */
    vpwCap: decimal("vpw_cap", { precision: 12, scale: 6 }),
    /** VPW: the age the table runs to (null = config default). */
    vpwEndAge: integer("vpw_end_age"),
    /**
     * Per portfolio-sized strategy: true = Social Security pays part of the strategy's amount
     * (spending); false = the amount is what leaves the portfolio (the published definition).
     * Null = the strategy's config default (false).
     */
    cpSsInAmount: boolean("cp_ss_in_amount"),
    enSsInAmount: boolean("en_ss_in_amount"),
    vdSsInAmount: boolean("vd_ss_in_amount"),
    rmdSsInAmount: boolean("rmd_ss_in_amount"),
    vpwSsInAmount: boolean("vpw_ss_in_amount"),
    /** RMD-forced withdrawal beyond spending need (after QCD): "reinvest" into brokerage
     *  (default) or "spend" (consumed, so net worth ends lower). */
    rmdExcessHandling: varchar("rmd_excess_handling", { length: 20 })
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
    qcdMaximize: boolean("qcd_maximize").notNull().default(false),
    /** Size Roth conversions to shrink a future RMD toward spending need, not just fill this
     *  year's bracket (pay tax sooner). Default false; per person, needs individual accounts. */
    rmdSmoothingEnabled: boolean("rmd_smoothing_enabled")
      .notNull()
      .default(false),
    /** How far smoothing may raise the effective conversion target above `rothBracketTarget` /
     *  `rothConversionTarget`; never lowers it. Null = not set: the UI seeds it from the current
     *  `rothBracketTarget`, not a hardcoded value. */
    rmdSmoothingMaxBracketTarget: decimal("rmd_smoothing_max_bracket_target", {
      precision: 8,
      scale: 6,
    }),
    /** Enable IRMAA awareness — constrain Roth conversions/withdrawals near Medicare surcharge cliffs (65+). */
    enableIrmaaAwareness: boolean("enable_irmaa_awareness")
      .notNull()
      .default(false),
    /** Years someone with a job has stopped: stop saving altogether. */
    gapYearStopSaving: boolean("gap_year_stop_saving").notNull().default(false),
    /** Those years, draw what pay doesn't cover; off, spending is cut to it. */
    gapYearDraws: boolean("gap_year_draws").notNull().default(true),
    /** IRMAA surcharges are paid on top of the retirement budget, not inside
     *  it. The surcharge only: base Part B and D premiums aren't modeled. */
    irmaaOnTopOfBudget: boolean("irmaa_on_top_of_budget")
      .notNull()
      .default(false),
    /** Enable ACA subsidy awareness (pre-65): report MAGI headroom below the subsidy cliff and warn when a year crosses it; never caps MAGI. */
    enableAcaAwareness: boolean("enable_aca_awareness")
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
    distributionTaxRateTraditional: decimal(
      "distribution_tax_rate_traditional",
      {
        precision: 8,
        scale: 6,
      },
    ),
    distributionTaxRateRoth: decimal("distribution_tax_rate_roth", {
      precision: 8,
      scale: 6,
    }),
    distributionTaxRateHsa: decimal("distribution_tax_rate_hsa", {
      precision: 8,
      scale: 6,
    }),
    distributionTaxRateBrokerage: decimal("distribution_tax_rate_brokerage", {
      precision: 8,
      scale: 6,
    }),
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
export const retirementProfiles = pgTable("retirement_profiles", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  description: text("description"),
  /**
   * Tax-law year this profile is priced under: `resolveTaxParams`'s base year (`onMissing:
   * "nearest"`). NULL = the latest enacted tax data ("Latest = current law" in the UI).
   */
  taxParamsYear: integer("tax_params_year"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Per-person retirement assumptions within a profile (only what the engine reads per person,
 * e.g. end_age). Every profile holds a row for every person (kept on profile create/duplicate,
 * person create/delete): with no baseline, a missing row is a missing retirement age.
 */
export const retirementProfilePeople = pgTable(
  "retirement_profile_people",
  {
    id: serial("id").primaryKey(),
    profileId: integer("profile_id")
      .notNull()
      .references(() => retirementProfiles.id, { onDelete: "cascade" }),
    personId: integer("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    retirementAge: integer("retirement_age").notNull(),
    endAge: integer("end_age").notNull(),
    socialSecurityMonthly: decimal("social_security_monthly", {
      precision: 14,
      scale: 2,
    }),
    /** PIA (monthly benefit at Full Retirement Age), entered by the user;
     *  the claiming-age optimizer computes from it. Opt-in and independent
     *  of socialSecurityMonthly: null until the household fills it in. */
    socialSecurityPia: decimal("social_security_pia", {
      precision: 14,
      scale: 2,
    }),
    ssStartAge: integer("ss_start_age"),
    ruleOf55Override: boolean("rule_of_55_override"),
    salaryAnnualIncrease: decimal("salary_annual_increase", {
      precision: 8,
      scale: 6,
    }),
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

export const retirementSalaryOverrides = pgTable(
  "retirement_salary_overrides",
  {
    id: serial("id").primaryKey(),
    personId: integer("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "restrict" }),
    projectionYear: integer("projection_year").notNull(),
    overrideSalary: decimal("override_salary", {
      precision: 14,
      scale: 2,
    }).notNull(),
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

export const retirementBudgetOverrides = pgTable(
  "retirement_budget_overrides",
  {
    id: serial("id").primaryKey(),
    personId: integer("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "restrict" }),
    projectionYear: integer("projection_year").notNull(),
    overrideMonthlyBudget: decimal("override_monthly_budget", {
      precision: 14,
      scale: 2,
    }).notNull(),
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

export const projectionOverrides = pgTable(
  "projection_overrides",
  {
    id: serial("id").primaryKey(),
    overrideType: text("override_type").notNull(),
    overrides: jsonb("overrides").$type<Record<string, unknown>[]>().notNull(),
    createdBy: text("created_by"),
    updatedBy: text("updated_by"),
  },
  (table) => [
    uniqueIndex("projection_overrides_type_idx").on(table.overrideType),
  ],
);

export const retirementScenarios = pgTable("retirement_scenarios", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  withdrawalRate: decimal("withdrawal_rate", {
    precision: 8,
    scale: 6,
  }).notNull(),
  targetAnnualIncome: decimal("target_annual_income", {
    precision: 14,
    scale: 2,
  }).notNull(),
  annualInflation: decimal("annual_inflation", {
    precision: 8,
    scale: 6,
  }).notNull(),
  distributionTaxRateTraditional: decimal("distribution_tax_rate_traditional", {
    precision: 8,
    scale: 6,
  })
    .notNull()
    .default("0.22"),
  distributionTaxRateRoth: decimal("distribution_tax_rate_roth", {
    precision: 8,
    scale: 6,
  })
    .notNull()
    .default("0"),
  distributionTaxRateHsa: decimal("distribution_tax_rate_hsa", {
    precision: 8,
    scale: 6,
  })
    .notNull()
    .default("0"),
  distributionTaxRateBrokerage: decimal("distribution_tax_rate_brokerage", {
    precision: 8,
    scale: 6,
  })
    .notNull()
    .default("0.15"),
  isLtBrokerageEnabled: boolean("is_lt_brokerage_enabled")
    .notNull()
    .default(true),
  ltBrokerageAnnualContribution: decimal("lt_brokerage_annual_contribution", {
    precision: 14,
    scale: 2,
  })
    .notNull()
    .default("0"),
  isSelected: boolean("is_selected").notNull().default(false),
  notes: text("notes"),
});
