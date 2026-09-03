"use client";

/** Debug settings tab providing diagnostics mode toggle, data freshness date overrides, an embedded test runner, and a danger-zone full data reset. */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import {
  usePersistedToggle,
  usePersistedSetting,
} from "@/lib/hooks/use-persisted-setting";
import { useUser, isAdmin } from "@/lib/context/user-context";
import { SK_SETTINGS_DEBUG_SECTION } from "@/lib/constants/settings-keys";
import { Button } from "@/components/ui/button";
import { STATUS_COLORS } from "@/lib/utils/colors";
import { formatDate } from "@/lib/utils/format";
import { TestRunner } from "./test-runner";

/** A stored freshness value can be a plain "YYYY-MM-DD" or a full ISO
 *  timestamp — take just the calendar day so the <input type="date"> and
 *  the "Current:" label both derive from the same normalization the
 *  sidebar's formatDate ultimately renders (avoids the Debug view and the
 *  sidebar tooltip disagreeing by a day). */
function toDateInputValue(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw.slice(0, 10);
}

const DEBUG_SECTIONS = [
  { key: "diagnostics", label: "Diagnostics" },
  { key: "freshness", label: "Data Freshness" },
  { key: "danger", label: "Danger Zone" },
] as const;

type DebugSectionKey = (typeof DEBUG_SECTIONS)[number]["key"];

export function DebugSettings() {
  const [section, setSection] = usePersistedSetting<DebugSectionKey>(
    SK_SETTINGS_DEBUG_SECTION,
    "diagnostics",
  );

  return (
    <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-6">
      <nav className="flex md:flex-col gap-1 overflow-x-auto">
        {DEBUG_SECTIONS.map((s) => (
          <button
            key={s.key}
            onClick={() => setSection(s.key)}
            className={`px-3 py-2 text-sm text-left rounded-md whitespace-nowrap transition-colors ${
              section === s.key
                ? s.key === "danger"
                  ? "bg-red-600 text-white"
                  : "bg-blue-600 text-white"
                : s.key === "danger"
                  ? `${STATUS_COLORS.red.text} hover:bg-red-50`
                  : "text-secondary hover:bg-surface-elevated"
            }`}
          >
            {s.label}
          </button>
        ))}
      </nav>

      <div>
        {/* All three stay mounted — Data Freshness and Danger Zone each
         *  hold in-progress local draft state (typed-but-unsaved dates,
         *  the reset confirmation text) that would silently reset on a
         *  switch away and back otherwise, same pattern the other shells
         *  guard against. */}
        <div className={section === "diagnostics" ? "" : "hidden"}>
          <DiagnosticsSection />
        </div>
        <div className={section === "freshness" ? "" : "hidden"}>
          <DataFreshnessSection />
        </div>
        <div className={section === "danger" ? "" : "hidden"}>
          <DangerZoneSection />
        </div>
      </div>
    </div>
  );
}

function DiagnosticsSection() {
  const admin = isAdmin(useUser());
  const [diagMode, setDiagMode] = usePersistedToggle("diag_mode", false);

  return (
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

      {diagMode && admin && (
        <div className="border-t border-subtle pt-4 mt-4">
          <TestRunner />
        </div>
      )}
    </div>
  );
}

function DataFreshnessSection() {
  const admin = isAdmin(useUser());
  const utils = trpc.useUtils();
  const { data } = trpc.settings.getDataFreshness.useQuery();
  const updateMut = trpc.settings.updateDataFreshness.useMutation({
    onSuccess: () => utils.settings.getDataFreshness.invalidate(),
  });

  const [balanceDate, setBalanceDate] = useState("");
  const [perfDate, setPerfDate] = useState("");
  const [basisDate, setBasisDate] = useState("");

  const fields = [
    {
      label: "Balance last updated",
      current: data?.balanceDate ?? null,
      value: balanceDate,
      set: setBalanceDate,
      hint: "From the most recent portfolio snapshot's date.",
    },
    {
      label: "Performance last updated",
      current: data?.performanceDate ?? null,
      value: perfDate,
      set: setPerfDate,
      hint: "Stored as an app setting.",
    },
    {
      label: "Cost basis last updated",
      current: data?.basisDate ?? null,
      value: basisDate,
      set: setBasisDate,
      hint: "Stored as an app setting.",
    },
  ];

  const anyDraft = !!(balanceDate || perfDate || basisDate);

  return (
    <div>
      <h3 className="text-sm font-medium text-primary mb-3">
        Data Freshness Dates
      </h3>
      <p className="text-xs text-muted mb-4">
        Override the &ldquo;last updated&rdquo; dates shown in the sidebar
        &ldquo;Data Updated&rdquo; tooltip. Leave a field blank to keep its
        current value.
      </p>
      <div className="space-y-3 max-w-sm">
        {fields.map((f) => (
          <div key={f.label}>
            <label className="block text-xs font-medium text-muted mb-1">
              {f.label}
            </label>
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={f.value}
                onChange={(e) => f.set(e.target.value)}
                className="block w-full rounded border border-strong px-2 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
              <span className="text-caption text-faint whitespace-nowrap">
                {/* Same formatDate the sidebar tooltip uses, so the two
                    views never disagree on the day. */}
                Current:{" "}
                {f.current ? formatDate(toDateInputValue(f.current)) : "—"}
              </span>
            </div>
          </div>
        ))}
        <Button
          variant="primary"
          size="sm"
          onClick={() => {
            if (!anyDraft) return;
            updateMut.mutate({
              ...(balanceDate ? { balanceDate } : {}),
              ...(perfDate ? { performanceDate: perfDate } : {}),
              ...(basisDate ? { basisDate } : {}),
            });
            setBalanceDate("");
            setPerfDate("");
            setBasisDate("");
          }}
          disabled={!anyDraft || updateMut.isPending || !admin}
        >
          {updateMut.isPending ? "Saving..." : "Update"}
        </Button>
        {updateMut.isSuccess && (
          <p className={`text-xs ${STATUS_COLORS.green.text}`}>
            Dates updated.
          </p>
        )}
        {updateMut.isError && (
          <p className={`text-xs ${STATUS_COLORS.red.text}`}>
            {updateMut.error.message}
          </p>
        )}
      </div>
    </div>
  );
}

function DangerZoneSection() {
  const admin = isAdmin(useUser());
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

  return (
    <div>
      <h3 className="text-sm font-semibold text-red-600 mb-2">Danger Zone</h3>
      {showReset ? (
        <div className="space-y-2">
          <p className={`text-xs ${STATUS_COLORS.red.text}`}>
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
            <Button
              variant="danger"
              size="xs"
              onClick={() => resetMut.mutate({ confirmation: "delete" })}
              disabled={resetText !== "delete" || resetMut.isPending || !admin}
            >
              {resetMut.isPending ? "Clearing..." : "Clear All Data"}
            </Button>
            <Button
              variant="secondary"
              size="xs"
              onClick={() => {
                setShowReset(false);
                setResetText("");
              }}
            >
              Cancel
            </Button>
          </div>
          {resetMut.error && (
            <p className={`text-xs ${STATUS_COLORS.red.text}`}>
              {resetMut.error.message}
            </p>
          )}
        </div>
      ) : (
        <Button variant="danger" size="xs" onClick={() => setShowReset(true)}>
          Reset App — Clear All Data
        </Button>
      )}
    </div>
  );
}
