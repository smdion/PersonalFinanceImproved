/**
 * Milestones — the one place financial rules and milestones are judged.
 *
 * The Milestones page, the dashboard Financial Checkup and the Retirement
 * card's readiness row all read `evaluateMilestones()`; none of them judges
 * a rule on its own. Pure: callers gather the household's figures (yearly
 * history, the live contribution/savings/mortgage summaries, the deterministic
 * projection, linked holdings) and pass them in. Thresholds and wording live
 * in `lib/config/milestones.ts`.
 *
 * Reached dates come from the yearly history (finalized years, plus the
 * current year for point-in-time balances); expected dates come from the
 * Retirement projection — the same run the dashboard Retirement card shows.
 */
import { settingsLocationLabel } from "@/lib/config/settings-sections";
import {
  FIDELITY_CHECKPOINTS,
  FIRST_100K,
  HOUSING_COST_SHARE,
  LIMIT_FILLED_TOLERANCE,
  MILESTONE_CHECKLIST_TODOS,
  MONEY_GUY_CHECKPOINTS,
  ONE_MILLION,
  PAID_OFF_HOME_BY_AGE,
  PROTECTION_CHECKLIST_AGE,
  CAR_RULE,
  type MilestoneChecklistItem,
} from "@/lib/config/milestones";
import {
  formatCurrency,
  formatList,
  formatNumber,
  formatPercent,
  formatSavingsRate,
} from "@/lib/utils/format";
import { calculateLoanMonthlyPayment, safeDivide } from "@/lib/utils/math";
import { isHighInterestDebt } from "@/lib/config/debts";
import { carPaymentShare, checkCarLoan } from "@/lib/pure/debts/debt-rules";
import {
  amountMilestone,
  checkpointBalance,
  definition,
  expectedNote,
  firstReachedYear,
  growthMilestone,
  meetsMoneyGuyRate,
  projectedFiYear,
  reachedNote,
  result,
} from "@/lib/pure/advice/milestones/milestones.shared";
import type {
  MatchShortfall,
  MilestoneInput,
  MilestoneLimit,
  MilestoneResult,
  MilestoneValue,
  MilestoneYear,
} from "@/lib/pure/advice/milestones/milestones.types";
import {
  wealthFormula,
  checkpoints,
} from "@/lib/pure/advice/milestones/wealth";
import {
  savingsRate,
  studentLoans,
  alwaysBuying,
  saveRaises,
  emergencyFund,
  pfRetirementRate,
} from "@/lib/pure/advice/milestones/habits";
import {
  investing,
  megaBackdoor,
  goalHorizon,
  fundCosts,
} from "@/lib/pure/advice/milestones/investing";
import { customGoal } from "@/lib/pure/advice/milestones/custom-goals";

export * from "@/lib/pure/advice/milestones/milestones.types";

// ---------------------------------------------------------------------------
// Wealth journey
// ---------------------------------------------------------------------------

function journey(input: MilestoneInput, now: MilestoneYear): MilestoneResult[] {
  const nonLiquid = now.netWorth - now.liquid;
  const out: MilestoneResult[] = [];

  out.push(
    amountMilestone("zero", input, {
      current: now.netWorth,
      target: 0,
      history: (y) => y.netWorth,
      projected: (y) => y.liquid + nonLiquid,
      estimate: true,
    }),
  );
  out.push(
    amountMilestone("first100k", input, {
      current: now.liquid,
      target: FIRST_100K,
      history: (y) => y.liquid,
      projected: (y) => y.liquid,
    }),
  );

  out.push(
    growthMilestone("investmentsSaveHarder", input, now, {
      // A year of saving includes employer money: Money Guy counts all
      // money saved.
      past: (y) => y.contributions,
      current: input.savings?.savedWithMatch ?? null,
      projected: (y) => y.contributions,
      label: "saved",
      matches: "growth matches what you save",
    }),
  );

  out.push(
    amountMilestone("twoComma", input, {
      current: now.netWorth,
      target: ONE_MILLION,
      history: (y) => y.netWorth,
      projected: (y) => y.liquid + nonLiquid,
      estimate: true,
    }),
  );
  out.push(
    amountMilestone("liquidMillionaire", input, {
      current: now.liquid,
      target: ONE_MILLION,
      history: (y) => y.liquid,
      projected: (y) => y.liquid,
    }),
  );

  // Finalized years compare against gross income (salary + bonus, as
  // recorded); projected years only have the engine's projected salary —
  // the engine carries no per-year gross figure — so the "on pace" year
  // can come a little early for a household with a large bonus.
  out.push(
    growthMilestone("moneyWorksHarder", input, now, {
      past: (y) => y.grossIncome,
      current: now.grossIncome,
      projected: (y) => y.salary,
      label: "pay",
      matches: "growth matches your pay",
    }),
  );

  out.push(fi(input, now));
  return out;
}

