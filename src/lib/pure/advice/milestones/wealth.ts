/** Wealth: the wealth formula's score and the income-multiple checkpoints. */
import { type IncomeCheckpoint } from "@/lib/config/milestones";
import {
  WEALTH_FORMULA_MULTIPLIER,
  WEALTH_TIER_PAW_MIN,
} from "@/lib/constants";
import { wealthScoreTier } from "@/lib/config/display-labels";
import { formatCurrency, formatNumber } from "@/lib/utils/format";
import { safeDivide } from "@/lib/utils/math";
import {
  firstProjectedYear,
  firstReachedYear,
  incomeMultipleTarget,
  reachedNote,
  result,
} from "@/lib/pure/advice/milestones/milestones.shared";
import type {
  MilestoneInput,
  MilestoneResult,
  MilestoneYear,
} from "@/lib/pure/advice/milestones/milestones.types";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** A multiple to one decimal, e.g. `1.5×`. */
const multiple = (n: number) => `${formatNumber(n, 1)}×`;

// ---------------------------------------------------------------------------
// Wealth
// ---------------------------------------------------------------------------

export function wealthFormula(
  input: MilestoneInput,
  now: MilestoneYear,
): MilestoneResult {
  const score = now.wealthScore;
  if (now.grossIncome <= 0 || now.age <= 0) {
    return result("wealthFormula", {
      status: "unknown",
      headline: "Needs income and birth dates",
    });
  }
  const tier = wealthScoreTier(score);
  const reachedYear = firstReachedYear(
    input.years,
    (y) => y.wealthScore >= WEALTH_TIER_PAW_MIN,
  );
  const expectedNetWorth = safeDivide(now.netWorth, score, 0);
  const pawNetWorth = expectedNetWorth * WEALTH_FORMULA_MULTIPLIER;
  return result("wealthFormula", {
    status: tier.tier === "paw" ? "reached" : score >= 1 ? "onTrack" : "behind",
    alert: tier.tier === "uaw",
    value: { kind: "multiple", amount: score },
    target: { kind: "multiple", amount: WEALTH_TIER_PAW_MIN },
    progress: Math.max(0, Math.min(1, score / WEALTH_TIER_PAW_MIN)),
    headline: `${multiple(score)} · ${tier.label}`,
    short: tier.shortLabel,
    reachedYear,
    note:
      reachedYear !== null
        ? reachedNote(reachedYear, input.years, tier.tier === "paw")
        : null,
    nextStep:
      tier.tier !== "paw" && expectedNetWorth > 0
        ? `PAW at ${formatCurrency(pawNetWorth)} net worth — ${formatCurrency(Math.max(0, pawNetWorth - now.netWorth))} to go`
        : null,
    achievements:
      reachedYear !== null
        ? [{ year: reachedYear, label: "Prodigious Accumulator" }]
        : [],
  });
}

export function checkpoints(
  id: "moneyGuyCheckpoints" | "fidelityCheckpoints",
  table: readonly IncomeCheckpoint[],
  input: MilestoneInput,
  now: MilestoneYear,
  balance: (y: MilestoneYear) => number,
): MilestoneResult {
  if (now.grossIncome <= 0 || now.age <= 0) {
    return result(id, {
      status: "unknown",
      headline: "Needs income and birth dates",
    });
  }
  const ratio = (y: MilestoneYear) =>
    y.grossIncome > 0 ? balance(y) / y.grossIncome : 0;
  const current = ratio(now);
  const target = incomeMultipleTarget(table, now.age);
  const achievements = table.flatMap((cp) => {
    const year = firstReachedYear(input.years, (y) => ratio(y) >= cp.multiple);
    return year !== null
      ? [
          {
            year,
            label: `${multiple(cp.multiple)} income${id === "fidelityCheckpoints" ? " (Fidelity)" : ""}`,
          },
        ]
      : [];
  });
  const last = table[table.length - 1]!;
  const next = table.find((cp) => current < cp.multiple) ?? null;
  // Projected liquid ÷ projected pay — the Money Guy table only (the
  // projection doesn't carry a retirement-accounts-only balance).
  const expected =
    next && id === "moneyGuyCheckpoints" && input.projection
      ? firstProjectedYear(
          input.projection.years,
          input.asOfYear,
          (y) =>
            y.salary !== null &&
            y.salary > 0 &&
            y.liquid / y.salary >= next.multiple,
        )
      : null;
  const highest = achievements[achievements.length - 1] ?? null;
  // What the multiple counts — liquid investments (Money Guy) or retirement
  // accounts (Fidelity) — so the line reads on its own.
  const counted =
    id === "fidelityCheckpoints" ? "saved for retirement" : "invested";
  const notes = [
    highest ? `${highest.label} reached ${highest.year}` : null,
    next
      ? `next ${multiple(next.multiple)} by ${next.age}${
          expected ? ` — on pace for ${expected.year}` : ""
        }`
      : null,
  ].filter(Boolean);
  return result(id, {
    status:
      current >= last.multiple
        ? "reached"
        : current >= target
          ? "onTrack"
          : "behind",
    value: { kind: "multiple", amount: current },
    target: { kind: "multiple", amount: target },
    progress: Math.min(1, safeDivide(current, target, 1)),
    headline: `${multiple(current)} your income ${counted}; ${multiple(target)} is the target for your household's average age, ${Math.round(now.age)}`,
    note: notes.length ? notes.join(" · ") : null,
    nextStep:
      current < target
        ? `${formatCurrency((target - current) * now.grossIncome)} more ${counted} reaches ${multiple(target)} your income, the target for your household's average age, ${Math.round(now.age)}`
        : null,
    impact:
      current < target
        ? { kind: "oneTime", amount: (target - current) * now.grossIncome }
        : null,
    reachedYear: highest?.year ?? null,
    expectedYear: expected?.year ?? null,
    expectedAge: expected?.age ?? null,
    achievements,
  });
}
