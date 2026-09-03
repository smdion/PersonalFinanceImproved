"use client";

import { useState } from "react";
import { InlineEdit } from "@/components/ui/inline-edit";
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import { HelpTip } from "@/components/ui/help-tip";
import { AccountBadge } from "@/components/ui/account-badge";
import { SlidePanel } from "@/components/ui/slide-panel";
import { SectionHeader } from "./section-header";
import { ContribCard } from "./contrib-card";
import {
  ContribAccountForm,
  type ContribAccountFormValues,
} from "./contrib-account-form";
import type { RawContrib, JointContrib } from "./types";
import {
  CONTRIBUTION_METHOD_LABELS_SHORT,
  TAX_TREATMENT_LABELS as TAX_LABELS,
  displayLabel,
} from "@/lib/config/display-labels";
import {
  getLimitGroup as configGetLimitGroup,
  categoriesWithIrsLimit,
  getDisplayConfig,
  isOverflowTarget,
} from "@/lib/config/account-types";
import type { AccountCategory } from "@/lib/config/account-types";
import type { PerContribView } from "@/lib/hooks/use-paycheck-person-views";

export function ContributionsSection({
  rawContribs,
  perContribData,
  onUpdateContrib,
  onToggleAutoMax,
  onDeleteContrib,
  onCreateContrib,
  onUpdateInstitution,
  coverageNote,
  coverageNoteGroup,
  otherJointContribs,
  salary,
  periodsPerYear,
  isExpanded,
  onToggleExpand,
  sharedGroupOrder,
  personId,
  jobId,
  readOnly,
  contribValueReadOnly,
}: {
  rawContribs: RawContrib[];
  /**
   * Per-contribution annual/limit figures, already resolved by the caller's
   * shared paycheck hook with the SAME Contribution/Salary Profile ids the
   * rest of the page uses.
   *
   * This section used to run its own `contribution.computeSummary` query
   * keyed on the raw globally-active contribution setting while using the
   * Plan-pin-aware hook for the salary axis. That made the cards ignore an
   * active Plan's Contribution Profile pin, and made the page's own
   * Contribution Profile dropdown move the pay stub without moving these
   * cards — two different profiles rendered in one view. Never reintroduce a
   * query here: this data arrives as a prop.
   */
  perContribData: PerContribView[];
  onUpdateContrib: (id: number, field: string, value: string) => void;
  onToggleAutoMax?: (
    id: number,
    value: boolean,
    targetContribValue?: number,
  ) => void;
  onDeleteContrib?: (id: number) => void;
  onCreateContrib?: (data: ContribAccountFormValues) => void;
  onUpdateInstitution?: (
    id: number,
    performanceAccountId: number | null,
  ) => void;
  coverageNote?: string;
  coverageNoteGroup?: string;
  otherJointContribs?: JointContrib[];
  salary?: number;
  periodsPerYear?: number;
  isExpanded: boolean;
  onToggleExpand: () => void;
  sharedGroupOrder?: string[];
  personId?: number;
  jobId?: number;
  /** Sandbox/preview mode — cards are read-only and the "add account"
   *  action is omitted entirely. */
  readOnly?: boolean;
  /** Mirrors PersonPaycheck's salary padlock — contributionValue/Method
   *  write into the viewed Contribution Profile's active fields when
   *  unlocked, so only that field gates on it; delete/toggle/institution
   *  edits are unrelated and keep gating on `readOnly` alone. */
  contribValueReadOnly?: boolean;
}) {
  const [addingAccount, setAddingAccount] = useState(false);

  // Lookup from contribId -> per-contrib computed data (resolved upstream).
  const perContribMap = new Map<number, PerContribView>(
    perContribData.map((pcd) => [pcd.contribId, pcd]),
  );

  // Show section if there are contribs or a coverage note or joint accounts from partner
  if (
    rawContribs.length === 0 &&
    !coverageNote &&
    (!otherJointContribs || otherJointContribs.length === 0)
  )
    return null;

  const methodLabel = (m: string) =>
    displayLabel(CONTRIBUTION_METHOD_LABELS_SHORT, m);

  // Determine which IRS limit group an account belongs to (accounts in the same group share a limit)
  const getLimitGroup = (type: string): string | null => {
    return configGetLimitGroup(type as AccountCategory);
  };

  // Group contribs by limit group so shared-limit accounts (401k + Roth 401k, IRA + Roth IRA) appear together
  type LimitGroupKey = string; // '401k', 'ira', or exact accountType for non-shared types
  const getGroupKey = (type: string): LimitGroupKey => {
    const group = getLimitGroup(type);
    return group ?? type; // non-shared types use their own name as key
  };

  // Use shared group order if provided (ensures both people show same groups in same order)
  const groupOrder: LimitGroupKey[] = sharedGroupOrder
    ? [...sharedGroupOrder]
    : [];
  if (!sharedGroupOrder) {
    for (const c of rawContribs) {
      const key = getGroupKey(c.accountType);
      if (!groupOrder.includes(key)) groupOrder.push(key);
    }
    if (otherJointContribs) {
      for (const jc of otherJointContribs) {
        const key = getGroupKey(jc.accountType);
        if (!groupOrder.includes(key)) groupOrder.push(key);
      }
    }
  }

  const groupedContribs = new Map<LimitGroupKey, RawContrib[]>();
  for (const key of groupOrder) {
    groupedContribs.set(
      key,
      rawContribs.filter((c) => getGroupKey(c.accountType) === key),
    );
  }

  const groupedJoint = new Map<LimitGroupKey, JointContrib[]>();
  if (otherJointContribs) {
    for (const jc of otherJointContribs) {
      const key = getGroupKey(jc.accountType);
      const existing = groupedJoint.get(key) ?? [];
      existing.push(jc);
      groupedJoint.set(key, existing);
    }
  }

  return (
    <div>
      <button
        onClick={onToggleExpand}
        className="w-full cursor-pointer text-left"
        aria-expanded={isExpanded}
      >
        <SectionHeader>
          <span className="flex items-center gap-1.5">
            Contribution Accounts
            <HelpTip text="Retirement and investment accounts you contribute to from each paycheck (401k, IRA, HSA, etc.)" />
            <span className="text-faint text-caption font-normal tracking-normal normal-case">
              ({rawContribs.length})
            </span>
            <svg
              className={`text-faint h-3 w-3 transition-transform ${isExpanded ? "rotate-90" : ""}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 5l7 7-7 7"
              />
            </svg>
          </span>
        </SectionHeader>
      </button>
      {isExpanded && (
        <div className="mt-2 space-y-4">
          {groupOrder.map((groupKey) => {
            const contribs = groupedContribs.get(groupKey) ?? [];
            const jointContribs = groupedJoint.get(groupKey) ?? [];
            // A group has a shared limit if any category in it has an IRS limit and shares a limit group
            const irsLimitCats = categoriesWithIrsLimit();
            const isSharedLimit = irsLimitCats.some(
              (c) => getLimitGroup(c) === groupKey,
            );
            if (
              contribs.length === 0 &&
              jointContribs.length === 0 &&
              !(coverageNote && groupKey === coverageNoteGroup)
            )
              return null;

            // For shared-limit groups, compute the combined annual usage vs limit from perContribData
            let sharedLimitAmount: number | undefined;
            let sharedLimitUsed = 0;
            if (isSharedLimit && contribs.length > 0) {
              const firstData = perContribMap.get(contribs[0]!.id);
              if (firstData) {
                sharedLimitAmount = firstData.limit;
                sharedLimitUsed = contribs.reduce(
                  (sum, c) =>
                    sum + (perContribMap.get(c.id)?.annualAmount ?? 0),
                  0,
                );
              }
            }

            return (
              <div key={groupKey}>
                {/* Group header */}
                <div className="mb-2 flex items-center gap-2">
                  {isSharedLimit ? (
                    <>
                      {/* Show all account type badges in the group */}
                      {Array.from(
                        new Set(contribs.map((c) => c.accountType)),
                      ).map((type) => (
                        <AccountBadge key={type} type={type} />
                      ))}
                      {sharedLimitAmount !== undefined &&
                        sharedLimitAmount > 0 && (
                          <span className="text-caption text-muted">
                            Shared limit: {formatCurrency(sharedLimitAmount)}/yr
                            {contribs.length > 1 && (
                              <span
                                className={
                                  sharedLimitUsed > sharedLimitAmount
                                    ? "ml-1 font-medium text-red-600"
                                    : "text-faint ml-1"
                                }
                              >
                                ({formatCurrency(sharedLimitUsed)} used)
                              </span>
                            )}
                          </span>
                        )}
                    </>
                  ) : (
                    <AccountBadge type={groupKey} />
                  )}
                  <span className="bg-surface-strong h-px flex-1" />
                </div>

                {/* Account cards */}
                <div className="ml-1 space-y-2">
                  {contribs.map((c) => {
                    const pcd = perContribMap.get(c.id);
                    return (
                      <ContribCard
                        key={c.id}
                        contrib={c}
                        onUpdateContrib={onUpdateContrib}
                        onToggleAutoMax={onToggleAutoMax}
                        onDeleteContrib={onDeleteContrib}
                        onUpdateInstitution={onUpdateInstitution}
                        _methodLabel={methodLabel}
                        salary={salary}
                        periodsPerYear={periodsPerYear}
                        annualLimit={pcd?.limit}
                        siblingAnnualContribs={pcd?.siblingAnnualTotal ?? 0}
                        employerMatchAnnual={pcd?.employerMatchAnnual ?? 0}
                        readOnly={readOnly}
                        contribValueReadOnly={contribValueReadOnly}
                      />
                    );
                  })}

                  {/* Joint contribs — owned by partner, editable here too */}
                  {jointContribs.map((jc) => {
                    const jDisplay = getDisplayConfig(
                      jc.accountType,
                      jc.subType,
                    );
                    return (
                      <div
                        key={`joint-${jc.id}`}
                        className="bg-surface-primary rounded-lg border p-3 text-sm shadow-sm"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <AccountBadge type={jc.accountType} />
                            <span className="text-faint text-xs font-medium">
                              (Joint)
                            </span>
                            {isOverflowTarget(jc.accountType) &&
                              (jc.subType || jc.label) && (
                                <span className="text-muted text-xs font-medium">
                                  {jDisplay.displayLabel.toLowerCase() !==
                                  jc.accountType.toLowerCase()
                                    ? jDisplay.displayLabel
                                    : (jc.label ?? jc.subType)}
                                </span>
                              )}
                            <span className="text-faint text-xs">
                              {TAX_LABELS[jc.taxTreatment] ?? jc.taxTreatment}
                            </span>
                          </div>
                          <span className="flex items-center gap-1 text-xs">
                            <InlineEdit
                              value={jc.contributionValue}
                              onSave={(v) =>
                                onUpdateContrib(jc.id, "contributionValue", v)
                              }
                              formatDisplay={(v) =>
                                jc.contributionMethod === "percent_of_salary"
                                  ? formatPercent(Number(v) / 100)
                                  : formatCurrency(Number(v))
                              }
                              parseInput={(v) => v.replace(/[^0-9.]/g, "")}
                              type="number"
                              className="font-medium"
                              isEditable={!readOnly && !contribValueReadOnly}
                            />
                            <span className="text-faint">
                              {methodLabel(jc.contributionMethod)}
                            </span>
                          </span>
                        </div>
                        <p className="text-caption text-faint mt-1">
                          Joint household contribution
                        </p>
                      </div>
                    );
                  })}

                  {/* Coverage note (e.g., HSA family plan via other person) */}
                  {groupKey === coverageNoteGroup &&
                    coverageNote &&
                    contribs.length === 0 && (
                      <div className="bg-surface-sunken rounded-lg border p-3 text-sm">
                        <div className="text-faint flex items-center justify-between">
                          <span className="font-medium">{coverageNote}</span>
                          <span>&mdash;</span>
                        </div>
                      </div>
                    )}
                </div>
              </div>
            );
          })}

          {/* Add new contribution account */}
          {!readOnly && onCreateContrib && personId && (
            <div className="flex justify-center pt-1">
              <button
                type="button"
                onClick={() => setAddingAccount(true)}
                className="inline-flex items-center gap-1 text-xs text-blue-500 transition-colors hover:text-blue-700"
              >
                <svg
                  className="h-3.5 w-3.5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 4v16m8-8H4"
                  />
                </svg>
                Add contribution account
              </button>
            </div>
          )}
          {!readOnly && onCreateContrib && personId && (
            <SlidePanel
              isOpen={addingAccount}
              onClose={() => setAddingAccount(false)}
              title="Add Contribution Account"
            >
              <ContribAccountForm
                initialValues={{ personId, jobId: jobId ?? null }}
                onSave={(data) => {
                  onCreateContrib(data);
                  setAddingAccount(false);
                }}
                onCancel={() => setAddingAccount(false)}
              />
            </SlidePanel>
          )}

          {/* Coverage note when its group is not in groupOrder */}
          {coverageNote &&
            coverageNoteGroup &&
            !groupOrder.includes(coverageNoteGroup) && (
              <div>
                <div className="mb-2 flex items-center gap-2">
                  <AccountBadge type={coverageNoteGroup} />
                  <span className="bg-surface-strong h-px flex-1" />
                </div>
                <div className="bg-surface-sunken ml-1 rounded-lg border p-3 text-sm">
                  <div className="text-faint flex items-center justify-between">
                    <span className="font-medium">{coverageNote}</span>
                    <span>&mdash;</span>
                  </div>
                </div>
              </div>
            )}
        </div>
      )}
    </div>
  );
}