function fi(input: MilestoneInput, now: MilestoneYear): MilestoneResult {
  if (input.fiTarget <= 0) {
    return result("fi", {
      status: "unknown",
      headline: "Set a budget and withdrawal rate to get an FI number",
    });
  }
  // FI is a state, not a one-time step: it counts as reached only while
  // today's figure is there. The first year it was reached stays on the
  // timeline either way.
  const reachedYear = firstReachedYear(input.years, (y) => y.fiProgress >= 1);
  const achievements =
    reachedYear !== null
      ? [{ year: reachedYear, label: definition("fi").title }]
      : [];
  const value: MilestoneValue = { kind: "percent", amount: now.fiProgress };
  const headline = `${formatPercent(now.fiProgress)} of ${formatCurrency(input.fiTarget)}`;
  if (now.fiProgress >= 1) {
    return result("fi", {
      status: "reached",
      value,
      progress: 1,
      headline,
      short: "FI reached",
      reachedYear,
      note:
        reachedYear !== null
          ? reachedNote(reachedYear, input.years, true)
          : null,
      achievements,
    });
  }
  const expected = input.projection
    ? projectedFiYear(
        input.projection.years,
        input.fiTarget,
        input.projection.inflationRate,
        input.asOfYear,
      )
    : null;
  return result("fi", {
    status: !input.projection ? "unknown" : expected ? "onTrack" : "behind",
    alert: Boolean(input.projection) && !expected,
    value,
    progress: Math.max(0, Math.min(1, now.fiProgress)),
    headline,
    short: !input.projection
      ? `${formatPercent(now.fiProgress)} there`
      : expected
        ? `On pace for ${expected.year}`
        : "Not reached in projection",
    note:
      [
        reachedYear !== null
          ? reachedNote(reachedYear, input.years, false)
          : null,
        expectedNote(expected, input),
      ]
        .filter(Boolean)
        .join(" · ") || null,
    nextStep: `${formatCurrency(Math.max(0, input.fiTarget - now.liquid))} to go in today's dollars`,
    reachedYear,
    expectedYear: expected?.year ?? null,
    expectedAge: expected?.age ?? null,
    achievements,
  });
}

