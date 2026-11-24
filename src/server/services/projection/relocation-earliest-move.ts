/** The Relocation tool's earliest safe move: a binary search over the
 *  current scenario's working years for the first move year whose run
 *  still succeeds. */
import { assessPlan } from "@/lib/pure/retirement/plan-outcome";
import type {
  EngineYearProjection,
  ProjectionResult,
} from "@/lib/pure/engine/types/index";

/** The earliest year the household can move and still have its plan hold,
 *  its age then, and the portfolio it needs going into that year. */
export function earliestSafeMove(
  runMovingIn: (moveYear: number) => ProjectionResult,
  currentAccRows: EngineYearProjection[],
  relocationFiTarget: number,
  isViableNow: boolean,
  engineBaseYear: number,
  currentAge: number,
  currentPayload: { portfolioTotal: number },
) {
  const probeViable = (rowIndex: number): boolean => {
    const probeResult = runMovingIn(currentAccRows[rowIndex]!.year);
    return assessPlan(probeResult).succeeded;
  };

  let earliestRelocateYear: number | null = null;
  let earliestRelocateAge: number | null = null;
  let recommendedPortfolioToRelocate = relocationFiTarget;

  // "Now" is the projection's year 0 — the snapshot's year — like
  // every row the search below can return.
  if (isViableNow) {
    earliestRelocateYear = engineBaseYear;
    earliestRelocateAge = Math.floor(currentAge);
    recommendedPortfolioToRelocate = currentPayload.portfolioTotal;
  } else if (
    currentAccRows.length > 0 &&
    probeViable(currentAccRows.length - 1)
  ) {
    let lo = 0;
    let hi = currentAccRows.length - 1;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (probeViable(mid)) {
        hi = mid;
      } else {
        lo = mid + 1;
      }
    }
    const foundRow = currentAccRows[lo]!;
    earliestRelocateYear = foundRow.year;
    earliestRelocateAge = Math.floor(foundRow.age);
    // The move happens at the START of foundRow.year, so what's needed
    // is the balance going into it: the prior year's end (or today's).
    recommendedPortfolioToRelocate =
      lo > 0
        ? currentAccRows[lo - 1]!.retirementBalance
        : currentPayload.portfolioTotal;
  }

  return {
    earliestRelocateYear,
    earliestRelocateAge,
    recommendedPortfolioToRelocate,
  };
}
