/** Saving habits and safety: savings rate, raises, always buying, student
 *  loans, the emergency fund and the car rule. */
import {
  CAR_RULE,
  EMERGENCY_FUND_MONTHS,
  MONEY_GUY_SAVINGS_RATE,
  PF_RETIREMENT_RATE,
  RAISE_RULE,
} from "@/lib/config/milestones";
import {
  formatCurrency,
  formatNumber,
  formatPercent,
  formatSavingsRate,
} from "@/lib/utils/format";
import { safeDivide } from "@/lib/utils/math";
import { meetsRaiseRule } from "@/lib/pure/household/raise-history";
import { recentCoveredMonths } from "@/lib/pure/investments/always-buying";
import { carPaymentShare, checkCarLoan } from "@/lib/pure/debts/debt-rules";
import {
  meetsMoneyGuyRate,
  meetsRateTarget,
  result,
} from "@/lib/pure/advice/milestones/milestones.shared";
import type {
  MilestoneInput,
  MilestoneResult,
  MilestoneYear,
} from "@/lib/pure/advice/milestones/milestones.types";

// ---------------------------------------------------------------------------
// Saving, FOO, safety, home, investing
// ---------------------------------------------------------------------------

export function savingsRate(input: MilestoneInput): MilestoneResult {
  const s = input.savings;
  if (!s || s.compensation <= 0) {
    return result("savingsRate", {
      status: "unknown",
      headline: "Needs a paycheck set up",
    });
  }
  const met = meetsMoneyGuyRate(s.rate);
  const gapPerMonth = (MONEY_GUY_SAVINGS_RATE * s.compensation - s.saved) / 12;
  return result("savingsRate", {
    status: met ? "reached" : "behind",
    value: { kind: "percent", amount: s.rate },
    target: { kind: "percent", amount: MONEY_GUY_SAVINGS_RATE },
    progress: Math.min(1, s.rate / MONEY_GUY_SAVINGS_RATE),
    headline: `Saving ${formatSavingsRate(s.rate)} of gross pay`,
    note: [
      s.retirementRate < s.rate
        ? `${formatSavingsRate(s.retirementRate)} into Retirement accounts`
        : null,
      s.matchCounted
        ? "employer match counted"
        : `employer match left out (pay over ${formatCurrency(s.highIncomeThreshold)})`,
    ]
      .filter(Boolean)
      .join(" · "),
    nextStep: met
      ? null
      : `Save ${formatCurrency(gapPerMonth)} more a month to reach a ${formatSavingsRate(MONEY_GUY_SAVINGS_RATE)} savings rate${(() => {
          const first = whereToSaveFirst(input);
          return first ? ` — ${first}` : "";
        })()}`,
    impact: met ? null : { kind: "perYear", amount: gapPerMonth * 12 },
  });
}

