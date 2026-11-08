import Link from "next/link";
import { settingsHref } from "@/lib/config/settings-sections";
import { NO_RETURN_RATE_MESSAGE } from "@/lib/pure/simulation/return-rate-breakpoints";
import type { ProjectionState } from "../projection-table-types";

export function EngineNotices({
  engineQuery,
}: {
  engineQuery: ProjectionState["engineQuery"];
}) {
  return (
    <>
      {engineQuery.error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          Failed to run engine: {engineQuery.error.message}
        </div>
      )}
      {engineQuery.data && "notConfigured" in engineQuery.data && (
        <div className="rounded bg-amber-50 px-3 py-2 text-sm text-amber-600">
          {NO_RETURN_RATE_MESSAGE}
          <Link
            href={settingsHref("taxdata", "returns")}
            className="ml-1 underline"
          >
            Set return rates
          </Link>
        </div>
      )}
    </>
  );
}

export function SimulationOffNotice({
  result,
  mcAutoloadEnabled,
  mcPrefetchQuery,
  runMonteCarlo,
}: {
  result: ProjectionState["result"];
  mcAutoloadEnabled: ProjectionState["mcAutoloadEnabled"];
  mcPrefetchQuery: ProjectionState["mcPrefetchQuery"];
  runMonteCarlo: ProjectionState["runMonteCarlo"];
}) {
  return (
    <>
      {result && !mcAutoloadEnabled && !mcPrefetchQuery.data && (
        <div className="border-subtle bg-surface-sunken flex items-center justify-between rounded-lg border px-3 py-2 print:hidden">
          <span className="text-muted text-xs">
            Simulation auto-load is off — chart bands unavailable.
          </span>
          <button
            onClick={() => runMonteCarlo()}
            className="text-xs font-medium text-blue-500 hover:text-blue-400"
          >
            Run Simulation
          </button>
        </div>
      )}
    </>
  );
}
