/** The retirement card's estimate rows: the baseline withdrawal, Coast FIRE
 *  and when the simulation last ran. */
import { coastFireLabel } from "./coast-fire-label";
import { storedStrategyConfig } from "@/lib/config/stored-withdrawal-strategy";
import { focusHref } from "@/lib/config/focus-topics";
import { FocusLink } from "@/components/ui/focus-link";
import { HelpTip } from "@/components/ui/help-tip";
import { formatCurrency, formatRelativeTime } from "@/lib/utils/format";
import type { RouterOutputs } from "@/lib/trpc";
import type { useDashboardProjection } from "@/lib/hooks/use-dashboard-projection";

/** The baseline withdrawal row, with the active strategy's name. */
export function renderWithdrawalRow(
  settings: Extract<
    NonNullable<ReturnType<typeof useDashboardProjection>["data"]>,
    { settings: unknown }
  >["settings"],
  sustainableWithdrawal: number,
) {
  const strategyKey = settings.withdrawalStrategy as string | undefined;
  const strategyLabel = strategyKey
    ? (storedStrategyConfig(strategyKey)?.label ?? strategyKey)
    : "Fixed";
  const isDynamic = strategyKey && strategyKey !== "fixed";
  return (
    <div className="flex justify-between">
      <span className="text-muted">
        Est. Withdrawal (baseline)
        <HelpTip
          text={
            isDynamic
              ? `${strategyLabel} strategy — withdrawal varies year to year. This is your first retirement year's withdrawal in today's dollars: spending less Social Security, plus the tax on the withdrawal.`
              : "Your first retirement year's withdrawal in today's dollars: spending less Social Security, plus the tax on the withdrawal. Does not account for volatility — see Simulation on the Retirement page for a realistic range."
          }
          learnMoreHref="/retirement/decumulation-methodology"
        />
      </span>
      <span className="text-primary">
        {formatCurrency(sustainableWithdrawal)}/yr
        <span className="text-caption text-faint ml-1">
          ({strategyLabel}
          {isDynamic ? ", varies" : ""})
        </span>
      </span>
    </div>
  );
}

/** The Coast FIRE row: the baseline age, and the simulated one when run. */
export function renderCoastFireRow(
  coastFireSimulationPeek:
    RouterOutputs["projection"]["computeCoastFireSimulation"] | undefined,
  ageLabel: (age: number) => string,
  coastFireData: Extract<
    RouterOutputs["projection"]["computeCoastFire"],
    { result: object }
  >,
) {
  const simResult = coastFireSimulationPeek?.result;
  const simLabel = simResult
    ? simResult.status === "unreachable"
      ? "not reachable"
      : simResult.status === "already_coast"
        ? "already coast"
        : ageLabel(simResult.coastFireAge ?? 0)
    : null;
  return (
    <div className="flex justify-between">
      <span className="text-muted">
        Coast FIRE
        <HelpTip
          text="The earliest age at which you can stop contributing and still fund every retirement year of the projection. 'Already Coast' means you could stop today. This is the deterministic baseline — it doesn't account for market variance. The Retirement page's Projection Health tab runs a Simulation and can show a materially later age once you're asking 'stop today, and still succeed in ~90% of simulated outcomes.'"
          learnMoreHref={focusHref({ topic: "planHealth" })}
        />
      </span>
      <FocusLink
        focus={{ topic: "planHealth" }}
        className="text-primary hover:underline"
      >
        {coastFireLabel(coastFireData.result, ageLabel)}
        <span className="text-caption text-faint ml-1">
          {simLabel
            ? `(simulated: ${simLabel})`
            : "(baseline; see Projection Health for simulated)"}
        </span>
      </FocusLink>
    </div>
  );
}

/** When the last simulation ran, when one has. */
export function renderLastRunRow(
  simulationPeek:
    RouterOutputs["projection"]["getSimulationSummary"] | undefined,
  coastFireSimulationPeek:
    RouterOutputs["projection"]["computeCoastFireSimulation"] | undefined,
) {
  const lastRunAt = [
    simulationPeek?.computedAt,
    coastFireSimulationPeek?.computedAt,
  ]
    .filter((v): v is string => !!v)
    .sort()
    .at(-1);
  if (!lastRunAt) return null;
  return (
    <div className="flex justify-between">
      <span className="text-muted">Last simulation run</span>
      <span className="text-faint">{formatRelativeTime(lastRunAt)}</span>
    </div>
  );
}