/** Money Guy's student-loan rule, per person. */
export function studentLoans(input: MilestoneInput): MilestoneResult {
  const b = input.borrowing;
  if (!b) {
    return result("studentLoans", {
      status: "unknown",
      headline: "Needs the debts list",
    });
  }
  if (b.studentLoans.length === 0) {
    return result("studentLoans", {
      status: b.jointStudentLoans > 0 ? "unknown" : "reached",
      headline:
        b.jointStudentLoans > 0
          ? "Give each student loan an owner to judge it"
          : "No student loans",
      nextStepFocus: b.jointStudentLoans > 0 ? { topic: "debts" } : undefined,
    });
  }
  const judged: {
    owner: string;
    total: number;
    salary: number;
    year: number;
  }[] = [];
  const reasons: string[] = [];
  // Loans with no owner aren't anyone's to judge — said, never dropped
  // because someone else's loans could be judged.
  if (b.jointStudentLoans > 0)
    reasons.push("Give each student loan an owner to judge it");
  for (const p of b.studentLoans) {
    if (p.totalOriginal === null)
      reasons.push(`${p.owner}: add each loan's original amount`);
    else if (p.loanYear === null)
      reasons.push(`${p.owner}: add when the loans were opened`);
    else if (!p.firstSalary)
      reasons.push(
        `${p.owner}: no full year of salary on record within a few years of the loans`,
      );
    else
      judged.push({
        owner: p.owner,
        total: p.totalOriginal,
        salary: p.firstSalary.salary,
        year: p.firstSalary.year,
      });
  }
  const over = judged.filter((j) => j.total > j.salary);
  const describe = (j: (typeof judged)[number]) =>
    `${j.owner} borrowed ${formatCurrency(j.total, 0)} against ${formatCurrency(j.salary, 0)} earned in ${j.year}`;
  if (over.length > 0) {
    return result("studentLoans", {
      status: "behind",
      headline: describe(over[0]!),
      short: `${formatCurrency(over[0]!.total - over[0]!.salary, 0)} over`,
      note: [...over.slice(1).map(describe), ...reasons].join(" · ") || null,
      nextStep:
        "Pay the student loans down — and for more school, borrow no more than the first year's pay",
      nextStepFocus: { topic: "debts" },
    });
  }
  if (judged.length === 0) {
    return result("studentLoans", {
      status: "unknown",
      headline: reasons[0] ?? "Not enough to judge",
      note: reasons.slice(1).join(" · ") || null,
      nextStepFocus: { topic: "debts" },
    });
  }
  return result("studentLoans", {
    status: "reached",
    headline: judged.map(describe).join(" · "),
    short: "Within first-year pay",
    note: reasons.join(" · ") || null,
  });
}

/** Money Guy's Always Be Buying: the last covered SimpleFIN months and the
 *  latest losing year on record. */
export function alwaysBuying(input: MilestoneInput): MilestoneResult {
  const recent = recentCoveredMonths(input.buying?.months ?? []);
  const down = input.buying?.downYears ?? [];
  const latestDown = down[down.length - 1];
  if (recent.length === 0 && !latestDown) {
    return result("alwaysBuying", {
      status: "unknown",
      headline: "Needs SimpleFIN deposits or a losing year on record",
    });
  }
  const missed = recent.filter((m) => m.state === "notInvested").length;
  const droppedInDown = latestDown !== undefined && !latestDown.heldUp;
  const held = down.filter((d) => d.heldUp).length;
  const downText = latestDown
    ? latestDown.heldUp
      ? `kept buying through ${latestDown.year}'s loss`
      : `contributed ${formatPercent(safeDivide(latestDown.contributed, latestDown.prior, 0), 0)} of the year before in ${latestDown.year}, a losing year`
    : null;
  const monthText =
    recent.length === 0
      ? null
      : missed === 0
        ? `bought every month of the last ${recent.length}`
        : `${missed} of the last ${recent.length} months without a deposit`;
  const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
  const headline = [monthText, downText].filter(Boolean).join(" · ");
  return result("alwaysBuying", {
    status: missed > 0 || droppedInDown ? "behind" : "reached",
    headline: cap(headline),
    short: cap(monthText ?? downText ?? ""),
    note:
      down.length > 0
        ? `${held} of ${down.length} losing year${down.length === 1 ? "" : "s"} held up`
        : null,
    nextStep:
      missed > 0
        ? "Set up an automatic investment every month, so no month goes without one"
        : droppedInDown
          ? "Keep contributions steady when the market falls — that's when buying matters most"
          : null,
  });
}

