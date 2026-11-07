/** Investing: rebalancing, the mega backdoor, goal horizon and fund costs. */
import {
  HOLDINGS_MIN_COVERAGE,
  LOW_COST_EXPENSE_RATIO,
  REBALANCE_BANDS,
  GOAL_HORIZON_YEARS,
  PF_FUND_EXPENSE_RATIO,
} from "@/lib/config/milestones";
import { COMPOSITION_BUCKET_LABELS } from "@/lib/config/display-labels";
import {
  compactCurrency,
  formatCurrency,
  formatList,
  formatNumber,
  formatPercent,
} from "@/lib/utils/format";
import { sumBy } from "@/lib/utils/math";
import { result } from "@/lib/pure/advice/milestones/milestones.shared";
import type {
  MilestoneInput,
  MilestoneResult,
} from "@/lib/pure/advice/milestones/milestones.types";

/** Asset classes below target and outside their rebalancing band — where
 *  new money (uninvested cash included) helps rebalance. */
export function classesUnderTarget(
  holdings: MilestoneInput["holdings"],
): string[] {
  return (holdings?.classes ?? [])
    .filter(
      (c) =>
        c.targetShare !== null &&
        c.share < c.targetShare &&
        outsideRebalanceBand(c.share, c.targetShare),
    )
    .map((c) => c.name);
}

/** The 5/25 band (REBALANCE_BANDS): off by more than 5 points, or by more
 *  than 25% of a target of at least 5%. The one band rule — the rebalance
 *  milestone and the cash-drag recommendation both use it. */
export function outsideRebalanceBand(share: number, target: number): boolean {
  const gap = Math.abs(share - target);
  return (
    gap > REBALANCE_BANDS.absolute ||
    (target >= REBALANCE_BANDS.relativeMinTarget &&
      gap > REBALANCE_BANDS.relative * target)
  );
}

