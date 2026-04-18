"use client";

/** General settings tab containing the living-cost category mapping editor, which assigns budget categories to Dave Ramsey spending ranges. */
import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import {
  RAMSEY_RANGES,
  DEFAULT_LIVING_COST_MAPPING,
} from "@/lib/config/living-costs";
import { formatPercent } from "@/lib/utils/format";
import { usePersistedToggle } from "@/lib/hooks/use-persisted-setting";
import {
  SK_RETIREMENT_SIMULATION_AUTOLOAD,
  SK_RETIREMENT_MC_AUTOLOAD,
  SK_RETIREMENT_COASTFIRE_MC_AUTOLOAD,
} from "@/lib/constants/settings-keys";

export function GeneralSettings() {
  return (
    <div className="space-y-8">
      <RetirementSettings />
      <LivingCostMappingEditor />
    </div>
  );
}

function Toggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
        checked ? "bg-blue-600" : "bg-gray-300"
      }`}
    >
      <span
        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
          checked ? "translate-x-4" : "translate-x-1"
        }`}
      />
    </button>
  );
}

function RetirementSettings() {
  const [engineAutoload, setEngineAutoload] = usePersistedToggle(
    SK_RETIREMENT_SIMULATION_AUTOLOAD,
    true,
  );
  const [mcAutoload, setMcAutoload] = usePersistedToggle(
    SK_RETIREMENT_MC_AUTOLOAD,
    true,
  );
  const [coastFireMcAutoload, setCoastFireMcAutoload] = usePersistedToggle(
    SK_RETIREMENT_COASTFIRE_MC_AUTOLOAD,
    true,
  );

  return (
    <div>
      <h3 className="text-sm font-semibold text-primary mb-1">Retirement</h3>
      <p className="text-xs text-muted mb-3">
        Controls for the retirement projection page.
      </p>
      <div className="border rounded-lg divide-y divide-subtle">
        <div className="flex items-center justify-between px-3 py-3">
          <div>
            <div className="text-sm font-medium text-primary">
              Auto-load simulation
            </div>
            <div className="text-xs text-muted mt-0.5">
              Runs the projection engine automatically on page load and whenever
              inputs change. Disable to trigger manually.
            </div>
          </div>
          <Toggle checked={engineAutoload} onChange={setEngineAutoload} />
        </div>
        <div className="flex items-center justify-between px-3 py-3">
          <div>
            <div className="text-sm font-medium text-primary">
              Auto-load simulations
            </div>
            <div className="text-xs text-muted mt-0.5">
              Prefetches 1,000 simulation trials in the background after the
              engine completes. Disable on slow connections or to run manually.
            </div>
          </div>
          <Toggle checked={mcAutoload} onChange={setMcAutoload} />
        </div>
        <div className="flex items-center justify-between px-3 py-3">
          <div>
            <div className="text-sm font-medium text-primary">
              Auto-load Coast FIRE simulations
            </div>
            <div className="text-xs text-muted mt-0.5">
              Runs the Coast FIRE simulation after the engine completes. Takes
              4–6s. Disable if you don&apos;t use the Coast FIRE scenario.
            </div>
          </div>
          <Toggle
            checked={coastFireMcAutoload}
            onChange={setCoastFireMcAutoload}
          />
        </div>
      </div>
    </div>
  );
}

