/**
 * What the household records alongside a Performance account row
 * (account_performance `note`, `estimated_fields`, `accepted_checks`):
 * where the figures came from, which are still estimates, and which
 * reconciliation gaps are on purpose.
 *
 * Stored JSON is parsed entry by entry — one bad entry (a hand edit, a
 * field renamed in a later version) drops only itself.
 */
import { z } from "zod/v4";
import {
  PERF_CHECK_KINDS,
  type PerfCheckKind,
} from "@/lib/pure/performance-checks";

/** The figures of a Performance row as the household enters them. */
export const PERF_FIELDS = [
  "beginningBalance",
  "employeeContrib",
  "employerContributions",
  "distributions",
  "rollovers",
  "fees",
  "endingBalance",
  "yearlyGainLoss",
] as const;
export type PerfField = (typeof PERF_FIELDS)[number];
export const perfFieldSchema = z.enum(PERF_FIELDS);

export const PERF_NOTE_MAX = 500;

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** A gap accepted as on purpose: the gap (dollars), why, and when. For
 *  `transfers` the amount is the row's own rollover ("no tracked other
 *  side"). The check comes back when the gap is no longer this one. */
export const acceptedCheckSchema = z.object({
  amount: z.number().finite(),
  note: z.string().trim().min(1).max(280),
  on: dateSchema,
});
export type AcceptedCheck = z.infer<typeof acceptedCheckSchema>;
export type AcceptedChecks = Partial<Record<PerfCheckKind, AcceptedCheck>>;
export const perfCheckKindSchema = z.enum(PERF_CHECK_KINDS);

export function parseEstimatedFields(raw: unknown): PerfField[] {
  if (!Array.isArray(raw)) return [];
  const out = new Set<PerfField>();
  for (const v of raw) {
    const f = perfFieldSchema.safeParse(v);
    if (f.success) out.add(f.data);
  }
  return PERF_FIELDS.filter((f) => out.has(f));
}

export function parseAcceptedChecks(raw: unknown): AcceptedChecks {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const out: AcceptedChecks = {};
  for (const [kind, value] of Object.entries(raw)) {
    const k = perfCheckKindSchema.safeParse(kind);
    const entry = acceptedCheckSchema.safeParse(value);
    if (k.success && entry.success) out[k.data] = entry.data;
  }
  return out;
}

/** Accepted amounts by kind, as the checks read them. */
export function acceptedAmounts(
  accepted: AcceptedChecks,
): Partial<Record<PerfCheckKind, number>> {
  return Object.fromEntries(
    Object.entries(accepted).map(([k, v]) => [k, v.amount]),
  );
}
