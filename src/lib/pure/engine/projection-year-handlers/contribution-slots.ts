import type { AccumulationSlot } from "../types/routing";
import { roundToCents } from "../../../utils/math";
import {
  type AccountCategory,
  buildCategoryRecord,
  getAllCategories,
  isOverflowTarget,
  getRothFraction as configGetRothFraction,
} from "../../../config/account-types";
import type { resolveAccumulationConfig } from "../override-resolution";
import {
  routeWaterfall,
  routePercentage,
  routeFromSpecs,
  capSpecs,
  slotLimits,
  remainingRoom,
} from "../contribution-routing";
import { accountGroupLimits } from "@/lib/pure/contributions/contribution-caps";
import type { ContributionState } from "@/lib/pure/contributions/contribution-state";
import { applyRateCeiling } from "./rate-ceiling";
import type {
  yearContributionTarget,
  yearZeroBasis,
} from "./contribution-target";
import type {
  PreYearSetup,
  ProjectionContext,
  ProjectionLoopState,
} from "./types";

/** The specs capped per person, and the year's IRS limit per slot. */
export function yearContributionLimits(
  contributionSpecs: ProjectionLoopState["contributionSpecs"],
  year: number,
  irsLimitCaps: ProjectionContext["input"]["irsLimitCaps"],
  lgf: number,
  projectedSalary: number,
  currentSalary: number,
  personPay: ReturnType<typeof yearContributionTarget>["personPay"],
  yearEmployerMatch: Record<AccountCategory, number>,
  hasPerPersonSalary: boolean,
  projectedSalaryByPerson: PreYearSetup["effectiveSalaryByPerson"],
  useRealContributions: ReturnType<
    typeof yearZeroBasis
  >["useRealContributions"],
  activeBaseYearContributions: ProjectionLoopState["activeBaseYearContributions"],
) {
  // IRS limits: every key grows at the limit growth rate; the specs are
  // capped per person (ages at Dec 31 of this year), and every path sizes
  // its slot limits from the household's group limits, each counted once.
  const hasSpecs = !!contributionSpecs && contributionSpecs.length > 0;
  const capCtx = {
    taxYear: year,
    filingStatus: irsLimitCaps.filingStatus,
    limits: Object.fromEntries(
      Object.entries(irsLimitCaps.limits).map(([k, v]) => [
        k,
        roundToCents(v * lgf),
      ]),
    ),
  };
  const capped = hasSpecs
    ? capSpecs(
        contributionSpecs!,
        {
          projectedSalary,
          salaryBase: currentSalary,
          limitGrowthFactor: lgf,
          personPay,
        },
        {
          ctx: capCtx,
          people: irsLimitCaps.people,
          employerMatch: yearEmployerMatch,
          wagesByPerson: hasPerPersonSalary
            ? new Map(projectedSalaryByPerson)
            : null,
        },
      )
    : null;
  const groupLimits =
    capped?.groupLimits ??
    accountGroupLimits(irsLimitCaps.accounts, {
      ...capCtx,
      people: irsLimitCaps.people.map((p) => ({ ...p, wages: null })),
    });
  const cappedByCategory = buildCategoryRecord(() => 0);
  contributionSpecs?.forEach((spec, i) => {
    cappedByCategory[spec.category] += capped!.capped[i]!.cappedAnnual;
  });
  const yearLimits = slotLimits(
    groupLimits,
    useRealContributions ? activeBaseYearContributions! : cappedByCategory,
  );

  return { capped, yearLimits };
}

