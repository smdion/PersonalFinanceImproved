/** The Financial Order of Operations steps, from deductibles to debt-free. */
import { settingsLocationLabel } from "@/lib/config/settings-sections";
import {
  LIMIT_FILLED_TOLERANCE,
  type MilestoneChecklistItem,
} from "@/lib/config/milestones";
import {
  formatCurrency,
  formatNumber,
  formatPercent,
  formatSavingsRate,
} from "@/lib/utils/format";
import { safeDivide } from "@/lib/utils/math";
import { isHighInterestDebt } from "@/lib/config/debts";
import {
  definition,
  meetsMoneyGuyRate,
  result,
} from "@/lib/pure/advice/milestones/milestones.shared";
import type {
  MatchShortfall,
  MilestoneInput,
  MilestoneLimit,
  MilestoneResult,
  MilestoneYear,
} from "@/lib/pure/advice/milestones/milestones.types";
import { owesMortgage } from "@/lib/pure/advice/milestones/housing";

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

export function foo(
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
