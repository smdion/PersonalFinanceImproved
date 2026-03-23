"use client";

import { trpc } from "@/lib/trpc";
import { usePersistedSetting } from "@/lib/hooks/use-persisted-setting";
import { InlineEdit } from "@/components/ui/inline-edit";
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import { HelpTip } from "@/components/ui/help-tip";
import { AccountBadge } from "@/components/ui/account-badge";
import { SectionHeader } from "./section-header";
import { ContribCard } from "./contrib-card";
import { AddContribInline } from "./add-contrib-inline";
import type { RawContrib, CreateContribData, JointContrib } from "./types";
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

export function ContributionsSection({
  rawContribs,
  onUpdateContrib,
  onToggleAutoMax,
  onDeleteContrib,
  onCreateContrib,
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
}: {
  rawContribs: RawContrib[];
  onUpdateContrib: (id: number, field: string, value: string) => void;
  onToggleAutoMax?: (
    id: number,
    value: boolean,
    targetContribValue?: number,
  ) => void;
  onDeleteContrib?: (id: number) => void;
  onCreateContrib?: (data: CreateContribData) => void;
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
}) {
  // Use contribution router as canonical source for limits, annual amounts, and sibling data
  const [activeProfileId] = usePersistedSetting<number | null>(
    "active_contrib_profile_id",
    null,
  );
  const contribInput =
    activeProfileId != null
      ? { contributionProfileId: activeProfileId }
      : undefined;
  const { data: contribData } =
    trpc.contribution.computeSummary.useQuery(contribInput);

  // Build lookup from contribId -> per-contrib computed data
  const perContribMap = new Map<
    number,
    {
      annualAmount: number;
      employerMatchAnnual: number;
      limit: number;
      siblingAnnualTotal: number;
      limitGroup: string | null;
    }
  >();
  if (contribData?.people && personId) {
    const personData = contribData.people.find((p) => p.person.id === personId);
    if (personData?.perContribData) {
      for (const pcd of personData.perContribData) {
        perContribMap.set(pcd.contribId, pcd);
      }
    }
  }

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
        className="w-full text-left cursor-pointer"
        aria-expanded={isExpanded}
      >
        <SectionHeader>
          <span className="flex items-center gap-1.5">
            Contribution Accounts
            <HelpTip text="Retirement and investment accounts you contribute to from each paycheck (401k, IRA, HSA, etc.)" />
            <span className="text-faint text-[10px] font-normal normal-case tracking-normal">
              ({rawContribs.length})
            </span>
            <svg
              className={`w-3 h-3 text-faint transition-transform ${isExpanded ? "rotate-90" : ""}`}
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
        <div className="space-y-4 mt-2">
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
                <div className="flex items-center gap-2 mb-2">
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
                          <span className="text-[10px] text-muted">
                            Shared limit: {formatCurrency(sharedLimitAmount)}/yr
                            {contribs.length > 1 && (
                              <span
                                className={
                                  sharedLimitUsed > sharedLimitAmount
                                    ? "text-red-600 font-medium ml-1"
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
                  <span className="flex-1 h-px bg-surface-strong" />
                </div>

                {/* Account cards */}
                <div className="space-y-2 ml-1">
                  {contribs.map((c) => {
                    const pcd = perContribMap.get(c.id);
                    return (
                      <ContribCard
                        key={c.id}
                        contrib={c}
                        onUpdateContrib={onUpdateContrib}
                        onToggleAutoMax={onToggleAutoMax}
                        onDeleteContrib={onDeleteContrib}
                        _methodLabel={methodLabel}
                        salary={salary}
                        periodsPerYear={periodsPerYear}
                        annualLimit={pcd?.limit}
                        siblingAnnualContribs={pcd?.siblingAnnualTotal ?? 0}
                        employerMatchAnnual={pcd?.employerMatchAnnual ?? 0}
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
                        className="bg-surface-primary border rounded-lg p-3 text-sm shadow-sm"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <AccountBadge type={jc.accountType} />
                            <span className="text-xs text-faint font-medium">
                              (Joint)
                            </span>
                            {isOverflowTarget(jc.accountType) &&
                              (jc.subType || jc.label) && (
                                <span className="text-xs text-muted font-medium">
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
                          <span className="text-xs flex items-center gap-1">
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
                            />
                            <span className="text-faint">
                              {methodLabel(jc.contributionMethod)}
                            </span>
                          </span>
                        </div>
                        <p className="text-[10px] text-faint mt-1">
                          Joint household contribution
                        </p>
                      </div>
                    );
                  })}

                  {/* Coverage note (e.g., HSA family plan via other person) */}
                  {groupKey === coverageNoteGroup &&
                    coverageNote &&
                    contribs.length === 0 && (
                      <div className="bg-surface-sunken border rounded-lg p-3 text-sm">
                        <div className="flex justify-between items-center text-faint">
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
          {onCreateContrib && personId && (
            <AddContribInline
              personId={personId}
              jobId={jobId ?? null}
              onCreateContrib={onCreateContrib}
            />
          )}

          {/* Coverage note when its group is not in groupOrder */}
          {coverageNote &&
            coverageNoteGroup &&
            !groupOrder.includes(coverageNoteGroup) && (
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <AccountBadge type={coverageNoteGroup} />
                  <span className="flex-1 h-px bg-surface-strong" />
                </div>
                <div className="ml-1 bg-surface-sunken border rounded-lg p-3 text-sm">
                  <div className="flex justify-between items-center text-faint">
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