/** The year's contribution slots, routed by the path that sizes them. */
export function routeYearSlots(
  useRealContributions: ReturnType<
    typeof yearZeroBasis
  >["useRealContributions"],
  activeBaseYearContributions: ProjectionLoopState["activeBaseYearContributions"],
  yearEmployerMatch: Record<AccountCategory, number>,
  proRate: number,
  lateYearCut: Record<AccountCategory, number>,
  yearLimits: ReturnType<typeof slotLimits>,
  config: ReturnType<typeof resolveAccumulationConfig>,
  contributionSpecs: ProjectionLoopState["contributionSpecs"],
  capped: ReturnType<typeof yearContributionLimits>["capped"],
  contribution: ContributionState,
  projectedSalary: number,
  targetContribution: number,
) {
  let slots: AccumulationSlot[];
  let routeWarnings: string[];
  let specOverflow = 0; // overflow from per-account routing (only IRS cap spillover)
  let rateCeilingScale: number | null = null; // set when rate ceiling scales down contributions

  if (useRealContributions) {
    // Build slots from per-account annual projections, pro-rated for partial year 0
    const categories: AccountCategory[] = getAllCategories();
    slots = categories
      .filter(
        (cat) =>
          activeBaseYearContributions![cat] > 0 || yearEmployerMatch[cat] > 0,
      )
      .map((cat) => {
        const employeeContrib = roundToCents(
          Math.max(
            0,
            activeBaseYearContributions![cat] * proRate - lateYearCut[cat],
          ),
        );
        const irsLimit = yearLimits[cat];
        const rothFrac = configGetRothFraction(cat, config.taxSplits);
        const rothContrib = roundToCents(employeeContrib * rothFrac);
        const tradContrib = roundToCents(employeeContrib - rothContrib);
        return {
          category: cat,
          irsLimit,
          effectiveLimit: isOverflowTarget(cat) ? 0 : irsLimit,
          employerMatch: yearEmployerMatch[cat],
          employeeContrib,
          rothContrib,
          traditionalContrib: tradContrib,
          remainingSpace: remainingRoom(
            {
              category: cat,
              irsLimit,
              effectiveLimit: isOverflowTarget(cat) ? 0 : irsLimit,
              employerMatch: yearEmployerMatch[cat],
            },
            employeeContrib,
          ),
          cappedByAccount: false,
          cappedByTaxType: false,
          overflowAmount: 0,
        };
      });
    routeWarnings = [];
  } else if (contributionSpecs && contributionSpecs.length > 0) {
    // Per-account routing from DB specs, capped per person above.
    const routed = routeFromSpecs(
      contributionSpecs,
      capped!,
      yearLimits,
      yearEmployerMatch,
      config,
    );
    slots = routed.slots;
    routeWarnings = routed.warnings;
    specOverflow = routed.totalOverflow;

    // Pro-rate year 0 spec-based employee contributions (routeFromSpecs computes full-year amounts)
    if (proRate < 1) {
      for (const slot of slots) {
        // Year 0's cut (negative: more left than the months give) moves the slot's employee
        // money; its tax parts follow by the same ratio.
        const full = slot.employeeContrib;
        slot.employeeContrib = roundToCents(
          Math.max(0, full * proRate - lateYearCut[slot.category]),
        );
        const partRatio =
          lateYearCut[slot.category] !== 0 && full > 0
            ? slot.employeeContrib / full
            : proRate;
        // The Portfolio part pro-rates with the slot (the ceiling below
        // scales the rest; left full-year it would exceed the slot).
        if (slot.portfolioContrib != null)
          slot.portfolioContrib = roundToCents(
            Math.min(slot.portfolioContrib * partRatio, slot.employeeContrib),
          );
        slot.rothContrib = roundToCents(slot.rothContrib * partRatio);
        slot.traditionalContrib = roundToCents(
          slot.traditionalContrib * partRatio,
        );
        slot.remainingSpace = remainingRoom(slot, slot.employeeContrib);
      }
      specOverflow = roundToCents(specOverflow * proRate);
    }

    // The retirement-rate ceiling on the spec slots.
    const ceiling = applyRateCeiling(
      slots,
      contribution,
      projectedSalary,
      config,
      proRate,
      specOverflow,
    );
    rateCeilingScale = ceiling.scale;
    specOverflow = ceiling.specOverflow;
  } else {
    const routed =
      config.routingMode === "waterfall"
        ? routeWaterfall(
            targetContribution,
            config,
            yearLimits,
            yearEmployerMatch,
          )
        : routePercentage(
            targetContribution,
            config,
            yearLimits,
            yearEmployerMatch,
          );
    slots = routed.slots;
    routeWarnings = routed.warnings;
  }

  return { slots, routeWarnings, specOverflow, rateCeilingScale };
}
