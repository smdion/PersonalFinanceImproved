import { useMemo, useRef, useState } from "react";
import { getAllCategories } from "@/lib/config/account-types";
import { type SandboxSalaryEntries } from "@/lib/hooks/use-paycheck-person-views";
import {
  type ContributionAddition,
  type DeductionAddition,
} from "./what-if-editors";
import { type SandboxSalaryEntry } from "./what-if-salary-editor";

/**
 * Sandbox-local edit state: salary/bonus entries, deduction edits/
 * additions, and budget item amount drafts. None of it is ever persisted —
 * see what-if-tab.tsx's docblock point 4 for why the profile-scoped pieces (salary
 * entries, budget drafts) reset when their owning picker changes. Deduction
 * edits/additions are keyed by real deduction id / personId, which don't
 * change when a picker changes, so they persist until "Reset sandbox."
 */
export function useSandboxState(
  salaryId: number | null,
  budgetId: number | null,
) {
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
  const [contributionActiveFields, setContributionActiveFields] = useState<
    Map<number, string>
  >(new Map());
  const [contributionAdditions, setContributionAdditions] = useState<
    ContributionAddition[]
  >([]);
  const nextLocalId = useRef(-1);

  // A picker switch clears its drafts in the render that first sees the new
  // id (React's "adjust state when a prop changes"), not in an effect after
  // it, so no render pairs the new profile with the old profile's drafts.
  const [salaryDraftsFor, setSalaryDraftsFor] = useState(salaryId);
  if (salaryDraftsFor !== salaryId) {
    setSalaryDraftsFor(salaryId);
    setSalaryEntries({});
  }

  const [budgetDraftsFor, setBudgetDraftsFor] = useState(budgetId);
  if (budgetDraftsFor !== budgetId) {
    setBudgetDraftsFor(budgetId);
    setBudgetDrafts(new Map());
  }

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

  const setContributionActiveField = (
    accountId: number,
    contributionValue: string,
  ) =>
    setContributionActiveFields((prev) =>
      new Map(prev).set(accountId, contributionValue),
    );
  const resetContributionActiveField = (accountId: number) =>
    setContributionActiveFields((prev) => {
      const next = new Map(prev);
      next.delete(accountId);
      return next;
    });

  const addContributionAddition = (personId: number) => {
    const localId = nextLocalId.current--;
    setContributionAdditions((prev) => [
      ...prev,
      {
        localId,
        personId,
        accountType: getAllCategories()[0]!,
        contributionMethod: "percent_of_salary",
        contributionValue: "0",
      },
    ]);
  };
  const updateContributionAddition = (
    localId: number,
    patch: Partial<Omit<ContributionAddition, "localId" | "personId">>,
  ) =>
    setContributionAdditions((prev) =>
      prev.map((c) => (c.localId === localId ? { ...c, ...patch } : c)),
    );
  const removeContributionAddition = (localId: number) =>
    setContributionAdditions((prev) =>
      prev.filter((c) => c.localId !== localId),
    );

  const resetSandbox = () => {
    setSalaryEntries({});
    setBudgetDrafts(new Map());
    setDeductionEdits(new Map());
    setDeductionAdditions([]);
    setContributionActiveFields(new Map());
    setContributionAdditions([]);
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
    for (const [accountId, contributionValue] of contributionActiveFields) {
      out[String(accountId)] = { contributionValue };
    }
    return out;
  }, [contributionActiveFields]);

  const sandboxContribAdditions = useMemo(
    () =>
      contributionAdditions
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
    [contributionAdditions],
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
    contributionActiveFields,
    setContributionActiveField,
    resetContributionActiveField,
    sandboxContribActiveFields,
    contributionAdditions,
    addContributionAddition,
    updateContributionAddition,
    removeContributionAddition,
    sandboxContribAdditions,
    resetSandbox,
    hasEdits:
      Object.keys(salaryEntries).length > 0 ||
      budgetDrafts.size > 0 ||
      deductionEdits.size > 0 ||
      deductionAdditions.length > 0 ||
      contributionActiveFields.size > 0 ||
      contributionAdditions.length > 0,
  };
}