/** Money Guy's 20/3/8 on every open car loan in the debts list. */
function carRule(input: MilestoneInput, now: MilestoneYear): MilestoneResult {
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

function limitStep(
  id: "foo5" | "foo6",
  input: MilestoneInput,
): MilestoneResult {
  const step = id === "foo5" ? 5 : 6;
  if (!input.limits) {
    return result(id, {
      status: "unknown",
      headline: "Needs a paycheck set up",
    });
  }
  // Step 5: the IRA and HSA. Step 6: every limit in the Retirement parent
  // category, employee money only (employer money only where the IRS
  // limit itself counts it, e.g. HSA).
  const rows = input.limits.filter((l) =>
    step === 5 ? l.fooStep5 : l.retirement,
  );
  if (rows.some((l) => l.limit <= 0)) {
    return result(id, {
      status: "unknown",
      headline: "This year's IRS limits aren't entered",
      nextStep: `Add them under ${settingsLocationLabel("taxdata", "limits")}`,
      nextStepFocus: { topic: "settings", tab: "taxdata", section: "limits" },
    });
  }
  if (rows.length === 0) {
    // Money Guy: skip step 5 without an HSA-eligible plan or a way into a
    // Roth IRA — Ledgr can't see eligibility, so it can't call this behind.
    return step === 5
      ? result(id, {
          status: "unknown",
          headline: "No IRA or HSA set up",
          nextStep:
            "Open a Roth IRA if you can (a backdoor Roth works above the income limit); the HSA needs a high-deductible health plan",
        })
      : result(id, {
          status: "unknown",
          headline: "No retirement accounts with an IRS limit",
        });
  }
  const contributed = rows.reduce(
    (s, r) => s + Math.min(r.contributed, r.limit),
    0,
  );
  const limit = rows.reduce((s, r) => s + r.limit, 0);
  const open = rows.filter(
    (r) => r.contributed < r.limit * LIMIT_FILLED_TOLERANCE,
  );
  // Money Guy's step 6: reaching a 25% retirement investing rate (the
  // Retirement category only — Portfolio money is step 7's) before the
  // plans are maxed also completes the step. (Their "if you don't have a
  // high income" has no number; the high-income line only decides
  // whether the match counts toward the 25%.)
  const unlimitedNote =
    step === 6 && (input.retirementUnlimited ?? 0) > 0
      ? `Plus ${formatCurrency(input.retirementUnlimited!)} a year into retirement accounts without an IRS limit`
      : null;
  const s = input.savings;
  const twentyFiveFirst =
    step === 6 &&
    open.length > 0 &&
    s !== null &&
    meetsMoneyGuyRate(s.retirementRate);
  if (twentyFiveFirst) {
    return result(id, {
      status: "reached",
      value: { kind: "currency", amount: contributed },
      target: { kind: "currency", amount: limit },
      progress: 1,
      headline: `Investing ${formatSavingsRate(s.retirementRate)} for retirement before maxing out`,
      note: [
        `${formatCurrency(contributed)} of ${formatCurrency(limit)} a year of IRS limits`,
        unlimitedNote,
      ]
        .filter(Boolean)
        .join(" · "),
    });
  }
  return result(id, {
    status: open.length === 0 ? "reached" : "behind",
    value: { kind: "currency", amount: contributed },
    target: { kind: "currency", amount: limit },
    progress: Math.min(1, safeDivide(contributed, limit, 0)),
    headline: `${formatCurrency(contributed)} of ${formatCurrency(limit)} a year of IRS contribution limits used`,
    note: unlimitedNote,
    impact: open.length
      ? {
          kind: "perYear",
          amount: open.reduce((sum, r) => sum + (r.limit - r.contributed), 0),
        }
      : null,
    nextStep: open.length
      ? open.map((r) => limitGapStep(r, input.asOfYear)).join(" · ")
      : null,
  });
}

/** How to close one IRS-limit gap: through payroll, spread over the
 *  owner's paychecks left this year; outside it (an IRA, an HSA funded
 *  directly), any time until the filing deadline. */
function limitGapStep(r: MilestoneLimit, year: number): string {
  const gap = r.limit - r.contributed;
  const base = `${r.owner} ${r.label}: ${formatCurrency(gap)} more reaches the ${year} IRS limit`;
  if (r.payroll === false)
    return `${base} — ${year} contributions are allowed until the tax-filing deadline`;
  if (r.payroll === true && r.checksLeft != null)
    return r.checksLeft > 0
      ? `${base} — about ${formatCurrency(gap / r.checksLeft)} more a paycheck for the ${r.checksLeft} left this year`
      : `${base} — no paychecks left this year; raise it for next year`;
  return `${base} — contribute it this year`;
}

/** "raise Ann 401k to 6% of pay (now 4%)" — the dollars are the step's. */
function matchShortfallStep(s: MatchShortfall): string {
  return s.fullPct !== null
    ? `raise ${s.owner} ${s.label} to ${formatNumber(s.fullPct, s.fullPct % 1 === 0 ? 0 : 1)}% of pay${s.currentPct !== null ? ` (now ${formatNumber(s.currentPct, s.currentPct % 1 === 0 ? 0 : 1)}%)` : ""}`
    : `raise ${s.owner} ${s.label} (${formatCurrency(s.missed)} a year of match missed)`;
}

function foo(
  input: MilestoneInput,
  now: MilestoneYear,
  savings: MilestoneResult,
  efund: MilestoneResult,
): MilestoneResult[] {
  const ticked = (k: MilestoneChecklistItem) => input.checklist[k] === true;
  const out: MilestoneResult[] = [];

  out.push(
    ticked("deductibles")
      ? result("foo1", { status: "reached", headline: "Covered" })
      : result("foo1", {
          status: "unknown",
          headline: "Not ticked yet",
          nextStep: "Tick it below once cash covers your deductibles",
        }),
  );

  const m = input.match;
  if (!m) {
    out.push(
      result("foo2", {
        status: "unknown",
        headline: "Needs a paycheck set up",
      }),
    );
  } else if (m.available <= 0) {
    out.push(
      result("foo2", {
        status: "reached",
        headline: "No employer match offered",
      }),
    );
  } else {
    const left = Math.max(0, m.available - m.captured);
    out.push(
      result("foo2", {
        status: left < 1 ? "reached" : "behind",
        alert: left >= 1,
        value: { kind: "currency", amount: m.captured },
        target: { kind: "currency", amount: m.available },
        progress: Math.min(1, safeDivide(m.captured, m.available, 0)),
        headline:
          left < 1
            ? `Full match: ${formatCurrency(m.captured)} a year`
            : `Getting ${formatCurrency(m.captured)} of ${formatCurrency(m.available)} a year of employer match`,
        short:
          left < 1
            ? `${formatCurrency(m.captured)}/yr captured`
            : `${formatCurrency(left)}/yr missed`,
        nextStep:
          left < 1
            ? null
            : m.shortfalls?.length
              ? `Get the full employer match (${formatCurrency(left)} a year): ${m.shortfalls.map(matchShortfallStep).join(" · ")}`
              : `Raise your workplace-plan contribution to get the full employer match (${formatCurrency(left)} a year)`,
        impact: left >= 1 ? { kind: "perYear", amount: left } : null,
      }),
    );
  }

  out.push(highInterestDebtStep(input, now));

  out.push({ ...efund, ...definition("foo4"), id: "foo4" });
  out.push(limitStep("foo5", input));
  out.push(limitStep("foo6", input));
  out.push({ ...savings, ...definition("foo7"), id: "foo7" });

  out.push(
    ticked("prepaid")
      ? result("foo8", { status: "reached", headline: "Saving ahead" })
      : result("foo8", {
          status: "unknown",
          headline: "Not ticked yet",
          nextStep:
            "Tick it below once you're saving ahead for big known costs",
        }),
  );

  out.push(debtFreeStep(input, now));
  return out;
}

/** FOO step 3 — high-interest debt, judged per debt against Money Guy's
 *  line for its owner's age (lib/config/debts.ts). Card balances mapped
 *  from the budget aren't judged (usually paid in full each month); a card
 *  on the debts list is a balance carried. */
function highInterestDebtStep(
  input: MilestoneInput,
  now: MilestoneYear,
): MilestoneResult {
  const debts = input.debts;
  if (!debts)
    return now.otherLiabilities <= 0
      ? result("foo3", {
          status: "reached",
          headline: "No debt besides the mortgage",
        })
      : result("foo3", {
          status: "unknown",
          headline: `${formatCurrency(now.otherLiabilities)} of other debt`,
          note: "Includes credit-card balances — Ledgr can't tell what's paid in full each month or what the rates are",
          nextStep:
            "Pay off any card balance you carry, and loans above Money Guy's age line",
          nextStepFocus: { topic: "debts" },
        });
  const open = debts.filter((d) => d.open && d.balance > 0);
  const manual = input.otherDebt?.manual ?? 0;
  const cardsNote =
    (input.otherDebt?.creditCardMapped ?? 0) > 0
      ? "Card balances from your budget aren't judged — add a card you carry month to month to the debts list"
      : null;
  const noRate = open.filter((d) => d.rate == null && d.kind !== "credit_card");
  const high = open.filter(
    (d) =>
      (d.rate != null || d.kind === "credit_card") &&
      isHighInterestDebt(d.kind, d.rate ?? 0, d.ownerAge),
  );
  if (high.length > 0) {
    const interest = high.reduce((s, d) => s + d.balance * (d.rate ?? 0), 0);
    const names = high.map((d) =>
      d.rate != null ? `${d.name} (${formatPercent(d.rate, 1)})` : d.name,
    );
    return result("foo3", {
      status: "behind",
      alert: true,
      headline: `${formatCurrency(high.reduce((s, d) => s + d.balance, 0))} of high-interest debt`,
      note:
        [
          cardsNote,
          noRate.length > 0
            ? `No rate yet for ${noRate.map((d) => d.name).join(", ")}`
            : null,
        ]
          .filter(Boolean)
          .join(". ") || null,
      nextStep: `Pay off ${names.join(", ")} — above Money Guy's line for your age${interest > 0 ? `; about ${formatCurrency(interest, 0)} a year in interest` : ""}`,
      nextStepFocus: { topic: "debts" },
      subjects: high.map((d) => d.name),
      impact: interest > 0 ? { kind: "perYear", amount: interest } : null,
    });
  }
  if (manual > 0 || noRate.length > 0)
    return result("foo3", {
      status: "unknown",
      headline:
        noRate.length > 0
          ? `No rate for ${noRate.map((d) => d.name).join(", ")}`
          : `${formatCurrency(manual)} of other debt not itemized`,
      note: cardsNote,
      nextStep:
        "List each debt with its interest rate on Liabilities, so it can be judged against Money Guy's line",
      nextStepFocus: { topic: "debts" },
    });
  return result("foo3", {
    status: "reached",
    headline:
      open.length === 0
        ? "No debt besides the mortgage"
        : "No high-interest debt",
    note: cardsNote,
  });
}

/** FOO step 9 — debt-free: the mortgage and every other debt. The expected
 *  year is the last payoff among them. */
function debtFreeStep(
  input: MilestoneInput,
  now: MilestoneYear,
): MilestoneResult {
  const payoffYear = input.mortgage?.payoffYear ?? null;
  const mortgage = owesMortgage(input, now);
  const debts = input.debts;
  const achievements = (debts ?? [])
    .filter((d) => !d.open && d.paidOffYear != null)
    .map((d) => ({ year: d.paidOffYear!, label: `Paid off ${d.name}` }));
  if (!debts) {
    if (!mortgage && now.otherLiabilities <= 0)
      return result("foo9", { status: "reached", headline: "Debt-free" });
    if (mortgage && now.otherLiabilities <= 0)
      return result("foo9", {
        status: "onTrack",
        headline: payoffYear
          ? `Mortgage paid off ${payoffYear}`
          : "Mortgage in progress",
        expectedYear: payoffYear,
      });
    return result("foo9", {
      status: "unknown",
      headline: mortgage
        ? "Mortgage and other debt in progress"
        : "Other debt in progress",
    });
  }
  const open = debts.filter((d) => d.open && d.balance > 0);
  const manual = input.otherDebt?.manual ?? 0;
  if (!mortgage && open.length === 0 && manual <= 0)
    return result("foo9", {
      status: "reached",
      headline: "Debt-free",
      achievements,
    });
  const never = open.filter((d) => d.never);
  if (never.length > 0)
    return result("foo9", {
      status: "behind",
      headline: `${never.map((d) => d.name).join(", ")} never pays off at today's payment`,
      nextStep: "Pay more than the interest each month",
      nextStepFocus: { topic: "debts" },
      achievements,
    });
  const stale = open.filter((d) => d.stale);
  const unknownDebt = open.some((d) => d.payoffYear == null);
  if (manual > 0 || unknownDebt || (mortgage && payoffYear == null))
    return result("foo9", {
      status: "unknown",
      headline: mortgage
        ? "Mortgage and other debt in progress"
        : "Other debt in progress",
      nextStep:
        stale.length > 0
          ? `Update the balance of ${stale.map((d) => d.name).join(", ")} on Liabilities — its payoff estimate has passed`
          : unknownDebt
            ? "Add each debt's rate and monthly payment on Liabilities to estimate when it's paid off"
            : null,
      nextStepFocus: unknownDebt ? { topic: "debts" } : undefined,
      achievements,
    });
  const year = Math.max(
    ...(mortgage && payoffYear != null ? [payoffYear] : []),
    ...open.map((d) => d.payoffYear!),
  );
  return result("foo9", {
    status: "onTrack",
    headline: `Debt-free ${year}`,
    expectedYear: year,
    achievements,
  });
}

/** A mortgage is still owed: the active loan, or a balance in this year's
 *  figures when the loan details aren't available. */
function owesMortgage(input: MilestoneInput, now: MilestoneYear): boolean {
  return Boolean(input.mortgage?.active) || now.mortgageBalance > 0;
}

function protection(
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

function housing(input: MilestoneInput, now: MilestoneYear): MilestoneResult[] {
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

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

/** Judge every milestone. Empty when there's no history yet. */
export function evaluateMilestones(input: MilestoneInput): MilestoneResult[] {
  const now = input.years[input.years.length - 1];
  if (!now) return [];
  const savings = savingsRate(input);
  const efund = emergencyFund("emergencyFund", input);
  return [
    ...journey(input, now),
    ...input.customGoals.map((g) => customGoal(g, input, now)),
    ...foo(input, now, savings, efund),
    wealthFormula(input, now),
    input.checkpointSource === "moneyGuy"
      ? checkpoints(
          "moneyGuyCheckpoints",
          MONEY_GUY_CHECKPOINTS,
          input,
          now,
          (y) => checkpointBalance("moneyGuy", y),
        )
      : checkpoints(
          "fidelityCheckpoints",
          FIDELITY_CHECKPOINTS,
          input,
          now,
          (y) => checkpointBalance("fidelity", y),
        ),
    input.savingsTargetSource === "personalFinance"
      ? pfRetirementRate(input)
      : savings,
    saveRaises(input),
    alwaysBuying(input),
    megaBackdoor(input),
    goalHorizon(input),
    efund,
    protection(input, now),
    ...housing(input, now),
    carRule(input, now),
    studentLoans(input),
    ...investing(input),
    fundCosts(input),
  ];
}

/** The FOO step you're on: the first one not reached and not waiting on
 *  information. Null once every judged step is done. */
export function currentFooStep(
  results: readonly MilestoneResult[],
): number | null {
  for (let step = 1; step <= 9; step++) {
    const r = results.find((x) => x.id === `foo${step}`);
    if (r && r.status === "behind") return step;
  }
  return null;
}

/** Reached milestones in date order. */
export function milestoneTimeline(
  results: readonly MilestoneResult[],
): { year: number; label: string; id: string }[] {
  return results
    .flatMap((r) => r.achievements.map((a) => ({ ...a, id: r.id })))
    .sort((a, b) => a.year - b.year || a.label.localeCompare(b.label));
}

/** The unreached milestones you're closest to (journey, your goals, wealth). */
export function nextUpMilestones(
  results: readonly MilestoneResult[],
  count = 2,
): MilestoneResult[] {
  return results
    .filter(
      (r) =>
        (r.group === "journey" ||
          r.group === "custom" ||
          r.group === "wealth") &&
        r.status !== "reached" &&
        r.progress !== null &&
        r.progress < 1,
    )
    .sort((a, b) => (b.progress ?? 0) - (a.progress ?? 0))
    .slice(0, count);
}

/** Last finalized year next to now, for the "since last year" line. */
export function sinceLastYear(years: readonly MilestoneYear[]): {
  fromYear: number;
  netWorth: [number, number];
  liquidMultiple: [number, number] | null;
  wealthScore: [number, number];
} | null {
  const now = years[years.length - 1];
  const before = [...years].reverse().find((y) => !y.isCurrent && y !== now);
  if (!now || !before) return null;
  const mult = (y: MilestoneYear) =>
    y.grossIncome > 0 ? y.liquid / y.grossIncome : null;
  const a = mult(before);
  const b = mult(now);
  return {
    fromYear: before.year,
    netWorth: [before.netWorth, now.netWorth],
    liquidMultiple: a !== null && b !== null ? [a, b] : null,
    wealthScore: [before.wealthScore, now.wealthScore],
  };
}
