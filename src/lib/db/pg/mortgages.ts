// Part of the Drizzle schema (PostgreSQL) — see schema-pg.ts.

import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  date,
  decimal,
  uniqueIndex,
  index,
  check,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type {
  UtilityKind,
  UtilityUnit,
  DebtKind,
  UtilitySource,
} from "@/lib/config/enum-values";
import { people } from "./people";

// ────────────────────────────────────────────────────────────────────────────
// 9. Mortgages
// ────────────────────────────────────────────────────────────────────────────

export const mortgageLoans = pgTable(
  "mortgage_loans",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    isActive: boolean("is_active").notNull().default(false),
    // Self-reference to this table's own id (the loan this one replaced via
    // refinance). ON DELETE SET NULL: deleting an old, refinanced-away loan
    // shouldn't be blocked by a newer loan's pointer to it; the pointer just
    // clears. Expressed as a lazy self-reference so the FK lives in the
    // generated schema rather than a hand-written migration.
    refinancedFromId: integer("refinanced_from_id").references(
      (): AnyPgColumn => mortgageLoans.id,
      { onDelete: "set null" },
    ),
    paidOffDate: date("paid_off_date"),
    principalAndInterest: decimal("principal_and_interest", {
      precision: 14,
      scale: 2,
    }).notNull(),
    pmi: decimal("pmi", { precision: 14, scale: 2 }).notNull().default("0"),
    insuranceAndTaxes: decimal("insurance_and_taxes", {
      precision: 14,
      scale: 2,
    })
      .notNull()
      .default("0"),
    totalEscrow: decimal("total_escrow", { precision: 14, scale: 2 })
      .notNull()
      .default("0"),
    interestRate: decimal("interest_rate", {
      precision: 8,
      scale: 6,
    }).notNull(),
    termYears: integer("term_years").notNull(),
    originalLoanAmount: decimal("original_loan_amount", {
      precision: 14,
      scale: 2,
    }).notNull(),
    firstPaymentDate: date("first_payment_date").notNull(),
    propertyValuePurchase: decimal("property_value_purchase", {
      precision: 14,
      scale: 2,
    }).notNull(),
    propertyValueEstimated: decimal("property_value_estimated", {
      precision: 14,
      scale: 2,
    }),
    usePurchaseOrEstimated: text("use_purchase_or_estimated")
      .notNull()
      .default("purchase"),
    apiBalance: decimal("api_balance", { precision: 14, scale: 2 }),
    apiBalanceDate: date("api_balance_date"),
  },
  (table) => [
    index("mortgage_loans_is_active_idx").on(table.isActive),
    index("mortgage_loans_refinanced_from_id_idx").on(table.refinancedFromId),
  ],
);

