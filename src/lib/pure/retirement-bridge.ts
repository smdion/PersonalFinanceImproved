/**
 * The bridge to penalty-free retirement money: the first retirement years,
 * while some retirement money is still locked by early-withdrawal rules
 * (59½, Roth ordering, Rule of 55 when it doesn't apply). Read entirely from
 * the engine's own projection — which money is locked, what was spent and
 * whether it fell short — so it never re-decides eligibility or re-prices a
 * withdrawal (RULES §Single Computation Path).
 *
 * The projection is the fixed-return run: a bad market in these years is
 * exactly how a bridge fails, so callers label it "at assumed returns".
 */
import {
  isHsaCategory,
  isIraCategory,
  isRetirementMoney,
  isRuleOf55EligibleCategory,
  isTaxableCategory,
  isTaxFreeBucket,
} from "@/lib/config/account-types";
import type {
  EngineDecumulationYear,
  EngineYearProjection,
} from "@/lib/calculators/types/engine-projection";
import type { IndividualAccountYearBalance } from "@/lib/calculators/types/shared";
import { roundToCents, sumBy } from "@/lib/utils/math";

/** Where penalty-free money at the start of the bridge sits. */
type BridgeSourceKind =
  "brokerage" | "roth" | "workplacePlan" | "traditionalIra" | "other";

export type BridgeYear = {
  year: number;
  age: number;
  /** Spending to cover after Social Security, after tax. */
  need: number;
  ssIncome: number;
  /** How much of `need` the withdrawals delivered. */
  covered: number;
  /** The engine's material-shortfall verdict. */
  short: boolean;
  /** Why it was short: money locked by early-withdrawal rules, Portfolio
   *  money left out of retirement spending, or simply out of money. */
  cause: "locked" | "portfolioExcluded" | "outOfMoney" | null;
};

export type RetirementBridge =
  /** Per-account eligibility wasn't in the projection (an older cached
   *  result, or no tracked accounts): nothing to say. */
  | { status: "unknown" }
  /** Retirement starts with nothing locked. */
  | { status: "nothingLocked"; year: number; age: number }
  | {
      status: "bridge";
      firstYear: number;
      lastYear: number;
      startAge: number;
      endAge: number;
      years: BridgeYear[];
      /** Penalty-free money at the start of the bridge, by where it sits. */
      sources: { kind: BridgeSourceKind; amount: number }[];
      /** HSA money — usable penalty-free only for medical costs before 65,
       *  never counted above. */
      hsa: number;
      /** When each person's locked money unlocks (the year after their
       *  last locked year). */
      unlocks: { name: string; year: number }[];
      /** The tightest point: penalty-free money left after the year's
       *  withdrawals, at its lowest across the bridge. */
      cushion: { amount: number; year: number } | null;
      /** Spending cut by the withdrawal strategy's guardrails during the
       *  bridge (the budget less what the strategy spent). */
      strategyCut: number;
      /** Early-withdrawal penalties paid during the bridge (accounts the
       *  household lets take penalized draws). */
      penaltyCost: number;
      /** Roth conversions happen during the bridge — not yet counted
       *  toward penalty-free money. */
      conversionsDuring: boolean;
      /** A Roth account's basis rests on a stale or seeded record — its
       *  penalty-free amount may be understated. */
      rothBasisUncertain: boolean;
      /** Retirement accounts (not brokerage or HSA) with no owner — their
       *  eligibility can't be judged, so they count as unlocked. */
      unownedAccounts: string[];
    };

const isDecumulation = (y: EngineYearProjection): y is EngineDecumulationYear =>
  y.phase === "decumulation";

/** Retirement money the bridge reasons about: the retirement plan's own
 *  accounts (not Portfolio-parented savings), HSA set apart. */
function bridgeAccounts(y: EngineDecumulationYear) {
  return y.individualAccountBalances.filter((a) =>
    isRetirementMoney(a.parentCategory),
  );
}

function sourceKind(a: IndividualAccountYearBalance): BridgeSourceKind {
  if (isTaxableCategory(a.category)) return "brokerage";
  if (isTaxFreeBucket(a.taxType)) return "roth";
  if (isRuleOf55EligibleCategory(a.category)) return "workplacePlan";
  if (isIraCategory(a.category)) return "traditionalIra";
  return "other";
}

