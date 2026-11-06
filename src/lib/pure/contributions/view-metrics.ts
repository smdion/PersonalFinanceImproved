import { roundToCents } from "@/lib/utils/math";
import type { ViewMode } from "@/lib/pure/contributions/view-mode";

export type AccountViewMetrics = {
  employeeContrib: number;
  employerMatch: number;
  totalContrib: number;
  fundingPct: number;
  fundingMissing: number;
  pctOfSalaryToMax: number | null;
};

export type ViewAwareTotals = {
  retirementWithoutMatch: number;
  retirementWithMatch: number;
  portfolioWithoutMatch: number;
  portfolioWithMatch: number;
  totalWithoutMatch: number;
  totalWithMatch: number;
  /** The compensation a savings rate divides by (YTD: earned so far). */
  compensation: number;
};

function limitMetrics(
  towardLimit: number,
  limit: number,
  salary: number,
): {
  fundingPct: number;
  fundingMissing: number;
  pctOfSalaryToMax: number | null;
} {
  if (limit <= 0)
    return { fundingPct: 0, fundingMissing: 0, pctOfSalaryToMax: null };
  const missing = Math.max(0, limit - towardLimit);
  const pctOfSalaryToMax =
    salary > 0 && missing > 0
      ? roundToCents((missing / salary) * 100 * 100) / 100
      : salary > 0
        ? 0
        : null;
  return {
    fundingPct: towardLimit / limit,
    fundingMissing: missing,
    pctOfSalaryToMax,
  };
}

export function computeViewAwareAccountMetrics(input: {
  projected: { employeeContrib: number; employerMatch: number };
  blended: { employeeContrib: number; employerMatch: number };
  ytdActual: { contributions: number; employerMatch: number } | null;
  limit: number;
  salary: number;
  matchCountsTowardLimit: boolean;
}): Record<ViewMode, AccountViewMetrics> {
  const {
    projected,
    blended,
    ytdActual,
    limit,
    salary,
    matchCountsTowardLimit,
  } = input;

  function buildView(
    emp: number,
    match: number,
    isYtd: boolean,
  ): AccountViewMetrics {
    const total = emp + match;
    const toward = matchCountsTowardLimit ? total : emp;
    const lm = limitMetrics(toward, limit, salary);
    return {
      employeeContrib: roundToCents(emp),
      employerMatch: roundToCents(match),
      totalContrib: roundToCents(total),
      fundingPct: lm.fundingPct,
      fundingMissing: lm.fundingMissing,
      pctOfSalaryToMax: isYtd ? null : lm.pctOfSalaryToMax,
    };
  }

  const projView = buildView(
    projected.employeeContrib,
    projected.employerMatch,
    false,
  );

  if (!ytdActual) {
    return { projected: projView, blended: projView, ytd: projView };
  }

  const blendedView = buildView(
    blended.employeeContrib,
    blended.employerMatch,
    false,
  );
  const ytdView = buildView(
    ytdActual.contributions,
    ytdActual.employerMatch,
    true,
  );

  return { projected: projView, blended: blendedView, ytd: ytdView };
}

export function computeViewAwareTotals(input: {
  projected: {
    retirementWithoutMatch: number;
    retirementWithMatch: number;
    portfolioWithoutMatch: number;
    portfolioWithMatch: number;
  };
  blended: {
    retirementWithoutMatch: number;
    retirementWithMatch: number;
    portfolioWithoutMatch: number;
    portfolioWithMatch: number;
  };
  ytdActuals: {
    retirement: number;
    portfolio: number;
    retirementMatch: number;
    portfolioMatch: number;
  };
  ytdRatio: number;
  totalCompensation: number;
  blendedTotalCompensation?: number;
}): Record<ViewMode, ViewAwareTotals> {
  const { projected, blended, ytdActuals, ytdRatio, totalCompensation } = input;
  const blendedComp = input.blendedTotalCompensation ?? totalCompensation;

  function buildView(src: typeof projected, comp: number): ViewAwareTotals {
    const totalWithout = src.retirementWithoutMatch + src.portfolioWithoutMatch;
    const totalWith = src.retirementWithMatch + src.portfolioWithMatch;
    return {
      retirementWithoutMatch: src.retirementWithoutMatch,
      retirementWithMatch: src.retirementWithMatch,
      portfolioWithoutMatch: src.portfolioWithoutMatch,
      portfolioWithMatch: src.portfolioWithMatch,
      totalWithoutMatch: totalWithout,
      totalWithMatch: totalWith,
      compensation: comp,
    };
  }

  const projView = buildView(projected, totalCompensation);

  const hasActuals =
    ytdActuals.retirement > 0 ||
    ytdActuals.portfolio > 0 ||
    ytdActuals.retirementMatch > 0 ||
    ytdActuals.portfolioMatch > 0;

  if (!hasActuals) {
    return { projected: projView, blended: projView, ytd: projView };
  }

  const blendedView = buildView(blended, blendedComp);

  const ytdRetWithout = roundToCents(ytdActuals.retirement);
  const ytdRetWith = roundToCents(
    ytdActuals.retirement + ytdActuals.retirementMatch,
  );
  const ytdPortWithout = roundToCents(ytdActuals.portfolio);
  const ytdPortWith = roundToCents(
    ytdActuals.portfolio + ytdActuals.portfolioMatch,
  );
  const ytdCompensation = totalCompensation * ytdRatio;
  const ytdView = buildView(
    {
      retirementWithoutMatch: ytdRetWithout,
      retirementWithMatch: ytdRetWith,
      portfolioWithoutMatch: ytdPortWithout,
      portfolioWithMatch: ytdPortWith,
    },
    ytdCompensation > 0 ? ytdCompensation : totalCompensation,
  );

  return { projected: projView, blended: blendedView, ytd: ytdView };
}
