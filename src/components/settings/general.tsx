"use client";

/** General settings tab containing the living-cost category mapping editor, which assigns budget categories to Dave Ramsey spending ranges. */
import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import {
  RAMSEY_RANGES,
  DEFAULT_LIVING_COST_MAPPING,
} from "@/lib/config/living-costs";
import { formatPercent } from "@/lib/utils/format";
import { STATUS_COLORS } from "@/lib/utils/colors";
import {
  usePersistedToggle,
  usePersistedSetting,
} from "@/lib/hooks/use-persisted-setting";
import {
  SK_RETIREMENT_SIMULATION_AUTOLOAD,
  SK_RETIREMENT_MC_AUTOLOAD,
  SK_RETIREMENT_COASTFIRE_MC_AUTOLOAD,
  SK_SETTINGS_GENERAL_SECTION,
} from "@/lib/constants/settings-keys";
import { Button } from "@/components/ui/button";
import { Toggle } from "@/components/ui/toggle";
import { PeopleSettings } from "@/components/settings/people";

const GENERAL_SECTIONS = [
  { key: "people", label: "People" },
  { key: "retirement", label: "Retirement" },
  { key: "livingCosts", label: "Living Costs Mapping" },
] as const;

type GeneralSectionKey = (typeof GENERAL_SECTIONS)[number]["key"];

export function GeneralSettings() {
  const [section, setSection] = usePersistedSetting<GeneralSectionKey>(
    SK_SETTINGS_GENERAL_SECTION,
    "people",
  );

  return (
    <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-6">
      <nav className="flex md:flex-col gap-1 overflow-x-auto">
        {GENERAL_SECTIONS.map((s) => (
          <button
            key={s.key}
            onClick={() => setSection(s.key)}
            className={`px-3 py-2 text-sm text-left rounded-md whitespace-nowrap transition-colors ${
              section === s.key
                ? "bg-blue-600 text-white"
                : "text-secondary hover:bg-surface-elevated"
            }`}
          >
            {s.label}
          </button>
        ))}
      </nav>

      <div>
        {/* Both stay mounted — LivingCostMappingEditor holds in-progress
         *  local draft state (category assignments not yet saved) that
         *  would silently reset if switching away and back unmounted it,
         *  same risk the Integrations shell's connection cards have. Only
         *  visibility toggles. */}
        <div className={section === "people" ? "" : "hidden"}>
          <PeopleSettings />
        </div>
        <div className={section === "retirement" ? "" : "hidden"}>
          <RetirementSettings />
        </div>
        <div className={section === "livingCosts" ? "" : "hidden"}>
          <LivingCostMappingEditor />
        </div>
      </div>
    </div>
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
  // Default false (2026-08-30) — Coast FIRE MC now runs on demand (when the
  // scenario is actually selected), not eagerly on every page load. This
  // toggle is the opt-in back to the old always-prefetched behavior. Must
  // match the default in use-projection-queries.ts's own usePersistedToggle
  // call for this same key, or this page shows the toggle in a state that
  // disagrees with actual behavior until the user touches it.
  const [coastFireMcAutoload, setCoastFireMcAutoload] = usePersistedToggle(
    SK_RETIREMENT_COASTFIRE_MC_AUTOLOAD,
    false,
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
          <Toggle
            isChecked={engineAutoload}
            onChange={setEngineAutoload}
            ariaLabel="Auto-load simulation"
          />
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
          <Toggle
            isChecked={mcAutoload}
            onChange={setMcAutoload}
            ariaLabel="Auto-load simulations"
          />
        </div>
        <div className="flex items-center justify-between px-3 py-3">
          <div>
            <div className="text-sm font-medium text-primary">
              Always prefetch Coast FIRE simulations
            </div>
            <div className="text-xs text-muted mt-0.5">
              Runs the Coast FIRE simulation after the engine completes, even
              before you select that scenario. Takes 4–6s. Off by default — it
              already runs automatically the moment you pick a Coast FIRE
              scenario; enable this only if you want that switch to feel instant
              at the cost of a slower page load every time.
            </div>
          </div>
          <Toggle
            isChecked={coastFireMcAutoload}
            onChange={setCoastFireMcAutoload}
            ariaLabel="Auto-load Coast FIRE simulations"
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
    Record<string, string[]> | undefined;
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
            <Button variant="ghost" size="xs" onClick={() => setDraft(null)}>
              Discard
            </Button>
          )}
          {savedMapping && (
            <Button
              variant="danger"
              size="xs"
              onClick={reset}
              disabled={upsert.isPending}
              title="Reset to defaults"
            >
              Reset to Defaults
            </Button>
          )}
          <Button
            variant="primary"
            size="xs"
            onClick={save}
            disabled={!isDirty || upsert.isPending}
          >
            {upsert.isPending ? "Saving..." : "Save"}
          </Button>
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
                  <span className="text-caption text-faint">
                    {formatPercent(range.low, 0)}–{formatPercent(range.high, 0)}{" "}
                    of income
                  </span>
                </div>
                {/* Matches the "+Year"/"+ Add year" blue-link pattern used
                 *  by the other Settings add-flows (YearSelector and
                 *  friends) rather than Button's ghost variant, which
                 *  reads as a neutral toggle, not an "add" affordance. */}
                <button
                  onClick={() =>
                    setAddingTo(addingTo === range.name ? null : range.name)
                  }
                  className="text-caption text-blue-600 hover:text-blue-800 font-medium"
                >
                  + Add
                </button>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {cats.length === 0 && (
                  <span className="text-caption text-faint italic">
                    No categories mapped
                  </span>
                )}
                {cats.map((cat) => (
                  <span
                    key={cat}
                    className="inline-flex items-center gap-1 text-caption px-1.5 py-0.5 rounded bg-surface-elevated text-secondary"
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
                      className="text-caption px-1.5 py-0.5 rounded border border-dashed border-blue-300 text-blue-600 hover:bg-blue-50"
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
                      className="text-caption px-1.5 py-0.5 border border-strong rounded w-24 focus:outline-none focus:ring-1 focus:ring-blue-400"
                    />
                    {customInput.trim() && (
                      <button
                        onClick={() =>
                          addCategory(range.name, customInput.trim())
                        }
                        className="text-caption text-blue-600 font-medium"
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
        <div
          className={`mt-3 p-2 rounded text-xs border ${STATUS_COLORS.amber.bg} ${STATUS_COLORS.amber.border} ${STATUS_COLORS.amber.text}`}
        >
          <span className="font-medium">Unmapped categories:</span>{" "}
          {unassigned.join(", ")}
        </div>
      )}
    </div>
  );
}
