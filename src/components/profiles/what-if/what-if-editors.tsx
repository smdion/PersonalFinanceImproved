"use client";

/**
 * What-If per-person editors (deductions, contribution accounts): live rows
 * pin-editable, plus hypothetical rows. Only "Make real" writes (admin-gated).
 */
import { useState, type ReactNode } from "react";
import {
  DEDUCTION_PRESETS,
  deductionPresetFor,
} from "@/lib/config/paycheck-presets";
import { accountDisplayName } from "@/lib/utils/format";
import {
  getAllCategories,
  type AccountCategory,
} from "@/lib/config/account-types";
import type { PaycheckPersonView } from "@/lib/hooks/use-paycheck-person-views";

/** A hand-added hypothetical deduction — `localId` is a client-only key
 *  (negative, never collides with a real DB id) for React list identity
 *  and removal; it is never sent to the server. */
export type DeductionAddition = {
  localId: number;
  personId: number;
  name: string;
  amountPerPeriod: number;
  isPretax: boolean;
  ficaExempt: boolean;
};

/** A hand-added hypothetical contribution account — same localId contract
 *  as DeductionAddition. */
export type ContributionAddition = {
  localId: number;
  personId: number;
  accountType: AccountCategory;
  contributionMethod: "percent_of_salary" | "fixed_annual";
  contributionValue: string;
};

const LINK = "text-caption font-medium text-blue-500 hover:text-blue-700";
const AMBER_INPUT =
  "bg-surface-primary rounded border border-amber-400 px-1.5 py-0.5 text-xs font-medium text-amber-600";

/** Alternating row shade, counting live rows then added ones. */
const stripe = (i: number) =>
  `border-subtle border-b ${i % 2 === 1 ? "bg-surface-sunken/60" : "bg-surface-primary"}`;

