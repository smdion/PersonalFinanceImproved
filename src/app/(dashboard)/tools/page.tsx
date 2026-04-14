"use client";

/** Financial analysis tools page — currently hosts the Relocation decision
 *  calculator. Large UI sub-sections were extracted in the v0.5.2 file-split
 *  refactor; this file now owns tRPC queries/mutations + local state and
 *  orchestrates the section components in `src/components/tools/relocation/`.
 */

import { useState, useMemo, useCallback } from "react";
import { Skeleton, SkeletonChart } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { HelpTip } from "@/components/ui/help-tip";
import type { RelocationScenarioParams } from "@/lib/db/schema";

import { RelocationScenariosControls } from "@/components/tools/relocation/scenarios-controls";
import { RelocationBudgetSelectors } from "@/components/tools/relocation/budget-selectors";
import { RelocationMetricsAndBanner } from "@/components/tools/relocation/metrics-and-banner";
import {
  RelocationLargePurchases,
  type PurchaseFormState,
} from "@/components/tools/relocation/large-purchases";
import {
  RelocationYearAdjustments,
  type RelocAdjFormState,
} from "@/components/tools/relocation/year-adjustments";
import { RelocationProjectionTable } from "@/components/tools/relocation/projection-table";
import type {
  LargePurchaseRow,
  YearAdjustmentRow,
} from "@/components/tools/relocation/types";

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
    YearAdjustmentRow[]
  >([]);
  const [showRelocAllYears, setShowRelocAllYears] = useState(false);
  const [showRelocAdjForm, setShowRelocAdjForm] = useState(false);
  const [relocAdjMode, setRelocAdjMode] = useState<"manual" | "profile">(
    "manual",
  );
  const [relocAdjForm, setRelocAdjForm] = useState<RelocAdjFormState>({
    year: String(new Date().getFullYear() + 2),
    monthlyExpenses: "",
    profileId: "",
    budgetColumn: "0",
    notes: "",
  });

  // Large purchases state
  const [relocLargePurchases, setRelocLargePurchases] = useState<
    LargePurchaseRow[]
  >([]);
  const [showPurchaseForm, setShowPurchaseForm] = useState(false);
  const [purchaseForm, setPurchaseForm] = useState<PurchaseFormState>({
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

  // Save / Save As / Delete handlers wiring mutations.
  // Kept in the parent so the mutation hooks + tRPC cache invalidation stay
  // in one place and child components only see plain callbacks.
  const handleSaveClick = useCallback(() => {
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
  }, [
    selectedScenarioId,
    scenariosQuery.data,
    saveMutation,
    buildScenarioParams,
  ]);

  const handleSaveAsClick = useCallback(() => {
    setSaveScenarioName("");
    setShowSaveDialog(true);
  }, []);

  const handleDeleteClick = useCallback(() => {
    if (!selectedScenarioId) return;
    if (confirm("Delete this saved scenario?")) {
      deleteMutation.mutate({ id: selectedScenarioId });
    }
  }, [selectedScenarioId, deleteMutation]);

  const handleSaveDialogSubmit = useCallback(() => {
    if (!saveScenarioName.trim()) return;
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
  }, [saveScenarioName, saveMutation, buildScenarioParams]);

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
        <RelocationScenariosControls
          scenarios={scenariosQuery.data ?? []}
          selectedScenarioId={selectedScenarioId}
          setSelectedScenarioId={setSelectedScenarioId}
          loadScenario={loadScenario}
          saveIsPending={saveMutation.isPending}
          deleteIsPending={deleteMutation.isPending}
          onSaveClick={handleSaveClick}
          onSaveAsClick={handleSaveAsClick}
          onDeleteClick={handleDeleteClick}
          showSaveDialog={showSaveDialog}
          setShowSaveDialog={setShowSaveDialog}
          saveScenarioName={saveScenarioName}
          setSaveScenarioName={setSaveScenarioName}
          onSaveDialogSubmit={handleSaveDialogSubmit}
        />
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
                <RelocationBudgetSelectors
                  budgetInfo={bi}
                  effectiveCurrentProfileId={effectiveCurrentProfileId}
                  setRelocCurrentProfileId={setRelocCurrentProfileId}
                  relocCurrentCol={relocCurrentCol}
                  setRelocCurrentCol={setRelocCurrentCol}
                  relocCurrentOverride={relocCurrentOverride}
                  setRelocCurrentOverride={setRelocCurrentOverride}
                  effectiveTargetProfileId={effectiveTargetProfileId}
                  setRelocTargetProfileId={setRelocTargetProfileId}
                  relocTargetCol={relocTargetCol}
                  setRelocTargetCol={setRelocTargetCol}
                  relocTargetOverride={relocTargetOverride}
                  setRelocTargetOverride={setRelocTargetOverride}
                  contribProfiles={contribProfiles}
                  effectiveCurrentContribProfileId={
                    effectiveCurrentContribProfileId
                  }
                  setRelocCurrentContribProfileId={
                    setRelocCurrentContribProfileId
                  }
                  effectiveTargetContribProfileId={
                    effectiveTargetContribProfileId
                  }
                  setRelocTargetContribProfileId={
                    setRelocTargetContribProfileId
                  }
                  currentContribProfile={relocQuery.data.currentContribProfile}
                  relocationContribProfile={
                    relocQuery.data.relocationContribProfile
                  }
                />

                <RelocationMetricsAndBanner result={r} />

                <RelocationLargePurchases
                  result={r}
                  relocLargePurchases={relocLargePurchases}
                  setRelocLargePurchases={setRelocLargePurchases}
                  showPurchaseForm={showPurchaseForm}
                  setShowPurchaseForm={setShowPurchaseForm}
                  purchaseForm={purchaseForm}
                  setPurchaseForm={setPurchaseForm}
                />

                <RelocationYearAdjustments
                  budgetInfo={bi}
                  relocYearAdjustments={relocYearAdjustments}
                  setRelocYearAdjustments={setRelocYearAdjustments}
                  showRelocAdjForm={showRelocAdjForm}
                  setShowRelocAdjForm={setShowRelocAdjForm}
                  relocAdjMode={relocAdjMode}
                  setRelocAdjMode={setRelocAdjMode}
                  relocAdjForm={relocAdjForm}
                  setRelocAdjForm={setRelocAdjForm}
                />

                <RelocationProjectionTable
                  result={r}
                  showRelocAllYears={showRelocAllYears}
                  setShowRelocAllYears={setShowRelocAllYears}
                  relocYearAdjustments={relocYearAdjustments}
                  relocLargePurchases={relocLargePurchases}
                  peopleLookup={peopleLookup}
                  displayAge={displayAge}
                  ageTooltip={ageTooltip}
                />
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
