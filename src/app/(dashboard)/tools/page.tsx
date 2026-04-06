"use client";

/** Financial calculators and tools page (compound interest, loan payoff, tax estimators, etc.). */

import { useState, useMemo, useCallback } from "react";
import { Skeleton, SkeletonChart } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";
import { Card } from "@/components/ui/card";
import { Toggle } from "@/components/ui/toggle";
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { HelpTip } from "@/components/ui/help-tip";
import type { RelocationScenarioParams } from "@/lib/db/schema";

export default function ToolsPage() {
  // Relocation analysis state
  const [relocCurrentProfileId, setRelocCurrentProfileId] = useState<
    number | null
  >(null);
  const [relocCurrentCol, setRelocCurrentCol] = useState(0);
  const [relocTargetProfileId, setRelocTargetProfileId] = useState<
    number | null
  >(null);
  const [relocTargetCol, setRelocTargetCol] = useState(1);
  const [relocCurrentOverride, setRelocCurrentOverride] = useState<string>("");
  const [relocTargetOverride, setRelocTargetOverride] = useState<string>("");
  const [relocYearAdjustments, setRelocYearAdjustments] = useState<
    {
      id: string;
      year: number;
      monthlyExpenses: number;
      profileId?: number;
      budgetColumn?: number;
      notes?: string;
    }[]
  >([]);
  const [showRelocAllYears, setShowRelocAllYears] = useState(false);
  const [showRelocAdjForm, setShowRelocAdjForm] = useState(false);
  const [relocAdjMode, setRelocAdjMode] = useState<"manual" | "profile">(
    "manual",
  );
  const [relocAdjForm, setRelocAdjForm] = useState({
    year: String(new Date().getFullYear() + 2),
    monthlyExpenses: "",
    profileId: "",
    budgetColumn: "0",
    notes: "",
  });

  // Large purchases state
  const [relocLargePurchases, setRelocLargePurchases] = useState<
    {
      id: string;
      name: string;
      purchasePrice: number;
      downPaymentPercent?: number;
      loanRate?: number;
      loanTermYears?: number;
      ongoingMonthlyCost?: number;
      saleProceeds?: number;
      purchaseYear: number;
    }[]
  >([]);
  const [showPurchaseForm, setShowPurchaseForm] = useState(false);
  const [purchaseForm, setPurchaseForm] = useState({
    name: "",
    purchasePrice: "",
    purchaseYear: String(new Date().getFullYear() + 1),
    financed: false,
    downPaymentPercent: "20",
    loanRate: "6.5",
    loanTermYears: "30",
    ongoingMonthlyCost: "",
    saleProceeds: "",
  });

  // Contribution profile selectors (default to the live/default profile)
  const [relocCurrentContribProfileId, setRelocCurrentContribProfileId] =
    useState<number | null>(null);
  const [relocTargetContribProfileId, setRelocTargetContribProfileId] =
    useState<number | null>(null);

  // Scenario persistence state
  const [selectedScenarioId, setSelectedScenarioId] = useState<number | null>(
    null,
  );
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [saveScenarioName, setSaveScenarioName] = useState("");

  const scenariosQuery = trpc.settings.relocationScenarios.list.useQuery();
  const utils = trpc.useUtils();
  const saveMutation = trpc.settings.relocationScenarios.save.useMutation({
    onSuccess: () => {
      utils.settings.relocationScenarios.list.invalidate();
    },
  });
  const deleteMutation = trpc.settings.relocationScenarios.delete.useMutation({
    onSuccess: () => {
      utils.settings.relocationScenarios.list.invalidate();
      setSelectedScenarioId(null);
    },
  });

  // Budget profiles for relocation selectors
  const budgetProfilesQuery = trpc.budget.listProfiles.useQuery();
  const relocProfiles = budgetProfilesQuery.data ?? [];
  const relocDefaultProfileId =
    relocProfiles.find((p) => p.isActive)?.id ?? relocProfiles[0]?.id;
  const effectiveCurrentProfileId =
    relocCurrentProfileId ?? relocDefaultProfileId ?? 0;
  const effectiveTargetProfileId =
    relocTargetProfileId ?? relocDefaultProfileId ?? 0;

  // Contribution profiles for relocation selectors
  const contribProfilesQuery = trpc.contributionProfile.list.useQuery();
  const contribProfiles = contribProfilesQuery.data ?? [];
  const defaultContribProfileId =
    contribProfiles.find((p) => p.isDefault)?.id ?? contribProfiles[0]?.id;
  const effectiveCurrentContribProfileId =
    relocCurrentContribProfileId ?? defaultContribProfileId ?? null;
  const effectiveTargetContribProfileId =
    relocTargetContribProfileId ?? defaultContribProfileId ?? null;

  // People for age display
  const { data: retData } = trpc.projection.computeProjection.useQuery({});
  const peopleLookup =
    retData && "people" in retData ? retData.people : undefined;
  const avgBirthYear = useMemo(
    () =>
      peopleLookup && peopleLookup.length > 0
        ? peopleLookup.reduce(
            (s: number, p: { birthYear: number }) => s + p.birthYear,
            0,
          ) / peopleLookup.length
        : null,
    [peopleLookup],
  );
  const displayAge = useCallback(
    (year: number) =>
      avgBirthYear !== null ? Math.round(year - avgBirthYear) : null,
    [avgBirthYear],
  );
  const ageTooltip = useCallback(
    (year: number) =>
      peopleLookup && peopleLookup.length > 1
        ? peopleLookup
            .map(
              (p: { name: string; birthYear: number }) =>
                `${p.name}: ${year - p.birthYear}`,
            )
            .join(",")
        : undefined,
    [peopleLookup],
  );

  const buildScenarioParams = useCallback(
    (): RelocationScenarioParams => ({
      currentProfileId: effectiveCurrentProfileId,
      currentBudgetColumn: relocCurrentCol,
      currentExpenseOverride: relocCurrentOverride
        ? parseFloat(relocCurrentOverride)
        : null,
      relocationProfileId: effectiveTargetProfileId,
      relocationBudgetColumn: relocTargetCol,
      relocationExpenseOverride: relocTargetOverride
        ? parseFloat(relocTargetOverride)
        : null,
      yearAdjustments: relocYearAdjustments,
      largePurchases: relocLargePurchases,
      currentContributionProfileId: effectiveCurrentContribProfileId,
      relocationContributionProfileId: effectiveTargetContribProfileId,
    }),
    [
      effectiveCurrentProfileId,
      relocCurrentCol,
      relocCurrentOverride,
      effectiveTargetProfileId,
      relocTargetCol,
      relocTargetOverride,
      relocYearAdjustments,
      relocLargePurchases,
      effectiveCurrentContribProfileId,
      effectiveTargetContribProfileId,
    ],
  );

  const loadScenario = useCallback((params: RelocationScenarioParams) => {
    setRelocCurrentProfileId(params.currentProfileId);
    setRelocCurrentCol(params.currentBudgetColumn);
    setRelocCurrentOverride(
      params.currentExpenseOverride != null
        ? String(params.currentExpenseOverride)
        : "",
    );
    setRelocTargetProfileId(params.relocationProfileId);
    setRelocTargetCol(params.relocationBudgetColumn);
    setRelocTargetOverride(
      params.relocationExpenseOverride != null
        ? String(params.relocationExpenseOverride)
        : "",
    );
    setRelocYearAdjustments(
      (params.yearAdjustments ?? []).map((a) => ({
        ...a,
        id: crypto.randomUUID(),
      })),
    );
    setRelocLargePurchases(
      (params.largePurchases ?? []).map((p) => ({
        ...p,
        id: crypto.randomUUID(),
      })),
    );
    setRelocCurrentContribProfileId(params.currentContributionProfileId);
    setRelocTargetContribProfileId(params.relocationContributionProfileId);
  }, []);

  const relocInput = useMemo(
    () => ({
      currentProfileId: effectiveCurrentProfileId,
      currentBudgetColumn: relocCurrentCol,
      currentExpenseOverride: relocCurrentOverride
        ? parseFloat(relocCurrentOverride)
        : null,
      relocationProfileId: effectiveTargetProfileId,
      relocationBudgetColumn: relocTargetCol,
      relocationExpenseOverride: relocTargetOverride
        ? parseFloat(relocTargetOverride)
        : null,
      yearAdjustments: relocYearAdjustments,
      contributionOverrides: [] as never[],
      largePurchases: relocLargePurchases,
      currentContributionProfileId: effectiveCurrentContribProfileId,
      relocationContributionProfileId: effectiveTargetContribProfileId,
    }),
    [
      effectiveCurrentProfileId,
      relocCurrentCol,
      relocCurrentOverride,
      effectiveTargetProfileId,
      relocTargetCol,
      relocTargetOverride,
      relocYearAdjustments,
      relocLargePurchases,
      effectiveCurrentContribProfileId,
      effectiveTargetContribProfileId,
    ],
  );
  const debouncedRelocInput = useDebouncedValue(relocInput, 600);
  const relocQuery = trpc.retirement.computeRelocationAnalysis.useQuery(
    debouncedRelocInput,
    {
      enabled: effectiveCurrentProfileId > 0 && effectiveTargetProfileId > 0,
      placeholderData: (prev) => prev,
    },
  );

  return (
    <div>
      <PageHeader
        title="Tools"
        subtitle="Financial analysis and decision-making tools."
      />

      {/* Relocation Decision Tool */}
      <Card
        title={
          <>
            Relocation Analysis
            <HelpTip text="Compare how moving to a new area would affect your expenses, savings rate, and path to financial independence" />
          </>
        }
        className="mb-6"
      >
        {/* Scenario save/load controls */}
        <div className="flex items-center gap-2 mb-4 text-sm">
          <select
            className="border rounded px-2 py-1 text-sm min-w-[180px]"
            value={selectedScenarioId ?? ""}
            onChange={(e) => {
              const id = e.target.value ? Number(e.target.value) : null;
              setSelectedScenarioId(id);
              if (id) {
                const scenario = scenariosQuery.data?.find((s) => s.id === id);
                if (scenario) loadScenario(scenario.params);
              }
            }}
          >
            <option value="">Unsaved</option>
            {(scenariosQuery.data ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <Button
            size="sm"
            disabled={saveMutation.isPending}
            onClick={() => {
              if (selectedScenarioId) {
                const existing = scenariosQuery.data?.find(
                  (s) => s.id === selectedScenarioId,
                );
                saveMutation.mutate({
                  id: selectedScenarioId,
                  name: existing?.name ?? "Scenario",
                  params: buildScenarioParams(),
                });
              } else {
                setSaveScenarioName("");
                setShowSaveDialog(true);
              }
            }}
          >
            {selectedScenarioId ? "Update" : "Save"}
          </Button>
          {selectedScenarioId && (
            <>
              <button
                className="px-3 py-1 bg-surface-strong text-secondary rounded text-sm hover:bg-surface-strong"
                onClick={() => {
                  setSaveScenarioName("");
                  setShowSaveDialog(true);
                }}
              >
                Save As
              </button>
              <button
                className="px-3 py-1 bg-red-100 text-red-700 rounded text-sm hover:bg-red-200 disabled:opacity-50"
                disabled={deleteMutation.isPending}
                onClick={() => {
                  if (confirm("Delete this saved scenario?")) {
                    deleteMutation.mutate({ id: selectedScenarioId });
                  }
                }}
              >
                Delete
              </button>
            </>
          )}
        </div>
        {/* Save dialog */}
        {showSaveDialog && (
          <div className="mb-4 flex items-center gap-2 p-3 border rounded bg-surface-sunken text-sm">
            <label className="text-muted">Name:</label>
            <input
              type="text"
              className="border rounded px-2 py-1 text-sm flex-1"
              placeholder="Scenario name"
              value={saveScenarioName}
              onChange={(e) => setSaveScenarioName(e.target.value)}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter" && saveScenarioName.trim()) {
                  saveMutation.mutate(
                    {
                      name: saveScenarioName.trim(),
                      params: buildScenarioParams(),
                    },
                    {
                      onSuccess: (result) => {
                        setShowSaveDialog(false);
                        if (result) setSelectedScenarioId(result.id);
                      },
                    },
                  );
                }
                if (e.key === "Escape") setShowSaveDialog(false);
              }}
            />
            <Button
              size="sm"
              disabled={!saveScenarioName.trim() || saveMutation.isPending}
              onClick={() => {
                saveMutation.mutate(
                  {
                    name: saveScenarioName.trim(),
                    params: buildScenarioParams(),
                  },
                  {
                    onSuccess: (result) => {
                      setShowSaveDialog(false);
                      if (result) setSelectedScenarioId(result.id);
                    },
                  },
                );
              }}
            >
              {saveMutation.isPending ? "Saving..." : "Save"}
            </Button>
            <button
              className="px-2 py-1 text-muted hover:text-secondary text-sm"
              onClick={() => setShowSaveDialog(false)}
            >
              Cancel
            </button>
          </div>
        )}
        {relocQuery.data?.budgetInfo ? (
          (() => {
            const bi = relocQuery.data.budgetInfo;
            const r = relocQuery.data.result;
            if (!r)
              return (
                <p className="text-sm text-muted">
                  No retirement settings found.
                </p>
              );

            return (
              <div className="space-y-4">
                {/* Profile + Column selectors */}
                {(() => {
                  const currentProf = bi.profiles.find(
                    (p) => p.id === effectiveCurrentProfileId,
                  );
                  const targetProf = bi.profiles.find(
                    (p) => p.id === effectiveTargetProfileId,
                  );
                  const currentMonths =
                    (currentProf?.columnMonths as number[] | null) ?? null;
                  const targetMonths =
                    (targetProf?.columnMonths as number[] | null) ?? null;
                  const currentWeighted =
                    (currentProf?.weightedAnnualTotal as number | null) ?? null;
                  const targetWeighted =
                    (targetProf?.weightedAnnualTotal as number | null) ?? null;

                  return (
                    <div className="grid grid-cols-[1fr_auto_1fr] gap-4 items-start text-sm">
                      {/* Current Budget */}
                      <div>
                        <label className="block text-muted mb-1">
                          Current Budget
                          <HelpTip text="Budget profile used for your current living expenses. When a profile has month assignments, the weighted average is used automatically." />
                        </label>
                        <div className="flex flex-col gap-1">
                          <select
                            className="border rounded px-2 py-1 text-sm"
                            value={effectiveCurrentProfileId}
                            onChange={(e) => {
                              setRelocCurrentProfileId(Number(e.target.value));
                              setRelocCurrentCol(0);
                            }}
                          >
                            {bi.profiles.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name}
                              </option>
                            ))}
                          </select>
                          {currentMonths ? (
                            <span className="text-xs text-amber-700 bg-amber-50 rounded px-2 py-1">
                              Weighted:{" "}
                              {formatCurrency((currentWeighted ?? 0) / 12)}/mo
                              <span className="text-[10px] text-faint ml-1">
                                (
                                {currentMonths
                                  .map(
                                    (m, i) =>
                                      `${m}mo ${(currentProf?.columnLabels ?? [])[i] ?? ""}`,
                                  )
                                  .join(" +")}
                                )
                              </span>
                            </span>
                          ) : (currentProf?.columnLabels ?? []).length >= 2 ? (
                            <select
                              className="border rounded px-2 py-1 text-sm"
                              value={relocCurrentCol}
                              onChange={(e) =>
                                setRelocCurrentCol(Number(e.target.value))
                              }
                            >
                              {(currentProf?.columnLabels ?? []).map(
                                (label: string, i: number) => (
                                  <option key={label} value={i}>
                                    {label} (
                                    {formatCurrency(
                                      (currentProf?.columnTotals ?? [])[i] ?? 0,
                                    )}
                                    /mo)
                                  </option>
                                ),
                              )}
                            </select>
                          ) : null}
                          {/* Override */}
                          <div className="flex items-center gap-1">
                            <span className="text-[10px] text-faint">
                              Override:
                            </span>
                            <input
                              type="number"
                              className="border rounded px-2 py-0.5 text-xs w-24"
                              placeholder="$/mo"
                              value={relocCurrentOverride}
                              onChange={(e) =>
                                setRelocCurrentOverride(e.target.value)
                              }
                            />
                            {relocCurrentOverride && (
                              <button
                                className="text-[10px] text-red-400 hover:text-red-600"
                                onClick={() => setRelocCurrentOverride("")}
                              >
                                clear
                              </button>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="text-faint self-center pt-6">→</div>

                      {/* Relocation Budget */}
                      <div>
                        <label className="block text-muted mb-1">
                          Relocation Budget
                          <HelpTip text="Budget profile for projected expenses after relocating. Use the override to enter a custom monthly amount." />
                        </label>
                        <div className="flex flex-col gap-1">
                          <select
                            className="border rounded px-2 py-1 text-sm"
                            value={effectiveTargetProfileId}
                            onChange={(e) => {
                              setRelocTargetProfileId(Number(e.target.value));
                              setRelocTargetCol(0);
                            }}
                          >
                            {bi.profiles.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name}
                              </option>
                            ))}
                          </select>
                          {targetMonths ? (
                            <span className="text-xs text-amber-700 bg-amber-50 rounded px-2 py-1">
                              Weighted:{" "}
                              {formatCurrency((targetWeighted ?? 0) / 12)}/mo
                              <span className="text-[10px] text-faint ml-1">
                                (
                                {targetMonths
                                  .map(
                                    (m, i) =>
                                      `${m}mo ${(targetProf?.columnLabels ?? [])[i] ?? ""}`,
                                  )
                                  .join(" +")}
                                )
                              </span>
                            </span>
                          ) : (targetProf?.columnLabels ?? []).length >= 2 ? (
                            <select
                              className="border rounded px-2 py-1 text-sm"
                              value={relocTargetCol}
                              onChange={(e) =>
                                setRelocTargetCol(Number(e.target.value))
                              }
                            >
                              {(targetProf?.columnLabels ?? []).map(
                                (label: string, i: number) => (
                                  <option key={label} value={i}>
                                    {label} (
                                    {formatCurrency(
                                      (targetProf?.columnTotals ?? [])[i] ?? 0,
                                    )}
                                    /mo)
                                  </option>
                                ),
                              )}
                            </select>
                          ) : null}
                          {/* Override */}
                          <div className="flex items-center gap-1">
                            <span className="text-[10px] text-faint">
                              Override:
                            </span>
                            <input
                              type="number"
                              className="border rounded px-2 py-0.5 text-xs w-24"
                              placeholder="$/mo"
                              value={relocTargetOverride}
                              onChange={(e) =>
                                setRelocTargetOverride(e.target.value)
                              }
                            />
                            {relocTargetOverride && (
                              <button
                                className="text-[10px] text-red-400 hover:text-red-600"
                                onClick={() => setRelocTargetOverride("")}
                              >
                                clear
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })()}

                {/* Contribution profile selectors */}
                {contribProfiles.length > 0 && (
                  <div className="grid grid-cols-[1fr_auto_1fr] gap-4 items-start text-sm">
                    <div>
                      <label className="block text-muted mb-1">
                        Current Contributions
                        <HelpTip text="Salary and contribution profile for your current scenario. Managed on the Budget page." />
                      </label>
                      <select
                        className="border rounded px-2 py-1 text-sm w-full"
                        value={effectiveCurrentContribProfileId ?? ""}
                        onChange={(e) =>
                          setRelocCurrentContribProfileId(
                            Number(e.target.value),
                          )
                        }
                      >
                        {contribProfiles.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                      {relocQuery.data?.currentContribProfile && (
                        <div className="mt-1 text-[10px] text-faint flex gap-3">
                          <span>
                            Salary:{" "}
                            {formatCurrency(
                              relocQuery.data.currentContribProfile
                                .combinedSalary,
                            )}
                          </span>
                          <span>
                            Contrib:{" "}
                            {formatCurrency(
                              relocQuery.data.currentContribProfile
                                .annualContributions,
                            )}
                            /yr
                          </span>
                          <span>
                            Match:{" "}
                            {formatCurrency(
                              relocQuery.data.currentContribProfile
                                .employerMatch,
                            )}
                            /yr
                          </span>
                        </div>
                      )}
                    </div>
                    <div className="text-faint self-center pt-6">→</div>
                    <div>
                      <label className="block text-muted mb-1">
                        Relocation Contributions
                        <HelpTip text="Salary and contribution profile for the relocation scenario. Create profiles on the Budget page." />
                      </label>
                      <select
                        className="border rounded px-2 py-1 text-sm w-full"
                        value={effectiveTargetContribProfileId ?? ""}
                        onChange={(e) =>
                          setRelocTargetContribProfileId(Number(e.target.value))
                        }
                      >
                        {contribProfiles.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                      {relocQuery.data?.relocationContribProfile && (
                        <div className="mt-1 text-[10px] text-faint flex gap-3">
                          <span>
                            Salary:{" "}
                            {formatCurrency(
                              relocQuery.data.relocationContribProfile
                                .combinedSalary,
                            )}
                          </span>
                          <span>
                            Contrib:{" "}
                            {formatCurrency(
                              relocQuery.data.relocationContribProfile
                                .annualContributions,
                            )}
                            /yr
                          </span>
                          <span>
                            Match:{" "}
                            {formatCurrency(
                              relocQuery.data.relocationContribProfile
                                .employerMatch,
                            )}
                            /yr
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Key metrics */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="bg-surface-sunken rounded-lg p-3">
                    <div className="text-xs text-muted uppercase">
                      Monthly Delta
                      <HelpTip text="How much more (or less) you'd spend each month after relocating" />
                    </div>
                    <div
                      className={`text-lg font-bold ${r.monthlyExpenseDelta > 0 ? "text-red-600" : r.monthlyExpenseDelta < 0 ? "text-green-600" : ""}`}
                    >
                      {r.monthlyExpenseDelta > 0 ? "+" : ""}
                      {formatCurrency(r.monthlyExpenseDelta)}
                    </div>
                    <div className="text-xs text-faint">
                      {r.percentExpenseIncrease > 0 ? "+" : ""}
                      {r.percentExpenseIncrease}%{" "}
                      {r.percentExpenseIncrease > 0
                        ? "increase"
                        : r.percentExpenseIncrease < 0
                          ? "decrease"
                          : ""}
                    </div>
                  </div>

                  <div className="bg-surface-sunken rounded-lg p-3">
                    <div className="text-xs text-muted uppercase">
                      Additional Nest Egg Needed
                      <HelpTip text="Extra savings required to maintain the same retirement readiness with higher expenses" />
                    </div>
                    <div
                      className={`text-lg font-bold ${r.additionalNestEggNeeded > 0 ? "text-red-600" : "text-green-600"}`}
                    >
                      {r.additionalNestEggNeeded > 0 ? "+" : ""}
                      {formatCurrency(r.additionalNestEggNeeded)}
                    </div>
                    <div className="text-xs text-faint">
                      FI: {formatCurrency(r.currentFiTarget)} →{" "}
                      {formatCurrency(r.relocationFiTarget)}
                    </div>
                  </div>

                  <div className="bg-surface-sunken rounded-lg p-3">
                    <div className="text-xs text-muted uppercase">
                      Savings Rate Impact
                      <HelpTip text="How much your monthly savings rate would change after relocating" />
                    </div>
                    <div
                      className={`text-lg font-bold ${r.savingsRateDrop > 0 ? "text-red-600" : "text-green-600"}`}
                    >
                      {r.savingsRateDrop > 0 ? "−" : "+"}
                      {formatPercent(Math.abs(r.savingsRateDrop))}
                    </div>
                    <div className="text-xs text-faint">
                      {formatPercent(r.currentSavingsRate)} →{" "}
                      {formatPercent(r.relocationSavingsRate)}
                    </div>
                  </div>

                  <div className="bg-surface-sunken rounded-lg p-3">
                    <div className="text-xs text-muted uppercase">
                      FI Age Impact
                      <HelpTip text="How many years earlier or later you'd reach financial independence" />
                    </div>
                    <div
                      className={`text-lg font-bold ${r.fiAgeDelay !== null && r.fiAgeDelay > 0 ? "text-red-600" : "text-green-600"}`}
                    >
                      {r.fiAgeDelay !== null
                        ? `${r.fiAgeDelay > 0 ? "+" : ""}${r.fiAgeDelay} yr${Math.abs(r.fiAgeDelay) !== 1 ? "s" : ""}`
                        : "—"}
                    </div>
                    <div className="text-xs text-faint">
                      {r.currentFiAge !== null
                        ? `Age ${r.currentFiAge}`
                        : "N/A"}{" "}
                      →{" "}
                      {r.relocationFiAge !== null
                        ? `Age ${r.relocationFiAge}`
                        : "N/A"}
                    </div>
                  </div>
                </div>

                {/* Recommendation banner */}
                {r.earliestRelocateAge !== null ? (
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm">
                    <span className="font-semibold text-blue-800">
                      Recommendation:
                    </span>{" "}
                    <span className="text-blue-700">
                      Target a portfolio of at least{" "}
                      <strong>
                        {formatCurrency(r.recommendedPortfolioToRelocate)}
                      </strong>{" "}
                      before relocating.
                      {r.earliestRelocateAge <= (r.currentFiAge ?? 999)
                        ? ` You can relocate as early as age ${r.earliestRelocateAge} and still reach FI by retirement.`
                        : ` Earliest safe relocation age: ${r.earliestRelocateAge}.`}
                    </span>
                  </div>
                ) : (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm">
                    <span className="font-semibold text-amber-800">
                      Warning:
                    </span>{" "}
                    <span className="text-amber-700">
                      With the relocation budget, your portfolio may not reach
                      the FI target ({formatCurrency(r.relocationFiTarget)}) by
                      retirement. Consider reducing expenses, increasing income,
                      or extending the timeline.
                    </span>
                  </div>
                )}

                {/* Warnings from calculator */}
                {r.warnings.length > 0 && (
                  <div className="space-y-1">
                    {r.warnings.map((w) => (
                      <div
                        key={w}
                        className="text-xs text-amber-600 bg-amber-50 rounded p-2"
                      >
                        {w}
                      </div>
                    ))}
                  </div>
                )}

                {/* Large purchase summary KPIs (only when purchases exist) */}
                {relocLargePurchases.length > 0 && (
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    <div className="bg-orange-50 rounded-lg p-3">
                      <div className="text-xs text-muted uppercase">
                        Portfolio Hit from Purchases
                        <HelpTip text="Total one-time cash withdrawn from portfolio for down payments, minus any sale proceeds" />
                      </div>
                      <div className="text-lg font-bold text-orange-700">
                        {r.totalLargePurchasePortfolioHit > 0 ? "−" : "+"}
                        {formatCurrency(
                          Math.abs(r.totalLargePurchasePortfolioHit),
                        )}
                      </div>
                    </div>
                    <div className="bg-orange-50 rounded-lg p-3">
                      <div className="text-xs text-muted uppercase">
                        Monthly Cost from Purchases
                        <HelpTip text="Steady-state monthly loan payments + ongoing costs from all purchases" />
                      </div>
                      <div className="text-lg font-bold text-orange-700">
                        +{formatCurrency(r.steadyStateMonthlyFromPurchases)}/mo
                      </div>
                    </div>
                    <div className="bg-orange-50 rounded-lg p-3">
                      <div className="text-xs text-muted uppercase">
                        Annual from Purchases
                        <HelpTip text="Total annualized cost from loan payments + ongoing costs, added to relocation expenses" />
                      </div>
                      <div className="text-lg font-bold text-orange-700">
                        +
                        {formatCurrency(r.steadyStateMonthlyFromPurchases * 12)}
                        /yr
                      </div>
                      <div className="text-xs text-faint">
                        added to relocation expenses
                      </div>
                    </div>
                  </div>
                )}

                {/* Large purchases */}
                <div className="border-t pt-3">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-sm font-medium text-secondary">
                      Large Purchases
                      <HelpTip text="One-time purchases tied to the relocation — home, car, furniture, etc. Cash portion is withdrawn from portfolio; financed portions add monthly payments to expenses." />
                    </h4>
                    <button
                      className="text-xs text-blue-600 hover:underline"
                      onClick={() => setShowPurchaseForm(!showPurchaseForm)}
                    >
                      {showPurchaseForm ? "Cancel" : "+ Add Purchase"}
                    </button>
                  </div>

                  {relocLargePurchases.length > 0 && (
                    <div className="flex flex-wrap gap-2 mb-2">
                      {relocLargePurchases.map((p) => {
                        const isFinanced =
                          p.downPaymentPercent !== undefined &&
                          p.downPaymentPercent < 1;
                        return (
                          <div
                            key={p.id}
                            className="flex items-center gap-1 bg-orange-50 text-orange-700 rounded px-2 py-1 text-xs"
                          >
                            <span className="font-medium">{p.name}</span>
                            <span>
                              {formatCurrency(p.purchasePrice)} in{" "}
                              {p.purchaseYear}
                            </span>
                            {isFinanced && (
                              <span className="text-orange-400">
                                ({formatPercent(p.downPaymentPercent ?? 0)}{" "}
                                down, {p.loanTermYears}yr @
                                {formatPercent(p.loanRate ?? 0, 1)})
                              </span>
                            )}
                            {(p.ongoingMonthlyCost ?? 0) > 0 && (
                              <span className="text-orange-400">
                                +{formatCurrency(p.ongoingMonthlyCost!)}/mo
                              </span>
                            )}
                            {(p.saleProceeds ?? 0) > 0 && (
                              <span className="text-green-600">
                                +{formatCurrency(p.saleProceeds!)} proceeds
                              </span>
                            )}
                            <button
                              className="ml-1 text-orange-400 hover:text-red-600"
                              onClick={() =>
                                setRelocLargePurchases((prev) =>
                                  prev.filter((x) => x.id !== p.id),
                                )
                              }
                            >
                              ×
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {showPurchaseForm && (
                    <div className="bg-surface-sunken rounded-lg p-3 mb-2 space-y-2">
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        <div>
                          <label className="block text-xs text-muted">
                            Name
                          </label>
                          <input
                            type="text"
                            className="border rounded px-2 py-1 w-full text-sm"
                            placeholder="e.g. New Home"
                            value={purchaseForm.name}
                            onChange={(e) =>
                              setPurchaseForm((f) => ({
                                ...f,
                                name: e.target.value,
                              }))
                            }
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-muted">
                            Purchase Price ($)
                          </label>
                          <input
                            type="number"
                            className="border rounded px-2 py-1 w-full text-sm"
                            placeholder="e.g. 500000"
                            value={purchaseForm.purchasePrice}
                            onChange={(e) =>
                              setPurchaseForm((f) => ({
                                ...f,
                                purchasePrice: e.target.value,
                              }))
                            }
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-muted">
                            Purchase Year
                          </label>
                          <input
                            type="number"
                            className="border rounded px-2 py-1 w-full text-sm"
                            value={purchaseForm.purchaseYear}
                            onChange={(e) =>
                              setPurchaseForm((f) => ({
                                ...f,
                                purchaseYear: e.target.value,
                              }))
                            }
                          />
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <label className="flex items-center gap-1 text-xs text-muted cursor-pointer">
                          <input
                            type="checkbox"
                            checked={purchaseForm.financed}
                            onChange={(e) =>
                              setPurchaseForm((f) => ({
                                ...f,
                                financed: e.target.checked,
                              }))
                            }
                          />
                          Financed
                        </label>
                      </div>

                      {purchaseForm.financed && (
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                          <div>
                            <label className="block text-xs text-muted">
                              Down Payment %
                            </label>
                            <input
                              type="number"
                              className="border rounded px-2 py-1 w-full text-sm"
                              value={purchaseForm.downPaymentPercent}
                              onChange={(e) =>
                                setPurchaseForm((f) => ({
                                  ...f,
                                  downPaymentPercent: e.target.value,
                                }))
                              }
                            />
                          </div>
                          <div>
                            <label className="block text-xs text-muted">
                              Loan Rate %
                            </label>
                            <input
                              type="number"
                              step="0.1"
                              className="border rounded px-2 py-1 w-full text-sm"
                              value={purchaseForm.loanRate}
                              onChange={(e) =>
                                setPurchaseForm((f) => ({
                                  ...f,
                                  loanRate: e.target.value,
                                }))
                              }
                            />
                          </div>
                          <div>
                            <label className="block text-xs text-muted">
                              Loan Term (years)
                            </label>
                            <input
                              type="number"
                              className="border rounded px-2 py-1 w-full text-sm"
                              value={purchaseForm.loanTermYears}
                              onChange={(e) =>
                                setPurchaseForm((f) => ({
                                  ...f,
                                  loanTermYears: e.target.value,
                                }))
                              }
                            />
                          </div>
                        </div>
                      )}

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <div>
                          <label className="block text-xs text-muted">
                            Ongoing Monthly Cost ($)
                            <HelpTip text="Property tax, HOA, insurance, maintenance — any recurring monthly cost from this purchase" />
                          </label>
                          <input
                            type="number"
                            className="border rounded px-2 py-1 w-full text-sm"
                            placeholder="0"
                            value={purchaseForm.ongoingMonthlyCost}
                            onChange={(e) =>
                              setPurchaseForm((f) => ({
                                ...f,
                                ongoingMonthlyCost: e.target.value,
                              }))
                            }
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-muted">
                            Sale Proceeds ($)
                            <HelpTip text="Net proceeds from selling an existing asset (e.g. current home equity minus closing costs). Offsets the cash outlay." />
                          </label>
                          <input
                            type="number"
                            className="border rounded px-2 py-1 w-full text-sm"
                            placeholder="0"
                            value={purchaseForm.saleProceeds}
                            onChange={(e) =>
                              setPurchaseForm((f) => ({
                                ...f,
                                saleProceeds: e.target.value,
                              }))
                            }
                          />
                        </div>
                      </div>

                      <Button
                        size="xs"
                        onClick={() => {
                          const price = parseFloat(purchaseForm.purchasePrice);
                          const year = parseInt(purchaseForm.purchaseYear);
                          if (
                            !purchaseForm.name ||
                            isNaN(price) ||
                            price <= 0 ||
                            isNaN(year)
                          )
                            return;

                          const purchase: (typeof relocLargePurchases)[number] =
                            {
                              id: crypto.randomUUID(),
                              name: purchaseForm.name,
                              purchasePrice: price,
                              purchaseYear: year,
                            };

                          if (purchaseForm.financed) {
                            purchase.downPaymentPercent =
                              (parseFloat(purchaseForm.downPaymentPercent) ||
                                20) / 100;
                            purchase.loanRate =
                              (parseFloat(purchaseForm.loanRate) || 6.5) / 100;
                            purchase.loanTermYears =
                              parseInt(purchaseForm.loanTermYears) || 30;
                          }

                          const ongoing = parseFloat(
                            purchaseForm.ongoingMonthlyCost,
                          );
                          if (!isNaN(ongoing) && ongoing > 0)
                            purchase.ongoingMonthlyCost = ongoing;

                          const proceeds = parseFloat(
                            purchaseForm.saleProceeds,
                          );
                          if (!isNaN(proceeds) && proceeds > 0)
                            purchase.saleProceeds = proceeds;

                          setRelocLargePurchases((prev) =>
                            [...prev, purchase].sort(
                              (a, b) => a.purchaseYear - b.purchaseYear,
                            ),
                          );
                          setPurchaseForm({
                            name: "",
                            purchasePrice: "",
                            purchaseYear: String(year),
                            financed: false,
                            downPaymentPercent: "20",
                            loanRate: "6.5",
                            loanTermYears: "30",
                            ongoingMonthlyCost: "",
                            saleProceeds: "",
                          });
                          setShowPurchaseForm(false);
                        }}
                      >
                        Add Purchase
                      </Button>
                    </div>
                  )}
                </div>

                {/* Year adjustments */}
                <div className="border-t pt-3">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-sm font-medium text-secondary">
                      Year-by-Year Expense Adjustments
                    </h4>
                    <button
                      className="text-xs text-blue-600 hover:underline"
                      onClick={() => setShowRelocAdjForm(!showRelocAdjForm)}
                    >
                      {showRelocAdjForm ? "Cancel" : "+ Add Adjustment"}
                    </button>
                  </div>

                  {relocYearAdjustments.length > 0 && (
                    <div className="flex flex-wrap gap-2 mb-2">
                      {relocYearAdjustments.map((adj) => {
                        const adjProf = adj.profileId
                          ? bi.profiles.find(
                              (p: { id: number }) => p.id === adj.profileId,
                            )
                          : null;
                        const adjLabel = adjProf
                          ? `${adjProf.name}${(adjProf.columnLabels as string[]).length > 1 ? ` / ${(adjProf.columnLabels as string[])[adj.budgetColumn ?? 0] ?? ""}` : ""}`
                          : `${formatCurrency(adj.monthlyExpenses)}/mo`;
                        return (
                          <div
                            key={adj.id}
                            className="flex items-center gap-1 bg-blue-50 text-blue-700 rounded px-2 py-1 text-xs"
                          >
                            <span>
                              {adj.year}: {adjLabel}
                            </span>
                            {adj.notes && (
                              <span className="text-blue-400">
                                ({adj.notes})
                              </span>
                            )}
                            <button
                              className="ml-1 text-blue-400 hover:text-red-600"
                              onClick={() =>
                                setRelocYearAdjustments((prev) =>
                                  prev.filter((a) => a.id !== adj.id),
                                )
                              }
                            >
                              ×
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {showRelocAdjForm && (
                    <div className="space-y-2 mb-2 text-sm">
                      <div className="flex gap-2 items-end">
                        <div>
                          <label className="block text-xs text-muted">
                            Year
                          </label>
                          <input
                            type="number"
                            className="border rounded px-2 py-1 w-20 text-sm"
                            value={relocAdjForm.year}
                            onChange={(e) =>
                              setRelocAdjForm((f) => ({
                                ...f,
                                year: e.target.value,
                              }))
                            }
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-muted">
                            Source
                          </label>
                          <select
                            className="border rounded px-2 py-1 text-sm"
                            value={relocAdjMode}
                            onChange={(e) =>
                              setRelocAdjMode(
                                e.target.value as "manual" | "profile",
                              )
                            }
                          >
                            <option value="manual">Manual</option>
                            <option value="profile">Budget Profile</option>
                          </select>
                        </div>
                        {relocAdjMode === "manual" ? (
                          <div>
                            <label className="block text-xs text-muted">
                              Monthly Expenses
                            </label>
                            <input
                              type="number"
                              className="border rounded px-2 py-1 w-28 text-sm"
                              placeholder="$"
                              value={relocAdjForm.monthlyExpenses}
                              onChange={(e) =>
                                setRelocAdjForm((f) => ({
                                  ...f,
                                  monthlyExpenses: e.target.value,
                                }))
                              }
                            />
                          </div>
                        ) : (
                          <>
                            <div>
                              <label className="block text-xs text-muted">
                                Profile
                              </label>
                              <select
                                className="border rounded px-2 py-1 text-sm"
                                value={relocAdjForm.profileId || ""}
                                onChange={(e) => {
                                  setRelocAdjForm((f) => ({
                                    ...f,
                                    profileId: e.target.value,
                                    budgetColumn: "0",
                                  }));
                                }}
                              >
                                <option value="">Select…</option>
                                {bi.profiles.map(
                                  (p: {
                                    id: number;
                                    name: string;
                                    isActive: boolean;
                                  }) => (
                                    <option key={p.id} value={p.id}>
                                      {p.name}
                                    </option>
                                  ),
                                )}
                              </select>
                            </div>
                            {(() => {
                              const selectedProf = bi.profiles.find(
                                (p: { id: number }) =>
                                  p.id === Number(relocAdjForm.profileId),
                              );
                              const labels =
                                (selectedProf?.columnLabels as
                                  | string[]
                                  | undefined) ?? [];
                              const months =
                                (selectedProf?.columnMonths as
                                  | number[]
                                  | null) ?? null;
                              const totals =
                                (selectedProf?.columnTotals as
                                  | number[]
                                  | undefined) ?? [];
                              if (months) {
                                return (
                                  <span className="text-xs text-amber-700 bg-amber-50 rounded px-2 py-1 self-end">
                                    Weighted:{" "}
                                    {formatCurrency(
                                      ((selectedProf?.weightedAnnualTotal as number) ??
                                        0) / 12,
                                    )}
                                    /mo
                                  </span>
                                );
                              }
                              if (labels.length >= 2) {
                                return (
                                  <div>
                                    <label className="block text-xs text-muted">
                                      Column
                                    </label>
                                    <select
                                      className="border rounded px-2 py-1 text-sm"
                                      value={relocAdjForm.budgetColumn}
                                      onChange={(e) =>
                                        setRelocAdjForm((f) => ({
                                          ...f,
                                          budgetColumn: e.target.value,
                                        }))
                                      }
                                    >
                                      {labels.map(
                                        (label: string, idx: number) => (
                                          <option key={label} value={idx}>
                                            {label} (
                                            {formatCurrency(totals[idx] ?? 0)}
                                            /mo)
                                          </option>
                                        ),
                                      )}
                                    </select>
                                  </div>
                                );
                              }
                              return null;
                            })()}
                          </>
                        )}
                        <div>
                          <label className="block text-xs text-muted">
                            Notes
                          </label>
                          <input
                            type="text"
                            className="border rounded px-2 py-1 w-32 text-sm"
                            placeholder="e.g. Cut dining"
                            value={relocAdjForm.notes}
                            onChange={(e) =>
                              setRelocAdjForm((f) => ({
                                ...f,
                                notes: e.target.value,
                              }))
                            }
                          />
                        </div>
                        <Button
                          size="xs"
                          onClick={() => {
                            const year = parseInt(relocAdjForm.year);
                            if (isNaN(year)) return;
                            if (relocAdjMode === "profile") {
                              const profId = Number(relocAdjForm.profileId);
                              if (!profId) return;
                              const col = Number(relocAdjForm.budgetColumn);
                              setRelocYearAdjustments((prev) => {
                                const filtered = prev.filter(
                                  (a) => a.year !== year,
                                );
                                return [
                                  ...filtered,
                                  {
                                    id: crypto.randomUUID(),
                                    year,
                                    monthlyExpenses: 0,
                                    profileId: profId,
                                    budgetColumn: col,
                                    notes: relocAdjForm.notes || undefined,
                                  },
                                ].sort((a, b) => a.year - b.year);
                              });
                            } else {
                              const monthly = parseFloat(
                                relocAdjForm.monthlyExpenses,
                              );
                              if (isNaN(monthly) || monthly < 0) return;
                              setRelocYearAdjustments((prev) => {
                                const filtered = prev.filter(
                                  (a) => a.year !== year,
                                );
                                return [
                                  ...filtered,
                                  {
                                    id: crypto.randomUUID(),
                                    year,
                                    monthlyExpenses: monthly,
                                    notes: relocAdjForm.notes || undefined,
                                  },
                                ].sort((a, b) => a.year - b.year);
                              });
                            }
                            setRelocAdjForm({
                              year: String(year + 1),
                              monthlyExpenses: "",
                              profileId: relocAdjForm.profileId,
                              budgetColumn: relocAdjForm.budgetColumn,
                              notes: "",
                            });
                            setShowRelocAdjForm(false);
                          }}
                        >
                          Add
                        </Button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Year-by-year projection table */}
                <div className="border-t pt-3">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-sm font-medium text-secondary">
                      Portfolio Projection Comparison
                    </h4>
                    <Toggle
                      label="All years"
                      checked={showRelocAllYears}
                      onChange={setShowRelocAllYears}
                    />
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b text-muted">
                          <th className="text-left py-1 pr-3">Year</th>
                          <th className="text-left py-1 pr-3">
                            Age
                            {peopleLookup && peopleLookup.length > 1
                              ? " (avg)"
                              : ""}
                          </th>
                          <th className="text-right py-1 pr-3">Contrib</th>
                          <th className="text-right py-1 pr-3">
                            Current Balance
                          </th>
                          <th className="text-right py-1 pr-3">
                            Reloc Contrib
                          </th>
                          <th className="text-right py-1 pr-3">
                            Relocation Balance
                          </th>
                          <th className="text-right py-1 pr-3">Gap</th>
                          <th className="text-right py-1">Reloc Expenses</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(() => {
                          const rows = r.projectionByYear;
                          if (rows.length === 0) return null;
                          const milestoneYears = new Set<number>();
                          milestoneYears.add(rows[0]!.year);
                          milestoneYears.add(rows[rows.length - 1]!.year);
                          for (const row of rows) {
                            if (row.age % 5 === 0) milestoneYears.add(row.year);
                          }
                          if (r.currentFiAge !== null) {
                            const fiRow = rows.find(
                              (row) => row.age === r.currentFiAge,
                            );
                            if (fiRow) milestoneYears.add(fiRow.year);
                          }
                          if (r.relocationFiAge !== null) {
                            const fiRow = rows.find(
                              (row) => row.age === r.relocationFiAge,
                            );
                            if (fiRow) milestoneYears.add(fiRow.year);
                          }
                          if (r.earliestRelocateAge !== null) {
                            const eRow = rows.find(
                              (row) => row.age === r.earliestRelocateAge,
                            );
                            if (eRow) milestoneYears.add(eRow.year);
                          }
                          for (const adj of relocYearAdjustments)
                            milestoneYears.add(adj.year);
                          for (const p of relocLargePurchases)
                            milestoneYears.add(p.purchaseYear);

                          const purchaseYears = new Set(
                            relocLargePurchases.map((p) => p.purchaseYear),
                          );

                          const displayRows = showRelocAllYears
                            ? rows
                            : rows.filter((row) =>
                                milestoneYears.has(row.year),
                              );

                          return displayRows.map((row) => (
                            <tr
                              key={row.year}
                              className={`border-b border-subtle ${
                                row.hasAdjustment ? "bg-blue-50" : ""
                              } ${row.age === r.currentFiAge ? "bg-green-50" : ""} ${
                                row.age === r.relocationFiAge
                                  ? "bg-purple-50"
                                  : ""
                              } ${row.age === r.earliestRelocateAge ? "bg-cyan-50" : ""} ${
                                purchaseYears.has(row.year)
                                  ? "bg-orange-50"
                                  : ""
                              }`}
                            >
                              <td className="py-1 pr-3">{row.year}</td>
                              <td
                                className="py-1 pr-3"
                                title={ageTooltip(row.year)}
                              >
                                {displayAge(row.year) ?? row.age}
                                {row.age === r.currentFiAge && (
                                  <span className="ml-1 text-green-600 text-[10px]">
                                    FI
                                  </span>
                                )}
                                {row.age === r.relocationFiAge && (
                                  <span className="ml-1 text-purple-600 text-[10px]">
                                    FI-R
                                  </span>
                                )}
                                {row.age === r.earliestRelocateAge && (
                                  <span className="ml-1 text-cyan-600 text-[10px]">
                                    MOVE
                                  </span>
                                )}
                              </td>
                              <td className="text-right py-1 pr-3 font-mono">
                                {formatCurrency(row.currentContribution)}
                              </td>
                              <td className="text-right py-1 pr-3 font-mono">
                                {formatCurrency(row.currentBalance)}
                              </td>
                              <td className="text-right py-1 pr-3 font-mono">
                                {formatCurrency(row.relocationContribution)}
                              </td>
                              <td className="text-right py-1 pr-3 font-mono">
                                {formatCurrency(row.relocationBalance)}
                              </td>
                              <td
                                className={`text-right py-1 pr-3 font-mono ${row.delta < 0 ? "text-red-600" : "text-green-600"}`}
                              >
                                {row.delta < 0 ? "" : "+"}
                                {formatCurrency(row.delta)}
                              </td>
                              <td className="text-right py-1 font-mono">
                                {formatCurrency(row.relocationExpenses / 12)}/mo
                                {row.hasAdjustment && (
                                  <span className="ml-1 text-blue-500">*</span>
                                )}
                                {row.largePurchaseImpact !== 0 && (
                                  <span
                                    className="ml-1 text-orange-500"
                                    title={`Portfolio: ${row.largePurchaseImpact > 0 ? "+" : ""}${formatCurrency(row.largePurchaseImpact)}`}
                                  >
                                    $
                                  </span>
                                )}
                              </td>
                            </tr>
                          ));
                        })()}
                      </tbody>
                    </table>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-3 text-[10px] text-faint">
                    <span>
                      <span className="inline-block w-2 h-2 bg-green-200 rounded mr-1" />
                      FI = current FI age
                    </span>
                    <span>
                      <span className="inline-block w-2 h-2 bg-purple-200 rounded mr-1" />
                      FI-R = relocation FI age
                    </span>
                    <span>
                      <span className="inline-block w-2 h-2 bg-cyan-200 rounded mr-1" />
                      MOVE = earliest safe relocation
                    </span>
                    <span>
                      <span className="inline-block w-2 h-2 bg-blue-200 rounded mr-1" />
                      * = expense adjustment
                    </span>
                    <span>
                      <span className="inline-block w-2 h-2 bg-orange-200 rounded mr-1" />
                      $ = large purchase
                    </span>
                  </div>
                </div>
              </div>
            );
          })()
        ) : relocQuery.isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-8 w-1/2" />
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <SkeletonChart height={80} />
              <SkeletonChart height={80} />
              <SkeletonChart height={80} />
              <SkeletonChart height={80} />
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted">
            No active budget profile found. Create a budget profile first.
          </p>
        )}
      </Card>
    </div>
  );
}