const lockedFor = (a: IndividualAccountYearBalance) =>
  (a.penaltyExposedAmount ?? 0) > 0 && a.allowPenalizedWithdrawals !== true;

export function retirementBridge(
  projection: readonly EngineYearProjection[],
): RetirementBridge {
  const decum = projection.filter(isDecumulation);
  const first = decum[0];
  if (!first || first.penaltyLockedStillExcluded === undefined)
    return { status: "unknown" };
  if (first.penaltyLockedStillExcluded <= 0)
    return { status: "nothingLocked", year: first.year, age: first.age };

  // The bridge: retirement years from the start while money is locked.
  const bridge: EngineDecumulationYear[] = [];
  for (const y of decum) {
    if ((y.penaltyLockedStillExcluded ?? 0) <= 0) break;
    bridge.push(y);
  }
  const last = bridge[bridge.length - 1]!;

  const years: BridgeYear[] = bridge.map((y) => {
    const short = y.unmetNeedMaterial === true;
    return {
      year: y.year,
      age: y.age,
      need: y.afterTaxNeed,
      ssIncome: y.ssIncome,
      covered: Math.min(y.afterTaxNeed, y.deliveredAfterTax ?? 0),
      short,
      cause: !short
        ? null
        : (y.penaltyAvoidedShortfall ?? 0) > 0
          ? "locked"
          : (y.nonRetirementShortfall ?? 0) > 0
            ? "portfolioExcluded"
            : "outOfMoney",
    };
  });

  const startAccounts = bridgeAccounts(first);
  const counted = startAccounts.filter((a) => !isHsaCategory(a.category));
  const bySource = new Map<BridgeSourceKind, number>();
  for (const a of counted) {
    const free = a.penaltyFreeAmount ?? 0;
    if (free <= 0) continue;
    const kind = sourceKind(a);
    bySource.set(kind, (bySource.get(kind) ?? 0) + free);
  }

  // Each person's money unlocks the year after their last locked year.
  const lastLocked = new Map<string, number>();
  for (const y of bridge)
    for (const a of bridgeAccounts(y))
      if (!isHsaCategory(a.category) && lockedFor(a) && a.ownerName)
        lastLocked.set(a.ownerName, y.year);
  const unlocks = Array.from(lastLocked, ([name, year]) => ({
    name,
    year: year + 1,
  })).sort((a, b) => a.year - b.year);

  // The tightest year: penalty-free money left after that year's draws.
  let cushion: { amount: number; year: number } | null = null;
  for (const y of bridge) {
    const left = sumBy(
      bridgeAccounts(y).filter((a) => !isHsaCategory(a.category)),
      (a) => Math.max(0, (a.penaltyFreeAmount ?? 0) - (a.withdrawal ?? 0)),
    );
    if (!cushion || left < cushion.amount)
      cushion = { amount: roundToCents(left), year: y.year };
  }

  return {
    status: "bridge",
    firstYear: first.year,
    lastYear: last.year,
    startAge: first.age,
    endAge: last.age,
    years,
    sources: Array.from(bySource, ([kind, amount]) => ({
      kind,
      amount: roundToCents(amount),
    })).sort((a, b) => b.amount - a.amount),
    hsa: roundToCents(
      sumBy(
        startAccounts.filter((a) => isHsaCategory(a.category)),
        (a) => a.balance,
      ),
    ),
    unlocks,
    cushion,
    strategyCut: roundToCents(
      sumBy(bridge, (y) =>
        Math.max(0, y.budgetOnlyExpenses - y.projectedExpenses),
      ),
    ),
    penaltyCost: roundToCents(sumBy(bridge, (y) => y.penaltyCost ?? 0)),
    conversionsDuring: bridge.some((y) => (y.rothConversionAmount ?? 0) > 0),
    rothBasisUncertain: counted.some(
      (a) => isTaxFreeBucket(a.taxType) && a.rothBasisUncertain === true,
    ),
    unownedAccounts: counted
      .filter(
        (a) => a.ownerPersonId === undefined && !isTaxableCategory(a.category),
      )
      .map((a) => a.name),
  };
}
