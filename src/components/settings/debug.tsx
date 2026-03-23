"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { usePersistedToggle } from "@/lib/hooks/use-persisted-setting";
import { useUser, isAdmin } from "@/lib/context/user-context";
import { TestRunner } from "./test-runner";

export function DebugSettings() {
  const user = useUser();
  const admin = isAdmin(user);
  const [diagMode, setDiagMode] = usePersistedToggle("diag_mode", false);
  const utils = trpc.useUtils();
  const [showReset, setShowReset] = useState(false);
  const [resetText, setResetText] = useState("");
  const resetMut = trpc.version.resetAllData.useMutation({
    onSuccess: () => {
      utils.invalidate();
      setShowReset(false);
      setResetText("");
    },
  });

  const { data } = trpc.settings.getDataFreshness.useQuery(undefined, {
    staleTime: 5 * 60 * 1000,
  });

  const updateMut = trpc.settings.updateDataFreshness.useMutation({
    onSuccess: () => utils.settings.getDataFreshness.invalidate(),
  });

  const [balanceDate, setBalanceDate] = useState("");
  const [perfDate, setPerfDate] = useState("");

  // Sync initial values from query data
  const balancePlaceholder = data?.balanceDate ?? "";
  const perfPlaceholder = data?.performanceDate ?? "";

  return (
    <div className="space-y-6">
      {/* Diagnostics mode */}
      <div>
        <h3 className="text-sm font-medium text-primary mb-3">Diagnostics</h3>
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={diagMode}
            onChange={(e) => setDiagMode(e.target.checked)}
            disabled={!admin}
            className="h-4 w-4 rounded border-strong text-blue-600 focus:ring-blue-500"
          />
          <div>
            <span className="text-sm font-medium text-secondary">
              Diagnostics mode
            </span>
            <p className="text-xs text-muted">
              Show diagnostic tooltips and debug data on projection tables
              (withdrawal routing, MC proof notes, etc.)
            </p>
          </div>
        </label>
      </div>

      {/* Test Runner (admin + debug mode only) */}
      {diagMode && admin && (
        <div className="border-t border-subtle pt-4">
          <TestRunner />
        </div>
      )}

      {/* Data freshness overrides */}
      <div>
        <h3 className="text-sm font-medium text-primary mb-3">
          Data Freshness Dates
        </h3>
        <p className="text-xs text-muted mb-4">
          Override the &ldquo;last updated&rdquo; dates shown in the sidebar.
          Balance date comes from the most recent portfolio snapshot;
          performance date is stored as an app setting.
        </p>
        <div className="space-y-3 max-w-sm">
          <div>
            <label className="block text-xs font-medium text-muted mb-1">
              Balance last updated
            </label>
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={balanceDate}
                onChange={(e) => setBalanceDate(e.target.value)}
                placeholder={balancePlaceholder}
                className="block w-full rounded border border-strong px-2 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
              {balancePlaceholder && (
                <span className="text-[10px] text-faint whitespace-nowrap">
                  Current: {balancePlaceholder}
                </span>
              )}
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-muted mb-1">
              Performance last updated
            </label>
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={perfDate}
                onChange={(e) => setPerfDate(e.target.value)}
                placeholder={perfPlaceholder}
                className="block w-full rounded border border-strong px-2 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
              {perfPlaceholder && (
                <span className="text-[10px] text-faint whitespace-nowrap">
                  Current: {perfPlaceholder}
                </span>
              )}
            </div>
          </div>
          <button
            onClick={() => {
              if (!balanceDate && !perfDate) return;
              updateMut.mutate({
                ...(balanceDate ? { balanceDate } : {}),
                ...(perfDate ? { performanceDate: perfDate } : {}),
              });
              setBalanceDate("");
              setPerfDate("");
            }}
            disabled={
              (!balanceDate && !perfDate) || updateMut.isPending || !admin
            }
            className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {updateMut.isPending ? "Saving..." : "Update"}
          </button>
          {updateMut.isSuccess && (
            <p className="text-xs text-green-600">Dates updated.</p>
          )}
          {updateMut.isError && (
            <p className="text-xs text-red-600">{updateMut.error.message}</p>
          )}
        </div>
      </div>

      {/* Danger Zone */}
      <div className="mt-6 pt-4 border-t border-red-200">
        <h3 className="text-sm font-semibold text-red-600 mb-2">Danger Zone</h3>
        {showReset ? (
          <div className="space-y-2">
            <p className="text-xs text-red-600">
              This will permanently delete all financial data. Versions and app
              settings are preserved. This cannot be undone.
            </p>
            <p className="text-xs text-muted">
              Type <span className="font-mono font-bold">delete</span> to confirm:
            </p>
            <input
              type="text"
              value={resetText}
              onChange={(e) => setResetText(e.target.value)}
              placeholder="delete"
              className="w-full px-2 py-1.5 text-sm border border-red-300 rounded bg-surface-primary focus:outline-none focus:ring-1 focus:ring-red-400"
              autoFocus
            />
            <div className="flex gap-2">
              <button
                onClick={() => resetMut.mutate({ confirmation: "delete" })}
                disabled={resetText !== "delete" || resetMut.isPending || !admin}
                className="px-3 py-1.5 text-xs font-medium text-white bg-red-600 rounded hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {resetMut.isPending ? "Clearing..." : "Clear All Data"}
              </button>
              <button
                onClick={() => {
                  setShowReset(false);
                  setResetText("");
                }}
                className="px-3 py-1.5 text-xs font-medium text-secondary bg-surface-elevated rounded hover:bg-surface-strong transition-colors"
              >
                Cancel
              </button>
            </div>
            {resetMut.error && (
              <p className="text-xs text-red-600">{resetMut.error.message}</p>
            )}
          </div>
        ) : (
          <button
            onClick={() => setShowReset(true)}
            className="px-3 py-1.5 text-xs font-medium text-red-600 border border-red-300 rounded hover:bg-red-50 transition-colors"
          >
            Reset App — Clear All Data
          </button>
        )}
      </div>
    </div>
  );
}
