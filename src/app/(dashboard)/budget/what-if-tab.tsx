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
 * 3. The three pickers are plain component state. They never write to the
 *    Plan or to the globally-active settings — they default FROM those (via
 *    `useEffectiveProfileId`, so an active Plan's pins are the starting
 *    point) and diverge locally from there.
 * 4. A session scenario (the browser-local what-if in the top bar) is a
 *    different concept from this tab's sandbox and must not stack on top of
 *    it — hence `honorSessionScenario: false`.
 * 5. Sandbox drafts (salary/bonus edits, budget item edits) are keyed by
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
  getAllCategories,
} from "@/lib/config/account-types";
import type { AccountCategory } from "@/lib/config/account-types";
import { usePersistedSetting } from "@/lib/hooks/use-persisted-setting";
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
import {
  useBudgetDerivedData,
  type SavingsGoalEntry,
} from "./use-budget-derived-data";
import { WhatIfPaycheckSummary } from "./what-if-paycheck-summary";

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
      <span className="text-xs text-muted">{label}:</span>
      <select
        className="text-xs border rounded px-2 py-1 bg-surface-primary"
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
        <span className="text-caption text-amber-600 font-medium">{note}</span>
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
    <section className="rounded-lg border border-default bg-surface-sunken/40 p-4">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="flex items-start gap-2.5 text-left"
          aria-expanded={expanded}
        >
          <span className="flex-shrink-0 w-5 h-5 rounded-full bg-blue-600 text-white text-micro font-semibold flex items-center justify-center mt-0.5">
            {number}
          </span>
          <div>
            <h3 className="text-sm font-semibold text-primary leading-tight flex items-center gap-1">
              {title}
              {expanded ? (
                <ChevronDown className="w-3.5 h-3.5 text-faint" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5 text-faint" />
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

/** A hand-added hypothetical deduction — `localId` is a client-only key
 *  (negative, never collides with a real DB id) for React list identity
 *  and removal; it is never sent to the server. */
type DeductionAddition = {
  localId: number;
  personId: number;
  name: string;
  amountPerPeriod: number;
  isPretax: boolean;
};

/** A hand-added hypothetical contribution account — same localId contract
 *  as DeductionAddition. */
type ContribAddition = {
  localId: number;
  personId: number;
  accountType: AccountCategory;
  contributionMethod: "percent_of_salary" | "fixed_annual";
  contributionValue: string;
};

/** Every account category the app supports — same source
 *  ContributionProfileManager and every other picker use, so a new category
 *  added to the config shows up here automatically. */
const SANDBOX_ACCOUNT_TYPES = getAllCategories();

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
  const [contribOverrides, setContribOverrides] = useState<Map<number, string>>(
    new Map(),
  );
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

  const setContribOverride = (accountId: number, contributionValue: string) =>
    setContribOverrides((prev) =>
      new Map(prev).set(accountId, contributionValue),
    );
  const resetContribOverride = (accountId: number) =>
    setContribOverrides((prev) => {
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
    setContribOverrides(new Map());
    setContribAdditions([]);
  };

  const itemAmountOverrides = useMemo(
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
        .map(({ personId, name, amountPerPeriod, isPretax }) => ({
          personId,
          name,
          amountPerPeriod,
          isPretax,
        })),
    [deductionAdditions],
  );

  const sandboxContribOverrides = useMemo(() => {
    const out: Record<string, { contributionValue: string }> = {};
    for (const [accountId, contributionValue] of contribOverrides) {
      out[String(accountId)] = { contributionValue };
    }
    return out;
  }, [contribOverrides]);

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
    itemAmountOverrides,
    deductionEdits,
    setDeductionEdit,
    resetDeductionEdit,
    deductionAdditions,
    addDeduction,
    updateDeductionAddition,
    removeDeductionAddition,
    sandboxDeductionEdits,
    sandboxDeductionAdditions,
    contribOverrides,
    setContribOverride,
    resetContribOverride,
    sandboxContribOverrides,
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
      contribOverrides.size > 0 ||
      contribAdditions.length > 0,
  };
}

/**
 * A numeric cell pre-filled with the live/resolved value that pins on
 * change — the SAME interaction the real Salary Profile tab uses
 * (`PinnedNumberCell` in salary-profile-manager.tsx), not a blank field
 * with a "live" placeholder. This app already killed the idea of an
 * unfilled "follows job" field once; a placeholder that says "live" is
 * that same idea wearing different clothes, and it's what a user actually
 * hit and got confused by.
 */
function WhatIfPinnedCell({
  liveValue,
  pinnedValue,
  onCommit,
  onReset,
  step,
  width = "w-24",
}: {
  liveValue: number;
  pinnedValue: number | undefined;
  onCommit: (value: number) => void;
  onReset: () => void;
  step?: string;
  width?: string;
}) {
  const isPinned = pinnedValue !== undefined;
  const shown = isPinned ? pinnedValue : liveValue;
  return (
    <div className="flex items-center justify-end gap-1">
      <input
        type="number"
        step={step}
        value={shown}
        onChange={(e) => {
          const n = parseFloat(e.target.value);
          if (!isNaN(n)) onCommit(n);
        }}
        title={
          isPinned
            ? `Pinned for this preview. Live value: ${liveValue}`
            : "Follows the picked Salary Profile / job record"
        }
        className={`${width} px-1.5 py-0.5 text-xs text-right border rounded bg-surface-primary tabular-nums ${
          isPinned
            ? "text-amber-600 font-medium border-amber-400"
            : "text-secondary"
        }`}
      />
      <button
        type="button"
        onClick={onReset}
        disabled={!isPinned}
        title={isPinned ? "Reset to the live value" : "Already live"}
        className="text-caption text-faint hover:text-blue-600 disabled:opacity-0 disabled:cursor-default w-3.5 shrink-0"
      >
        ↺
      </button>
    </div>
  );
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
    <table className="w-full text-xs border-collapse">
      <thead>
        <tr className="border-b-2 border-strong">
          <th className="text-left py-2 pl-4 pr-3 text-muted font-medium">
            Person
          </th>
          <th className="text-right py-2 px-3 text-muted font-medium w-32">
            Salary
          </th>
          <th className="text-right py-2 px-3 text-muted font-medium w-24">
            Bonus %
          </th>
          <th className="text-right py-2 px-3 text-muted font-medium w-24">
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
              className={`border-b border-subtle hover:bg-blue-50/60 transition-colors ${
                rowIdx % 2 === 1 ? "bg-surface-sunken/60" : "bg-surface-primary"
              }`}
            >
              <td className="py-1.5 pl-4 pr-3 text-secondary">
                {v.person.name}
              </td>
              <td className="py-1.5 px-3 text-right">
                <WhatIfPinnedCell
                  liveValue={v.salary}
                  pinnedValue={entry.salary}
                  onCommit={(n) => onChange(v.person.id, "salary", n)}
                  onReset={() => onChange(v.person.id, "salary", undefined)}
                  step="1000"
                  width="w-28"
                />
              </td>
              <td className="py-1.5 px-3 text-right">
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
              <td className="py-1.5 px-3 text-right">
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

/**
 * Per-person deductions editor — existing deductions pin-editable the same
 * way salary/bonus fields do (pre-filled with the real stored amount,
 * pinning on change); additions are new hypothetical rows with no DB row,
 * removable, feeding `sandboxDeductionAdditions`. Both flow into a REAL
 * `paycheck.computeSummary` recompute, not a client-side estimate.
 */
function WhatIfDeductionsEditor({
  views,
  deductionEdits,
  onEditDeduction,
  onResetDeduction,
  additions,
  onAddDeduction,
  onUpdateAddition,
  onRemoveAddition,
  canManagePaycheck,
  onMakeReal,
  makeRealPendingId,
}: {
  views: PaycheckPersonView[];
  deductionEdits: Map<number, number>;
  onEditDeduction: (id: number, amountPerPeriod: number) => void;
  onResetDeduction: (id: number) => void;
  additions: DeductionAddition[];
  onAddDeduction: (personId: number) => void;
  onUpdateAddition: (
    localId: number,
    patch: Partial<Omit<DeductionAddition, "localId" | "personId">>,
  ) => void;
  onRemoveAddition: (localId: number) => void;
  /** `settings.deductions.create` is admin-gated — only admins see the
   *  "Make this real" affordance. */
  canManagePaycheck: boolean;
  onMakeReal: (addition: DeductionAddition, jobId: number) => void;
  makeRealPendingId: number | null;
}) {
  const [expanded, setExpanded] = useState(true);

  if (views.length === 0) return null;

  if (!expanded) {
    const totalDeductions = views.reduce(
      (s, v) => s + v.rawDeductions.length,
      0,
    );
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="text-caption text-blue-500 hover:text-blue-700 font-medium"
      >
        Edit deductions ({totalDeductions} total) ▸
      </button>
    );
  }

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => setExpanded(false)}
        className="text-caption text-blue-500 hover:text-blue-700 font-medium"
      >
        ▾ Deductions
      </button>
      {views.map((v) => {
        const personAdditions = additions.filter(
          (a) => a.personId === v.person.id,
        );
        return (
          <div key={v.person.id}>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-caption font-semibold text-muted">
                {v.person.name}&rsquo;s deductions
              </span>
              <button
                type="button"
                onClick={() => onAddDeduction(v.person.id)}
                className="text-caption text-blue-500 hover:text-blue-700 font-medium"
              >
                + Add deduction
              </button>
            </div>
            {v.rawDeductions.length === 0 && personAdditions.length === 0 ? (
              <p className="text-caption text-faint italic pl-2">None</p>
            ) : (
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="border-b border-subtle">
                    <th className="text-left py-1 pl-4 pr-3 text-muted font-medium">
                      Name
                    </th>
                    <th className="text-right py-1 px-3 text-muted font-medium w-32">
                      $/period
                    </th>
                    <th className="text-left py-1 px-3 text-muted font-medium w-24">
                      Treatment
                    </th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody>
                  {v.rawDeductions.map((d, rowIdx) => (
                    <tr
                      key={d.id}
                      className={`border-b border-subtle ${rowIdx % 2 === 1 ? "bg-surface-sunken/60" : "bg-surface-primary"}`}
                    >
                      <td className="py-1 pl-4 pr-3 text-secondary">
                        {d.deductionName}
                      </td>
                      <td className="py-1 px-3 text-right">
                        <WhatIfPinnedCell
                          liveValue={parseFloat(d.amountPerPeriod)}
                          pinnedValue={deductionEdits.get(d.id)}
                          onCommit={(n) => onEditDeduction(d.id, n)}
                          onReset={() => onResetDeduction(d.id)}
                          step="10"
                          width="w-24"
                        />
                      </td>
                      <td className="py-1 px-3 text-faint">
                        {d.isPretax ? "Pre-tax" : "Post-tax"}
                      </td>
                      <td />
                    </tr>
                  ))}
                  {personAdditions.map((a, rowIdx) => (
                    <tr
                      key={a.localId}
                      className={`border-b border-subtle ${(v.rawDeductions.length + rowIdx) % 2 === 1 ? "bg-surface-sunken/60" : "bg-surface-primary"}`}
                    >
                      <td className="py-1 pl-4 pr-3">
                        <input
                          type="text"
                          value={a.name}
                          onChange={(e) =>
                            onUpdateAddition(a.localId, {
                              name: e.target.value,
                            })
                          }
                          className="w-full text-xs border rounded px-1.5 py-0.5 bg-surface-primary text-amber-600 font-medium border-amber-400"
                        />
                      </td>
                      <td className="py-1 px-3 text-right">
                        <input
                          type="number"
                          step="10"
                          value={a.amountPerPeriod}
                          onChange={(e) =>
                            onUpdateAddition(a.localId, {
                              amountPerPeriod: parseFloat(e.target.value) || 0,
                            })
                          }
                          className="w-24 text-xs text-right border rounded px-1.5 py-0.5 bg-surface-primary text-amber-600 font-medium border-amber-400 tabular-nums"
                        />
                      </td>
                      <td className="py-1 px-3">
                        <select
                          value={a.isPretax ? "pre" : "post"}
                          onChange={(e) =>
                            onUpdateAddition(a.localId, {
                              isPretax: e.target.value === "pre",
                            })
                          }
                          className="text-xs border rounded px-1 py-0.5 bg-surface-primary"
                        >
                          <option value="pre">Pre-tax</option>
                          <option value="post">Post-tax</option>
                        </select>
                      </td>
                      <td className="py-1 px-1">
                        <div className="flex items-center gap-2 whitespace-nowrap">
                          {canManagePaycheck && v.job && (
                            <button
                              type="button"
                              disabled={makeRealPendingId === a.localId}
                              onClick={() => onMakeReal(a, v.job.id)}
                              className="text-caption text-blue-500 hover:text-blue-700 font-medium disabled:opacity-50"
                              title="Add this as a real paycheck deduction"
                            >
                              {makeRealPendingId === a.localId
                                ? "Saving…"
                                : "Make real"}
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => onRemoveAddition(a.localId)}
                            className="text-red-400 hover:text-red-600 text-caption"
                            title="Remove"
                          >
                            ×
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Per-person contribution accounts editor — same pin-editable pattern as
 * salary/deductions: pre-filled with the resolved current value, pinning on
 * change, ↺ to reset. Feeds `sandboxContribOverrides`, applied server-side
 * via the SAME `applyContribActiveFields` merge a Contribution Profile's own
 * active fields go through — one more layer, not a parallel mechanism. Value is
 * NOT percent/100 converted: `percent_of_salary` stores the raw percent
 * number (5 = 5%), matching how ContributionProfileManager already displays
 * it (`value%`), not a fraction like bonusPercent uses.
 */
function WhatIfContributionsEditor({
  views,
  overrides,
  onEdit,
  onReset,
  additions,
  onAddAccount,
  onUpdateAddition,
  onRemoveAddition,
  canManagePaycheck,
  onMakeReal,
  makeRealPendingId,
}: {
  views: PaycheckPersonView[];
  overrides: Map<number, string>;
  onEdit: (accountId: number, contributionValue: string) => void;
  onReset: (accountId: number) => void;
  additions: ContribAddition[];
  onAddAccount: (personId: number) => void;
  onUpdateAddition: (
    localId: number,
    patch: Partial<Omit<ContribAddition, "localId" | "personId">>,
  ) => void;
  onRemoveAddition: (localId: number) => void;
  /** `settings.contributionAccounts.create` is admin-gated — only admins
   *  see the "Make this real" affordance. */
  canManagePaycheck: boolean;
  onMakeReal: (addition: ContribAddition) => void;
  makeRealPendingId: number | null;
}) {
  const [expanded, setExpanded] = useState(true);

  if (views.length === 0) return null;

  const totalAccounts = views.reduce((s, v) => s + v.rawContribs.length, 0);

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="text-caption text-blue-500 hover:text-blue-700 font-medium"
      >
        Edit contribution accounts ({totalAccounts} total) ▸
      </button>
    );
  }

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => setExpanded(false)}
        className="text-caption text-blue-500 hover:text-blue-700 font-medium"
      >
        ▾ Contribution accounts
      </button>
      {views.map((v) => {
        const personAdditions = additions.filter(
          (a) => a.personId === v.person.id,
        );
        return (
          <div key={v.person.id}>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-caption font-semibold text-muted">
                {v.person.name}&rsquo;s accounts
              </span>
              <button
                type="button"
                onClick={() => onAddAccount(v.person.id)}
                className="text-caption text-blue-500 hover:text-blue-700 font-medium"
              >
                + Add account
              </button>
            </div>
            {v.rawContribs.length === 0 && personAdditions.length === 0 ? (
              <p className="text-caption text-faint italic pl-2">None</p>
            ) : (
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="border-b border-subtle">
                    <th className="text-left py-1 pl-4 pr-3 text-muted font-medium">
                      Account
                    </th>
                    <th className="text-right py-1 px-3 text-muted font-medium w-32">
                      Value
                    </th>
                    <th className="w-24" />
                  </tr>
                </thead>
                <tbody>
                  {v.rawContribs.map((c, rowIdx) => {
                    const isPercent =
                      c.contributionMethod === "percent_of_salary";
                    const liveValue = parseFloat(c.contributionValue);
                    const override = overrides.get(c.id);
                    return (
                      <tr
                        key={c.id}
                        className={`border-b border-subtle ${rowIdx % 2 === 1 ? "bg-surface-sunken/60" : "bg-surface-primary"}`}
                      >
                        <td className="py-1 pl-4 pr-3 text-secondary">
                          {accountDisplayName(
                            { ...c, ownershipType: c.ownership },
                            v.person.name,
                          )}
                        </td>
                        <td className="py-1 px-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <span className="text-faint w-3 text-right shrink-0">
                              {isPercent ? "" : "$"}
                            </span>
                            <WhatIfPinnedCell
                              liveValue={liveValue}
                              pinnedValue={
                                override !== undefined
                                  ? parseFloat(override)
                                  : undefined
                              }
                              onCommit={(n) => onEdit(c.id, String(n))}
                              onReset={() => onReset(c.id)}
                              step={isPercent ? "0.5" : "10"}
                              width="w-20"
                            />
                            <span className="text-faint w-3 text-left shrink-0">
                              {isPercent ? "%" : ""}
                            </span>
                          </div>
                        </td>
                        <td />
                      </tr>
                    );
                  })}
                  {personAdditions.map((a, rowIdx) => {
                    const isPercent =
                      a.contributionMethod === "percent_of_salary";
                    return (
                      <tr
                        key={a.localId}
                        className={`border-b border-subtle ${(v.rawContribs.length + rowIdx) % 2 === 1 ? "bg-surface-sunken/60" : "bg-surface-primary"}`}
                      >
                        <td className="py-1 pl-4 pr-3">
                          <div className="flex items-center gap-1">
                            <select
                              value={a.accountType}
                              onChange={(e) =>
                                onUpdateAddition(a.localId, {
                                  accountType: e.target
                                    .value as AccountCategory,
                                })
                              }
                              className="text-xs border rounded px-1 py-0.5 bg-surface-primary text-amber-600 font-medium border-amber-400"
                            >
                              {SANDBOX_ACCOUNT_TYPES.map((t) => (
                                <option key={t} value={t}>
                                  {t}
                                </option>
                              ))}
                            </select>
                            <select
                              value={a.contributionMethod}
                              onChange={(e) =>
                                onUpdateAddition(a.localId, {
                                  contributionMethod: e.target.value as
                                    "percent_of_salary" | "fixed_annual",
                                })
                              }
                              className="text-xs border rounded px-1 py-0.5 bg-surface-primary"
                            >
                              <option value="percent_of_salary">%</option>
                              <option value="fixed_annual">$/yr</option>
                            </select>
                          </div>
                        </td>
                        <td className="py-1 px-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <span className="text-faint w-3 text-right shrink-0">
                              {isPercent ? "" : "$"}
                            </span>
                            <input
                              type="number"
                              step={isPercent ? "0.5" : "10"}
                              value={a.contributionValue}
                              onChange={(e) =>
                                onUpdateAddition(a.localId, {
                                  contributionValue: e.target.value,
                                })
                              }
                              className="w-20 text-xs text-right border rounded px-1.5 py-0.5 bg-surface-primary text-amber-600 font-medium border-amber-400 tabular-nums"
                            />
                            <span className="text-faint w-3 text-left shrink-0">
                              {isPercent ? "%" : ""}
                            </span>
                          </div>
                        </td>
                        <td className="py-1 px-1">
                          <div className="flex items-center gap-2 whitespace-nowrap justify-end">
                            {canManagePaycheck && (
                              <button
                                type="button"
                                disabled={makeRealPendingId === a.localId}
                                onClick={() => onMakeReal(a)}
                                className="text-caption text-blue-500 hover:text-blue-700 font-medium disabled:opacity-50"
                                title="Add this as a real contribution account"
                              >
                                {makeRealPendingId === a.localId
                                  ? "Saving…"
                                  : "Make real"}
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => onRemoveAddition(a.localId)}
                              className="text-red-400 hover:text-red-600 text-caption"
                              title="Remove"
                            >
                              ×
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        );
      })}
    </div>
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

  // ── Profile lists + defaults (Plan pins first, then globally-active) ──
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
  const { profileId: defaultContribId, planPinId: planContribProfileId } =
    useEffectiveProfileId("contribution", {
      validIds: contribProfiles?.map((p) => p.id),
      localSelection: null,
      globalDefaultId: activeContribSetting,
    });
  const { profileId: defaultSalaryId, planPinId: planSalaryProfileId } =
    useEffectiveProfileId("salary", {
      validIds: salaryProfiles?.map((p) => p.id),
      localSelection: null,
      globalDefaultId: activeSalarySetting,
    });

  // ── The three local pickers (plain state; null = "use the default") ──
  const [pickedBudgetId, setPickedBudgetId] = useState<number | null>(null);
  const [pickedContribId, setPickedContribId] = useState<number | null>(null);
  const [pickedSalaryId, setPickedSalaryId] = useState<number | null>(null);

  const budgetId = pickedBudgetId ?? defaultBudgetId;
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
    // A session scenario must not silently stack on top of the tab's picks.
    honorSessionScenario: false,
    sandboxSalaryEntries: sandbox.salaryEntries,
    sandboxDeductionEdits: sandbox.sandboxDeductionEdits,
    sandboxDeductionAdditions: sandbox.sandboxDeductionAdditions,
    sandboxContribOverrides: sandbox.sandboxContribOverrides,
    sandboxContribAdditions: sandbox.sandboxContribAdditions,
  });

  // ── Budget panel ──
  // The tab's picks go into the LOCAL SELECTION tier of the documented
  // precedence — the tier that already exists for exactly this "page-level
  // preview" purpose. It is not a new tier and it does not outrank a Plan
  // pin: if a Plan is active, its pin still wins, same as every other
  // page-local selector in the app. The note below surfaces that when it
  // actually happens.
  const contributionProfileTiers = useMemo(
    () => ({
      planPinId: planContribProfileId,
      localSelectionId: contribId,
      globalDefaultId: activeContribSetting,
    }),
    [planContribProfileId, contribId, activeContribSetting],
  );
  const salaryProfileTiers = useMemo(
    () => ({
      planPinId: planSalaryProfileId,
      localSelectionId: salaryId,
      globalDefaultId: activeSalarySetting,
    }),
    [planSalaryProfileId, salaryId, activeSalarySetting],
  );

  const [activeColumn, setActiveColumn] = useState(0);
  const { data: budgetData } = trpc.budget.computeActiveSummary.useQuery(
    {
      selectedColumn: activeColumn,
      contributionProfile: contributionProfileTiers,
      salaryProfile: salaryProfileTiers,
      ...(budgetId != null ? { profileId: budgetId } : {}),
      ...(Object.keys(sandbox.salaryEntries).length > 0
        ? { sandboxSalaryEntries: sandbox.salaryEntries }
        : {}),
      ...(sandbox.itemAmountOverrides.length > 0
        ? { itemAmountOverrides: sandbox.itemAmountOverrides }
        : {}),
      ...(sandbox.sandboxDeductionEdits.length > 0
        ? { sandboxDeductionEdits: sandbox.sandboxDeductionEdits }
        : {}),
      ...(sandbox.sandboxDeductionAdditions.length > 0
        ? { sandboxDeductionAdditions: sandbox.sandboxDeductionAdditions }
        : {}),
      ...(Object.keys(sandbox.sandboxContribOverrides).length > 0
        ? { sandboxContribOverrides: sandbox.sandboxContribOverrides }
        : {}),
      ...(sandbox.sandboxContribAdditions.length > 0
        ? { sandboxContribAdditions: sandbox.sandboxContribAdditions }
        : {}),
    },
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
    salaryActiveFields: [],
    contributionProfileTiers,
    salaryProfileTiers,
    editMode: true,
    getDraft: sandbox.getDraft,
    // No pagination in the sandbox — a "load more" sentinel that never
    // triggers (no scroll container to observe) would just hide categories.
    visibleCount: 9999,
  });

  // Columns whose resolved Contribution/Salary Profile differs from what the
  // tab's own picker shows — i.e. a Plan pin or a column pin outranks the
  // preview tier for that column.
  const overriddenColumns = useMemo(() => {
    const contribByCol =
      budgetData && "contribProfileIdByColumn" in budgetData
        ? budgetData.contribProfileIdByColumn
        : [];
    const salaryByCol =
      budgetData && "salaryProfileIdByColumn" in budgetData
        ? budgetData.salaryProfileIdByColumn
        : [];
    const out: string[] = [];
    for (let i = 0; i < cols.length; i++) {
      const parts: string[] = [];
      if (contribByCol[i] != null && contribByCol[i] !== contribId) {
        const name =
          contribProfiles?.find((p) => p.id === contribByCol[i])?.name ??
          `#${contribByCol[i]}`;
        parts.push(`Contribution: ${name}`);
      }
      if (salaryByCol[i] != null && salaryByCol[i] !== salaryId) {
        const name =
          salaryProfiles?.find((p) => p.id === salaryByCol[i])?.name ??
          `#${salaryByCol[i]}`;
        parts.push(`Salary: ${name}`);
      }
      if (parts.length > 0) out.push(`${cols[i]} → ${parts.join(", ")}`);
    }
    return out;
  }, [budgetData, cols, contribId, salaryId, contribProfiles, salaryProfiles]);

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
  const deductionMakeRealAdditionRef = useRef<number | null>(null);
  const createDeduction = trpc.settings.deductions.create.useMutation({
    onSuccess: (created) => {
      utils.paycheck.invalidate();
      const localId = deductionMakeRealAdditionRef.current;
      if (localId != null) sandbox.removeDeductionAddition(localId);
      setDeductionMakeRealPendingId(null);
      toast.success(`Added "${created?.deductionName ?? ""}" to the paycheck`);
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
    deductionMakeRealAdditionRef.current = addition.localId;
    setDeductionMakeRealPendingId(addition.localId);
    createDeduction.mutate({
      jobId,
      deductionName: addition.name,
      amountPerPeriod: addition.amountPerPeriod.toFixed(2),
      isPretax: addition.isPretax,
      ficaExempt: false,
    });
  };

  const [contribMakeRealPendingId, setContribMakeRealPendingId] = useState<
    number | null
  >(null);
  const contribMakeRealAdditionRef = useRef<number | null>(null);
  const createContribAccount =
    trpc.settings.contributionAccounts.create.useMutation({
      onSuccess: (created) => {
        utils.contribution.invalidate();
        utils.paycheck.invalidate();
        const localId = contribMakeRealAdditionRef.current;
        if (localId != null) sandbox.removeContribAddition(localId);
        setContribMakeRealPendingId(null);
        toast.success(
          `Added "${created ? accountDisplayName(created) : ""}" account to Contribution Profiles`,
        );
      },
      onError: (err) => {
        setContribMakeRealPendingId(null);
        toast.error(err.message || "Failed to add contribution account");
      },
    });
  const handleMakeContribReal = (addition: ContribAddition) => {
    contribMakeRealAdditionRef.current = addition.localId;
    setContribMakeRealPendingId(addition.localId);
    createContribAccount.mutate({
      jobId: null,
      personId: addition.personId,
      accountType: addition.accountType,
      parentCategory: getParentCategory(addition.accountType),
      taxTreatment: getDefaultTaxTreatment(addition.accountType) as
        "pre_tax" | "tax_free" | "after_tax" | "hsa",
      contributionMethod: addition.contributionMethod,
      contributionValue: addition.contributionValue,
      employerMatchType: "none",
    });
  };

  const budgetProfileName =
    budgetProfiles?.find((p) => p.id === budgetId)?.name ?? "";
  const contribProfileName =
    contribProfiles?.find((p) => p.id === contribId)?.name ?? null;

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
  const planLabel = createPlan.isPending
    ? "Saving…"
    : salaryEditCount > 0
      ? "Save as Plan (with your salary edits)"
      : "Save as Plan";

  return (
    <div className="space-y-5">
      {/* ── Pickers ── */}
      <div className="rounded-lg border border-default bg-surface-sunken/40 px-4 py-3">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <span className="text-xs font-semibold text-muted uppercase tracking-wide">
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
              <span className="text-xs text-muted">Tax Year:</span>
              <div className="flex gap-1">
                {availableYears.map((year) => (
                  <button
                    key={year}
                    type="button"
                    onClick={() => setTaxYear(year)}
                    className={`px-2 py-0.5 text-xs rounded-full transition-colors ${
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
              className="ml-auto text-caption text-faint hover:text-red-600"
            >
              Reset sandbox
            </button>
          )}
        </div>
        {overriddenColumns.length > 0 && (
          <div className="text-caption text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2 mt-2">
            <span className="font-semibold">Pinned elsewhere: </span>
            some budget modes resolve to a different profile than the picks
            above, because an active Plan&rsquo;s pin or the mode&rsquo;s own
            pin outranks a page-level preview (see Profile Pins in the docs).
            <ul className="mt-1 list-disc list-inside">
              {overriddenColumns.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* ── Step 1: Salary/bonus edits ── */}
      <WhatIfStep
        number={1}
        title="Paycheck"
        description="Edit salary, bonus, or deductions to see the resulting take-home pay."
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
            <WhatIfPaycheckSummary views={views} />
          </div>
        )}
      </WhatIfStep>

      {/* ── Step 2: Contribution accounts ── */}
      <WhatIfStep
        number={2}
        title={`Contributions${contribProfileName ? ` — ${contribProfileName}` : ""}`}
        description="What you and your employer put toward retirement/savings accounts."
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
            overrides={sandbox.contribOverrides}
            onEdit={sandbox.setContribOverride}
            onReset={sandbox.resetContribOverride}
            additions={sandbox.contribAdditions}
            onAddAccount={sandbox.addContribAddition}
            onUpdateAddition={sandbox.updateContribAddition}
            onRemoveAddition={sandbox.removeContribAddition}
            canManagePaycheck={canManagePaycheck}
            onMakeReal={handleMakeContribReal}
            makeRealPendingId={contribMakeRealPendingId}
          />
        )}
      </WhatIfStep>

      {/* ── Step 3: Budget vs. net income ── */}
      <WhatIfStep
        number={3}
        title={`Budget${budgetProfileName ? ` — ${budgetProfileName}` : ""}`}
        description="Edit any amount to see whether take-home pay covers it."
        headerExtra={
          <div className="flex items-center gap-3 flex-wrap">
            {cols.length > 1 && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted">Mode:</span>
                <div className="flex gap-1">
                  {cols.map((label, idx) => (
                    <button
                      key={label}
                      type="button"
                      onClick={() => setActiveColumn(idx)}
                      className={`px-2 py-0.5 text-xs rounded-full transition-colors ${
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
            className={`flex items-center justify-between text-xs font-semibold rounded-md px-3 py-2 mb-3 ${
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
        {allColumnResults && allColumnResults.length > 0 ? (
          <div className="max-h-[520px] w-full overflow-y-auto rounded-md border border-subtle">
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
        <section className="rounded-lg border border-default bg-surface-sunken/40 p-4 space-y-3">
          <h3 className="text-sm font-semibold text-primary">Keep this</h3>
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
                className="text-xs border rounded px-2 py-1 bg-surface-primary w-56"
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
                    ...(sandbox.itemAmountOverrides.length > 0
                      ? { itemAmountOverrides: sandbox.itemAmountOverrides }
                      : {}),
                  })
                }
                className="px-2.5 py-1 text-xs rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
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
                className="text-xs border rounded px-2 py-1 bg-surface-primary w-56"
                aria-label="New Plan name"
              />
              <button
                type="button"
                disabled={!planName.trim() || createPlan.isPending}
                onClick={() => {
                  const peopleOverrides = Object.fromEntries(
                    Object.entries(sandbox.salaryEntries)
                      .filter(
                        (entry): entry is [string, { salary: number }] =>
                          entry[1].salary !== undefined,
                      )
                      .map(([personId, e]) => [personId, { salary: e.salary }]),
                  );
                  const overrides =
                    Object.keys(peopleOverrides).length > 0
                      ? { people: peopleOverrides }
                      : ({} as Record<
                          string,
                          Record<string, Record<string, number>>
                        >);
                  createPlan.mutate({
                    name: planName.trim(),
                    overrides,
                    budgetProfileId: budgetId,
                    contributionProfileId: contribId,
                    salaryProfileId: salaryId,
                  });
                }}
                className="px-2.5 py-1 text-xs rounded border hover:bg-surface-sunken"
              >
                {planLabel}
              </button>
              <span className="text-caption text-faint">
                Pins these three profiles to a new Plan you can switch to from
                the top bar.
                {salaryEditCount > 0 && (
                  <>
                    {" "}
                    Salary edits carry over; bonus-term edits don&rsquo;t — pin
                    those on a Salary Profile instead.
                  </>
                )}
              </span>
              <FormError error={createPlan.error} prefix="Failed" />
            </div>
          )}
        </section>
      )}
    </div>
  );
}
