import {
  SIMULATION_NOT_CONFIGURED_MESSAGE,
  type SimulationNotConfigured,
} from "@/lib/pure/simulation/monte-carlo";
import { NO_RETURN_RATE_MESSAGE } from "@/lib/pure/return-rate-breakpoints";
import { SettingsLink } from "./settings-link";

/** Why a projection or Simulation can't run, as a procedure's
 *  `notConfigured` names it; a missing return rate links to where it's set. */
export function NotConfiguredNotice({
  reason,
}: {
  reason: SimulationNotConfigured | "no_return_rate";
}) {
  return (
    <div className="rounded bg-amber-50 px-3 py-2 text-sm text-amber-600">
      {reason === "no_return_rate" ? (
        <>
          {NO_RETURN_RATE_MESSAGE}{" "}
          <SettingsLink tab="taxdata" section="returns" className="underline">
            Set return rates
          </SettingsLink>
        </>
      ) : (
        SIMULATION_NOT_CONFIGURED_MESSAGE[reason]
      )}
    </div>
  );
}
