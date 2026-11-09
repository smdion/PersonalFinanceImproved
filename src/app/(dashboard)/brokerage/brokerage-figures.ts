import type { DollarBasis } from "@/lib/config/enum-values";
import { flatDeflator, toTodaysDollars } from "@/lib/pure/simulation/dollars";
import { calculateBrokerageGoals } from "@/lib/pure/savings/brokerage-goals";
import { isPortfolioParent } from "@/lib/config/account-types";
import { sumBy } from "@/lib/utils/math";
import type { RouterOutputs } from "@/lib/trpc";

/** The page's figures from the projection, the contribution summary and the balances. */
export function brokerageFigures(
  data: NonNullable<RouterOutputs["projection"]["computeProjection"]> & {
    result: NonNullable<
      NonNullable<RouterOutputs["projection"]["computeProjection"]>["result"]
    >;
  },
  contributionData: RouterOutputs["contribution"]["computeSummary"] | undefined,
  brokerageData: RouterOutputs["brokerage"]["computeSummary"] | undefined,
  dollarMode: DollarBasis,
  activeProfileId: number | null,
  contributionProfiles:
    RouterOutputs["contributionProfile"]["list"] | undefined,
) {
  const brokerageGoalsInput = {
    asOfDate: new Date(),
    goals: data.brokerageGoals,
    engineYears: data.result.projectionByYear,
  };
  const brokerageResult = calculateBrokerageGoals(brokerageGoalsInput);

  // Portfolio-category accounts from contribution summary
  const portfolioAccounts = contributionData
    ? [
        ...contributionData.people.flatMap((p) =>
          p.accountTypes.filter((at) => isPortfolioParent(at.parentCategory)),
        ),
        ...contributionData.jointAccountTypes.filter((at) =>
          isPortfolioParent(at.parentCategory),
        ),
      ]
    : [];

  // API balance overlay — per tracked account (two accounts can share a type)
  const apiBalances = (brokerageData?.apiBalances ?? []).filter(
    (ab) => ab.source === "api",
  );
  const budgetLinks = brokerageData?.budgetLinks ?? [];

  // Deflation (Today's $ / Future $) — same pattern as retirement
  const inflationRate = Number(data.settings.annualInflation);
  const deflator = flatDeflator(new Date().getFullYear(), inflationRate);
  const deflate = (value: number, year: number) =>
    dollarMode === "nominal" ? value : toTodaysDollars(value, year, deflator);

  // Funding sources
  const totalDirectContribution = sumBy(
    portfolioAccounts,
    (at) => at.totalContrib,
  );
  const firstYear = brokerageResult.projectionByYear[0];
  const totalOverflow = firstYear?.overflow ?? 0;
  const accYears = data.result.projectionByYear.filter(
    (yearRow) => yearRow.phase === "accumulation",
  );
  const firstAccYear = accYears[0] as
    import("@/lib/pure/engine/types").EngineAccumulationYear | undefined;
  const brokerageRamp = firstAccYear?.brokerageRampContribution ?? 0;

  const activeProfileName =
    activeProfileId != null
      ? (contributionProfiles?.find((p) => p.id === activeProfileId)?.name ??
        null)
      : null;
  const hasContextOverrides = activeProfileName != null;

  return {
    brokerageResult,
    portfolioAccounts,
    apiBalances,
    budgetLinks,
    deflate,
    totalDirectContribution,
    totalOverflow,
    brokerageRamp,
    activeProfileName,
    hasContextOverrides,
  };
}
