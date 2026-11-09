"use client";

/**
 * What-If sandbox (salary → take-home → budget → leftover → savings) built from the real
 * components; every figure comes from budget.computeActiveSummary. Only Duplicate Profile and
 * Save as Plan write (`amountsOnly`, `sandbox`+`onLocalChange`); pickers and drafts stay local.
 */

import { useMemo, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "@/lib/hooks/use-toast";
import { accountDisplayName } from "@/lib/utils/format";
import { usePersistedSetting } from "@/lib/hooks/use-persisted-setting";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";
import { PROJECTION_DEBOUNCE_MS } from "@/lib/constants";
import { useEffectiveProfileId } from "@/lib/hooks/use-effective-profile-id";
import { usePaycheckPersonViews } from "@/lib/hooks/use-paycheck-person-views";
import {
  SK_ACTIVE_CONTRIB_PROFILE_ID,
  SK_ACTIVE_SALARY_PROFILE_ID,
} from "@/lib/constants/settings-keys";
import { useBudgetProfilesList } from "@/lib/hooks/use-budget-profiles-list";
import { type ContribAccountFormValues } from "@/components/paycheck/contrib-account-form";
import {
  useBudgetDerivedData,
  type SavingsGoalEntry,
} from "../../../app/(dashboard)/budget/use-budget-derived-data";
import {
  type ContributionAddition,
  type DeductionAddition,
} from "./what-if-editors";
import { useActiveRetirementProfile } from "@/lib/hooks/use-active-retirement-profile";
import { useSandboxState } from "./use-what-if-sandbox";
import { WhatIfPickers } from "./what-if-pickers";
import { WhatIfSalaryStep } from "./what-if-salary-step";
import { WhatIfContributionsStep } from "./what-if-contributions-step";
import { WhatIfBudgetStep } from "./what-if-budget-step";
import { WhatIfSavingsStep } from "./what-if-savings-step";
import { WhatIfSaveActions } from "./what-if-save-actions";
import { WhatIfMakeRealPanel } from "./what-if-make-real-panel";

export function WhatIfTab({
  canDuplicateProfile,
  canCreatePlan,
  canManagePaycheck,
}: {
  /** `hasPermission(user, "budget")` — same gate as budget.createProfile. */
  canDuplicateProfile: boolean;
  /** `hasPermission(user, "scenario")` — a DIFFERENT permission from the
   *  Budget page's own gate; settings.scenarios.create is scenarioProcedure,
   *  so a budget-only user must not see a button that would 403. */
  canCreatePlan: boolean;
  /** `isAdmin(user)`: the deduction/contribution-account creates are
   *  adminProcedure. Governs "Make this real" on hand-added rows. */
  canManagePaycheck: boolean;
}) {
  const utils = trpc.useUtils();

  // ── Profile lists + defaults (the active profiles) ──
  const { data: budgetProfiles } = useBudgetProfilesList();
  const { data: contributionProfiles } =
    trpc.contributionProfile.list.useQuery();
  const { data: salaryProfiles } = trpc.salaryProfile.list.useQuery();

  const [activeContributionSetting] = usePersistedSetting<number | null>(
    SK_ACTIVE_CONTRIB_PROFILE_ID,
    null,
  );
  const [activeSalarySetting] = usePersistedSetting<number | null>(
    SK_ACTIVE_SALARY_PROFILE_ID,
    null,
  );
  const activeBudgetProfileId =
    budgetProfiles?.find((p) => p.isActive)?.id ?? null;

  const { profileId: defaultBudgetId } = useEffectiveProfileId("budget", {
    validIds: budgetProfiles?.map((p) => p.id),
    localSelection: null,
    activeProfileId: activeBudgetProfileId,
  });
  const { profileId: defaultContributionId } = useEffectiveProfileId(
    "contribution",
    {
      validIds: contributionProfiles?.map((p) => p.id),
      localSelection: null,
      activeProfileId: activeContributionSetting,
    },
  );
  const { profileId: defaultSalaryId } = useEffectiveProfileId("salary", {
    validIds: salaryProfiles?.map((p) => p.id),
    localSelection: null,
    activeProfileId: activeSalarySetting,
  });

  // ── The three local pickers (plain state; null = "use the default") ──
  const [pickedBudgetId, setPickedBudgetId] = useState<number | null>(null);
  const [pickedContributionId, setPickedContributionId] = useState<
    number | null
  >(null);
  const [pickedSalaryId, setPickedSalaryId] = useState<number | null>(null);

  const budgetId = pickedBudgetId ?? defaultBudgetId;
  const [activeRetirementId] = useActiveRetirementProfile();
  const contribId = pickedContributionId ?? defaultContributionId;
  const salaryId = pickedSalaryId ?? defaultSalaryId;

  // ── Sandbox edit state (salary/bonus + budget item drafts) ──
  const sandbox = useSandboxState(salaryId, budgetId);

  // ── Tax year: the sandbox's own, NOT the Paycheck page's persisted one ──
  const currentYear = new Date().getFullYear();
  const [taxYear, setTaxYear] = useState<number>(currentYear);
  const { data: taxBrackets } = trpc.settings.taxBrackets.list.useQuery();
  const { data: contributionLimitsAll } =
    trpc.settings.contributionLimits.list.useQuery();
  const availableYears = useMemo(() => {
    const yrs = new Set<number>();
    for (const tb of taxBrackets ?? []) yrs.add(tb.taxYear);
    for (const l of contributionLimitsAll ?? []) yrs.add(l.taxYear);
    return Array.from(yrs).sort((a, b) => b - a);
  }, [taxBrackets, contributionLimitsAll]);

  // ── Paycheck panel ──
  const { views, isLoading: paycheckLoading } = usePaycheckPersonViews({
    contributionProfileId: contribId,
    salaryProfileId: salaryId,
    taxYearOverride: taxYear,
    sandboxSalaryEntries: sandbox.salaryEntries,
    sandboxDeductionEdits: sandbox.sandboxDeductionEdits,
    sandboxDeductionAdditions: sandbox.sandboxDeductionAdditions,
    sandboxContribActiveFields: sandbox.sandboxContribActiveFields,
    sandboxContribAdditions: sandbox.sandboxContribAdditions,
  });

  // ── Budget panel ──
  // The tab's picks, else the active ids (null while loading = none).
  const selection = useMemo(
    () => ({
      contribution: contribId ?? activeContributionSetting,
      salary: salaryId ?? activeSalarySetting,
    }),
    [contribId, salaryId, activeContributionSetting, activeSalarySetting],
  );

  const [activeColumn, setActiveColumn] = useState(0);
  // Debounced: some sandbox editors update on every keystroke, and each new
  // input is a real server round trip (computeActiveSummary).
  const computeActiveSummaryInput = useDebouncedValue(
    {
      selectedColumn: activeColumn,
      selection,
      ...(budgetId != null ? { profileId: budgetId } : {}),
      ...(Object.keys(sandbox.salaryEntries).length > 0
        ? { sandboxSalaryEntries: sandbox.salaryEntries }
        : {}),
      ...(sandbox.itemAmountActiveFields.length > 0
        ? { itemAmountActiveFields: sandbox.itemAmountActiveFields }
        : {}),
      ...(sandbox.sandboxDeductionEdits.length > 0
        ? { sandboxDeductionEdits: sandbox.sandboxDeductionEdits }
        : {}),
      ...(sandbox.sandboxDeductionAdditions.length > 0
        ? { sandboxDeductionAdditions: sandbox.sandboxDeductionAdditions }
        : {}),
      ...(Object.keys(sandbox.sandboxContribActiveFields).length > 0
        ? { sandboxContribActiveFields: sandbox.sandboxContribActiveFields }
        : {}),
      ...(sandbox.sandboxContribAdditions.length > 0
        ? { sandboxContribAdditions: sandbox.sandboxContribAdditions }
        : {}),
    },
    PROJECTION_DEBOUNCE_MS,
  );
  const { data: budgetData } = trpc.budget.computeActiveSummary.useQuery(
    computeActiveSummaryInput,
    { enabled: budgetId != null },
  );
  const { data: resolvedSavingsGoals } =
    trpc.savings.goalProfileAllocations.list.useQuery(
      { profileId: budgetId! },
      { enabled: budgetId != null },
    );
  const savingsGoals: SavingsGoalEntry[] | undefined =
    resolvedSavingsGoals?.map((g) => ({
      id: g.goalId,
      name: g.name,
      isActive: true,
      monthlyContribution: g.monthlyContribution,
      allocationPercent: g.allocationPercent,
    }));

  const {
    cols,
    categoryNames,
    visibleCategories,
    hasMoreCategories,
    getCatTotals,
    matchContribution,
    allColumnResults,
    apiActualsMap,
    // buildPushPreviewItems / buildPullPreviewItems are deliberately NOT
    // destructured — nothing in this sandbox may reach a real external sync.
  } = useBudgetDerivedData({
    data: budgetData,
    savingsGoals,
    apiActualsData: null,
    contributionProfileId: selection.contribution,
    salaryProfileId: selection.salary,
    editMode: true,
    getDraft: sandbox.getDraft,
    // No pagination in the sandbox — a "load more" sentinel that never
    // triggers (no scroll container to observe) would just hide categories.
    visibleCount: 9999,
  });

  // ── Leftover: net income − this column's budget total ──
  const netMonthlyIncome =
    budgetData && "netMonthlyIncome" in budgetData
      ? (budgetData.netMonthlyIncome ?? null)
      : null;
  const budgetTotal = allColumnResults?.[activeColumn]?.totalMonthly ?? null;
  const leftover =
    netMonthlyIncome != null && budgetTotal != null
      ? netMonthlyIncome - budgetTotal
      : null;
  // Extra-paycheck adjustment for the real current month, independent of the
  // selected column. A separate annotation; never folded into income or leftover.
  const budgetIncomeAdjustmentThisMonth =
    budgetData && "budgetIncomeAdjustmentThisMonth" in budgetData
      ? budgetData.budgetIncomeAdjustmentThisMonth
      : null;

  // ── Sandbox-local Budget table wiring (amounts-only, no live mutation) ──
  const sentinelRef = useRef<HTMLTableRowElement>(null);
  const noop = () => {};
  // Session-local only (not persisted like the real Budget tab's
  // `budget_name_col_width` setting) — same 192px starting point, same
  // drag-to-resize interaction, just doesn't write anywhere.
  const [nameColWidth, setNameColWidth] = useState(192);
  const resizeStartRef = useRef<{ startX: number; startW: number } | null>(
    null,
  );
  const onResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = nameColWidth;
    resizeStartRef.current = { startX, startW };
    const onMove = (ev: MouseEvent) => {
      const delta = ev.clientX - startX;
      setNameColWidth(Math.max(120, Math.min(400, startW + delta)));
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      resizeStartRef.current = null;
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };
  const budgetPageContextValue = useMemo(
    () => ({
      profileId: budgetId,
      cols,
      activeColumn,
      apiService: null,
      apiLinkedProfileId: null,
      apiLinkedColumnIndex: null,
      showApiColumn: false,
      // Safe here specifically because amountsOnly (below) has already
      // neutered everything else canEdit would otherwise unlock.
      canEdit: true,
      editMode: true,
      setEditMode: noop,
      amountsOnly: true,
    }),
    [budgetId, cols, activeColumn],
  );

  // ── Save actions ──
  const [duplicateName, setDuplicateName] = useState("");
  const [planName, setPlanName] = useState("");
  const duplicateProfile = trpc.budget.duplicateProfile.useMutation({
    onSuccess: (created) => {
      utils.budget.invalidate();
      setDuplicateName("");
      toast.success(`Created budget profile "${created.name}"`);
    },
    onError: (err) => toast.error(err.message || "Failed to duplicate profile"),
  });
  const createPlan = trpc.settings.scenarios.create.useMutation({
    onSuccess: (created) => {
      utils.settings.scenarios.list.invalidate();
      setPlanName("");
      toast.success(`Created Plan "${created?.name ?? ""}"`);
    },
    onError: (err) => toast.error(err.message || "Failed to create Plan"),
  });

  // ── "Make this real" — graduate a sandbox addition into a genuine row.
  // Minimal fields; the rest takes the mutations' defaults and is finished on
  // the Contribution Profiles / Paycheck settings pages.
  const [deductionMakeRealPendingId, setDeductionMakeRealPendingId] = useState<
    number | null
  >(null);
  const deductionMakeRealAdditionRef = useRef<DeductionAddition | null>(null);
  const setDeductionActiveFields =
    trpc.contributionProfile.setDeductionActiveFields.useMutation();
  const createDeduction = trpc.settings.deductions.create.useMutation({
    onSuccess: (created) => {
      const addition = deductionMakeRealAdditionRef.current;
      const finish = () => {
        utils.paycheck.invalidate();
        utils.contributionProfile.invalidate();
        if (addition) sandbox.removeDeductionAddition(addition.localId);
        setDeductionMakeRealPendingId(null);
        toast.success(
          `Added "${created?.deductionName ?? ""}" to the paycheck`,
        );
      };
      // A deduction has no amount of its own: the previewed value goes into the
      // effective Contribution Profile's deductions active field.
      if (created && addition && contribId != null) {
        setDeductionActiveFields.mutate(
          {
            profileId: contribId,
            deductionId: created.id,
            fields: { amountPerPeriod: addition.amountPerPeriod.toFixed(2) },
          },
          { onSuccess: finish, onError: finish },
        );
      } else {
        finish();
      }
    },
    onError: (err) => {
      setDeductionMakeRealPendingId(null);
      toast.error(err.message || "Failed to add deduction");
    },
  });
  const handleMakeDeductionReal = (
    addition: DeductionAddition,
    jobId: number,
  ) => {
    deductionMakeRealAdditionRef.current = addition;
    setDeductionMakeRealPendingId(addition.localId);
    createDeduction.mutate({
      jobId,
      deductionName: addition.name,
      isPretax: addition.isPretax,
      ficaExempt: addition.ficaExempt,
    });
  };

  const [contributionMakeRealPendingId, setContributionMakeRealPendingId] =
    useState<number | null>(null);
  // The addition being converted: its previewed value/method go into the new
  // account's active field in the effective profile (contribId), since the
  // account holds no value itself (see applyContribActiveFields).
  const contributionMakeRealAdditionRef = useRef<ContributionAddition | null>(
    null,
  );
  const [makeRealAddition, setMakeRealAddition] =
    useState<ContributionAddition | null>(null);
  const setContributionAccountActiveFields =
    trpc.contributionProfile.setAccountActiveFields.useMutation();
  const onMakeRealSettled = (created: { id: number } | undefined) => {
    const addition = contributionMakeRealAdditionRef.current;
    const finish = () => {
      utils.contribution.invalidate();
      utils.paycheck.invalidate();
      utils.contributionProfile.invalidate();
      if (addition) sandbox.removeContributionAddition(addition.localId);
      setContributionMakeRealPendingId(null);
      setMakeRealAddition(null);
      toast.success(
        `Added "${created ? accountDisplayName(created as Record<string, unknown>) : ""}" account to Contribution Profiles`,
      );
    };
    if (created && addition && contribId != null) {
      setContributionAccountActiveFields.mutate(
        {
          profileId: contribId,
          accountId: created.id,
          fields: {
            contributionValue: addition.contributionValue,
            contributionMethod: addition.contributionMethod,
          },
        },
        { onSuccess: finish, onError: finish },
      );
    } else {
      finish();
    }
  };
  const onMakeRealError = (err: { message?: string }) => {
    setContributionMakeRealPendingId(null);
    toast.error(err.message || "Failed to add contribution account");
  };
  const createContributionAccount =
    trpc.settings.contributionAccounts.create.useMutation({
      onSuccess: onMakeRealSettled,
      onError: onMakeRealError,
    });
  const updateContributionAccount =
    trpc.settings.contributionAccounts.update.useMutation({
      onSuccess: onMakeRealSettled,
      onError: onMakeRealError,
    });
  const handleSaveMakeReal = (values: ContribAccountFormValues) => {
    if (!makeRealAddition) return;
    contributionMakeRealAdditionRef.current = makeRealAddition;
    setContributionMakeRealPendingId(makeRealAddition.localId);
    const { id, ...rest } = values;
    if (id != null) {
      updateContributionAccount.mutate({ id, ...rest });
    } else {
      createContributionAccount.mutate(rest);
    }
  };

  const budgetProfileName =
    budgetProfiles?.find((p) => p.id === budgetId)?.name ?? "";
  const contributionProfileName =
    contributionProfiles?.find((p) => p.id === contribId)?.name ?? null;
  const salaryProfileName =
    salaryProfiles?.find((p) => p.id === salaryId)?.name ?? null;

  // Callout showing the picked Contribution Profile's effect, from the
  // perContribData usePaycheckPersonViews already resolved.
  const contributionTotals = useMemo(() => {
    let annual = 0;
    let match = 0;
    for (const v of views) {
      for (const c of v.perContribData) {
        annual += c.annualAmount;
        match += c.employerMatchAnnual;
      }
    }
    return { annual, match };
  }, [views]);

  const editedAmountCount = sandbox.budgetDrafts.size;
  const duplicateLabel = duplicateProfile.isPending
    ? "Duplicating…"
    : editedAmountCount > 0
      ? `Save as new profile (${editedAmountCount} edited amount${editedAmountCount === 1 ? "" : "s"})`
      : "Duplicate Profile";

  const salaryEditCount = Object.values(sandbox.salaryEntries).filter(
    (e) => e.salary !== undefined,
  ).length;
  const planLabel = createPlan.isPending ? "Saving…" : "Save as Plan";
  const planProfiles =
    salaryId != null &&
    contribId != null &&
    budgetId != null &&
    activeRetirementId != null
      ? {
          salaryProfileId: salaryId,
          contributionProfileId: contribId,
          budgetProfileId: budgetId,
          retirementProfileId: activeRetirementId,
        }
      : null;

  return (
    <div className="space-y-5">
      {/* ── Pickers ── */}
      <WhatIfPickers
        availableYears={availableYears}
        budgetId={budgetId}
        budgetProfiles={budgetProfiles}
        contribId={contribId}
        contributionProfiles={contributionProfiles}
        salaryId={salaryId}
        salaryProfiles={salaryProfiles}
        sandbox={sandbox}
        setPickedBudgetId={setPickedBudgetId}
        setPickedContributionId={setPickedContributionId}
        setPickedSalaryId={setPickedSalaryId}
        setTaxYear={setTaxYear}
        taxYear={taxYear}
      />

      {/* ── Step 1: Salary/bonus edits ── */}
      <WhatIfSalaryStep
        netMonthlyIncome={netMonthlyIncome}
        paycheckLoading={paycheckLoading}
        salaryProfileName={salaryProfileName}
        sandbox={sandbox}
        views={views}
      />

      {/* ── Step 2: Contribution accounts + deductions — both resolve via
          the Contribution Profile now (paycheck_deductions carries no
          amount of its own, see DESIGN.md's Salary Profile layer section) ── */}
      <WhatIfContributionsStep
        canManagePaycheck={canManagePaycheck}
        contributionMakeRealPendingId={contributionMakeRealPendingId}
        contributionProfileName={contributionProfileName}
        contribTotals={contributionTotals}
        deductionMakeRealPendingId={deductionMakeRealPendingId}
        handleMakeDeductionReal={handleMakeDeductionReal}
        paycheckLoading={paycheckLoading}
        sandbox={sandbox}
        setMakeRealAddition={setMakeRealAddition}
        views={views}
      />

      {/* ── Step 3: Budget vs. net income ── */}
      <WhatIfBudgetStep
        activeColumn={activeColumn}
        allColumnResults={allColumnResults}
        apiActualsMap={apiActualsMap}
        budgetIncomeAdjustmentThisMonth={budgetIncomeAdjustmentThisMonth}
        budgetPageContextValue={budgetPageContextValue}
        budgetProfileName={budgetProfileName}
        budgetTotal={budgetTotal}
        categoryNames={categoryNames}
        cols={cols}
        getCatTotals={getCatTotals}
        hasMoreCategories={hasMoreCategories}
        leftover={leftover}
        matchContribution={matchContribution}
        nameColWidth={nameColWidth}
        netMonthlyIncome={netMonthlyIncome}
        noop={noop}
        onResizeStart={onResizeStart}
        sandbox={sandbox}
        sentinelRef={sentinelRef}
        setActiveColumn={setActiveColumn}
        visibleCategories={visibleCategories}
      />

      {/* ── Step 4: Savings from what's left over ── */}
      <WhatIfSavingsStep
        activeColumn={activeColumn}
        budgetId={budgetId}
        cols={cols}
        leftover={leftover}
        setPickedBudgetId={setPickedBudgetId}
      />

      {/* ── Save actions ── */}
      <WhatIfSaveActions
        budgetId={budgetId}
        budgetProfileName={budgetProfileName}
        canCreatePlan={canCreatePlan}
        canDuplicateProfile={canDuplicateProfile}
        createPlan={createPlan}
        duplicateLabel={duplicateLabel}
        duplicateName={duplicateName}
        duplicateProfile={duplicateProfile}
        planLabel={planLabel}
        planName={planName}
        planProfiles={planProfiles}
        salaryEditCount={salaryEditCount}
        sandbox={sandbox}
        setDuplicateName={setDuplicateName}
        setPlanName={setPlanName}
      />

      <WhatIfMakeRealPanel
        createContributionAccount={createContributionAccount}
        handleSaveMakeReal={handleSaveMakeReal}
        makeRealAddition={makeRealAddition}
        setMakeRealAddition={setMakeRealAddition}
        updateContributionAccount={updateContributionAccount}
      />
    </div>
  );
}