/** Money Guy's 60/40: judged on the latest raise; the page lists them all. */
export function saveRaises(input: MilestoneInput): MilestoneResult {
  const raises = input.raises;
  if (!raises || raises.length === 0) {
    return result("saveRaises", {
      status: "unknown",
      headline: raises
        ? "No raise to judge yet"
        : "Needs salary history and finalized Performance years",
    });
  }
  const latest = raises[raises.length - 1]!;
  const met = meetsRaiseRule(latest);
  const metCount = raises.filter(meetsRaiseRule).length;
  const shortfall = RAISE_RULE.saveShare * latest.raise - latest.savingChange;
  return result("saveRaises", {
    status: met ? "reached" : "behind",
    value: { kind: "percent", amount: latest.share },
    target: { kind: "percent", amount: RAISE_RULE.saveShare },
    progress: Math.min(1, Math.max(0, latest.share / RAISE_RULE.saveShare)),
    headline:
      latest.savingChange < 0
        ? `Saved ${formatCurrency(-latest.savingChange, 0)} less after the ${latest.year} raise`
        : `Saved ${formatPercent(latest.share, 0)} of the ${latest.year} raise`,
    short: `${formatPercent(latest.share, 0)} of the ${latest.year} raise`,
    note: [
      `${metCount} of ${raises.length} raise${raises.length === 1 ? "" : "s"} at ${formatPercent(RAISE_RULE.saveShare, 0)} or more`,
      latest.estimated ? "contributions still estimated" : null,
    ]
      .filter(Boolean)
      .join(" · "),
    reachedYear: met ? latest.year : null,
    nextStep: met
      ? null
      : `Contribute ${formatCurrency(shortfall, 0)} more a year to save ${formatPercent(RAISE_RULE.saveShare, 0)} of the ${latest.year} raise`,
    impact: met ? null : { kind: "perYear", amount: shortfall },
  });
}

export function emergencyFund(
  id: "emergencyFund" | "foo4",
  input: MilestoneInput,
): MilestoneResult {
  const months = input.efundMonths;
  if (months === null) {
    return result(id, {
      status: "unknown",
      headline: "Set up an emergency fund goal",
    });
  }
  const met = months >= EMERGENCY_FUND_MONTHS.min;
  return result(id, {
    status: met ? "reached" : "behind",
    alert: months < EMERGENCY_FUND_MONTHS.alertBelow,
    value: { kind: "months", amount: months },
    target: { kind: "months", amount: EMERGENCY_FUND_MONTHS.min },
    progress: Math.min(1, months / EMERGENCY_FUND_MONTHS.full),
    headline: `Emergency fund covers ${formatNumber(months, 1)} months of essential expenses`,
    short: `${formatNumber(months, 1)} mo covered`,
    note:
      met && months < EMERGENCY_FUND_MONTHS.full
        ? `${EMERGENCY_FUND_MONTHS.full} months is fully stocked`
        : null,
    nextStep: met
      ? null
      : input.efundEssentialMonthly
        ? `Add about ${formatCurrency((EMERGENCY_FUND_MONTHS.min - months) * input.efundEssentialMonthly)} to your emergency fund to reach ${EMERGENCY_FUND_MONTHS.min} months of essential expenses (${formatCurrency(input.efundEssentialMonthly)} a month)`
        : `Build your emergency fund to ${EMERGENCY_FUND_MONTHS.min} months of essential expenses`,
  });
}

/** Where a household short of its savings target should start: the
 *  employer match it's missing, then the account with the most IRS room. */
function whereToSaveFirst(input: MilestoneInput): string | null {
  const shortfall = [...(input.match?.shortfalls ?? [])].sort(
    (a, b) => b.missed - a.missed,
  )[0];
  if (shortfall)
    return `start with the employer match in ${shortfall.owner} ${shortfall.label}`;
  const room = (input.limits ?? [])
    .map((r) => ({ r, room: r.limit - r.contributed }))
    .filter((x) => x.room >= 1)
    .sort((a, b) => b.room - a.room)[0];
  return room
    ? `${room.r.owner} ${room.r.label} has ${formatCurrency(room.room)} of IRS room this year`
    : null;
}

// ---------------------------------------------------------------------------
// r/personalfinance
// ---------------------------------------------------------------------------

