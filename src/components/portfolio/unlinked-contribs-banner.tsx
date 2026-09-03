"use client";

/**
 * UnlinkedContribsBanner — extracted from contribution-accounts.tsx.
 *
 * Renders the amber warning box listing active contribution accounts that are
 * not yet linked to a portfolio performance account, with inline owner +
 * link-to dropdowns.
 */

import React from "react";
import { TAX_TREATMENT_LABELS as TAX_LABELS } from "@/lib/config/display-labels";
import { accountDisplayName } from "@/lib/utils/format";
import { formatEmployerMatch } from "@/lib/pure/contributions";

type ContribEntry = {
  id: number;
  personId: number | null;
  jobId: number | null;
  accountType: string;
  subType: string | null;
  taxTreatment: string;
  employerMatchType: string;
  employerMatchValue: string | null;
  employerMaxMatchPct: string | null;
  ownership: string;
};

type PerfAccountEntry = {
  id: number;
  ownerPersonId: number | null;
  parentCategory: string;
  institution: string;
  displayName?: string | null;
  label?: string | null;
  ownershipType: string;
};

type Props = {
  unlinkedContribs: ContribEntry[];
  activeAccounts: PerfAccountEntry[];
  contribsByPerfId: Map<number, ContribEntry[]>;
  personOptions: Array<{ value: string; label: string }>;
  jobLabel: (id: number | null) => string;
  admin: boolean;
  onContribOwnerChange: (
    c: ContribEntry,
    update: { ownership: "individual" | "joint"; personId?: number | null },
  ) => void;
  onLinkContrib: (contribId: number, perfAccountId: number) => void;
};

export function UnlinkedContribsBanner({
  unlinkedContribs,
  activeAccounts,
  contribsByPerfId,
  personOptions,
  jobLabel,
  admin,
  onContribOwnerChange,
  onLinkContrib,
}: Props) {
  if (unlinkedContribs.length === 0) return null;

  return (
    <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm">
      <p className="font-medium text-amber-800">
        {unlinkedContribs.length} contribution
        {unlinkedContribs.length > 1 ? "s" : ""} not linked to a portfolio
        account
      </p>
      <p className="mt-1 text-xs text-amber-700">
        Unlinked contributions are excluded from retirement projections.
      </p>
      <div className="mt-2 space-y-1.5">
        {unlinkedContribs.map((c) => {
          const taxLabel = TAX_LABELS[c.taxTreatment] ?? c.taxTreatment;
          const acctType = c.subType ?? c.accountType;
          const matchText = formatEmployerMatch(
            c.employerMatchType,
            c.employerMatchValue,
            c.employerMaxMatchPct,
          );
          const matchDetail = matchText ? `, ${matchText} match` : "";
          const employer = jobLabel(c.jobId);
          const compatibleAccounts = activeAccounts.filter(
            (pa) =>
              pa.ownerPersonId === c.personId || pa.ownerPersonId === null,
          );
          return (
            <div key={c.id} className="flex flex-wrap items-center gap-2">
              <select
                value={c.ownership === "joint" ? "joint" : String(c.personId)}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === "joint") {
                    onContribOwnerChange(c, {
                      ownership: "joint",
                      personId: null,
                    });
                  } else {
                    onContribOwnerChange(c, {
                      personId: parseInt(val, 10),
                      ownership: "individual",
                    });
                  }
                }}
                disabled={!admin}
                className="bg-surface-primary rounded border border-amber-300 px-1 py-0.5 text-xs text-amber-800"
              >
                {personOptions.map((po) => (
                  <option key={po.value} value={po.value}>
                    {po.label}
                  </option>
                ))}
              </select>
              <span className="text-xs text-amber-800">
                {taxLabel} {acctType}
                {matchDetail} ({employer})
              </span>
              <select
                value=""
                onChange={(e) => {
                  const val = e.target.value;
                  if (val) onLinkContrib(c.id, parseInt(val, 10));
                }}
                disabled={!admin}
                className="bg-surface-primary rounded border border-amber-300 px-1.5 py-0.5 text-xs"
              >
                <option value="">Link to...</option>
                {compatibleAccounts.map((pa) => {
                  const linkedCount = contribsByPerfId.get(pa.id)?.length ?? 0;
                  return (
                    <option key={pa.id} value={String(pa.id)}>
                      {accountDisplayName(pa)} — {pa.parentCategory}
                      {linkedCount > 0 ? ` [${linkedCount} linked]` : ""}
                    </option>
                  );
                })}
              </select>
            </div>
          );
        })}
      </div>
    </div>
  );
}
