"use client";

/**
 * Drift + profile header section of the integrations preview panel.
 *
 * Renders two unrelated header pieces that share the "top of panel" region:
 *
 *   1. A name-drift banner with bulk "use API names" / "keep Ledgr names"
 *      reconciliation buttons. Only shown when at least one linked item has
 *      drifted.
 *   2. A profile + column selector (YNAB/Actual), only shown when the active
 *      service exposes multiple profiles.
 *
 * Mutations live in `useDriftMutations` so that a pending flip here does not
 * re-render any of the other four sections.
 */
import type { PreviewData, Service } from "../integrations-types";
import type { DriftMutations } from "./hooks/use-drift-mutations";

type Props = {
  service: Service;
  profile: PreviewData["profile"];
  totalDrifted: number;
  mutations: DriftMutations;
};

export function DriftBanner({
  service,
  profile,
  totalDrifted,
  mutations,
}: Props) {
  const {
    syncAllNames: syncAllNamesMut,
    setLinkedProfile: setLinkedProfileMut,
    setLinkedColumn: setLinkedColumnMut,
  } = mutations;

  return (
    <>
      {totalDrifted > 0 && (
        <div className="flex items-center gap-2 rounded border border-amber-200 bg-amber-50 p-2 text-xs">
          <span className="text-amber-700">
            {totalDrifted} linked{" "}
            {totalDrifted === 1 ? "item has" : "items have"} different names or
            categories in Ledgr vs API
          </span>
          <div className="ml-auto flex gap-1">
            <button
              onClick={() =>
                syncAllNamesMut.mutate({ service, direction: "pull" })
              }
              disabled={syncAllNamesMut.isPending}
              className="text-caption rounded bg-amber-100 px-2 py-0.5 whitespace-nowrap text-amber-700 hover:bg-amber-200 disabled:opacity-50"
            >
              Use all API names
            </button>
            <button
              onClick={() =>
                syncAllNamesMut.mutate({ service, direction: "keepLedgr" })
              }
              disabled={syncAllNamesMut.isPending}
              className="text-caption rounded bg-blue-50 px-2 py-0.5 whitespace-nowrap text-blue-600 hover:bg-blue-100 disabled:opacity-50"
            >
              Keep all Ledgr names
            </button>
          </div>
        </div>
      )}

      {profile && profile.availableProfiles.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted whitespace-nowrap">Profile:</span>
          <select
            value={profile.linkedProfileId ?? ""}
            onChange={(e) => {
              const val = e.target.value;
              setLinkedProfileMut.mutate({
                service,
                profileId: val ? Number(val) : null,
              });
            }}
            className="text-label border-strong bg-surface-primary min-w-[120px] rounded border px-1 py-1"
          >
            <option value="">Select...</option>
            {profile.availableProfiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.isActive ? " (active)" : ""}
              </option>
            ))}
          </select>
          {profile.columnLabels.length > 1 && (
            <>
              <span className="text-muted whitespace-nowrap">Mode:</span>
              <select
                value={profile.linkedColumnIndex}
                onChange={(e) =>
                  setLinkedColumnMut.mutate({
                    service,
                    columnIndex: Number(e.target.value),
                  })
                }
                className="text-label border-strong bg-surface-primary min-w-[80px] rounded border px-1 py-1"
              >
                {profile.columnLabels.map((label, i) => (
                  <option key={label} value={i}>
                    {label}
                  </option>
                ))}
              </select>
            </>
          )}
        </div>
      )}
    </>
  );
}
