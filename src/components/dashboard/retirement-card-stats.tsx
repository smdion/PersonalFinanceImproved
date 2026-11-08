import type { RouterOutputs } from "@/lib/trpc";
import type { simulatedOrBaseline } from "@/lib/pure/retirement/nest-egg-display";
import type { assessPlan } from "@/lib/pure/retirement/plan-outcome";
import { Metric } from "@/components/ui/card";
import { HelpTip } from "@/components/ui/help-tip";
import { FocusLink } from "@/components/ui/focus-link";
import { focusHref } from "@/lib/config/focus-topics";
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import { STATUS_COLORS } from "@/lib/utils/colors";
import { simulationRateTone } from "@/lib/config/simulation-tones";

export function NestEggFigure({
  nestEggDisplay,
  yearOf,
  nestEggAge,
}: {
  nestEggDisplay: ReturnType<typeof simulatedOrBaseline>;
  yearOf: (age: number) => number;
  nestEggAge: number;
}) {
  return (
    <>
      {nestEggDisplay.kind === "simulated" ? (
        <>
          <Metric
            value={formatCurrency(nestEggDisplay.median)}
            label={`Nest egg in ${yearOf(nestEggAge)} (today's $, simulated median)`}
          />
          <div className="text-caption text-faint mt-1 leading-tight">
            Range {formatCurrency(nestEggDisplay.low)} –{" "}
            {formatCurrency(nestEggDisplay.high)} · Baseline:{" "}
            {formatCurrency(nestEggDisplay.baseline)} (fixed returns)
          </div>
        </>
      ) : (
        <>
          <Metric
            value={formatCurrency(nestEggDisplay.baseline)}
            label={`Nest egg in ${yearOf(nestEggAge)} (today's $, baseline — fixed returns)`}
          />
          {/* The whole card links to /retirement — no nested link. */}
          <div className="text-caption text-faint mt-1 leading-tight">
            Run a simulation on the Retirement page to see the simulated range.
          </div>
        </>
      )}
    </>
  );
}

export function RetirementAccountsBreakdown({
  retPortfolio,
  portfolioTotal,
}: {
  retPortfolio:
    | { preTax: number; taxFree: number; hsa: number; afterTax: number }
    | undefined;
  portfolioTotal: number;
}) {
  return (
    <>
      {retPortfolio && portfolioTotal > 0 && (
        <div className="text-faint ml-3 space-y-0.5 text-xs">
          {retPortfolio.preTax > 0 && (
            <div className="flex justify-between">
              <span>Pre-tax</span>
              <span>{formatCurrency(retPortfolio.preTax)}</span>
            </div>
          )}
          {retPortfolio.taxFree > 0 && (
            <div className="flex justify-between">
              <span>Roth</span>
              <span>{formatCurrency(retPortfolio.taxFree)}</span>
            </div>
          )}
          {retPortfolio.hsa > 0 && (
            <div className="flex justify-between">
              <span>HSA</span>
              <span>{formatCurrency(retPortfolio.hsa)}</span>
            </div>
          )}
          {retPortfolio.afterTax > 0 && (
            <div className="flex justify-between">
              <span>After-tax</span>
              <span>{formatCurrency(retPortfolio.afterTax)}</span>
            </div>
          )}
        </div>
      )}
    </>
  );
}

export function ContributionsRow({
  excludeMatch,
  annualContributions,
  totalWithMatch,
  employerContributions,
}: {
  excludeMatch: boolean;
  annualContributions: number;
  totalWithMatch: number;
  employerContributions: number;
}) {
  return (
    <div className="flex justify-between">
      <span className="text-muted">Contributions</span>
      <span className="text-primary">
        {formatCurrency(excludeMatch ? annualContributions : totalWithMatch)}
        /yr
        {employerContributions > 0 && (
          <span className="text-caption text-faint ml-1">
            {excludeMatch
              ? `(+ ${formatCurrency(employerContributions)} match)`
              : `(${formatCurrency(annualContributions)} + ${formatCurrency(employerContributions)} match)`}
          </span>
        )}
      </span>
    </div>
  );
}

export function TaxRoomRow({ taxAdvSpace }: { taxAdvSpace: number }) {
  return (
    <>
      {taxAdvSpace > 0 && (
        <div className="flex justify-between">
          <span className="text-muted">Tax-advantaged room</span>
          <FocusLink
            focus={{ topic: "contributionElections" }}
            className="text-amber-600 hover:underline"
            title="See contribution elections on Paycheck"
          >
            {formatCurrency(taxAdvSpace)}/yr
          </FocusLink>
        </div>
      )}
    </>
  );
}

export function SimulatedSuccessRow({
  mcPeek,
}: {
  mcPeek: RouterOutputs["projection"]["peekMonteCarloSummary"] | undefined;
}) {
  return (
    <>
      {mcPeek?.result && (
        <div className="flex justify-between">
          <span className="text-muted">
            Simulated success
            <HelpTip
              text="The share of simulated market outcomes in which your projection doesn't run out of money, from the last Simulation you ran on the Retirement page. Not re-run automatically from the dashboard — visit the Retirement page's Projection Health tab to refresh it."
              learnMoreHref={focusHref({ topic: "planHealth" })}
            />
          </span>
          <FocusLink
            focus={{ topic: "planHealth" }}
            className={`font-medium hover:underline ${
              STATUS_COLORS[simulationRateTone(mcPeek.result.successRate)].text
            }`}
          >
            {formatPercent(mcPeek.result.successRate, 0)}
          </FocusLink>
        </div>
      )}
    </>
  );
}

export function DurationRow({
  endAge,
  outcome,
}: {
  endAge: number;
  outcome: ReturnType<typeof assessPlan>;
}) {
  return (
    <div className="flex justify-between">
      <span className="text-muted">Duration</span>
      {outcome.succeeded ? (
        <span className="font-medium text-green-600">Lasts to {endAge}+</span>
      ) : (
        // The year it fails, in the projection.
        <FocusLink
          focus={{ topic: "projectionYear", year: outcome.failureYear }}
          className="font-medium text-red-600 hover:underline"
        >
          {outcome.failureReason === "depleted"
            ? `Runs out ${outcome.failureYear}`
            : `Falls short ${outcome.failureYear}`}
        </FocusLink>
      )}
    </div>
  );
}