/** "▾ Title" over its contents; collapsed, one "Edit … (n total) ▸" link. */
function EditorSection({
  title,
  collapsedLabel,
  children,
}: {
  title: string;
  collapsedLabel: string;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(true);
  if (!expanded) {
    return (
      <button type="button" onClick={() => setExpanded(true)} className={LINK}>
        {collapsedLabel} ▸
      </button>
    );
  }
  return (
    <div className="space-y-3">
      <button type="button" onClick={() => setExpanded(false)} className={LINK}>
        ▾ {title}
      </button>
      {children}
    </div>
  );
}

/** One person's block: heading, "+ Add …", then their rows (or "None"). */
function PersonTable({
  heading,
  addLabel,
  onAdd,
  empty,
  head,
  children,
}: {
  heading: string;
  addLabel: string;
  onAdd: () => void;
  empty: boolean;
  /** The header row's cells. */
  head: ReactNode;
  children: ReactNode;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center gap-2">
        <span className="text-caption text-muted font-semibold">{heading}</span>
        <button type="button" onClick={onAdd} className={LINK}>
          {addLabel}
        </button>
      </div>
      {empty ? (
        <p className="text-caption text-faint pl-2 italic">None</p>
      ) : (
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="border-subtle border-b">{head}</tr>
          </thead>
          <tbody>{children}</tbody>
        </table>
      )}
    </div>
  );
}

/** An added row's actions: "Make real" (when allowed) and remove. */
function AdditionActions({
  onMakeReal,
  makeRealTitle,
  pending,
  onRemove,
}: {
  /** Absent = not offered (not an admin, or no job to add it to). */
  onMakeReal?: () => void;
  makeRealTitle: string;
  pending: boolean;
  onRemove: () => void;
}) {
  return (
    <td className="px-1 py-1">
      <div className="flex items-center justify-end gap-2 whitespace-nowrap">
        {onMakeReal && (
          <button
            type="button"
            disabled={pending}
            onClick={onMakeReal}
            className={`${LINK} disabled:opacity-50`}
            title={makeRealTitle}
          >
            {pending ? "Saving…" : "Make real"}
          </button>
        )}
        <button
          type="button"
          onClick={onRemove}
          className="text-caption text-red-400 hover:text-red-600"
          title="Remove"
        >
          ×
        </button>
      </div>
    </td>
  );
}

/**
 * Numeric cell pre-filled with the live value that pins on change, like
 * `PinnedNumberCell` on the Salary Profile tab (no blank "live" placeholder).
 */
export function WhatIfPinnedCell({
  liveValue,
  pinnedValue,
  onCommit,
  onReset,
  step,
  width = "w-24",
  label,
}: {
  liveValue: number;
  pinnedValue: number | undefined;
  onCommit: (value: number) => void;
  onReset: () => void;
  step?: string;
  width?: string;
  label?: string;
}) {
  const isPinned = pinnedValue !== undefined;
  const shown = isPinned ? pinnedValue : liveValue;
  return (
    <div className="flex items-center justify-end gap-1">
      <input
        aria-label={label}
        type="number"
        step={step}
        value={shown}
        onChange={(e) => {
          const n = parseFloat(e.target.value);
          if (!isNaN(n)) onCommit(n);
        }}
        title={
          isPinned
            ? `Fixed for this preview. Live value: ${liveValue}`
            : "Follows the picked Salary Profile / job record"
        }
        className={`${width} bg-surface-primary rounded border px-1.5 py-0.5 text-right text-xs tabular-nums ${
          isPinned
            ? "border-amber-400 font-medium text-amber-600"
            : "text-secondary"
        }`}
      />
      <button
        type="button"
        onClick={onReset}
        disabled={!isPinned}
        title={isPinned ? "Reset to the live value" : "Already live"}
        className="text-caption text-faint w-3.5 shrink-0 hover:text-blue-600 disabled:cursor-default disabled:opacity-0"
      >
        ↺
      </button>
    </div>
  );
}

/**
 * Per-person deductions: existing rows pin-editable, additions are removable
 * hypothetical rows. Both feed a real `paycheck.computeSummary` recompute.
 */
export function WhatIfDeductionsEditor({
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
  /** `paycheck.deductions.create` is admin-gated — only admins see the
   *  "Make this real" affordance. */
  canManagePaycheck: boolean;
  onMakeReal: (addition: DeductionAddition, jobId: number) => void;
  makeRealPendingId: number | null;
}) {
  if (views.length === 0) return null;
  const total = views.reduce((n, v) => n + v.rawDeductions.length, 0);
  return (
    <EditorSection
      title="Deductions"
      collapsedLabel={`Edit deductions (${total} total)`}
    >
      {views.map((v) => {
        const personAdditions = additions.filter(
          (a) => a.personId === v.person.id,
        );
        return (
          <PersonTable
            key={v.person.id}
            heading={`${v.person.name}’s deductions`}
            addLabel="+ Add deduction"
            onAdd={() => onAddDeduction(v.person.id)}
            empty={v.rawDeductions.length === 0 && personAdditions.length === 0}
            head={
              <>
                <th className="text-muted py-1 pr-3 pl-4 text-left font-medium">
                  Name
                </th>
                <th className="text-muted w-32 px-3 py-1 text-right font-medium">
                  $/period
                </th>
                <th className="text-muted w-24 px-3 py-1 text-left font-medium">
                  Treatment
                </th>
                <th className="w-8" />
              </>
            }
          >
            {v.rawDeductions.map((d, rowIndex) => (
              <tr key={d.id} className={stripe(rowIndex)}>
                <td className="text-secondary py-1 pr-3 pl-4">
                  {d.deductionName}
                </td>
                <td className="px-3 py-1 text-right">
                  <WhatIfPinnedCell
                    liveValue={parseFloat(d.amountPerPeriod)}
                    pinnedValue={deductionEdits.get(d.id)}
                    onCommit={(n) => onEditDeduction(d.id, n)}
                    onReset={() => onResetDeduction(d.id)}
                    label={`${d.deductionName} $/period`}
                    step="10"
                    width="w-24"
                  />
                </td>
                <td className="text-faint px-3 py-1">
                  {deductionPresetFor(d).short}
                </td>
                <td />
              </tr>
            ))}
            {personAdditions.map((a, rowIndex) => (
              <tr
                key={a.localId}
                className={stripe(v.rawDeductions.length + rowIndex)}
              >
                <td className="py-1 pr-3 pl-4">
                  <input
                    aria-label="New deduction name"
                    type="text"
                    value={a.name}
                    onChange={(e) =>
                      onUpdateAddition(a.localId, { name: e.target.value })
                    }
                    className={`${AMBER_INPUT} w-full`}
                  />
                </td>
                <td className="px-3 py-1 text-right">
                  <input
                    aria-label={`${a.name || "New deduction"} $/period`}
                    type="number"
                    step="10"
                    value={a.amountPerPeriod}
                    onChange={(e) =>
                      onUpdateAddition(a.localId, {
                        amountPerPeriod: parseFloat(e.target.value) || 0,
                      })
                    }
                    className={`${AMBER_INPUT} w-24 text-right tabular-nums`}
                  />
                </td>
                <td className="px-3 py-1">
                  <select
                    aria-label="How your pay stub lists it"
                    value={deductionPresetFor(a).key}
                    onChange={(e) => {
                      const p = DEDUCTION_PRESETS.find(
                        (x) => x.key === e.target.value,
                      );
                      if (p)
                        onUpdateAddition(a.localId, {
                          isPretax: p.isPretax,
                          ficaExempt: p.ficaExempt,
                        });
                    }}
                    className="bg-surface-primary rounded border px-1 py-0.5 text-xs"
                  >
                    {DEDUCTION_PRESETS.map((p) => (
                      <option key={p.key} value={p.key} title={p.label}>
                        {p.short}
                      </option>
                    ))}
                  </select>
                </td>
                <AdditionActions
                  onMakeReal={
                    canManagePaycheck && v.job
                      ? () => onMakeReal(a, v.job.id)
                      : undefined
                  }
                  makeRealTitle="Add this as a real paycheck deduction"
                  pending={makeRealPendingId === a.localId}
                  onRemove={() => onRemoveAddition(a.localId)}
                />
              </tr>
            ))}
          </PersonTable>
        );
      })}
    </EditorSection>
  );
}

/**
 * Per-person contribution accounts, pin-editable; feeds `sandboxContribActiveFields`
 * (merged server-side by `applyContribActiveFields`). `percent_of_salary` values
 * are raw percents (5 = 5%), not fractions.
 */
export function WhatIfContributionsEditor({
  views,
  activeFields,
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
  activeFields: Map<number, string>;
  onEdit: (accountId: number, contributionValue: string) => void;
  onReset: (accountId: number) => void;
  additions: ContributionAddition[];
  onAddAccount: (personId: number) => void;
  onUpdateAddition: (
    localId: number,
    patch: Partial<Omit<ContributionAddition, "localId" | "personId">>,
  ) => void;
  onRemoveAddition: (localId: number) => void;
  /** `contribution.accounts.create` is admin-gated — only admins
   *  see the "Make this real" affordance. */
  canManagePaycheck: boolean;
  onMakeReal: (addition: ContributionAddition) => void;
  makeRealPendingId: number | null;
}) {
  if (views.length === 0) return null;
  const total = views.reduce((n, v) => n + v.rawContribs.length, 0);
  /** "$" before / "%" after a value, by its method. */
  const affix = (isPercent: boolean, input: ReactNode) => (
    <div className="flex items-center justify-end gap-1">
      <span className="text-faint w-3 shrink-0 text-right">
        {isPercent ? "" : "$"}
      </span>
      {input}
      <span className="text-faint w-3 shrink-0 text-left">
        {isPercent ? "%" : ""}
      </span>
    </div>
  );
  return (
    <EditorSection
      title="Contribution accounts"
      collapsedLabel={`Edit contribution accounts (${total} total)`}
    >
      {views.map((v) => {
        const personAdditions = additions.filter(
          (a) => a.personId === v.person.id,
        );
        return (
          <PersonTable
            key={v.person.id}
            heading={`${v.person.name}’s accounts`}
            addLabel="+ Add account"
            onAdd={() => onAddAccount(v.person.id)}
            empty={v.rawContribs.length === 0 && personAdditions.length === 0}
            head={
              <>
                <th className="text-muted py-1 pr-3 pl-4 text-left font-medium">
                  Account
                </th>
                <th className="text-muted w-32 px-3 py-1 text-right font-medium">
                  Value
                </th>
                <th className="w-24" />
              </>
            }
          >
            {v.rawContribs.map((c, rowIndex) => {
              const isPercent = c.contributionMethod === "percent_of_salary";
              const activeField = activeFields.get(c.id);
              return (
                <tr key={c.id} className={stripe(rowIndex)}>
                  <td className="text-secondary py-1 pr-3 pl-4">
                    {accountDisplayName(
                      { ...c, ownershipType: c.ownership },
                      v.person.name,
                    )}
                  </td>
                  <td className="px-3 py-1 text-right">
                    {affix(
                      isPercent,
                      <WhatIfPinnedCell
                        liveValue={parseFloat(c.contributionValue)}
                        pinnedValue={
                          activeField !== undefined
                            ? parseFloat(activeField)
                            : undefined
                        }
                        onCommit={(n) => onEdit(c.id, String(n))}
                        onReset={() => onReset(c.id)}
                        step={isPercent ? "0.5" : "10"}
                        width="w-20"
                        label={`${accountDisplayName({ ...c, ownershipType: c.ownership }, v.person.name)} value`}
                      />,
                    )}
                  </td>
                  <td />
                </tr>
              );
            })}
            {personAdditions.map((a, rowIndex) => {
              const isPercent = a.contributionMethod === "percent_of_salary";
              return (
                <tr
                  key={a.localId}
                  className={stripe(v.rawContribs.length + rowIndex)}
                >
                  <td className="py-1 pr-3 pl-4">
                    <div className="flex items-center gap-1">
                      <select
                        aria-label="New contribution account type"
                        value={a.accountType}
                        onChange={(e) =>
                          onUpdateAddition(a.localId, {
                            accountType: e.target.value as AccountCategory,
                          })
                        }
                        className="bg-surface-primary rounded border border-amber-400 px-1 py-0.5 text-xs font-medium text-amber-600"
                      >
                        {getAllCategories().map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                      <select
                        aria-label="New contribution method"
                        value={a.contributionMethod}
                        onChange={(e) =>
                          onUpdateAddition(a.localId, {
                            contributionMethod: e.target.value as
                              "percent_of_salary" | "fixed_annual",
                          })
                        }
                        className="bg-surface-primary rounded border px-1 py-0.5 text-xs"
                      >
                        <option value="percent_of_salary">%</option>
                        <option value="fixed_annual">$/yr</option>
                      </select>
                    </div>
                  </td>
                  <td className="px-3 py-1 text-right">
                    {affix(
                      isPercent,
                      <input
                        aria-label="New contribution value"
                        type="number"
                        step={isPercent ? "0.5" : "10"}
                        value={a.contributionValue}
                        onChange={(e) =>
                          onUpdateAddition(a.localId, {
                            contributionValue: e.target.value,
                          })
                        }
                        className={`${AMBER_INPUT} w-20 text-right tabular-nums`}
                      />,
                    )}
                  </td>
                  <AdditionActions
                    onMakeReal={
                      canManagePaycheck ? () => onMakeReal(a) : undefined
                    }
                    makeRealTitle="Add this as a real contribution account"
                    pending={makeRealPendingId === a.localId}
                    onRemove={() => onRemoveAddition(a.localId)}
                  />
                </tr>
              );
            })}
          </PersonTable>
        );
      })}
    </EditorSection>
  );
}