export const mortgageWhatIfScenarios = pgTable(
  "mortgage_what_if_scenarios",
  {
    id: serial("id").primaryKey(),
    loanId: integer("loan_id").references(() => mortgageLoans.id, {
      onDelete: "cascade",
    }),
    label: text("label").notNull(),
    extraMonthlyPrincipal: decimal("extra_monthly_principal", {
      precision: 14,
      scale: 2,
    }).notNull(),
    extraOneTimePayment: decimal("extra_one_time_payment", {
      precision: 14,
      scale: 2,
    })
      .notNull()
      .default("0"),
    refinanceRate: decimal("refinance_rate", { precision: 8, scale: 6 }),
    refinanceTerm: integer("refinance_term"),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (table) => [index("mortgage_what_if_loan_id_idx").on(table.loanId)],
);

export const mortgageExtraPayments = pgTable(
  "mortgage_extra_payments",
  {
    id: serial("id").primaryKey(),
    loanId: integer("loan_id")
      .notNull()
      .references(() => mortgageLoans.id, { onDelete: "cascade" }),
    paymentDate: date("payment_date"),
    startDate: date("start_date"),
    endDate: date("end_date"),
    amount: decimal("amount", { precision: 14, scale: 2 }).notNull(),
    isActual: boolean("is_actual").notNull().default(false),
    notes: text("notes"),
  },
  (table) => [
    index("mortgage_extra_payments_loan_id_idx").on(table.loanId),
    check(
      "date_pattern_check",
      sql`(payment_date IS NOT NULL AND start_date IS NULL AND end_date IS NULL) OR (payment_date IS NULL AND start_date IS NOT NULL AND end_date IS NOT NULL)`,
    ),
  ],
);

/**
 * Debts other than the mortgage — student and car loans, credit cards
 * carried month to month, personal and medical debt. One row per debt, kept
 * after it's paid off (paid_off_date) as history. Balances are what the
 * household entered, as of `balance_as_of` — never amortized forward into
 * net worth; the payoff estimate is computed on read
 * (utils/math.ts `loanPayoffMonths`). A household fact, the same in every
 * profile.
 */
export const debts = pgTable(
  "debts",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    kind: text("kind").$type<DebtKind>().notNull(),
    /** Null: joint / household. */
    ownerPersonId: integer("owner_person_id").references(() => people.id, {
      onDelete: "restrict",
    }),
    balance: decimal("balance", { precision: 14, scale: 2 }).notNull(),
    balanceAsOf: date("balance_as_of").notNull(),
    originalAmount: decimal("original_amount", { precision: 14, scale: 2 }),
    /** Annual rate as a fraction (0.065 = 6.5%). */
    interestRate: decimal("interest_rate", { precision: 8, scale: 6 }),
    /** What the household pays each month (not the card's minimum). */
    monthlyPayment: decimal("monthly_payment", { precision: 14, scale: 2 }),
    openedDate: date("opened_date"),
    paidOffDate: date("paid_off_date"),
    notes: text("notes"),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (table) => [index("debts_owner_person_id_idx").on(table.ownerPersonId)],
);

export const propertyTaxes = pgTable(
  "property_taxes",
  {
    id: serial("id").primaryKey(),
    loanId: integer("loan_id")
      .notNull()
      .references(() => mortgageLoans.id, { onDelete: "cascade" }),
    year: integer("year").notNull(),
    assessedValue: decimal("assessed_value", { precision: 14, scale: 2 }),
    taxAmount: decimal("tax_amount", { precision: 14, scale: 2 }).notNull(),
    note: text("note"),
  },
  (table) => [
    uniqueIndex("property_taxes_loan_year_idx").on(table.loanId, table.year),
  ],
);

// Utility services — one row per metered house utility (gas / water / electric).
// Standalone tracker; not yet wired into the budget/projection (additive-ready).
export const utilityService = pgTable(
  "utility_service",
  {
    id: serial("id").primaryKey(),
    kind: text("kind").$type<UtilityKind>().notNull(),
    providerName: text("provider_name").notNull(),
    // Nullable for forward-compat with future utilities that may lack a metered
    // usage unit; seeded gas=ccf, water=gallon, electric=kWh.
    usageUnit: text("usage_unit").$type<UtilityUnit>(),
    sortOrder: integer("sort_order").notNull().default(0),
    active: boolean("active").notNull().default(true),
    /** The budget category (in whichever budget service is active) this
     *  service's cost is fed from — by id, not name (names change). Null:
     *  not fed; costs are typed in. */
    budgetApiCategoryId: text("budget_api_category_id"),
    /** Months a bill is paid after the month it covers (a payment in March
     *  for February's gas is 1). */
    billingLagMonths: integer("billing_lag_months").notNull().default(0),
  },
  (table) => [
    // Unique by kind makes the spreadsheet import idempotent (one service per kind).
    uniqueIndex("utility_service_kind_idx").on(table.kind),
  ],
);

// Utility readings — one row per service per month (the only stored facts).
// Derived values ($/unit, avg, min/max, totals, YoY) are computed in the router.
export const utilityReading = pgTable(
  "utility_reading",
  {
    id: serial("id").primaryKey(),
    serviceId: integer("service_id")
      .notNull()
      .references(() => utilityService.id, { onDelete: "cascade" }),
    year: integer("year").notNull(),
    month: integer("month").notNull(), // 1–12, app-validated (no CHECK; sqlite codegen strips them)
    cost: decimal("cost", { precision: 14, scale: 2 }).notNull(),
    // Nullable: some bills are cost-only (e.g. 2018 move-in year). scale 4 keeps
    // fractional meter reads (e.g. ccf/kWh sub-unit precision) lossless.
    usage: decimal("usage", { precision: 14, scale: 4 }),
    note: text("note"),
    /** Who wrote `cost`: typed in, the one-time import, or the budget feed
     *  (YNAB / Actual). Null: from before sources were tracked — treated as
     *  typed in, so the feed never overwrites it. */
    source: text("source").$type<UtilitySource>(),
  },
  (table) => [
    // Composite unique drives idempotent upserts AND covers the serviceId FK as
    // its leading column, so no separate serviceId index is needed.
    uniqueIndex("utility_reading_service_year_month_idx").on(
      table.serviceId,
      table.year,
      table.month,
    ),
  ],
);
