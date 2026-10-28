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
 *    reset when that picker changes (see useSandboxState's effects), and
 *    there is deliberately no `beforeunload` guard: this is a throwaway
 *    play area, not an in-progress save.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "@/lib/hooks/use-toast";
import { formatCurrency, accountDisplayName } from "@/lib/utils/format";
import {
  getParentCategory,
  getDefaultTaxTreatment,
} from "@/lib/config/account-types";
import { usePersistedSetting } from "@/lib/hooks/use-persisted-setting";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";
import { PROJECTION_DEBOUNCE_MS } from "@/lib/constants";
import { useEffectiveProfileId } from "@/lib/hooks/use-effective-profile-id";
import {
  usePaycheckPersonViews,
  type SandboxSalaryEntries,
  type PaycheckPersonView,
} from "@/lib/hooks/use-paycheck-person-views";
import {
  SK_ACTIVE_CONTRIB_PROFILE_ID,
  SK_ACTIVE_SALARY_PROFILE_ID,
} from "@/lib/constants/settings-keys";
import { useBudgetProfilesList } from "@/lib/hooks/use-budget-profiles-list";
import { BudgetTable, SavingsAllocationPanel } from "@/components/budget";
import { BudgetPageContext } from "@/components/budget/budget-page-context";
import { HelpTip } from "@/components/ui/help-tip";
import { Skeleton } from "@/components/ui/skeleton";
import { FormError } from "@/components/ui/form-error";
import { SlidePanel } from "@/components/ui/slide-panel";
import {
  ContribAccountForm,
  type ContribAccountFormValues,
} from "@/components/paycheck/contrib-account-form";
import {
  useBudgetDerivedData,
  type SavingsGoalEntry,
} from "./use-budget-derived-data";
import { WhatIfPaycheckSummary } from "./what-if-paycheck-summary";
import {
  SANDBOX_ACCOUNT_TYPES,
  WhatIfContributionsEditor,
  WhatIfDeductionsEditor,
  WhatIfPinnedCell,
  type ContribAddition,
  type DeductionAddition,
} from "./what-if-editors";
import { useActiveRetirementProfile } from "@/lib/hooks/use-active-retirement-profile";

type SandboxSalaryEntry = SandboxSalaryEntries[string];

/** Local picker for one profile axis. */
function ProfilePicker({
  label,
  value,
  options,
  onChange,
  note,
}: {
  label: string;
  value: number | null;
  options: { id: number; name: string }[];
  onChange: (id: number) => void;
  note?: string;
}) {
  if (options.length === 0) return null;
  return (
    <div className="flex items-center gap-2">
      <span className="text-muted text-xs">{label}:</span>
      <select
        className="bg-surface-primary rounded border px-2 py-1 text-xs"
        value={value ?? ""}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={`${label} profile`}
      >
        {options.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      {note && (
        <span className="text-caption font-medium text-amber-600">{note}</span>
      )}
    </div>
  );
}

/**
 * A numbered card for one step of the workflow (Paycheck → Budget →
 * Savings). Gives the tab visual structure instead of one long
 * undifferentiated column — each step is its own bounded region with a
 * clear "what is this for" line, matching how a multi-step form reads.
 *
 * Collapsible rather than a wizard: the whole point of What-If is seeing
 * the cascade (a salary tweak in step 1 changes the leftover figure in
 * step 3) so hiding earlier steps behind "Next" would work against the
 * tool's purpose. Folding a step you're done with just reclaims vertical
 * space — `headerExtra` (each step's key figure) stays visible either way,
 * so a collapsed step still tells you what it resolved to.
 */
function WhatIfStep({
  number,
  title,
  description,
  headerExtra,
  defaultExpanded = true,
  children,
}: {
  number: number;
  title: string;
  description?: string;
  /** Right-aligned content in the header row (mode tabs, leftover figure).
   *  Rendered outside the collapse toggle, so it stays visible — and its
   *  own controls (e.g. the mode picker) stay clickable — when folded. */
  headerExtra?: ReactNode;
  defaultExpanded?: boolean;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  return (
    <section className="border-default bg-surface-sunken/40 rounded-lg border p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="flex items-start gap-2.5 text-left"
          aria-expanded={expanded}
        >
          <span className="text-micro mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-blue-600 font-semibold text-white">
            {number}
          </span>
          <div>
            <h3 className="text-primary flex items-center gap-1 text-sm leading-tight font-semibold">
              {title}
              {expanded ? (
                <ChevronDown className="text-faint h-3.5 w-3.5" />
              ) : (
                <ChevronRight className="text-faint h-3.5 w-3.5" />
              )}
            </h3>
            {description && (
              <p className="text-caption text-faint mt-0.5">{description}</p>
            )}
          </div>
        </button>
        {headerExtra}
      </div>
      {expanded && children}
    </section>
  );
}

/**
 * Sandbox-local edit state: salary/bonus entries, deduction edits/
 * additions, and budget item amount drafts. None of it is ever persisted —
 * see this file's docblock point 5 for why the profile-scoped pieces (salary
 * entries, budget drafts) reset when their owning picker changes. Deduction
 * edits/additions are keyed by real deduction id / personId, which don't
 * change when a picker changes, so they persist until "Reset sandbox."
 */
function useSandboxState(salaryId: number | null, budgetId: number | null) {
  const [salaryEntries, setSalaryEntries] = useState<SandboxSalaryEntries>({});
  const [budgetDrafts, setBudgetDrafts] = useState<Map<string, number>>(
    new Map(),
  );
  const [deductionEdits, setDeductionEdits] = useState<Map<number, number>>(
    new Map(),
  );
  const [deductionAdditions, setDeductionAdditions] = useState<
    DeductionAddition[]
  >([]);
  const [contribActiveFields, setContribActiveFields] = useState<
    Map<number, string>
  >(new Map());
  const [contribAdditions, setContribAdditions] = useState<ContribAddition[]>(
    [],
  );
  const nextLocalId = useRef(-1);

  const prevSalaryId = useRef(salaryId);
  useEffect(() => {
    if (prevSalaryId.current !== salaryId) {
      setSalaryEntries({});
      prevSalaryId.current = salaryId;
    }
  }, [salaryId]);

  const prevBudgetId = useRef(budgetId);
  useEffect(() => {
    if (prevBudgetId.current !== budgetId) {
      setBudgetDrafts(new Map());
      prevBudgetId.current = budgetId;
    }
  }, [budgetId]);

  const setSalaryField = (
    personId: number,
    field: keyof SandboxSalaryEntry,
    value: number | undefined,
  ) => {
    setSalaryEntries((prev) => {
      const next = { ...prev };
      const entry = { ...next[String(personId)] };
      if (value === undefined) delete entry[field];
      else entry[field] = value;
      if (Object.keys(entry).length === 0) delete next[String(personId)];
      else next[String(personId)] = entry;
      return next;
    });
  };

  const getDraft = (id: number, colIndex: number, original: number) =>
    budgetDrafts.get(`${id}:${colIndex}`) ?? original;
  const setDraft = (id: number, colIndex: number, amount: number) =>
    setBudgetDrafts((prev) => {
      const next = new Map(prev);
      next.set(`${id}:${colIndex}`, amount);
      return next;
    });

  const setDeductionEdit = (id: number, amountPerPeriod: number) =>
    setDeductionEdits((prev) => new Map(prev).set(id, amountPerPeriod));
  const resetDeductionEdit = (id: number) =>
    setDeductionEdits((prev) => {
      const next = new Map(prev);
      next.delete(id);
      return next;
    });

  const addDeduction = (personId: number) => {
    const localId = nextLocalId.current--;
    setDeductionAdditions((prev) => [
      ...prev,
      {
        localId,
        personId,
        name: "New deduction",
        amountPerPeriod: 0,
        isPretax: false,
        ficaExempt: false,
      },
    ]);
  };
  const updateDeductionAddition = (
    localId: number,
    patch: Partial<Omit<DeductionAddition, "localId" | "personId">>,
  ) =>
    setDeductionAdditions((prev) =>
      prev.map((d) => (d.localId === localId ? { ...d, ...patch } : d)),
    );
  const removeDeductionAddition = (localId: number) =>
    setDeductionAdditions((prev) => prev.filter((d) => d.localId !== localId));

  const setContribActiveField = (
    accountId: number,
    contributionValue: string,
  ) =>
    setContribActiveFields((prev) =>
      new Map(prev).set(accountId, contributionValue),
    );
  const resetContribActiveField = (accountId: number) =>
    setContribActiveFields((prev) => {
      const next = new Map(prev);
      next.delete(accountId);
      return next;
    });

  const addContribAddition = (personId: number) => {
    const localId = nextLocalId.current--;
    setContribAdditions((prev) => [
      ...prev,
      {
        localId,
        personId,
        accountType: SANDBOX_ACCOUNT_TYPES[0]!,
        contributionMethod: "percent_of_salary",
        contributionValue: "0",
      },
    ]);
  };
  const updateContribAddition = (
    localId: number,
    patch: Partial<Omit<ContribAddition, "localId" | "personId">>,
  ) =>
    setContribAdditions((prev) =>
      prev.map((c) => (c.localId === localId ? { ...c, ...patch } : c)),
    );
  const removeContribAddition = (localId: number) =>
    setContribAdditions((prev) => prev.filter((c) => c.localId !== localId));

  const resetSandbox = () => {
    setSalaryEntries({});
    setBudgetDrafts(new Map());
    setDeductionEdits(new Map());
    setDeductionAdditions([]);
    setContribActiveFields(new Map());
    setContribAdditions([]);
  };

  const itemAmountActiveFields = useMemo(
    () =>
      Array.from(budgetDrafts.entries()).map(([key, amount]) => {
        const [itemId, colIndex] = key.split(":").map(Number);
        return { itemId: itemId!, colIndex: colIndex!, amount };
      }),
    [budgetDrafts],
  );

  const sandboxDeductionEdits = useMemo(
    () =>
      Array.from(deductionEdits.entries()).map(([id, amountPerPeriod]) => ({
        id,
        amountPerPeriod,
      })),
    [deductionEdits],
  );

  const sandboxDeductionAdditions = useMemo(
    () =>
      deductionAdditions
        .filter((d) => d.name.trim() !== "" && d.amountPerPeriod !== 0)
        .map(({ personId, name, amountPerPeriod, isPretax, ficaExempt }) => ({
          personId,
          name,
          amountPerPeriod,
          isPretax,
          ficaExempt,
        })),
    [deductionAdditions],
  );

  const sandboxContribActiveFields = useMemo(() => {
    const out: Record<string, { contributionValue: string }> = {};
    for (const [accountId, contributionValue] of contribActiveFields) {
      out[String(accountId)] = { contributionValue };
    }
    return out;
  }, [contribActiveFields]);

  const sandboxContribAdditions = useMemo(
    () =>
      contribAdditions
        .filter((c) => parseFloat(c.contributionValue) !== 0)
        .map(
          ({
            personId,
            accountType,
            contributionMethod,
            contributionValue,
          }) => ({
            personId,
            accountType,
            contributionMethod,
            contributionValue,
          }),
        ),
    [contribAdditions],
  );

  return {
    salaryEntries,
    setSalaryField,
    budgetDrafts,
    getDraft,
    setDraft,
    itemAmountActiveFields,
    deductionEdits,
    setDeductionEdit,
    resetDeductionEdit,
    deductionAdditions,
    addDeduction,
    updateDeductionAddition,
    removeDeductionAddition,
    sandboxDeductionEdits,
    sandboxDeductionAdditions,
    contribActiveFields,
    setContribActiveField,
    resetContribActiveField,
    sandboxContribActiveFields,
    contribAdditions,
    addContribAddition,
    updateContribAddition,
    removeContribAddition,
    sandboxContribAdditions,
    resetSandbox,
    hasEdits:
      Object.keys(salaryEntries).length > 0 ||
      budgetDrafts.size > 0 ||
      deductionEdits.size > 0 ||
      deductionAdditions.length > 0 ||
      contribActiveFields.size > 0 ||
      contribAdditions.length > 0,
  };
}

/** Editable salary/bonus fields per person — writes into the sandbox's
 *  SandboxSalaryEntries, feeding a REAL server recompute (paycheck/
 *  contribution.computeSummary's sandboxSalaryEntries input), not a
 *  client-side estimate. Each cell pre-fills with what the picked Salary
 *  Profile currently resolves to for that person; leaving it alone writes
 *  nothing (stays live), changing it pins that field for this preview. */
function WhatIfSalaryEditor({
  views,
  entries,
  onChange,
}: {
  views: PaycheckPersonView[];
  entries: SandboxSalaryEntries;
  onChange: (
    personId: number,
    field: keyof SandboxSalaryEntry,
    value: number | undefined,
  ) => void;
}) {
  if (views.length === 0) return null;

  return (
    <table className="w-full border-collapse text-xs">
      <thead>
        <tr className="border-strong border-b-2">
          <th className="text-muted py-2 pr-3 pl-4 text-left font-medium">
            Person
          </th>
          <th className="text-muted w-32 px-3 py-2 text-right font-medium">
            Salary
          </th>
          <th className="text-muted w-24 px-3 py-2 text-right font-medium">
            Bonus %
          </th>
          <th className="text-muted w-24 px-3 py-2 text-right font-medium">
            Bonus ×
          </th>
        </tr>
      </thead>
      <tbody>
        {views.map((v, rowIdx) => {
          const entry = entries[String(v.person.id)] ?? {};
          return (
            <tr
              key={v.person.id}
              className={`border-subtle border-b transition-colors hover:bg-blue-50/60 ${
                rowIdx % 2 === 1 ? "bg-surface-sunken/60" : "bg-surface-primary"
              }`}
            >
              <td className="text-secondary py-1.5 pr-3 pl-4">
                {v.person.name}
              </td>
              <td className="px-3 py-1.5 text-right">
                <WhatIfPinnedCell
                  liveValue={v.salary}
                  pinnedValue={entry.salary}
                  onCommit={(n) => onChange(v.person.id, "salary", n)}
                  onReset={() => onChange(v.person.id, "salary", undefined)}
                  step="1000"
                  width="w-28"
                />
              </td>
              <td className="px-3 py-1.5 text-right">
                <WhatIfPinnedCell
                  liveValue={v.resolvedBonusTerms.bonusPercent * 100}
                  pinnedValue={
                    entry.bonusPercent != null
                      ? entry.bonusPercent * 100
                      : undefined
                  }
                  onCommit={(n) =>
                    onChange(v.person.id, "bonusPercent", n / 100)
                  }
                  onReset={() =>
                    onChange(v.person.id, "bonusPercent", undefined)
                  }
                  step="0.5"
                  width="w-16"
                />
              </td>
              <td className="px-3 py-1.5 text-right">
                <WhatIfPinnedCell
                  liveValue={v.resolvedBonusTerms.bonusMultiplier}
                  pinnedValue={entry.bonusMultiplier}
                  onCommit={(n) => onChange(v.person.id, "bonusMultiplier", n)}
                  onReset={() =>
                    onChange(v.person.id, "bonusMultiplier", undefined)
                  }
                  step="0.1"
                  width="w-16"
                />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

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
    globalDefaultId: activeBudgetProfileId,
  });
  const { profileId: defaultContribId } = useEffectiveProfileId(
    "contribution",
    {
      validIds: contribProfiles?.map((p) => p.id),
      localSelection: null,
      globalDefaultId: activeContribSetting,
    },
  );
  const { profileId: defaultSalaryId } = useEffectiveProfileId("salary", {
    validIds: salaryProfiles?.map((p) => p.id),
    localSelection: null,
    globalDefaultId: activeSalarySetting,
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
  // The tab's picks go into the LOCAL SELECTION tier of the documented
  // precedence — the tier that exists for exactly this sandbox.
  const contributionProfileTiers = useMemo(
    () => ({
      localSelectionId: contribId,
      globalDefaultId: activeContribSetting,
    }),
    [contribId, activeContribSetting],
  );
  const salaryProfileTiers = useMemo(
    () => ({
      localSelectionId: salaryId,
      globalDefaultId: activeSalarySetting,
    }),
    [salaryId, activeSalarySetting],
  );

  const [activeColumn, setActiveColumn] = useState(0);
  // Debounced: several of the sandbox editors below (deduction/contribution
  // additions' name/amount/treatment fields) update on raw onChange, not
  // blur — typing into a text field can otherwise re-key this query on
  // every keystroke, each one making a REAL server round trip (which
  // itself nests a paycheck.computeSummary call — see budget.ts's
  // computeActiveSummary). Matches the debounce pattern
  // use-projection-queries.ts already uses for the same reason.
  const computeActiveSummaryInput = useDebouncedValue(
    {
      selectedColumn: activeColumn,
      contributionProfile: contributionProfileTiers,
      salaryProfile: salaryProfileTiers,
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
    contributionProfileTiers,
    salaryProfileTiers,
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
      ? (budgetData.budgetIncomeAdjustmentThisMonth ?? null)
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
      toast.success(`Created budget profile "${created?.name ?? ""}"`);
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
      // pattern setContribAccountActiveFields already uses above.
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
      <div className="border-default bg-surface-sunken/40 rounded-lg border px-4 py-3">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <span className="text-muted text-xs font-semibold tracking-wide uppercase">
            Starting point
            <HelpTip text="Nothing on this tab changes what's active for your household. Pick any combination of profiles, edit salary/bonus and budget amounts to preview them, then use Duplicate Profile or Save as Plan below if you want to keep it." />
          </span>
          <ProfilePicker
            label="Salary"
            value={salaryId}
            options={salaryProfiles ?? []}
            onChange={setPickedSalaryId}
          />
          <ProfilePicker
            label="Contribution"
            value={contribId}
            options={contribProfiles ?? []}
            onChange={setPickedContribId}
          />
          <ProfilePicker
            label="Budget"
            value={budgetId}
            options={budgetProfiles ?? []}
            onChange={setPickedBudgetId}
          />
          {availableYears.length > 1 && (
            <div className="flex items-center gap-2">
              <span className="text-muted text-xs">Tax Year:</span>
              <div className="flex gap-1">
                {availableYears.map((year) => (
                  <button
                    key={year}
                    type="button"
                    onClick={() => setTaxYear(year)}
                    className={`rounded-full px-2 py-0.5 text-xs transition-colors ${
                      taxYear === year
                        ? "bg-blue-600 text-white"
                        : "bg-surface-elevated text-muted hover:bg-surface-strong"
                    }`}
                  >
                    {year}
                  </button>
                ))}
              </div>
            </div>
          )}
          {sandbox.hasEdits && (
            <button
              type="button"
              onClick={sandbox.resetSandbox}
              className="text-caption text-faint ml-auto hover:text-red-600"
            >
              Reset sandbox
            </button>
          )}
        </div>
      </div>

      {/* ── Step 1: Salary/bonus edits ── */}
      <WhatIfStep
        number={1}
        title={`Paycheck${salaryProfileName ? ` — ${salaryProfileName}` : ""}`}
        description="Edit salary or bonus to see the resulting take-home pay."
        headerExtra={
          netMonthlyIncome != null ? (
            <span className="text-xs font-semibold text-indigo-700">
              {formatCurrency(netMonthlyIncome)}/mo net
            </span>
          ) : undefined
        }
      >
        {paycheckLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : views.length === 0 ? (
          <p className="text-caption text-faint italic">
            No active jobs to preview.
          </p>
        ) : (
          <div className="space-y-3">
            <WhatIfSalaryEditor
              views={views}
              entries={sandbox.salaryEntries}
              onChange={sandbox.setSalaryField}
            />
            <WhatIfPaycheckSummary views={views} />
          </div>
        )}
      </WhatIfStep>

      {/* ── Step 2: Contribution accounts + deductions — both resolve via
          the Contribution Profile now (paycheck_deductions carries no
          amount of its own, see RULES.md's Salary Profile layer section) ── */}
      <WhatIfStep
        number={2}
        title={`Contributions${contribProfileName ? ` — ${contribProfileName}` : ""}`}
        description="What you and your employer put toward retirement/savings accounts, and what's deducted from your paycheck."
        headerExtra={
          views.length > 0 && contribProfileName ? (
            <span className="text-xs font-semibold text-indigo-700">
              {formatCurrency(contribTotals.annual)}/yr you
              {contribTotals.match > 0 && (
                <> · {formatCurrency(contribTotals.match)}/yr employer match</>
              )}
            </span>
          ) : undefined
        }
      >
        {paycheckLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : views.length === 0 ? (
          <p className="text-caption text-faint italic">
            No active jobs to preview.
          </p>
        ) : (
          <WhatIfContributionsEditor
            views={views}
            activeFields={sandbox.contribActiveFields}
            onEdit={sandbox.setContribActiveField}
            onReset={sandbox.resetContribActiveField}
            additions={sandbox.contribAdditions}
            onAddAccount={sandbox.addContribAddition}
            onUpdateAddition={sandbox.updateContribAddition}
            onRemoveAddition={sandbox.removeContribAddition}
            canManagePaycheck={canManagePaycheck}
            onMakeReal={setMakeRealAddition}
            makeRealPendingId={contribMakeRealPendingId}
          />
        )}
        {!paycheckLoading && views.length > 0 && (
          <WhatIfDeductionsEditor
            views={views}
            deductionEdits={sandbox.deductionEdits}
            onEditDeduction={sandbox.setDeductionEdit}
            onResetDeduction={sandbox.resetDeductionEdit}
            additions={sandbox.deductionAdditions}
            onAddDeduction={sandbox.addDeduction}
            onUpdateAddition={sandbox.updateDeductionAddition}
            onRemoveAddition={sandbox.removeDeductionAddition}
            canManagePaycheck={canManagePaycheck}
            onMakeReal={handleMakeDeductionReal}
            makeRealPendingId={deductionMakeRealPendingId}
          />
        )}
      </WhatIfStep>

      {/* ── Step 3: Budget vs. net income ── */}
      <WhatIfStep
        number={3}
        title={`Budget${budgetProfileName ? ` — ${budgetProfileName}` : ""}`}
        description="Edit any amount to see whether take-home pay covers it."
        headerExtra={
          <div className="flex flex-wrap items-center gap-3">
            {cols.length > 1 && (
              <div className="flex items-center gap-2">
                <span className="text-muted text-xs">Mode:</span>
                <div className="flex gap-1">
                  {cols.map((label, idx) => (
                    <button
                      key={label}
                      type="button"
                      onClick={() => setActiveColumn(idx)}
                      className={`rounded-full px-2 py-0.5 text-xs transition-colors ${
                        activeColumn === idx
                          ? "bg-blue-600 text-white"
                          : "bg-surface-elevated text-muted hover:bg-surface-strong"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        }
      >
        {leftover != null && (
          <div
            className={`mb-3 flex items-center justify-between rounded-md px-3 py-2 text-xs font-semibold ${
              leftover >= 0
                ? "bg-green-50 text-green-700"
                : "bg-red-50 text-red-600"
            }`}
          >
            <span>
              Net {formatCurrency(netMonthlyIncome ?? 0)}/mo − Budget{" "}
              {formatCurrency(budgetTotal ?? 0)}/mo
            </span>
            <span>
              {leftover >= 0 ? "" : "−"}
              {formatCurrency(Math.abs(leftover))}/mo left over
            </span>
          </div>
        )}
        {budgetIncomeAdjustmentThisMonth != null &&
          budgetIncomeAdjustmentThisMonth !== 0 && (
            <p className="text-muted -mt-2 mb-3 text-xs">
              +{formatCurrency(budgetIncomeAdjustmentThisMonth)} extra paycheck
              already included in this month&rsquo;s income (not part of Net
              above).
            </p>
          )}
        {allColumnResults && allColumnResults.length > 0 ? (
          <div className="border-subtle max-h-[520px] w-full overflow-y-auto rounded-md border">
            <BudgetPageContext.Provider value={budgetPageContextValue}>
              <BudgetTable
                visibleCategories={visibleCategories}
                hasMoreCategories={hasMoreCategories}
                categoryNames={categoryNames}
                getCatTotals={getCatTotals}
                layout={{
                  effectiveNameColWidth: nameColWidth,
                  onResizeStart,
                  sentinelRef,
                }}
                apiActualsMap={apiActualsMap}
                rowHandlers={{
                  getDraft: sandbox.getDraft,
                  setDraft: sandbox.setDraft,
                  onToggleItemEssential: noop,
                  onToggleCategoryEssential: noop,
                  onMoveItem: noop,
                  onDeleteItem: noop,
                  onConvertToGoal: noop,
                  onReorderItem: noop,
                  onReorderCategory: noop,
                  onAddItem: noop,
                  addItemPending: false,
                  addItemError: null,
                  matchContrib,
                  addingItemToCategory: null,
                  onSetAddingItemToCategory: noop,
                }}
              />
            </BudgetPageContext.Provider>
          </div>
        ) : (
          <Skeleton className="h-40 w-full" />
        )}
      </WhatIfStep>

      {/* ── Step 4: Savings from what's left over ── */}
      <WhatIfStep
        number={4}
        title="Savings"
        description="What's left over gets allocated here."
      >
        <SavingsAllocationPanel
          canEdit
          // No padlock to gate this: sandbox mode writes nothing but local
          // preview state (via onLocalChange below), so it's always editable.
          locked={false}
          sandbox
          viewingProfileId={budgetId}
          // The rail's own selection IS the tab's Budget Profile picker —
          // not a second, independent one.
          onSelectProfile={setPickedBudgetId}
          // No onActivateProfile: activating writes global state.
          livePoolEstimate={leftover}
          livePoolColumnLabel={cols[activeColumn]}
          onLocalChange={() => {
            // Sandbox savings edits are local-only for this preview session
            // (no downstream consumer needs them yet — the leftover figure
            // above already reflects the salary/budget sandbox). Accepting
            // the callback (rather than omitting it) is what keeps the
            // table's writes redirected away from the real upsert mutation.
          }}
        />
      </WhatIfStep>

      {/* ── Save actions ── */}
      {(canDuplicateProfile || canCreatePlan) && (
        <section className="border-default bg-surface-sunken/40 space-y-3 rounded-lg border p-4">
          <h3 className="text-primary text-sm font-semibold">Keep this</h3>
          {canDuplicateProfile && (
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                value={duplicateName}
                onChange={(e) => setDuplicateName(e.target.value)}
                placeholder={
                  budgetProfileName
                    ? `Copy of ${budgetProfileName}`
                    : "New profile name"
                }
                className="bg-surface-primary w-56 rounded border px-2 py-1 text-xs"
                aria-label="New budget profile name"
              />
              <button
                type="button"
                disabled={
                  budgetId == null ||
                  !duplicateName.trim() ||
                  duplicateProfile.isPending
                }
                onClick={() =>
                  duplicateProfile.mutate({
                    sourceProfileId: budgetId!,
                    name: duplicateName.trim(),
                    ...(sandbox.itemAmountActiveFields.length > 0
                      ? {
                          itemAmountActiveFields:
                            sandbox.itemAmountActiveFields,
                        }
                      : {}),
                  })
                }
                className="rounded bg-blue-600 px-2.5 py-1 text-xs text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {duplicateLabel}
              </button>
              <span className="text-caption text-faint">
                Copies modes, items and savings allocations.
                <HelpTip text="The copy starts inactive, and API-sync links and contribution-account links are intentionally NOT copied — two profiles pushing to the same external category is a real-money hazard. Re-link them on the copy if you want them." />
              </span>
              <FormError error={duplicateProfile.error} prefix="Failed" />
            </div>
          )}
          {canCreatePlan && (
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                value={planName}
                onChange={(e) => setPlanName(e.target.value)}
                placeholder="New Plan name"
                className="bg-surface-primary w-56 rounded border px-2 py-1 text-xs"
                aria-label="New Plan name"
              />
              <button
                type="button"
                disabled={
                  !planName.trim() || !planProfiles || createPlan.isPending
                }
                onClick={() => {
                  if (planProfiles)
                    createPlan.mutate({
                      name: planName.trim(),
                      ...planProfiles,
                    });
                }}
                className="hover:bg-surface-sunken rounded border px-2.5 py-1 text-xs"
              >
                {planLabel}
              </button>
              <span className="text-caption text-faint">
                Saves these profiles, plus your active Retirement profile, as a
                Plan you can apply from the top bar.
                {salaryEditCount > 0 && (
                  <>
                    {" "}
                    A Plan holds profiles, not edited amounts — save your salary
                    edits as a Salary Profile first.
                  </>
                )}
              </span>
              <FormError error={createPlan.error} prefix="Failed" />
            </div>
          )}
        </section>
      )}

      <SlidePanel
        isOpen={makeRealAddition != null}
        onClose={() => setMakeRealAddition(null)}
        title="Make Real: Contribution Account"
      >
        {makeRealAddition && (
          <ContribAccountForm
            initialValues={{
              personId: makeRealAddition.personId,
              accountType: makeRealAddition.accountType,
              parentCategory: getParentCategory(makeRealAddition.accountType),
              taxTreatment: getDefaultTaxTreatment(
                makeRealAddition.accountType,
              ) as "pre_tax" | "tax_free" | "after_tax" | "hsa",
            }}
            onSave={handleSaveMakeReal}
            onCancel={() => setMakeRealAddition(null)}
            isPending={
              createContribAccount.isPending || updateContribAccount.isPending
            }
          />
        )}
      </SlidePanel>
    </div>
  );
}
