/**
 * Shared conventions for tRPC routers.
 *
 * ──────────────────────────────────────────────────────────
 * NUMERIC / DECIMAL COLUMN RETURN TYPES
 * ──────────────────────────────────────────────────────────
 *
 * Drizzle returns PostgreSQL NUMERIC(12,2) columns as `string` by default
 * to preserve decimal precision. This is intentional — JavaScript `number`
 * (IEEE 754 float64) can silently lose precision with large currency values
 * (e.g. 9_999_999_999.99 cannot be represented exactly as a float).
 *
 * Convention:
 *  - DB → tRPC response: NUMERIC columns arrive as `string` (e.g. "1234.56").
 *  - Server helpers use `toNumber()` from `@/server/helpers/transforms` to parse
 *    strings to numbers when doing arithmetic (see that module for details).
 *  - Client code should use `parseFloat(value)` or `Number(value)` when it
 *    needs a numeric value for calculations, charts, or formatting.
 *  - When writing back to the DB, convert with `.toFixed(2)` to produce a
 *    string that PostgreSQL accepts for NUMERIC columns.
 *
 * This is a deliberate trade-off: we accept minor ergonomic friction on the
 * client in exchange for zero silent precision loss across the full stack.
 * A blanket refactor to coerce everything to `number` in tRPC output schemas
 * would risk introducing rounding bugs in balances and transaction amounts.
 * ──────────────────────────────────────────────────────────
 */

// This file is intentionally declaration-only (documentation + re-exports).
// Import shared utilities from their canonical locations:
//   toNumber()           → @/server/helpers/transforms
//   zDecimal             → @/server/routers/settings/_shared
//   protectedProcedure   → @/server/trpc

import { z } from "zod/v4";
import type { SalaryActiveMap } from "@/server/helpers";
import { accountCategoryEnum } from "@/lib/config/account-types";
import { CONTRIBUTION_METHOD_VALUES } from "@/lib/config/enum-values";

/**
 * Optional "what-if" targeting for procedures that read through
 * buildYearEndHistory/getAnnualExpensesFromBudget — lets a caller (a Plan
 * pin, or a page-local profile picker) ask "what would this look like under
 * budget profile X, column Y, with these active salaries" instead of always
 * reading the globally-active budget profile and true DB salaries.
 * Every field is optional; omitting all of them reproduces the untargeted,
 * cacheable default behavior.
 */
export const zYearEndTargeting = z
  .object({
    budgetProfileId: z.number().nullable().optional(),
    budgetColumn: z.number().nullable().optional(),
    salaryActiveFields: z
      .array(z.object({ personId: z.number(), salary: z.number() }))
      .optional(),
  })
  .optional();

export type YearEndTargetingInput = z.infer<typeof zYearEndTargeting>;

/**
 * Convert a procedure's `salaryActiveFields` input array into the Map shape
 * helpers expect.
 *
 * The Plan/session tier sets an active value for SALARY ONLY — it has no
 * bonus dimension, so every entry sets exactly that one field and leaves
 * bonus terms to resolve live (or to a Salary Profile, which merges into
 * the gaps per field).
 */
export function toSalaryActiveMap(
  salaryActiveFields: { personId: number; salary: number }[] | undefined,
): SalaryActiveMap {
  return new Map(
    (salaryActiveFields ?? []).map((s) => [s.personId, { salary: s.salary }]),
  );
}

/** Guardrail on the sandbox record's size — see zSandboxSalaryEntries. */
const MAX_SANDBOX_PEOPLE = 10;

/**
 * The What-If tab's hand-edited salary/bonus entries — the same
 * `SalaryEntryMap` shape a Salary Profile's `salaries` column holds, so the
 * sandbox needs no new input shape and no new schema.
 *
 * Applied server-side by `applySandboxSalaryEntries` as the highest
 * precedence tier (above a Plan/session active salary, above a Salary
 * Profile pin, above the live job). Every field is optional and PRESENCE IS
 * THE PIN SIGNAL, exactly as on a profile row.
 *
 * Size-capped because, unlike a profile row, this arrives directly from the
 * client on every keystroke-debounced query: a household is realistically
 * 1-2 people, so 10 is generous while keeping the record from being an
 * unbounded user-controlled map.
 */
export const zSandboxSalaryEntries = z
  .record(
    z.string(),
    z.object({
      salary: z.number().optional(),
      bonusPercent: z.number().optional(),
      bonusMultiplier: z.number().optional(),
      monthsInBonusYear: z.number().int().optional(),
    }),
  )
  .refine((v) => Object.keys(v ?? {}).length <= MAX_SANDBOX_PEOPLE, {
    message: `At most ${MAX_SANDBOX_PEOPLE} people may be edited at once`,
  })
  .optional();

/**
 * The What-If tab's hand-edited budget item amounts, keyed by
 * (itemId, colIndex).
 *
 * Consumed by `budget.computeActiveSummary` (to recompute totals under the
 * sandbox's edits without a second client-side computation of the app's most
 * important number) and by `budget.duplicateProfile` (to bake the same edits
 * into a saved copy, in the copy's own transaction).
 */
