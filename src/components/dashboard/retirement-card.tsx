"use client";

import { useHighIncomeLine } from "@/lib/hooks/use-high-income-line";
import { memo } from "react";
import Link from "next/link";
import { settingsHref } from "@/lib/config/settings-sections";
import { NO_RETURN_RATE_MESSAGE } from "@/lib/pure/simulation/return-rate-breakpoints";

import { trpc } from "@/lib/trpc";
import { useDashboardProjection } from "@/lib/hooks/use-dashboard-projection";
import { useYearEndTargetingInput } from "@/lib/hooks/use-year-end-targeting";
import { DEFAULT_CHECKPOINT_SOURCE } from "@/lib/config/milestones";
import { Card } from "@/components/ui/card";
import { CardQueryBoundary, queryPending } from "./utils";
import { RetirementBenchmarks } from "./retirement-benchmarks";
import {
  renderWithdrawalRow,
  renderCoastFireRow,
  renderLastRunRow,
} from "./retirement-card-rows";
import {
  ContributionsRow,
  DurationRow,
  NestEggFigure,
  RetirementAccountsBreakdown,
  SimulatedSuccessRow,
  TaxRoomRow,
} from "./retirement-card-stats";
import { PlanTimeRows, RetirementBudgetRow } from "./retirement-card-plan-rows";
import { retirementCardFigures } from "./retirement-card-figures";
import { useSavingsRateOptions } from "@/lib/hooks/use-savings-rate-options";
import { isHighIncomeHousehold } from "@/lib/pure/contributions/savings-rate";

function RetirementCardImpl() {
  const projection = useDashboardProjection();
  const { engineInput, ready, data, gate } = projection;
  // The household's checkpoint table and today's figures for Readiness —
  // the same query (and input) the Milestones engine reads.
  const milestoneInputs = trpc.milestones.computeInputs.useQuery(
    useYearEndTargetingInput(),
  );
  const { threshold: highIncomeThreshold } = useHighIncomeLine();
  // The match switch shared with every savings rate and contribution total.
  const { excludeMatch } = useSavingsRateOptions(
    isHighIncomeHousehold(
      data && "combinedSalary" in data ? data.combinedSalary : 0,
      highIncomeThreshold,
    ),
  );
  const { data: coastFireData } = trpc.projection.computeCoastFire.useQuery(
    engineInput,
    { staleTime: 60_000, enabled: ready },
  );
  // Peek-only reads of the persistent projection cache — never trigger a
  // fresh Monte Carlo run (that's a multi-second, rate-limited operation),
  // just surface whatever the Retirement page's last real run already
  // computed, if the inputs still match. Null result = nothing cached yet.
  const { data: mcPeek } = trpc.projection.peekMonteCarloSummary.useQuery(
    engineInput,
    // Always re-read: a run made on the Retirement page should show here
    // as soon as the dashboard is opened again.
    { staleTime: 0, enabled: ready },
  );
  const { data: coastFireMcPeek } = trpc.projection.computeCoastFireMC.useQuery(
    { ...engineInput, peekOnly: true },
    { staleTime: 0, enabled: ready },
  );
  if (queryPending([projection, gate]))
    return <CardQueryBoundary title="Retirement" query={[projection, gate]} />;
  if (data && "notConfigured" in data)
    return (
      <Card title="Retirement" href="/retirement">
        <p className="text-faint text-sm">
          {NO_RETURN_RATE_MESSAGE}
          <Link
            href={settingsHref("taxdata", "returns")}
            className="ml-1 underline"
          >
            Set return rates
          </Link>
        </p>
      </Card>
    );
  if (!data?.result)
    return (
      <Card title="Retirement" href="/retirement">
        <p className="text-faint text-sm">
          Add a person and configure retirement settings to see projections.
        </p>
      </Card>
    );

  const {
    settings,
    retirementResult,
    retPortfolio,
    retAge,
    endAge,
    currentAge,
    yearOf,
    ageLabel,
    portfolioTotal,
    annualContributions,
    employerContributions,
    outcome,
    yearsToRet,
    sustainableWd,
    nestEggAge,
    nestEggDisplay,
    totalWithMatch,
    retirementBudget,
    taxAdvSpace,
  } = retirementCardFigures(data, mcPeek);

  return (
    <Card title="Retirement" href="/retirement">
      <div className="grid gap-x-8 gap-y-4 md:grid-cols-2">
        <div>
          <NestEggFigure
            nestEggDisplay={nestEggDisplay}
            yearOf={yearOf}
            nestEggAge={nestEggAge}
          />
          <div className="mt-3 space-y-1 text-sm">
            <PlanTimeRows
              yearsToRet={yearsToRet}
              result={retirementResult}
              yearOf={yearOf}
              retAge={retAge}
              portfolioTotal={portfolioTotal}
            />
            <RetirementAccountsBreakdown
              retPortfolio={retPortfolio}
              portfolioTotal={portfolioTotal}
            />
            <ContributionsRow
              excludeMatch={excludeMatch}
              annualContributions={annualContributions}
              totalWithMatch={totalWithMatch}
              employerContributions={employerContributions}
            />
            <TaxRoomRow taxAdvSpace={taxAdvSpace} />
            <div className="border-subtle my-1 border-t" />
            <RetirementBudgetRow retirementBudget={retirementBudget} />
            {sustainableWd > 0 && renderWithdrawalRow(settings, sustainableWd)}
            {coastFireData?.result &&
              renderCoastFireRow(coastFireMcPeek, ageLabel, coastFireData)}
            <SimulatedSuccessRow mcPeek={mcPeek} />
            {renderLastRunRow(mcPeek, coastFireMcPeek)}
            <DurationRow endAge={endAge} outcome={outcome} />
          </div>
        </div>
        <div className="md:border-subtle md:border-l md:pl-8">
          <RetirementBenchmarks
            data={{ ...data, result: retirementResult }}
            currentAge={currentAge}
            retirementSavings={portfolioTotal}
            checkpoint={{
              source:
                milestoneInputs.data?.checkpointSource ??
                DEFAULT_CHECKPOINT_SOURCE,
              now: milestoneInputs.data?.years.at(-1) ?? null,
              allAccountsByYear: data.result.projectionByYear,
            }}
          />
        </div>
      </div>
    </Card>
  );
}

export const RetirementCard = memo(RetirementCardImpl);
