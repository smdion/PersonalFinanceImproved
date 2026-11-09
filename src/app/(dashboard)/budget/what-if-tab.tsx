"use client";

/**
 * The Budget page's What-If tab — an editable sandbox that walks the actual
 * workflow this page exists for: pick/edit a salary, see the resulting net
 * income, check it against an editable budget, see what's left over, and
 * allocate that leftover to savings. Nothing here writes to the database
 * except the two explicit save actions at the bottom (Duplicate Profile,
 * Save as Plan).
 *
 * Design rules this file exists to hold:
 *
 * 1. No forked display/compute path. The paycheck summary reuses
 *    `usePaycheckPersonViews` (the same hook the real Paycheck page uses);
 *    the budget table is the SAME `BudgetTable` the real Budget tab uses,
 *    wrapped in a local `BudgetPageContext.Provider`; the savings table is
 *    the SAME `SavingsAllocationPanel`/`SavingsAllocationTable`. Every
 *    number (net income, budget total, leftover) comes from ONE server
 *    computation (`budget.computeActiveSummary`), not a client re-derivation
 *    — see its `netMonthlyIncome` field.
 * 2. Nothing here can write except the two explicit save actions. Editing
 *    surfaces are neutralized two different ways depending on the
 *    component's shape:
 *      - `BudgetItemRow`'s `amountsOnly` prop: structurally omits every
 *        control that isn't the amount input (essential toggle, API link,
 *        move/delete/reorder/add), so passing `canEdit: true` to unlock
 *        amount editing can't also unlock anything else.
 *      - `SavingsAllocationTable`'s `sandbox`+`onLocalChange`: redirects
 *        the commit from `savings.goalProfileAllocations.upsert` to local
 *        state instead.
 *    Sandbox editing is NOT gated on `hasPermission(user, "budget")` — it
 *    writes nothing, so someone without budget-edit rights can still play.
 * 3. The three pickers are plain component state. They never write the
 *    active profiles — they start FROM them and diverge locally from there.
 * 4. Sandbox drafts (salary/bonus edits, budget item edits) are keyed by
 *    ids that only mean something for the CURRENTLY picked profile — they
 *    reset when that picker changes (see useSandboxState), and
 *    there is deliberately no `beforeunload` guard: this is a throwaway
 *    play area, not an in-progress save.
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
} from "./use-budget-derived-data";
import {
  type ContribAddition,
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
  /** `isAdmin(user)` — settings.deductions.create / settings.
   *  contributionAccounts.create are adminProcedure, a stricter gate than
   *  either permission above. Governs the "Make this real" affordance on
   *  hand-added deductions/contribution accounts. */
  canManagePaycheck: boolean;
}) {
  const utils = trpc.useUtils();

  // ── Profile lists + defaults (the active profiles) ──
  const { data: budgetProfiles } = useBudgetProfilesList();
  const { data: contribProfiles } = trpc.contributionProfile.list.useQuery();
  const { data: salaryProfiles } = trpc.salaryProfile.list.useQuery();

  const [activeContribSetting] = usePersistedSetting<number | null>(
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
  const { profileId: defaultContribId } = useEffectiveProfileId(
    "contribution",
    {
      validIds: contribProfiles?.map((p) => p.id),
      localSelection: null,
      activeProfileId: activeContribSetting,
    },
  );
  const { profileId: defaultSalaryId } = useEffectiveProfileId("salary", {
    validIds: salaryProfiles?.map((p) => p.id),
    localSelection: null,
    activeProfileId: activeSalarySetting,
  });

  // ── The three local pickers (plain state; null = "use the default") ──
  const [pickedBudgetId, setPickedBudgetId] = useState<number | null>(null);
  const [pickedContribId, setPickedContribId] = useState<number | null>(null);
  const [pickedSalaryId, setPickedSalaryId] = useState<number | null>(null);

  const budgetId = pickedBudgetId ?? defaultBudgetId;
  const [activeRetirementId] = useActiveRetirementProfile();
  const contribId = pickedContribId ?? defaultContribId;
  const salaryId = pickedSalaryId ?? defaultSalaryId;

  // ── Sandbox edit state (salary/bonus + budget item drafts) ──
  const sandbox = useSandboxState(salaryId, budgetId);

  // ── Tax year: the sandbox's own, NOT the Paycheck page's persisted one ──
  const currentYear = new Date().getFullYear();
  const [taxYear, setTaxYear] = useState<number>(currentYear);
  const { data: taxBrackets } = trpc.settings.taxBrackets.list.useQuery();
  const { data: contribLimitsAll } =
    trpc.settings.contributionLimits.list.useQuery();
  const availableYears = useMemo(() => {
    const yrs = new Set<number>();
    for (const tb of taxBrackets ?? []) yrs.add(tb.taxYear);
    for (const l of contribLimitsAll ?? []) yrs.add(l.taxYear);
    return Array.from(yrs).sort((a, b) => b - a);
  }, [taxBrackets, contribLimitsAll]);

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
      contribution: contribId ?? activeContribSetting,
      salary: salaryId ?? activeSalarySetting,
    }),
    [contribId, salaryId, activeContribSetting, activeSalarySetting],
  );

  const [activeColumn, setActiveColumn] = useState(0);
  // Debounced: several of the sandbox editors below (deduction/contribution
  // additions' name/amount/treatment fields) update on raw onChange, not
  // blur — typing into a text field can otherwise re-key this query on
  // every keystroke, each one making a REAL server round trip (which
  // itself computes a paycheck summary too — see budget.ts's
  // computeActiveSummary). Matches the debounce pattern
  // use-projection-queries.ts already uses for the same reason.
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
    matchContrib,
    allColumnResults,
    apiActualsMap,
    // buildPushPreviewItems / buildPullPreviewItems are deliberately NOT
    // destructured — nothing in this sandbox may reach a real external sync.
  } = useBudgetDerivedData({
    data: budgetData,
    savingsGoals,
    apiActualsData: null,
    contribProfileId: selection.contribution,
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
  // Budget-mode extra-paycheck adjustment landing in the REAL current
  // calendar month — independent of activeColumn/selectedColumn (see
  // budget.computeActiveSummary's docblock). A separate, additively-labeled
  // annotation only; never folded into netMonthlyIncome or `leftover`.
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
  // Deliberately minimal fields (see zSandboxDeductionAdditions/
  // zSandboxContribAdditions docblocks) — everything else these mutations'
  // own input schemas accept just takes its normal default, same as a
  // freshly-created real row would before anyone edits it further. The
  // rest (institution, label, employer match, sub-accounts) is finished on
  // the real Contribution Profiles / Paycheck settings pages, not here.
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
      // A deduction has no live amount of its own any more — the value the
      // user was previewing gets carried into the currently-effective
      // Contribution Profile's deductions active field, same "make real"
      // pattern setContributionAccountActiveFields already uses above.
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

  const [contribMakeRealPendingId, setContribMakeRealPendingId] = useState<
    number | null
  >(null);
  // Holds the sandbox addition being converted — its value/method are what
  // the user was previewing, and get carried into the real account's active
  // field in whichever profile is currently in effect (contribId below), so
  // "Make real" doesn't quietly lose the number the user was testing. The
  // account itself carries no value of its own (see applyContribActiveFields).
  const contribMakeRealAdditionRef = useRef<ContribAddition | null>(null);
  const [makeRealAddition, setMakeRealAddition] =
    useState<ContribAddition | null>(null);
  const setContribAccountActiveFields =
    trpc.contributionProfile.setAccountActiveFields.useMutation();
  const onMakeRealSettled = (created: { id: number } | undefined) => {
    const addition = contribMakeRealAdditionRef.current;
    const finish = () => {
      utils.contribution.invalidate();
      utils.paycheck.invalidate();
      utils.contributionProfile.invalidate();
      if (addition) sandbox.removeContribAddition(addition.localId);
      setContribMakeRealPendingId(null);
      setMakeRealAddition(null);
      toast.success(
        `Added "${created ? accountDisplayName(created as Record<string, unknown>) : ""}" account to Contribution Profiles`,
      );
    };
    if (created && addition && contribId != null) {
      setContribAccountActiveFields.mutate(
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
    setContribMakeRealPendingId(null);
    toast.error(err.message || "Failed to add contribution account");
  };
  const createContribAccount =
    trpc.settings.contributionAccounts.create.useMutation({
      onSuccess: onMakeRealSettled,
      onError: onMakeRealError,
    });
  const updateContribAccount =
    trpc.settings.contributionAccounts.update.useMutation({
      onSuccess: onMakeRealSettled,
      onError: onMakeRealError,
    });
  const handleSaveMakeReal = (values: ContribAccountFormValues) => {
    if (!makeRealAddition) return;
    contribMakeRealAdditionRef.current = makeRealAddition;
    setContribMakeRealPendingId(makeRealAddition.localId);
    const { id, ...rest } = values;
    if (id != null) {
      updateContribAccount.mutate({ id, ...rest });
    } else {
      createContribAccount.mutate(rest);
    }
  };

  const budgetProfileName =
    budgetProfiles?.find((p) => p.id === budgetId)?.name ?? "";
  const contribProfileName =
    contribProfiles?.find((p) => p.id === contribId)?.name ?? null;
  const salaryProfileName =
    salaryProfiles?.find((p) => p.id === salaryId)?.name ?? null;

  // The Contribution Profile picker's effect was previously buried as two
  // rows in the middle of WhatIfPaycheckSummary's table, with nothing
  // connecting them back to the picker above — surfaced here as its own
  // callout so "I picked a profile, is it doing anything" has a visible
  // answer. Same figures the summary table already shows (perContribData
  // is resolved once by usePaycheckPersonViews), not a second computation.
  const contribTotals = useMemo(() => {
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
        contribProfiles={contribProfiles}
        salaryId={salaryId}
        salaryProfiles={salaryProfiles}
        sandbox={sandbox}
        setPickedBudgetId={setPickedBudgetId}
        setPickedContribId={setPickedContribId}
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
        contribMakeRealPendingId={contribMakeRealPendingId}
        contribProfileName={contribProfileName}
        contribTotals={contribTotals}
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
        matchContrib={matchContrib}
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
        createContribAccount={createContribAccount}
        handleSaveMakeReal={handleSaveMakeReal}
        makeRealAddition={makeRealAddition}
        setMakeRealAddition={setMakeRealAddition}
        updateContribAccount={updateContribAccount}
      />
    </div>
  );
}
