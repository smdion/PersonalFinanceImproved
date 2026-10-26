// AUTO-GENERATED from ../pg/ by scripts/gen-sqlite-schema.ts — do not edit.
// Part of the Drizzle schema (SQLite) — see schema-pg.ts.

import {
  sqliteTable,
  text,
  integer,
  uniqueIndex,
  index,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";

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

export const mortgageLoans = sqliteTable(
  "mortgage_loans",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    isActive: integer("is_active", { mode: "boolean" })
      .notNull()
      .default(false),
    // Self-reference to this table's own id (the loan this one replaced via
    // refinance). ON DELETE SET NULL: deleting an old, refinanced-away loan
    // shouldn't be blocked by a newer loan's pointer to it; the pointer just
    // clears. Expressed as a lazy self-reference so the FK lives in the
    // generated schema rather than a hand-written migration.
    refinancedFromId: integer("refinanced_from_id").references(
      (): AnySQLiteColumn => mortgageLoans.id,
      { onDelete: "set null" },
    ),
    paidOffDate: text("paid_off_date"),
    principalAndInterest: text("principal_and_interest").notNull(),
    pmi: text("pmi").notNull().default("0"),
    insuranceAndTaxes: text("insurance_and_taxes").notNull().default("0"),
    totalEscrow: text("total_escrow").notNull().default("0"),
    interestRate: text("interest_rate").notNull(),
    termYears: integer("term_years").notNull(),
    originalLoanAmount: text("original_loan_amount").notNull(),
    firstPaymentDate: text("first_payment_date").notNull(),
    propertyValuePurchase: text("property_value_purchase").notNull(),
    propertyValueEstimated: text("property_value_estimated"),
    usePurchaseOrEstimated: text("use_purchase_or_estimated")
      .notNull()
      .default("purchase"),
    apiBalance: text("api_balance"),
    apiBalanceDate: text("api_balance_date"),
  },
  (table) => [
    index("mortgage_loans_is_active_idx").on(table.isActive),
    index("mortgage_loans_refinanced_from_id_idx").on(table.refinancedFromId),
  ],
);

export const mortgageWhatIfScenarios = sqliteTable(
  "mortgage_what_if_scenarios",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    loanId: integer("loan_id").references(() => mortgageLoans.id, {
      onDelete: "cascade",
    }),
    label: text("label").notNull(),
    extraMonthlyPrincipal: text("extra_monthly_principal").notNull(),
    extraOneTimePayment: text("extra_one_time_payment").notNull().default("0"),
    refinanceRate: text("refinance_rate"),
    refinanceTerm: integer("refinance_term"),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (table) => [index("mortgage_what_if_loan_id_idx").on(table.loanId)],
);

export const mortgageExtraPayments = sqliteTable(
  "mortgage_extra_payments",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    loanId: integer("loan_id")
      .notNull()
      .references(() => mortgageLoans.id, { onDelete: "cascade" }),
    paymentDate: text("payment_date"),
    startDate: text("start_date"),
    endDate: text("end_date"),
    amount: text("amount").notNull(),
    isActual: integer("is_actual", { mode: "boolean" })
      .notNull()
      .default(false),
    notes: text("notes"),
  },
  (table) => [index("mortgage_extra_payments_loan_id_idx").on(table.loanId)],
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
export const debts = sqliteTable(
  "debts",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    kind: text("kind").$type<DebtKind>().notNull(),
    /** Null: joint / household. */
    ownerPersonId: integer("owner_person_id").references(() => people.id, {
      onDelete: "restrict",
    }),
    balance: text("balance").notNull(),
    balanceAsOf: text("balance_as_of").notNull(),
    originalAmount: text("original_amount"),
    /** Annual rate as a fraction (0.065 = 6.5%). */
    interestRate: text("interest_rate"),
    /** What the household pays each month (not the card's minimum). */
    monthlyPayment: text("monthly_payment"),
    openedDate: text("opened_date"),
    paidOffDate: text("paid_off_date"),
    notes: text("notes"),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (table) => [index("debts_owner_person_id_idx").on(table.ownerPersonId)],
);

export const propertyTaxes = sqliteTable(
  "property_taxes",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    loanId: integer("loan_id")
      .notNull()
      .references(() => mortgageLoans.id, { onDelete: "cascade" }),
    year: integer("year").notNull(),
    assessedValue: text("assessed_value"),
    taxAmount: text("tax_amount").notNull(),
    note: text("note"),
  },
  (table) => [
    uniqueIndex("property_taxes_loan_year_idx").on(table.loanId, table.year),
  ],
);

// Utility services — one row per metered house utility (gas / water / electric).
// Standalone tracker; not yet wired into the budget/projection (additive-ready).
export const utilityService = sqliteTable(
  "utility_service",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    kind: text("kind").$type<UtilityKind>().notNull(),
    providerName: text("provider_name").notNull(),
    // Nullable for forward-compat with future utilities that may lack a metered
    // usage unit; seeded gas=ccf, water=gallon, electric=kWh.
    usageUnit: text("usage_unit").$type<UtilityUnit>(),
    sortOrder: integer("sort_order").notNull().default(0),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
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
export const utilityReading = sqliteTable(
  "utility_reading",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    serviceId: integer("service_id")
      .notNull()
      .references(() => utilityService.id, { onDelete: "cascade" }),
    year: integer("year").notNull(),
    month: integer("month").notNull(), // 1–12, app-validated (no CHECK; sqlite codegen strips them)
    cost: text("cost").notNull(),
    // Nullable: some bills are cost-only (e.g. 2018 move-in year). scale 4 keeps
    // fractional meter reads (e.g. ccf/kWh sub-unit precision) lossless.
    usage: text("usage"),
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