export const zItemAmountActiveFields = z
  .array(
    z.object({
      itemId: z.number().int(),
      colIndex: z.number().int(),
      amount: z.number(),
    }),
  )
  .optional();

/**
 * `itemAmountActiveFields` → a `"itemId:colIndex"` → amount lookup.
 *
 * The active value is ONE MORE LAYER on top of the existing amount
 * resolution chain, never a replacement for it: callers must consult this
 * map first and fall back to whatever they resolve today (contribution-linked
 * amount, then the raw stored amount). Skipping the chain for an item with
 * an active value is the exact bug class this feature exists to avoid.
 */
export function toItemAmountActiveMap(
  activeFields:
    { itemId: number; colIndex: number; amount: number }[] | undefined,
): Map<string, number> {
  return new Map(
    (activeFields ?? []).map((o) => [`${o.itemId}:${o.colIndex}`, o.amount]),
  );
}

/** Guardrail on the sandbox deduction inputs below — same reasoning as
 *  MAX_SANDBOX_PEOPLE: realistically a handful per household, capped to
 *  keep these from being unbounded user-controlled arrays. */
const MAX_SANDBOX_DEDUCTIONS = 20;

/**
 * The What-If tab's hand-edited amount for an EXISTING paycheck deduction
 * (identified by its real `paycheck_deductions.id`). One more layer on top
 * of the stored `amountPerPeriod`, applied before `calculatePaycheck` runs
 * — never a second computation of net pay.
 */
export const zSandboxDeductionEdits = z
  .array(
    z.object({
      id: z.number().int(),
      amountPerPeriod: z.number(),
    }),
  )
  .max(MAX_SANDBOX_DEDUCTIONS)
  .optional();

/**
 * The What-If tab's hand-added HYPOTHETICAL deductions — no `paycheck_
 * deductions` row exists for these (e.g. "what if I added a $200/mo life
 * insurance premium"), so they're keyed by `personId` instead of a real id
 * and appended to that person's deduction list for the duration of the
 * request only. `ficaExempt` is not exposed here (defaults to false, i.e.
 * FICA still applies) — a hypothetical addition doesn't know the DB's
 * per-deduction FICA-exemption nuance the way a real row does, and getting
 * that wrong silently would be worse than the (disclosed) simplification.
 */
export const zSandboxDeductionAdditions = z
  .array(
    z.object({
      personId: z.number().int(),
      name: z.string().trim().min(1),
      amountPerPeriod: z.number(),
      isPretax: z.boolean(),
    }),
  )
  .max(MAX_SANDBOX_DEDUCTIONS)
  .optional();

/** Guardrail on the sandbox contribution active fields below. */
const MAX_SANDBOX_CONTRIB_ACTIVE_FIELDS = 30;

/**
 * The What-If tab's hand-edited amount for an EXISTING contribution
 * account, keyed by the real `contribution_accounts.id`. Reuses the SAME
 * generic active-field-merge mechanism a Contribution Profile's own
 * `contributionActiveFields.contributionAccounts` already goes through
 * (`applyContribActiveFields`) — this is one more layer applied AFTER the
 * picked profile's own active fields, not a parallel mechanism. Stored as a
 * string to match `contribution_accounts.contribution_value`'s own column
 * type — every downstream reader already parses that field with
 * `toNumber`, so a mismatched type here would only matter if something
 * read it raw, which nothing does.
 */
export const zSandboxContribActiveFields = z
  .record(z.string(), z.object({ contributionValue: z.string() }))
  .refine(
    (v) => Object.keys(v ?? {}).length <= MAX_SANDBOX_CONTRIB_ACTIVE_FIELDS,
    {
      message: `At most ${MAX_SANDBOX_CONTRIB_ACTIVE_FIELDS} accounts may be edited at once`,
    },
  )
  .optional();

/**
 * The What-If tab's hand-added HYPOTHETICAL contribution accounts — no
 * `contribution_accounts` row exists yet, keyed by `personId` and appended
 * to that person's account list for the duration of the request only.
 * Deliberately minimal (account type, method, value) — the same fields
 * `contributionAccountInput` (settings/paycheck.ts) actually requires,
 * everything else (institution, label, employer match, sub-accounts) takes
 * that mutation's own defaults, same as a freshly-created real account
 * would have before anyone edits it further. `employerMatchType` defaults
 * to "none" here rather than being exposed — keeping the quick-add form
 * genuinely quick; a real employer match is set up on the real Contribution
 * Profiles page.
 */
export const zSandboxContribAdditions = z
  .array(
    z.object({
      personId: z.number().int(),
      accountType: z.enum(accountCategoryEnum()),
      contributionMethod: z.enum(CONTRIBUTION_METHOD_VALUES),
      contributionValue: z.string(),
    }),
  )
  .max(MAX_SANDBOX_CONTRIB_ACTIVE_FIELDS)
  .optional();