function LivingCostMappingEditor() {
  const utils = trpc.useUtils();
  const { data: appSettings, isLoading: settingsLoading } =
    trpc.settings.appSettings.list.useQuery();
  const { data: budgetData, isLoading: budgetLoading } =
    trpc.budget.computeActiveSummary.useQuery();
  const upsert = trpc.settings.appSettings.upsert.useMutation({
    onSuccess: () => utils.settings.appSettings.list.invalidate(),
  });

  // Resolve saved mapping or default
  const savedEntry = appSettings?.find(
    (s: { key: string }) => s.key === "living_cost_mapping",
  );
  const savedMapping = savedEntry?.value as
    | Record<string, string[]>
    | undefined;
  const baseMapping = savedMapping ?? DEFAULT_LIVING_COST_MAPPING;

  // Local draft state
  const [draft, setDraft] = useState<Record<string, string[]> | null>(null);
  const mapping = draft ?? baseMapping;

  // Budget categories from active profile
  const budgetCategories = useMemo(() => {
    if (!budgetData?.result?.categories) return [];
    return budgetData.result.categories
      .map((c: { name: string }) => c.name)
      .sort();
  }, [budgetData]);

  // All categories currently assigned to any range
  const assignedCategories = useMemo(() => {
    const set = new Set<string>();
    for (const cats of Object.values(mapping)) {
      for (const c of cats) set.add(c);
    }
    return set;
  }, [mapping]);

  // Categories not yet assigned to any Ramsey range
  const unassigned = useMemo(
    () => budgetCategories.filter((c: string) => !assignedCategories.has(c)),
    [budgetCategories, assignedCategories],
  );

  const [addingTo, setAddingTo] = useState<string | null>(null);
  const [customInput, setCustomInput] = useState("");

  if (settingsLoading || budgetLoading) {
    return <div className="animate-pulse h-32 bg-surface-elevated rounded" />;
  }

  const isDirty = draft !== null;

  const addCategory = (ramseyName: string, category: string) => {
    const next = { ...mapping };
    next[ramseyName] = [...(next[ramseyName] ?? []), category];
    setDraft(next);
    setAddingTo(null);
    setCustomInput("");
  };

  const removeCategory = (ramseyName: string, category: string) => {
    const next = { ...mapping };
    next[ramseyName] = (next[ramseyName] ?? []).filter((c) => c !== category);
    setDraft(next);
  };

  const save = () => {
    if (!draft) return;
    upsert.mutate({
      key: "living_cost_mapping",
      value: draft as Record<string, unknown>,
    });
    setDraft(null);
  };

  const reset = () => {
    upsert.mutate({ key: "living_cost_mapping", value: null });
    setDraft(null);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-sm font-semibold text-primary">
            Living Costs Mapping
          </h3>
          <p className="text-xs text-muted mt-0.5">
            Map your budget categories to Dave Ramsey&apos;s recommended
            spending ranges. The dashboard Living Costs card uses this mapping.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isDirty && (
            <button
              onClick={() => setDraft(null)}
              className="text-xs text-muted hover:text-secondary px-2 py-1"
            >
              Discard
            </button>
          )}
          {savedMapping && (
            <button
              onClick={reset}
              disabled={upsert.isPending}
              className="text-xs text-red-500 hover:text-red-700 px-2 py-1"
              title="Reset to defaults"
            >
              Reset to Defaults
            </button>
          )}
          <button
            onClick={save}
            disabled={!isDirty || upsert.isPending}
            className="text-xs px-3 py-1 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
          >
            {upsert.isPending ? "Saving..." : "Save"}
          </button>
        </div>
      </div>

      <div className="space-y-2">
        {RAMSEY_RANGES.map((range) => {
          const cats = mapping[range.name] ?? [];
          return (
            <div key={range.name} className="border rounded-lg px-3 py-2">
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-primary">
                    {range.name}
                  </span>
                  <span className="text-[10px] text-faint">
                    {formatPercent(range.low, 0)}–{formatPercent(range.high, 0)}{" "}
                    of income
                  </span>
                </div>
                <button
                  onClick={() =>
                    setAddingTo(addingTo === range.name ? null : range.name)
                  }
                  className="text-[10px] text-blue-600 hover:text-blue-800 font-medium"
                >
                  + Add
                </button>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {cats.length === 0 && (
                  <span className="text-[10px] text-faint italic">
                    No categories mapped
                  </span>
                )}
                {cats.map((cat) => (
                  <span
                    key={cat}
                    className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-surface-elevated text-secondary"
                  >
                    {cat}
                    <button
                      onClick={() => removeCategory(range.name, cat)}
                      className="text-faint hover:text-red-500 font-bold"
                      title={`Remove ${cat}`}
                    >
                      &times;
                    </button>
                  </span>
                ))}
              </div>

              {addingTo === range.name && (
                <div className="mt-2 flex flex-wrap gap-1.5 items-center border-t border-subtle pt-2">
                  {/* Quick-add from unassigned budget categories */}
                  {unassigned.map((cat: string) => (
                    <button
                      key={cat}
                      onClick={() => addCategory(range.name, cat)}
                      className="text-[10px] px-1.5 py-0.5 rounded border border-dashed border-blue-300 text-blue-600 hover:bg-blue-50"
                    >
                      + {cat}
                    </button>
                  ))}
                  {/* Custom entry for categories not in the active budget */}
                  <span className="inline-flex items-center gap-1">
                    <input
                      type="text"
                      value={customInput}
                      onChange={(e) => setCustomInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && customInput.trim()) {
                          addCategory(range.name, customInput.trim());
                        }
                        if (e.key === "Escape") {
                          setAddingTo(null);
                          setCustomInput("");
                        }
                      }}
                      placeholder="Custom..."
                      className="text-[10px] px-1.5 py-0.5 border border-strong rounded w-24 focus:outline-none focus:ring-1 focus:ring-blue-400"
                    />
                    {customInput.trim() && (
                      <button
                        onClick={() =>
                          addCategory(range.name, customInput.trim())
                        }
                        className="text-[10px] text-blue-600 font-medium"
                      >
                        Add
                      </button>
                    )}
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {unassigned.length > 0 && (
        <div className="mt-3 p-2 bg-amber-50 border border-amber-200 rounded text-xs text-amber-700">
          <span className="font-medium">Unmapped categories:</span>{" "}
          {unassigned.join(", ")}
        </div>
      )}
    </div>
  );
}
