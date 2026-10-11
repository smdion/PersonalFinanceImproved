/**
 * Does money arriving in an account match what the paycheck setup says?
 * Pure. Feeds often report one row per fund per payday, so deposits are
 * summed by day first; the typical payday amount and spacing then give a
 * yearly pace to compare with the setup's yearly total (employee +
 * employer). Medians, so one bonus or missed payday doesn't skew it.
 */
import { roundToCents } from "@/lib/utils/math";

/** How far the observed pace may differ from the setup and still "match". */
export const DEPOSIT_MATCH_TOLERANCE = 0.1;
/** Paydays needed before judging a pace. */
const MIN_PAYDAYS = 3;

export type DepositVerdict =
  /** The feed sends no transactions (balance only, or not linked). */
  | "unknown"
  /** No setup and no deposits — nothing to compare. */
  | "none"
  /** Deposits arrive but no contribution is set up for this account. */
  | "no_setup"
  /** A contribution is set up but no deposits arrived in the window. */
  | "no_deposits"
  /** Too few paydays to judge a pace yet. */
  | "too_few"
  | "matches"
  | "lower"
  | "higher";

export type DepositCheck = {
  verdict: DepositVerdict;
  /** Newest first, at most three. */
  recent: { day: string; amount: number }[];
  paydays: number;
  /** Typical payday amount. */
  typical: number | null;
  /** Typical days between paydays. */
  everyDays: number | null;
  observedAnnual: number | null;
  expectedAnnual: number | null;
};

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

const dayGap = (a: string, b: string) =>
  (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000;

export function checkDeposits(
  deposits: readonly { posted: string; amount: number }[],
  expectedAnnual: number | null,
  sendsTransactions: boolean,
): DepositCheck {
  const byDay = new Map<string, number>();
  for (const d of deposits)
    byDay.set(d.posted, (byDay.get(d.posted) ?? 0) + d.amount);
  const days = [...byDay.entries()]
    .filter(([, amount]) => amount > 0)
    .sort(([a], [b]) => a.localeCompare(b));
  const expected = expectedAnnual && expectedAnnual > 0 ? expectedAnnual : null;
  const base: DepositCheck = {
    verdict: "unknown",
    recent: days
      .slice(-3)
      .reverse()
      .map(([day, amount]) => ({ day, amount: roundToCents(amount) })),
    paydays: days.length,
    typical: null,
    everyDays: null,
    observedAnnual: null,
    expectedAnnual: expected === null ? null : roundToCents(expected),
  };
  if (!sendsTransactions) return base;
  if (days.length === 0)
    return { ...base, verdict: expected ? "no_deposits" : "none" };
  if (days.length < MIN_PAYDAYS)
    return { ...base, verdict: expected ? "too_few" : "no_setup" };

  const typical = median(days.map(([, a]) => a));
  const gaps = days.slice(1).map(([d], i) => dayGap(days[i]![0], d));
  const everyDays = median(gaps);
  const observedAnnual = everyDays > 0 ? (typical * 365) / everyDays : null;
  const measured = {
    ...base,
    typical: roundToCents(typical),
    everyDays: Math.round(everyDays),
    observedAnnual:
      observedAnnual === null ? null : roundToCents(observedAnnual),
  };
  if (!expected) return { ...measured, verdict: "no_setup" };
  if (observedAnnual === null) return { ...measured, verdict: "too_few" };
  const off = (observedAnnual - expected) / expected;
  return {
    ...measured,
    verdict:
      Math.abs(off) <= DEPOSIT_MATCH_TOLERANCE
        ? "matches"
        : off < 0
          ? "lower"
          : "higher",
  };
}