export function pfRetirementRate(input: MilestoneInput): MilestoneResult {
  const s = input.savings;
  if (!s || s.compensation <= 0) {
    return result("pfRetirementRate", {
      status: "unknown",
      headline: "Needs a paycheck set up",
    });
  }
  const met = meetsRateTarget(s.retirementRate, PF_RETIREMENT_RATE.min);
  const upper = meetsRateTarget(s.retirementRate, PF_RETIREMENT_RATE.upper);
  const gapPerMonth =
    ((PF_RETIREMENT_RATE.min - s.retirementRate) * s.compensation) / 12;
  return result("pfRetirementRate", {
    status: met ? "reached" : "behind",
    value: { kind: "percent", amount: s.retirementRate },
    target: { kind: "percent", amount: PF_RETIREMENT_RATE.min },
    progress: Math.min(1, s.retirementRate / PF_RETIREMENT_RATE.min),
    headline: `${formatSavingsRate(s.retirementRate)} of pre-tax income into Retirement accounts`,
    note: [
      upper
        ? `At or above the ${formatSavingsRate(PF_RETIREMENT_RATE.upper)} upper end`
        : `${formatSavingsRate(PF_RETIREMENT_RATE.upper)} is the upper end`,
      s.matchCounted
        ? "employer match counted"
        : `employer match left out (pay over ${formatCurrency(s.highIncomeThreshold)})`,
    ].join(" · "),
    nextStep: met
      ? null
      : `Put ${formatCurrency(gapPerMonth)} more a month into retirement accounts to reach ${formatSavingsRate(PF_RETIREMENT_RATE.min)} of pre-tax income${(() => {
          const first = whereToSaveFirst(input);
          return first ? ` — ${first}` : "";
        })()}`,
    impact: met ? null : { kind: "perYear", amount: gapPerMonth * 12 },
  });
}

/** Money Guy's 20/3/8 on every open car loan in the debts list. */
export function carRule(
  input: MilestoneInput,
  now: MilestoneYear,
): MilestoneResult {
  const loans = input.borrowing?.carLoans;
  if (!loans) {
    return result("carRule", {
      status: "unknown",
      headline: "Needs the debts list",
    });
  }
  if (loans.length === 0) {
    return result("carRule", { status: "reached", headline: "No car loan" });
  }
  const checks = loans.map(checkCarLoan);
  const pay = input.savings?.compensation ?? now.grossIncome;
  const share = carPaymentShare(
    loans.map((l) => l.monthlyPayment),
    pay,
  );
  const paymentOk =
    share === null ? null : share <= CAR_RULE.maxPaymentShare + 1e-9;
  const misses: string[] = [];
  for (const c of checks) {
    if (c.downOk === false)
      misses.push(
        `${c.name}: ${formatPercent(c.downShare ?? 0, 0)} down (${formatPercent(CAR_RULE.minDownShare, 0)} or more)`,
      );
    if (c.termOk === false)
      misses.push(
        `${c.name}: ${c.termMonths}-month term (${CAR_RULE.maxTermMonths} or fewer)`,
      );
  }
  if (paymentOk === false)
    misses.push(
      `car payments are ${formatPercent(share!, 1)} of gross pay (${formatPercent(CAR_RULE.maxPaymentShare, 0)} or less)`,
    );
  const unknown =
    checks.some((c) => c.downOk === null || c.termOk === null) ||
    paymentOk === null;
  const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
  if (misses.length > 0) {
    return result("carRule", {
      status: "behind",
      headline: cap(misses[0]!),
      short: `${misses.length} part${misses.length === 1 ? "" : "s"} missed`,
      note: misses.length > 1 ? misses.slice(1).map(cap).join(" · ") : null,
      nextStep:
        paymentOk === false
          ? "Pay the car loan down early, or keep the next car cheaper"
          : "Next car: put 20% down and borrow for 3 years or less",
      nextStepFocus: { topic: "debts" },
    });
  }
  if (unknown) {
    return result("carRule", {
      status: "unknown",
      headline:
        "Add each car loan's purchase price, original amount, term and payment to judge",
      short: "Needs loan details",
      nextStep: "Fill in the car loan's details in the debts list",
      nextStepFocus: { topic: "debts" },
    });
  }
  return result("carRule", {
    status: "reached",
    headline: `Within 20/3/8 — car payments ${formatPercent(share!, 1)} of gross pay`,
    short: "Within 20/3/8",
  });
}
