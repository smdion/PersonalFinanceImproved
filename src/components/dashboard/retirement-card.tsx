"use client";

import { useHighIncomeHousehold } from "@/lib/hooks/use-high-income-household";
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

function RetirementCardImpl() {
  const projection = useDashboardProjection();
  const { engineInput, ready, data, gate } = projection;
  // The household's checkpoint table and today's figures for Readiness —
  // the same query (and input) the Milestones engine reads.
  const milestoneInputs = trpc.milestones.computeInputs.useQuery(
    useYearEndTargetingInput(),
  );
  // The match switch shared with every savings rate and contribution total.
  const household = useHighIncomeHousehold();
  const { excludeMatch } = useSavingsRateOptions(household.highIncome === true);
  const { data: coastFireData } = trpc.projection.computeCoastFire.useQuery(
    engineInput,
    { staleTime: 60_000, enabled: ready },
  );
  // Peek-only reads of the projection cache: never start a simulation run (slow,
  // rate-limited); show the last run if inputs still match. Null = nothing cached.
  const { data: simulationSummary } =
    trpc.projection.getSimulationSummary.useQuery(
      engineInput,
      // Always re-read: a run made on the Retirement page should show here
      // as soon as the dashboard is opened again.
      { staleTime: 0, enabled: ready },
    );
  const { data: coastFireSimulationSummary } =
    trpc.projection.computeCoastFireSimulation.useQuery(
      { ...engineInput, peekOnly: true },
      { staleTime: 0, enabled: ready },
    );
  const queries = [projection, gate, ...household.queries];
  if (queryPending(queries) || household.highIncome === undefined)
    return <CardQueryBoundary title="Retirement" query={queries} />;
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
    retirementAge,
    endAge,
    currentAge,
    yearOf,
    ageLabel,
    portfolioTotal,
    annualContributions,
    employerContributions,
    outcome,
    yearsToRet,
    sustainableWithdrawal,
    nestEggAge,
    nestEggDisplay,
    totalWithMatch,
    retirementBudget,
    taxAdvSpace,
  } = retirementCardFigures(data, simulationSummary);

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
              retirementAge={retirementAge}
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
            {sustainableWithdrawal > 0 &&
              renderWithdrawalRow(settings, sustainableWithdrawal)}
            {coastFireData?.result &&
              renderCoastFireRow(
                coastFireSimulationSummary,
                ageLabel,
                coastFireData,
              )}
            <SimulatedSuccessRow simulationSummary={simulationSummary} />
            {renderLastRunRow(simulationSummary, coastFireSimulationSummary)}
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