export function investing(input: MilestoneInput): MilestoneResult[] {
  const h = input.holdings;
  const notLinked = "Not enough linked holdings";
  if (!h) {
    return [
      result("rebalance", { status: "unknown", headline: notLinked }),
      result("lowCost", { status: "unknown", headline: notLinked }),
    ];
  }
  const out: MilestoneResult[] = [];
  const targeted = h.classes.filter((c) => c.targetShare !== null);
  if (h.coverage < HOLDINGS_MIN_COVERAGE || targeted.length === 0) {
    out.push(
      result("rebalance", {
        status: "unknown",
        headline:
          targeted.length === 0 ? "No target allocation set" : notLinked,
      }),
    );
  } else {
    const off = targeted.filter((c) =>
      outsideRebalanceBand(c.share, c.targetShare!),
    );
    // The bands decide when; the targets decide what: once any class is
    // outside its band, every class moves back to its target (Bogleheads
    // rebalance to the target mix, not just the class that tripped).
    const dollars = (c: (typeof targeted)[number]) =>
      Math.abs(c.share - c.targetShare!) * h.knownValue;
    const moves = off.length
      ? targeted.filter(
          (c) => Math.abs(c.share - c.targetShare!) >= REBALANCE_BANDS.minMove,
        )
      : [];
    const over = moves
      .filter((c) => c.share > c.targetShare!)
      .sort((a, b) => dollars(b) - dollars(a));
    const under = moves
      .filter((c) => c.share < c.targetShare!)
      .sort((a, b) => dollars(b) - dollars(a));
    const list = (cs: typeof targeted) =>
      formatList(cs.map((c) => `${compactCurrency(dollars(c))} ${c.name}`));
    const names = (cs: typeof targeted) => formatList(cs.map((c) => c.name));
    const overTotal = over.reduce((s, c) => s + dollars(c), 0);
    const underTotal = under.reduce((s, c) => s + dollars(c), 0);
    // One amount for the move: sells and buys can differ a little, since
    // moves too small to matter are left out of each side.
    const moveTotal = Math.max(overTotal, underTotal);
    // Where to sell: inside tax-advantaged accounts a sale costs no tax;
    // in a taxable account it realizes gains, so new money does it better.
    const sheltered = over.reduce((s, c) => s + (c.shelteredValue ?? 0), 0);
    const known = over.some(
      (c) => c.shelteredValue !== undefined || c.taxableValue !== undefined,
    );
    const where = !known
      ? ""
      : sheltered >= overTotal
        ? " — inside tax-advantaged accounts, so no tax"
        : sheltered > 0
          ? ` — sell the ${compactCurrency(sheltered)} in tax-advantaged accounts first (no tax); steer new contributions for the rest`
          : " — steer new contributions; selling in taxable accounts realizes gains";
    const action =
      over.length && under.length
        ? `Rebalance about ${compactCurrency(moveTotal)}: sell ${names(over)}; buy ${list(under)}${where}`
        : over.length
          ? `Rebalance about ${compactCurrency(moveTotal)}: sell ${names(over)}; buy what's under target${where}`
          : under.length
            ? `Add about ${compactCurrency(underTotal)}: ${list(under)}`
            : null;
    const gaps = off
      .map((c) => {
        const gap = c.share - c.targetShare!;
        return `${c.name} ${formatNumber(Math.abs(gap) * 100, 1)} pts ${gap > 0 ? "over" : "under"} target`;
      })
      .join(" · ");
    out.push(
      result("rebalance", {
        status: off.length === 0 ? "reached" : "behind",
        headline:
          off.length === 0
            ? "Every class within its band"
            : `${off.length} asset class${off.length === 1 ? "" : "es"} outside the rebalancing band: ${gaps}`,
        note:
          [
            h.unlinkedValue > 0
              ? `${formatCurrency(h.unlinkedValue)} of holdings aren't linked to an asset class and aren't counted — link them on Benchmarks`
              : null,
            (h.unlinkedAccountsValue ?? 0) > 0
              ? `${formatCurrency(h.unlinkedAccountsValue!)} in SimpleFIN accounts not linked to Ledgr is left out`
              : null,
          ]
            .filter(Boolean)
            .join(" · ") || null,
        nextStep: action,
        impact: action !== null ? { kind: "oneTime", amount: moveTotal } : null,
      }),
    );
  }
  if (h.expenseRatio === null || h.costCoverage < HOLDINGS_MIN_COVERAGE) {
    out.push(result("lowCost", { status: "unknown", headline: notLinked }));
  } else {
    const low = h.expenseRatio <= LOW_COST_EXPENSE_RATIO;
    out.push(
      result("lowCost", {
        status: low ? "reached" : "behind",
        value: { kind: "percent", amount: h.expenseRatio },
        target: { kind: "percent", amount: LOW_COST_EXPENSE_RATIO },
        headline: `Funds cost ${formatPercent(h.expenseRatio, 2)} a year on average (blended expense ratio)`,
        nextStep: low
          ? null
          : `Lower your fund costs — they average ${formatPercent(h.expenseRatio, 2)} a year, above the ${formatPercent(LOW_COST_EXPENSE_RATIO, 2)} low-cost line`,
      }),
    );
  }
  return out;
}

export function megaBackdoor(input: MilestoneInput): MilestoneResult {
  const rows = input.megaBackdoor;
  if (!rows || rows.length === 0) {
    return result("megaBackdoor", {
      status: "unknown",
      headline: "No workplace plan set up",
    });
  }
  const room = rows.reduce((sum, r) => sum + r.room, 0);
  return result("megaBackdoor", {
    // Ledgr can't see whether a plan takes after-tax money, so this is
    // information, not a grade.
    status: "unknown",
    value: { kind: "currency", amount: room },
    headline: `Up to ${formatCurrency(room)} a year of after-tax room`,
    short: `${formatCurrency(room)}/yr room`,
    note: "If your plan allows after-tax contributions · assumes one employer plan each, before any profit-sharing",
    nextStep: rows
      .map(
        (r) =>
          `${r.owner}: ${formatCurrency(r.room)} of the ${formatCurrency(r.limit)} limit left`,
      )
      .join(" · "),
  });
}

