/** The What-If tab's inputs: hand edits that apply for one request only, never saved. */

import { z } from "zod/v4";
import { accountCategoryEnum } from "@/lib/config/account-types";
import { CONTRIBUTION_METHOD_VALUES } from "@/lib/config/enum-values";

/** Guardrail on the sandbox record's size — see zSandboxSalaryEntries. */
const MAX_SANDBOX_PEOPLE = 10;

/**
 * What-If salary/bonus entries (`SalaryEntryMap` shape), applied over the Salary
 * Profile by `applySandboxSalaryEntries`; a present field overrides. Size-capped:
 * it comes straight from the client on each debounced query.
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
  .refine((v) => Object.keys(v).length <= MAX_SANDBOX_PEOPLE, {
    message: `At most ${MAX_SANDBOX_PEOPLE} people may be edited at once`,
  })
  .optional();

/**
 * What-If budget item amounts by (itemId, colIndex), read by
 * `budget.computeActiveSummary` (server-side totals) and `budget.duplicateProfile`
 * (baked into the saved copy).
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
 * `itemAmountActiveFields` → `"itemId:colIndex"` → amount. A layer over the amount
 * chain: callers check this first, then fall back to the contribution-linked
 * amount, then the stored amount.
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
 * What-If amount for an existing paycheck deduction (by its real id), layered on
 * `amountPerPeriod` before `calculatePaycheck` runs.
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
 * What-If hypothetical deductions (no row), keyed by `personId` and appended for
 * the request only. `isPretax`/`ficaExempt` as on a real row (a Section 125
 * deduction is both; FICA-exempt requires pre-tax).
 */
export const zSandboxDeductionAdditions = z
  .array(
    z
      .object({
        personId: z.number().int(),
        name: z.string().trim().min(1),
        amountPerPeriod: z.number(),
        isPretax: z.boolean(),
        ficaExempt: z.boolean().default(false),
      })
      .refine((d) => !d.ficaExempt || d.isPretax, {
        message: "A FICA-exempt deduction must also be pre-tax",
        path: ["ficaExempt"],
      }),
  )
  .max(MAX_SANDBOX_DEDUCTIONS)
  .optional();

/** Guardrail on the sandbox contribution active fields below. */
const MAX_SANDBOX_CONTRIBUTION_ACTIVE_FIELDS = 30;

/**
 * What-If amount for an existing contribution account (by real id), merged by
 * `applyContribActiveFields` after the profile's own fields. A string, like the
 * `contribution_value` column.
 */
export const zSandboxContribActiveFields = z
  .record(z.string(), z.object({ contributionValue: z.string() }))
  .refine(
    (v) => Object.keys(v).length <= MAX_SANDBOX_CONTRIBUTION_ACTIVE_FIELDS,
    {
      message: `At most ${MAX_SANDBOX_CONTRIBUTION_ACTIVE_FIELDS} accounts may be edited at once`,
    },
  )
  .optional();

/**
 * What-If hypothetical contribution accounts (no row), keyed by `personId` for the
 * request only. Just the fields `contributionAccountInput` requires; the rest take
 * its defaults, with no employer match.
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
  .max(MAX_SANDBOX_CONTRIBUTION_ACTIVE_FIELDS)
  .optional();
