"use client";

/** Financial tools page (Relocation calculator): owns queries, mutations and
 *  state; sub-sections live in `src/components/tools/relocation/`. */

import { useState, useMemo, useCallback } from "react";
import { Skeleton, SkeletonChart } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { HelpTip } from "@/components/ui/help-tip";
import { useUser, isAdmin } from "@/lib/context/user-context";
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
import {
  DEFAULT_LOAN_DOWN_PAYMENT_PERCENT,
  DEFAULT_LOAN_RATE,
  DEFAULT_LOAN_TERM_YEARS,
} from "@/lib/constants";
import { useBudgetProfilesList } from "@/lib/hooks/use-budget-profiles-list";
import { NotConfiguredNotice } from "@/components/ui/not-configured-notice";
import { useEffectiveSalaryProfileId } from "@/lib/hooks/use-effective-salary-profile-id";

export function ToolsContent() {
  const user = useUser();

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
  const [purchaseForm, setPurchaseForm] = useState<PurchaseFormState>({
    name: "",
    purchasePrice: "",
    purchaseYear: String(new Date().getFullYear() + 1),
    financed: false,
    downPaymentPercent: String(DEFAULT_LOAN_DOWN_PAYMENT_PERCENT),
    loanRate: String(DEFAULT_LOAN_RATE),
    loanTermYears: String(DEFAULT_LOAN_TERM_YEARS),
    ongoingMonthlyCost: "",
    saleProceeds: "",
  });

  // Contribution profile selectors (default to the live/default profile)
  const [
    relocCurrentContributionProfileId,
    setRelocCurrentContributionProfileId,
  ] = useState<number | null>(null);
  const [
    relocTargetContributionProfileId,
    setRelocTargetContributionProfileId,
  ] = useState<number | null>(null);

  // User-controlled move year (null = show comparison table + earliest viable hint)
  const [relocMoveYear, setRelocMoveYear] = useState<number | null>(null);
  const [relocMoveYearInput, setRelocMoveYearInput] = useState<string>("");

  // Scenario persistence state
  const [selectedScenarioId, setSelectedScenarioId] = useState<number | null>(
    null,
  );
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [saveScenarioName, setSaveScenarioName] = useState("");

  const scenariosQuery = trpc.projection.relocationScenarios.list.useQuery();
  const utils = trpc.useUtils();
  const saveMutation = trpc.projection.relocationScenarios.save.useMutation({
    onSuccess: () => {
      utils.projection.relocationScenarios.list.invalidate();
    },
  });
  const deleteMutation = trpc.projection.relocationScenarios.delete.useMutation(
    {
      onSuccess: () => {
        utils.projection.relocationScenarios.list.invalidate();
        setSelectedScenarioId(null);
      },
    },
  );

  // Budget profiles for relocation selectors
  const budgetProfilesQuery = useBudgetProfilesList();
  const relocProfiles = budgetProfilesQuery.data ?? [];
  const relocDefaultProfileId =
    relocProfiles.find((p) => p.isActive)?.id ?? relocProfiles[0]?.id;
  const effectiveCurrentProfileId =
    relocCurrentProfileId ?? relocDefaultProfileId ?? 0;
  const effectiveTargetProfileId =
    relocTargetProfileId ?? relocDefaultProfileId ?? 0;

  // Contribution profiles for relocation selectors
  const contributionProfilesQuery = trpc.contributionProfile.list.useQuery();
  const contributionProfiles = contributionProfilesQuery.data ?? [];
  // No profile is privileged any more — the first (oldest) one is simply the
  // pre-selection when the relocation scenario hasn't picked one yet.
  const defaultContributionProfileId = contributionProfiles[0]?.id;
  const effectiveCurrentContributionProfileId =
    relocCurrentContributionProfileId ?? defaultContributionProfileId ?? null;
  const effectiveTargetContributionProfileId =
    relocTargetContributionProfileId ?? defaultContributionProfileId ?? null;

  // The active Salary Profile, applied to both scenarios like every other
  // engine-backed page, so the "current" baseline matches the Retirement page.
  const { salaryProfileId: effectiveSalaryProfileId } =
    useEffectiveSalaryProfileId();

  // People for age display
  const { data: retData } = trpc.projection.computeProjection.useQuery({});
  const peopleLookup =
    retData && "people" in retData ? retData.people : undefined;
  const primaryPersonId =
    retData && "primaryPersonId" in retData
      ? retData.primaryPersonId
      : undefined;
  const planBirthYear = useMemo(
    () =>
      (
        peopleLookup?.find((p: { id: number }) => p.id === primaryPersonId) ??
        peopleLookup?.[0]
      )?.birthYear ?? null,
    [peopleLookup, primaryPersonId],
  );
  const displayAge = useCallback(
    (year: number) => (planBirthYear !== null ? year - planBirthYear : null),
    [planBirthYear],
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
      currentContributionProfileId: effectiveCurrentContributionProfileId,
      relocationContributionProfileId: effectiveTargetContributionProfileId,
      moveYear: relocMoveYear,
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
      effectiveCurrentContributionProfileId,
      effectiveTargetContributionProfileId,
      relocMoveYear,
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
    // A saved scenario's params are stored jsonb, typed by $type only.
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
    setRelocCurrentContributionProfileId(params.currentContributionProfileId);
    setRelocTargetContributionProfileId(params.relocationContributionProfileId);
    const loadedMoveYear = params.moveYear ?? null;
    setRelocMoveYear(loadedMoveYear);
    setRelocMoveYearInput(loadedMoveYear != null ? String(loadedMoveYear) : "");
  }, []);

  // Save / Save As / Delete handlers wiring mutations.
  // Kept in the parent so the mutation hooks + tRPC cache invalidation stay
  // in one place and child components only see plain callbacks.
  const handleSaveClick = useCallback(() => {
    if (selectedScenarioId) {
      const existing = scenariosQuery.data?.find(
        (s) => s.id === selectedScenarioId,
      );
      // If the query hasn't loaded yet, don't clobber the name with a placeholder.
      if (!existing) return;
      saveMutation.mutate({
        id: selectedScenarioId,
        name: existing.name,
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
      currentContributionProfileId: effectiveCurrentContributionProfileId,
      relocationContributionProfileId: effectiveTargetContributionProfileId,
      moveYear: relocMoveYear,
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
      effectiveCurrentContributionProfileId,
      effectiveTargetContributionProfileId,
      relocMoveYear,
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
  const relocFiQuery = trpc.projection.computeRelocationFiProjection.useQuery(
    {
      currentProfileId: debouncedRelocInput.currentProfileId,
      currentBudgetColumn: debouncedRelocInput.currentBudgetColumn,
      currentExpenseOverride: debouncedRelocInput.currentExpenseOverride,
      currentContributionProfileId:
        debouncedRelocInput.currentContributionProfileId,
      relocationProfileId: debouncedRelocInput.relocationProfileId,
      relocationBudgetColumn: debouncedRelocInput.relocationBudgetColumn,
      relocationExpenseOverride: debouncedRelocInput.relocationExpenseOverride,
      relocationContributionProfileId:
        debouncedRelocInput.relocationContributionProfileId,
      yearAdjustments: debouncedRelocInput.yearAdjustments.map((a) => ({
        year: a.year,
        monthlyExpenses: a.monthlyExpenses,
      })),
      largePurchases: debouncedRelocInput.largePurchases.map((p) => ({
        purchaseYear: p.purchaseYear,
        purchasePrice: p.purchasePrice,
        downPaymentPercent: p.downPaymentPercent ?? null,
        loanRate: p.loanRate ?? null,
        loanTermYears: p.loanTermYears ?? null,
        ongoingMonthlyCost: p.ongoingMonthlyCost ?? null,
        saleProceeds: p.saleProceeds ?? null,
      })),
      moveYear: debouncedRelocInput.moveYear,
      salaryProfileId: effectiveSalaryProfileId,
    },
    {
      enabled: effectiveCurrentProfileId > 0 && effectiveTargetProfileId > 0,
      placeholderData: (prev) => prev,
    },
  );
  // No return rate: the engine figures wait for one (the notice says so).
  const relocFiState = relocFiQuery.data;
  const relocNotConfigured =
    relocFiState && "notConfigured" in relocFiState
      ? relocFiState.notConfigured
      : null;
  const relocFi =
    relocFiState && !("notConfigured" in relocFiState) ? relocFiState : null;

  return (
    <div>
      <PageHeader
        title="Relocation"
        subtitle="Financial analysis and decision-making tools."
      />

      {/* Relocation Decision Tool */}
      <Card
        title={
          <>
            Relocation Analysis
            <HelpTip text="Compare how moving to a new area would affect your expenses, savings rate, and retirement readiness" />
          </>
        }
        className="mb-6"
      >
        <RelocationScenariosControls
          scenarios={scenariosQuery.data ?? []}
          selectedScenarioId={selectedScenarioId}
          setSelectedScenarioId={setSelectedScenarioId}
          loadScenario={loadScenario}
          isAdmin={isAdmin(user)}
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
          <div className="space-y-4">
            <RelocationBudgetSelectors
              budgetInfo={relocQuery.data.budgetInfo}
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
              contributionProfiles={contributionProfiles}
              effectiveCurrentContributionProfileId={
                effectiveCurrentContributionProfileId
              }
              setRelocCurrentContributionProfileId={
                setRelocCurrentContributionProfileId
              }
              effectiveTargetContributionProfileId={
                effectiveTargetContributionProfileId
              }
              setRelocTargetContributionProfileId={
                setRelocTargetContributionProfileId
              }
              currentContribProfile={relocQuery.data.currentContribProfile}
              relocationContribProfile={
                relocQuery.data.relocationContribProfile
              }
            />

            {relocNotConfigured && (
              <NotConfiguredNotice reason={relocNotConfigured} />
            )}

            {/* Planned Move Year input */}
            <div className="flex items-center gap-3">
              <label className="text-muted text-sm whitespace-nowrap">
                Planned Move Year
              </label>
              <input
                type="number"
                className="w-24 rounded border px-2 py-1 text-sm"
                placeholder={
                  relocFi?.earliestRelocateYear != null
                    ? String(relocFi.earliestRelocateYear)
                    : "—"
                }
                value={relocMoveYearInput}
                min={new Date().getFullYear()}
                max={2100}
                onChange={(e) => {
                  const raw = e.target.value;
                  setRelocMoveYearInput(raw);
                  const parsed = parseInt(raw, 10);
                  setRelocMoveYear(
                    !isNaN(parsed) && parsed >= 1900 && parsed <= 2100
                      ? parsed
                      : null,
                  );
                }}
              />
              {relocMoveYear !== null && (
                <button
                  className="text-muted hover:text-secondary text-xs"
                  onClick={() => {
                    setRelocMoveYear(null);
                    setRelocMoveYearInput("");
                  }}
                >
                  Clear
                </button>
              )}
              {relocFi?.earliestRelocateYear != null &&
                relocMoveYear === null && (
                  <span className="text-faint text-xs">
                    Earliest viable: {relocFi.earliestRelocateYear} (age{" "}
                    {relocFi.earliestRelocateAge})
                  </span>
                )}
            </div>

            <RelocationMetricsAndBanner
              result={relocQuery.data.result}
              engineResult={
                relocFiQuery.isPending || relocFiQuery.isFetching
                  ? undefined
                  : (relocFi ?? null)
              }
              moveYear={relocMoveYear}
            />

            <RelocationLargePurchases
              result={relocQuery.data.result}
              relocLargePurchases={relocLargePurchases}
              setRelocLargePurchases={setRelocLargePurchases}
              purchaseForm={purchaseForm}
              setPurchaseForm={setPurchaseForm}
            />

            <RelocationYearAdjustments
              budgetInfo={relocQuery.data.budgetInfo}
              relocYearAdjustments={relocYearAdjustments}
              setRelocYearAdjustments={setRelocYearAdjustments}
              relocAdjMode={relocAdjMode}
              setRelocAdjMode={setRelocAdjMode}
              relocAdjForm={relocAdjForm}
              setRelocAdjForm={setRelocAdjForm}
            />

            <RelocationProjectionTable
              result={relocQuery.data.result}
              showRelocAllYears={showRelocAllYears}
              setShowRelocAllYears={setShowRelocAllYears}
              relocYearAdjustments={relocYearAdjustments}
              relocLargePurchases={relocLargePurchases}
              peopleLookup={peopleLookup}
              displayAge={displayAge}
              ageTooltip={ageTooltip}
              engineResult={
                relocFiQuery.isPending || relocFiQuery.isFetching
                  ? undefined
                  : (relocFi ?? null)
              }
              moveYear={relocMoveYear}
            />
          </div>
        ) : relocQuery.isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-8 w-1/2" />
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <SkeletonChart height={80} />
              <SkeletonChart height={80} />
              <SkeletonChart height={80} />
              <SkeletonChart height={80} />
            </div>
          </div>
        ) : (
          <p className="text-muted text-sm">
            No active budget profile found. Create a budget profile first.
          </p>
        )}
      </Card>
    </div>
  );
}