export function goalHorizon(input: MilestoneInput): MilestoneResult {
  const goals = input.brokerageGoals;
  if (!goals || goals.length === 0) {
    return result("goalHorizon", {
      status: "unknown",
      headline: "No brokerage goals",
    });
  }
  const yearsOut = (g: { targetYear: number }) => g.targetYear - input.asOfYear;
  const soon = goals.filter((g) => yearsOut(g) <= GOAL_HORIZON_YEARS.cash);
  const mid = goals.filter(
    (g) =>
      yearsOut(g) > GOAL_HORIZON_YEARS.cash &&
      yearsOut(g) <= GOAL_HORIZON_YEARS.conservative,
  );
  const list = (gs: typeof goals) =>
    gs.map((g) => `${g.name} (${g.targetYear})`).join(", ");
  if (soon.length > 0) {
    return result("goalHorizon", {
      status: "behind",
      headline: `${soon.length} brokerage goal${soon.length === 1 ? "" : "s"} due within ${GOAL_HORIZON_YEARS.cash} years`,
      nextStep: `Move money for ${list(soon)} out of stocks into savings, CDs or I bonds — due within ${GOAL_HORIZON_YEARS.cash} years`,
      note: mid.length ? `Conservative mix for: ${list(mid)}` : null,
    });
  }
  return result("goalHorizon", {
    status: mid.length ? "onTrack" : "reached",
    headline: mid.length
      ? `${mid.length} goal${mid.length === 1 ? "" : "s"} ${GOAL_HORIZON_YEARS.cash}–${GOAL_HORIZON_YEARS.conservative} years out`
      : `Every brokerage goal is ${GOAL_HORIZON_YEARS.conservative}+ years out`,
    nextStep: mid.length
      ? `Shift these goals' money to a conservative stock/bond mix as they get closer: ${list(mid)}`
      : null,
  });
}

export function fundCosts(input: MilestoneInput): MilestoneResult {
  const funds = input.holdings?.funds ?? [];
  const judged = funds.filter((f) => f.bucket in PF_FUND_EXPENSE_RATIO);
  if (judged.length === 0) {
    return result("fundCosts", {
      status: "unknown",
      headline: "Not enough linked holdings",
    });
  }
  const bar = (f: (typeof judged)[number]) =>
    PF_FUND_EXPENSE_RATIO[f.bucket as keyof typeof PF_FUND_EXPENSE_RATIO];
  const pricey = judged.filter((f) => f.expenseRatio > bar(f));
  const over = sumBy(pricey, (f) => (f.value ?? 0) * (f.expenseRatio - bar(f)));
  return result("fundCosts", {
    status: pricey.length ? "behind" : "reached",
    yearlySaving: over > 0 ? over : undefined,
    value: { kind: "count", amount: judged.length - pricey.length },
    target: { kind: "count", amount: judged.length },
    progress: (judged.length - pricey.length) / judged.length,
    headline: pricey.length
      ? `${pricey.length} of ${judged.length} funds above the low-cost bar for their asset class`
      : `All ${judged.length} funds under the low-cost bar for their asset class`,
    nextStep: pricey.length
      ? pricey
          .map(
            (f) =>
              `Swap ${f.name} (${formatPercent(f.expenseRatio, 2)} a year) for ${
                f.switchable
                  ? "a low-cost index fund"
                  : "a cheaper option on the plan's menu"
              } — under ${formatPercent(bar(f), 2)} is low-cost for ${COMPOSITION_BUCKET_LABELS[f.bucket]}`,
          )
          .join(" · ")
      : null,
    subjects: pricey.map((f) => f.name),
  });
}
