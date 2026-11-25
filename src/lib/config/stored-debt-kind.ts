/** A stored `debts.kind` as read (kept apart from debts.ts, which pages
 *  that never list debts bundle too). */
import { DEBT_KIND_VALUES, type DebtKind } from "./enum-values";
import { DEBT_KIND_CONFIG } from "./debts";

/** What a stored kind this version doesn't know is judged as. */
const KIND_IF_UNKNOWN = "other" satisfies DebtKind;

/** A stored `debts.kind` as read: a kind this version knows, or Other for
 *  one it doesn't (a downgrade, a hand edit; it stays stored), with the
 *  label that names it as stored. */
export function readDebtKind(stored: string): {
  value: DebtKind;
  label: string;
} {
  const known = DEBT_KIND_VALUES.find((k) => k === stored);
  const label = DEBT_KIND_CONFIG[known ?? KIND_IF_UNKNOWN].label;
  return {
    value: known ?? KIND_IF_UNKNOWN,
    label: known ? label : `Unknown kind "${stored}" (judged as ${label})`,
  };
}
