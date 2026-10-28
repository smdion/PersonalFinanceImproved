/**
 * Debt kinds: their labels and the rate above which each counts as
 * high-interest — Money Guy's line, which moves with age (Financial Order
 * of Operations step 3; milestones foo3). The line lives here only; the
 * milestone's note reads it.
 */
import type { DebtKind } from "./enum-values";

/** The age bands the line moves with: under 30, 30s, 40 and over. */
type DebtAgeBand = "20s" | "30s" | "40s+";

type DebtKindConfig = {
  label: string;
  /** High-interest above this annual rate, by age band; `0` = any balance
   *  counts (credit cards). */
  highInterestAbove: Record<DebtAgeBand, number>;
};

/** Car-loan line — personal, medical and other debts are judged like it. */
const CAR_LINE = { "20s": 0.1, "30s": 0.09, "40s+": 0.08 };

export const DEBT_KIND_CONFIG: Record<DebtKind, DebtKindConfig> = {
  student_loan: {
    label: "Student loan",
    highInterestAbove: { "20s": 0.06, "30s": 0.05, "40s+": 0.04 },
  },
  auto_loan: { label: "Car loan", highInterestAbove: CAR_LINE },
  credit_card: {
    label: "Credit card",
    highInterestAbove: { "20s": 0, "30s": 0, "40s+": 0 },
  },
  personal_loan: { label: "Personal loan", highInterestAbove: CAR_LINE },
  medical: { label: "Medical", highInterestAbove: CAR_LINE },
  other: { label: "Other", highInterestAbove: CAR_LINE },
};

/** The age band for a person's age (whole years). */
function debtAgeBand(age: number): DebtAgeBand {
  return age < 30 ? "20s" : age < 40 ? "30s" : "40s+";
}

/** Is a debt high-interest for its owner's age? A credit card carried is,
 *  at any rate. */
export function isHighInterestDebt(
  kind: DebtKind,
  annualRate: number,
  ownerAge: number,
): boolean {
  const line = DEBT_KIND_CONFIG[kind].highInterestAbove[debtAgeBand(ownerAge)];
  return line === 0 ? true : annualRate > line;
}

/** Money Guy's line in words, from the table above. */
export function highInterestLineText(): string {
  const pct = (r: number) => `${Math.round(r * 100)}%`;
  const s = DEBT_KIND_CONFIG.student_loan.highInterestAbove;
  const c = DEBT_KIND_CONFIG.auto_loan.highInterestAbove;
  return `Money Guy's line moves with age: student loans above ${pct(s["20s"])} in your 20s, ${pct(s["30s"])} in your 30s, ${pct(s["40s+"])} from your 40s; car loans (and personal, medical or other debt) above ${pct(c["20s"])} / ${pct(c["30s"])} / ${pct(c["40s+"])}; any credit card balance you carry.`;
}
