/** Housing and protection: the mortgage still owed, the wills/term-life/
 *  directive checklist, housing cost and the paid-off home. */
import {
  HOUSING_COST_SHARE,
  MILESTONE_CHECKLIST_TODOS,
  PAID_OFF_HOME_BY_AGE,
  PROTECTION_CHECKLIST_AGE,
  type MilestoneChecklistItem,
} from "@/lib/config/milestones";
import { formatCurrency, formatList, formatPercent } from "@/lib/utils/format";
import { calculateLoanMonthlyPayment } from "@/lib/utils/math";
import { result } from "@/lib/pure/advice/milestones/milestones.shared";
import type {
  MilestoneInput,
  MilestoneResult,
  MilestoneYear,
} from "@/lib/pure/advice/milestones/milestones.types";

/** A mortgage is still owed: the active loan, or a balance in this year's
 *  figures when the loan details aren't available. */
export function owesMortgage(
  input: MilestoneInput,
  now: MilestoneYear,
): boolean {
  return Boolean(input.mortgage?.active) || now.mortgageBalance > 0;
}

export function protection(
  input: MilestoneInput,
  now: MilestoneYear,
): MilestoneResult {
  const items: MilestoneChecklistItem[] = [
    "will",
    "termLife",
    "healthDirective",
  ];
  const done = items.filter((k) => input.checklist[k] === true).length;
  return result("protection", {
    status:
      done === items.length
        ? "reached"
        : now.age < PROTECTION_CHECKLIST_AGE
          ? "onTrack"
          : "behind",
    value: { kind: "count", amount: done },
    target: { kind: "count", amount: items.length },
    progress: done / items.length,
    headline: `${done} of ${items.length} done: wills, term life insurance, health-care directives`,
    nextStep:
      done < items.length
        ? `Still to do: ${formatList(
            items
              .filter((k) => input.checklist[k] !== true)
              .map((k) => MILESTONE_CHECKLIST_TODOS[k]),
          )} — tick each off on Milestones once done`
        : null,
  });
}

export function housing(
  input: MilestoneInput,
  now: MilestoneYear,
): MilestoneResult[] {
  const mortgage = input.mortgage;
  const out: MilestoneResult[] = [];
  const monthlyPay = now.grossIncome / 12;
  if (!mortgage?.active || monthlyPay <= 0) {
    out.push(
      result("housing", {
        status: "unknown",
        // Same "owes a mortgage" test as the paid-off-home row below, so the
        // two never disagree (a balance with no active loan on file).
        headline: mortgage?.active
          ? "Needs income"
          : owesMortgage(input, now)
            ? "Set up the mortgage to judge this"
            : "No mortgage on file",
      }),
    );
  } else {
    const share = mortgage.monthlyHousingCost / monthlyPay;
    out.push(
      result("housing", {
        status:
          share <= HOUSING_COST_SHARE.max
            ? "reached"
            : share <= HOUSING_COST_SHARE.stretch
              ? "onTrack"
              : "behind",
        value: { kind: "percent", amount: share },
        target: { kind: "percent", amount: HOUSING_COST_SHARE.max },
        headline: `Housing costs ${formatCurrency(mortgage.monthlyHousingCost)}/mo, ${formatPercent(share, 1)} of gross pay`,
        note:
          share > HOUSING_COST_SHARE.max && share <= HOUSING_COST_SHARE.stretch
            ? `Over ${formatPercent(HOUSING_COST_SHARE.max)}, within Money Guy's high-cost-area allowance`
            : null,
        nextStep:
          share > HOUSING_COST_SHARE.max
            ? `Housing costs are over ${formatPercent(HOUSING_COST_SHARE.max)} of gross pay — hold them steady and raises bring them under over time`
            : null,
      }),
    );
  }

  if (!owesMortgage(input, now)) {
    const hadMortgage = input.years.some((y) => y.mortgageBalance > 0);
    let paidYear: number | null = null;
    for (let i = 1; i < input.years.length; i++) {
      if (
        input.years[i - 1]!.mortgageBalance > 0 &&
        input.years[i]!.mortgageBalance <= 0
      )
        paidYear = input.years[i]!.year;
    }
    out.push(
      hadMortgage || mortgage
        ? result("paidOffHome", {
            status: "reached",
            headline: "Paid off",
            reachedYear: paidYear,
            note: paidYear ? `Paid off ${paidYear}` : null,
            achievements: paidYear
              ? [{ year: paidYear, label: "Mortgage paid off" }]
              : [],
          })
        : result("paidOffHome", {
            status: "unknown",
            headline: "No mortgage on file",
          }),
    );
  } else {
    const payoffYear = mortgage?.payoffYear ?? null;
    const payoffAge =
      payoffYear !== null ? now.age + (payoffYear - input.asOfYear) : null;
    out.push(
      result("paidOffHome", {
        status:
          payoffAge === null
            ? "unknown"
            : payoffAge <= PAID_OFF_HOME_BY_AGE
              ? "onTrack"
              : "behind",
        headline: payoffYear
          ? `Mortgage paid off ${payoffYear}`
          : "Mortgage payoff date unknown",
        expectedYear: payoffYear,
        expectedAge: payoffAge,
        nextStep:
          payoffAge !== null && payoffAge > PAID_OFF_HOME_BY_AGE
            ? (() => {
                const late = `on schedule ${Math.ceil(payoffAge - PAID_OFF_HOME_BY_AGE)} years after age ${PAID_OFF_HOME_BY_AGE}`;
                const extra = extraPrincipalToPayOffBy(
                  mortgage,
                  (PAID_OFF_HOME_BY_AGE - now.age) * 12,
                );
                return extra !== null
                  ? `Pay about ${formatCurrency(extra)} more principal a month to own the home by ${PAID_OFF_HOME_BY_AGE} — it's ${late}`
                  : `Make extra principal payments to own the home by ${PAID_OFF_HOME_BY_AGE} — it's ${late}`;
              })()
            : null,
      }),
    );
  }
  return out;
}

/** The extra principal a month that pays the balance off in `months`, on
 *  top of today's principal + interest; null when it can't be sized (no
 *  balance or rate, or no months left). */
export function extraPrincipalToPayOffBy(
  mortgage: MilestoneInput["mortgage"],
  months: number,
): number | null {
  const balance = mortgage?.balance;
  const rate = mortgage?.annualRate;
  const pi = mortgage?.principalAndInterest;
  if (balance == null || rate == null || pi == null || balance <= 0)
    return null;
  if (months < 1) return null;
  const needed = calculateLoanMonthlyPayment(balance, rate, months / 12);
  return Math.max(0, needed - pi);
}
