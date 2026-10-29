"use client";

/**
 * The What-If tab's per-person editors: deductions and contribution
 * accounts, each live row pin-editable (WhatIfPinnedCell) plus hand-added
 * hypothetical rows that an admin can "make real". Nothing here writes
 * except "Make real", which the tab wires to the admin-gated create.
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
export type ContribAddition = {
  localId: number;
  personId: number;
  accountType: AccountCategory;
  contributionMethod: "percent_of_salary" | "fixed_annual";
  contributionValue: string;
};

/** Every account category the app supports — same source
 *  ContributionProfileManager and every other picker use, so a new category
 *  added to the config shows up here automatically. */
export const SANDBOX_ACCOUNT_TYPES = getAllCategories();

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
 * A numeric cell pre-filled with the live/resolved value that pins on
 * change — the SAME interaction the real Salary Profile tab uses
 * (`PinnedNumberCell` in salary-profile-manager.tsx), not a blank field
 * with a "live" placeholder. This app already killed the idea of an
 * unfilled "follows job" field once; a placeholder that says "live" is
 * that same idea wearing different clothes, and it's what a user actually
 * hit and got confused by.
 */
export function WhatIfPinnedCell({
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
 * Per-person deductions editor — existing deductions pin-editable the same
 * way salary/bonus fields do (pre-filled with the real stored amount,
 * pinning on change); additions are new hypothetical rows with no DB row,
 * removable, feeding `sandboxDeductionAdditions`. Both flow into a REAL
 * `paycheck.computeSummary` recompute, not a client-side estimate.
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
  /** `settings.deductions.create` is admin-gated — only admins see the
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
            {v.rawDeductions.map((d, rowIdx) => (
              <tr key={d.id} className={stripe(rowIdx)}>
                <td className="text-secondary py-1 pr-3 pl-4">
                  {d.deductionName}
                </td>
                <td className="px-3 py-1 text-right">
                  <WhatIfPinnedCell
                    liveValue={parseFloat(d.amountPerPeriod)}
                    pinnedValue={deductionEdits.get(d.id)}
                    onCommit={(n) => onEditDeduction(d.id, n)}
                    onReset={() => onResetDeduction(d.id)}
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
            {personAdditions.map((a, rowIdx) => (
              <tr
                key={a.localId}
                className={stripe(v.rawDeductions.length + rowIdx)}
              >
                <td className="py-1 pr-3 pl-4">
                  <input
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
 * Per-person contribution accounts editor — same pin-editable pattern as
 * salary/deductions: pre-filled with the resolved current value, pinning on
 * change, ↺ to reset. Feeds `sandboxContribActiveFields`, applied server-side
 * via the SAME `applyContribActiveFields` merge a Contribution Profile's own
 * active fields go through — one more layer, not a parallel mechanism. Value is
 * NOT percent/100 converted: `percent_of_salary` stores the raw percent
 * number (5 = 5%), matching how ContributionProfileManager already displays
 * it (`value%`), not a fraction like bonusPercent uses.
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
            {v.rawContribs.map((c, rowIdx) => {
              const isPercent = c.contributionMethod === "percent_of_salary";
              const activeField = activeFields.get(c.id);
              return (
                <tr key={c.id} className={stripe(rowIdx)}>
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
                      />,
                    )}
                  </td>
                  <td />
                </tr>
              );
            })}
            {personAdditions.map((a, rowIdx) => {
              const isPercent = a.contributionMethod === "percent_of_salary";
              return (
                <tr
                  key={a.localId}
                  className={stripe(v.rawContribs.length + rowIdx)}
                >
                  <td className="py-1 pr-3 pl-4">
                    <div className="flex items-center gap-1">
                      <select
                        value={a.accountType}
                        onChange={(e) =>
                          onUpdateAddition(a.localId, {
                            accountType: e.target.value as AccountCategory,
                          })
                        }
                        className="bg-surface-primary rounded border border-amber-400 px-1 py-0.5 text-xs font-medium text-amber-600"
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
