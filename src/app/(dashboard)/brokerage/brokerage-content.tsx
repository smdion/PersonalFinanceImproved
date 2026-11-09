"use client";

/** Client content for the Brokerage page — prefetched by page.tsx. */

import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonTable } from "@/components/ui/skeleton";
import { QueryBoundary, queryPending } from "@/components/ui/query-boundary";
import { BrokerageYearSection } from "./brokerage-sections";
import { BrokerageGoalsPanel } from "./brokerage-sections";
import { BrokerageFundingPanel } from "./brokerage-sections";
import { brokerageFigures } from "./brokerage-figures";
import { useBrokeragePage } from "./use-brokerage-page";

export function BrokerageContent() {
  const {
    canEdit,
    canEditCostBasis,
    portfolioBrokerageAccounts,
    updateCostBasis,
    activeProfileId,
    brokerageLumpSums,
    setBrokerageLumpSums,
    savedAccumQuery,
    projectionQuery,
    data,
    isLoading,
    contributionData,
    brokerageData,
    contributionProfiles,
    upsertSetting,
    isGoalsOpen,
    setIsGoalsOpen,
    dollarMode,
    setDollarMode,
  } = useBrokeragePage();

  // Waiting on the saved rows shows the skeleton; their failure shows.
  if (isLoading || queryPending([projectionQuery, savedAccumQuery])) {
    return (
      <QueryBoundary
        query={[projectionQuery, savedAccumQuery]}
        frame={(body) => (
          <div>
            <PageHeader
              title="Brokerage Projection"
              subtitle="Non-retirement investment accounts"
            />
            {body}
          </div>
        )}
        fallback={<SkeletonTable rows={12} className="mt-4" />}
      />
    );
  }
  if (!data?.result) {
    return (
      <div>
        <PageHeader
          title="Brokerage Projection"
          subtitle="Non-retirement investment accounts"
        />
        <EmptyState message="No projection data available. Configure contribution accounts in Settings." />
      </div>
    );
  }

  // Run brokerage goals calculator on engine output
  const {
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
  } = brokerageFigures(
    data,
    contributionData,
    brokerageData,
    dollarMode,
    activeProfileId,
    contributionProfiles,
  );

  return (
    <div>
      <PageHeader
        title="Brokerage Projection"
        subtitle="Non-retirement investment accounts"
      />

      <BrokerageFundingPanel
        activeProfileName={activeProfileName}
        apiBalances={apiBalances}
        brokerageRamp={brokerageRamp}
        budgetLinks={budgetLinks}
        canEdit={canEdit}
        canEditCostBasis={canEditCostBasis}
        hasContextOverrides={hasContextOverrides}
        portfolioAccounts={portfolioAccounts}
        portfolioBrokerageAccounts={portfolioBrokerageAccounts}
        totalDirectContribution={totalDirectContribution}
        totalOverflow={totalOverflow}
        updateCostBasis={updateCostBasis}
        upsertSetting={upsertSetting}
      />

      <BrokerageGoalsPanel
        brokerageLumpSums={brokerageLumpSums}
        brokerageResult={brokerageResult}
        canEdit={canEdit}
        data={data}
        isGoalsOpen={isGoalsOpen}
        setBrokerageLumpSums={setBrokerageLumpSums}
        setIsGoalsOpen={setIsGoalsOpen}
      />

      {/* Year-by-Year Projection */}
      <BrokerageYearSection
        brokerageResult={brokerageResult}
        deflate={deflate}
        dollarMode={dollarMode}
        setDollarMode={setDollarMode}
      />
    </div>
  );
}
