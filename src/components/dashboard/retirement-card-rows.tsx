/** The retirement card's estimate rows: the baseline withdrawal, Coast FIRE
 *  and when the simulation last ran. */
import { STRATEGY_CONFIG_BY_STORED_KEY } from "@/lib/config/stored-withdrawal-strategy";
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
  sustainableWd: number,
) {
  const strategyKey = settings.withdrawalStrategy as string | undefined;
  const strategyLabel = strategyKey
    ? (STRATEGY_CONFIG_BY_STORED_KEY[strategyKey]?.label ?? strategyKey)
    : "Fixed";
  const isDynamic = strategyKey && strategyKey !== "fixed";
  return (
    <div className="flex justify-between">
      <span className="text-muted">
        Est. Withdrawal (baseline)
        <HelpTip
          text={
            isDynamic
              ? `${strategyLabel} strategy — withdrawal varies year-to-year based on portfolio performance. This is a projected starting amount in today's dollars.`
              : "Your projected nest egg × withdrawal rate in today's dollars. Does not account for volatility or taxes — see Simulation on the Retirement page for a realistic range."
          }
          learnMoreHref="/retirement/decumulation-methodology"
        />
      </span>
      <span className="text-primary">
        {formatCurrency(sustainableWd)}/yr
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
  coastFireMcPeek:
    RouterOutputs["projection"]["computeCoastFireMC"] | undefined,
  ageLabel: (age: number) => string,
  coastFireData: Extract<
    RouterOutputs["projection"]["computeCoastFire"],
    { result: object }
  >,
) {
  const simResult = coastFireMcPeek?.result;
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
          text="The earliest age at which you can stop contributing and still fund your plan through end of plan. 'Already Coast' means you could stop today. This is the deterministic baseline — it doesn't account for market variance. The Retirement page's Plan Health tab runs a Simulation and can show a materially later age once you're asking 'stop today, and still succeed in ~90% of simulated outcomes.'"
          learnMoreHref={focusHref({ topic: "planHealth" })}
        />
      </span>
      <FocusLink
        focus={{ topic: "planHealth" }}
        className="text-primary hover:underline"
      >
        {coastFireData.result.status === "unreachable"
          ? "Not reachable"
          : coastFireData.result.status === "already_coast"
            ? "Already Coast"
            : ageLabel(coastFireData.result.coastFireAge ?? 0)}
        <span className="text-caption text-faint ml-1">
          {simLabel
            ? `(simulated: ${simLabel})`
            : "(baseline; see Plan Health for simulated)"}
        </span>
      </FocusLink>
    </div>
  );
}

/** When the last simulation ran, when one has. */
export function renderLastRunRow(
  mcPeek: RouterOutputs["projection"]["peekMonteCarloSummary"] | undefined,
  coastFireMcPeek:
    RouterOutputs["projection"]["computeCoastFireMC"] | undefined,
) {
  const lastRunAt = [mcPeek?.computedAt, coastFireMcPeek?.computedAt]
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
