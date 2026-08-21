"use client";

/** Contribution row UI: displays a single contribution's summary/edit view with tax treatment, method, employer match fields, and an add-contribution form. */

import React, { useState } from "react";
import { HelpTip } from "@/components/ui/help-tip";
import {
  TAX_TREATMENT_LABELS as TAX_LABELS,
  EMPLOYER_MATCH_LABELS as MATCH_LABELS,
  MATCH_TAX_LABELS,
  HSA_COVERAGE_LABELS,
} from "@/lib/config/display-labels";
import {
  ACCOUNT_TYPE_CONFIG,
  getDefaultTaxTreatment,
} from "@/lib/config/account-types";
import type { AccountCategory } from "@/lib/config/account-types";
import type { ContribRow } from "./contribution-accounts-types";
import { formatPercent } from "@/lib/utils/format";
import { InlineText, InlineSelect } from "./contribution-accounts-inline";

export function ContributionRow({
  contrib: c,
  people,
  jobs,
  accountTypeOptions,
  sharedMatchFrom,
  onUpdate,
}: {
  contrib: ContribRow;
  people: { id: number; name: string }[];
  jobs: { id: number; employerName: string }[];
  accountTypeOptions: { value: string; label: string }[];
  /** Set when this row has no match config of its own but a sibling split
   *  of the same account does — that sibling's match is combined across
   *  both splits before capping, so this row still earns a real,
   *  proportional share (see computeGroupedEmployerMatch). */
  sharedMatchFrom?: ContribRow;
  onUpdate?: (updates: Record<string, unknown>) => void;
}) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const cfg = ACCOUNT_TYPE_CONFIG[c.accountType as AccountCategory];
  const hasCoverage =
    cfg?.irsLimitKeys && "coverageVariant" in cfg.irsLimitKeys;

  const personLabel = people.find((p) => p.id === c.personId)?.name ?? "?";
  const jLabel = c.jobId
    ? (jobs.find((j) => j.id === c.jobId)?.employerName ?? String(c.jobId))
    : "Personal";

  // Format match cap from decimal to percentage for display
  const matchCapDisplay = c.employerMaxMatchPct
    ? formatPercent(parseFloat(c.employerMaxMatchPct))
    : "";
  const sharedMatchCapDisplay = sharedMatchFrom?.employerMaxMatchPct
    ? formatPercent(parseFloat(sharedMatchFrom.employerMaxMatchPct))
    : "";
  const sharedMatchLabel = sharedMatchFrom
    ? `${sharedMatchFrom.employerMatchValue}% match up to ${sharedMatchCapDisplay || "no cap"}, combined with this account's ${TAX_LABELS[c.taxTreatment] ?? c.taxTreatment} contribution — see the ${TAX_LABELS[sharedMatchFrom.taxTreatment] ?? sharedMatchFrom.taxTreatment} row`
    : "";
  return (
    <div
      className={`border rounded-lg bg-surface-primary ${!c.isActive ? "opacity-50" : ""}`}
    >
      {/* Summary line — hidden when edit is open */}
      {!showAdvanced && (
        <div className="flex items-center gap-2 px-3 py-2 text-xs">
          <span className="text-secondary font-medium shrink-0">
            {c.ownership === "joint" ? "Joint" : personLabel}
          </span>
          <span className="text-faint">·</span>
          <span className="text-muted">{jLabel}</span>
          <span className="text-faint">·</span>
          <span className="text-muted">
            {TAX_LABELS[c.taxTreatment] ?? c.taxTreatment}
          </span>
          {c.employerMatchType !== "none" && c.employerMatchValue && (
            <>
              <span className="text-faint">·</span>
              <span className="text-faint">
                {c.employerMatchValue}% match
                {matchCapDisplay ? ` up to ${matchCapDisplay}` : ""}
                {sharedMatchFrom ? " (combined w/ other split)" : ""}
              </span>
            </>
          )}
          {(!c.employerMatchType || c.employerMatchType === "none") &&
            sharedMatchFrom && (
              <>
                <span className="text-faint">·</span>
                <span className="text-faint">
                  {sharedMatchFrom.employerMatchValue}% match up to{" "}
                  {sharedMatchCapDisplay || "no cap"} (combined w/{" "}
                  {TAX_LABELS[sharedMatchFrom.taxTreatment] ??
                    sharedMatchFrom.taxTreatment}{" "}
                  split)
                </span>
              </>
            )}
          {c.subType && (
            <>
              <span className="text-faint">·</span>
              <span className="text-faint">{c.subType}</span>
            </>
          )}
          <span className="flex-1" />
          {!c.isActive && (
            <span className="text-caption text-amber-500 font-medium">
              Inactive
            </span>
          )}
          {onUpdate && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onUpdate({ isActive: !c.isActive });
              }}
              className={`text-caption shrink-0 ${c.isActive ? "text-red-400 hover:text-red-600" : "text-green-500 hover:text-green-700"}`}
              title={c.isActive ? "Deactivate" : "Reactivate"}
            >
              {c.isActive ? "Deactivate" : "Reactivate"}
            </button>
          )}
          {onUpdate && (
            <button
              onClick={() => setShowAdvanced(true)}
              className="text-caption text-faint hover:text-secondary shrink-0"
            >
              Edit
            </button>
          )}
        </div>
      )}

      {/* Editable fields — replaces summary when open */}
      {showAdvanced && (
        <div className="px-3 py-2.5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-caption font-semibold text-muted uppercase tracking-wider">
              Edit Contribution
            </span>
            <button
              onClick={() => setShowAdvanced(false)}
              className="text-caption text-indigo-500 hover:text-indigo-700"
            >
              Done
            </button>
          </div>
          <p className="text-caption text-faint mb-2">
            Contribution amount is set per Contribution Profile — edit it on the
            Paycheck page or the Contribution Profiles tab.
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <InlineSelect
              label="Owner"
              value={c.ownership === "joint" ? "joint" : String(c.personId)}
              options={[
                { value: "joint", label: "Joint" },
                ...people.map((p) => ({ value: String(p.id), label: p.name })),
              ]}
              onChange={(val) => {
                if (val === "joint") {
                  onUpdate?.({ ownership: "joint", personId: null });
                } else {
                  onUpdate?.({
                    personId: parseInt(val, 10),
                    ownership: "individual",
                  });
                }
              }}
              disabled={!onUpdate}
            />
            <InlineSelect
              label="Job"
              value={c.jobId ? String(c.jobId) : ""}
              options={[
                { value: "", label: "Personal" },
                ...jobs.map((j) => ({
                  value: String(j.id),
                  label: j.employerName,
                })),
              ]}
              onChange={(val) =>
                onUpdate?.({ jobId: val ? parseInt(val, 10) : null })
              }
              disabled={!onUpdate}
            />
            <InlineSelect
              label="Account Type"
              value={c.accountType}
              options={accountTypeOptions}
              onChange={(val) => onUpdate?.({ accountType: val })}
              disabled={!onUpdate}
            />
            <InlineSelect
              label="Tax Treatment"
              value={c.taxTreatment}
              options={Object.entries(TAX_LABELS).map(([k, v]) => ({
                value: k,
                label: v,
              }))}
              onChange={(val) => onUpdate?.({ taxTreatment: val })}
              disabled={!onUpdate}
            />
            <InlineSelect
              label="Match Type"
              value={c.employerMatchType}
              options={Object.entries(MATCH_LABELS).map(([k, v]) => ({
                value: k,
                label: v,
              }))}
              onChange={(val) => onUpdate?.({ employerMatchType: val })}
              disabled={!onUpdate}
            />
            {(!c.employerMatchType || c.employerMatchType === "none") &&
              sharedMatchFrom && (
                <p className="col-span-2 md:col-span-4 text-caption text-faint -mt-1">
                  This account&apos;s match — {sharedMatchLabel}
                </p>
              )}
            {c.employerMatchType !== "none" && (
              <>
                <InlineText
                  label="Match %"
                  value={c.employerMatchValue ?? ""}
                  placeholder="e.g. 50"
                  onSave={(val) =>
                    onUpdate?.({ employerMatchValue: val || null })
                  }
                  disabled={!onUpdate}
                />
                <InlineText
                  label="Match Cap %"
                  value={
                    c.employerMaxMatchPct
                      ? String(parseFloat(c.employerMaxMatchPct) * 100)
                      : ""
                  }
                  placeholder="e.g. 7"
                  onSave={(val) =>
                    onUpdate?.({
                      employerMaxMatchPct: val
                        ? String(parseFloat(val) / 100)
                        : null,
                    })
                  }
                  disabled={!onUpdate}
                />
                <InlineSelect
                  label="Match Deposits To"
                  value={c.employerMatchTaxTreatment}
                  options={Object.entries(MATCH_TAX_LABELS).map(([k, v]) => ({
                    value: k,
                    label: v,
                  }))}
                  onChange={(val) =>
                    onUpdate?.({ employerMatchTaxTreatment: val })
                  }
                  disabled={!onUpdate}
                />
              </>
            )}
            {hasCoverage && (
              <InlineSelect
                label="HSA Coverage"
                value={c.hsaCoverageType ?? ""}
                options={[
                  { value: "", label: "—" },
                  ...Object.entries(HSA_COVERAGE_LABELS).map(([k, v]) => ({
                    value: k,
                    label: v,
                  })),
                ]}
                onChange={(val) => onUpdate?.({ hsaCoverageType: val || null })}
                disabled={!onUpdate}
              />
            )}
            <div className="flex items-center gap-2 pt-3">
              <input
                type="checkbox"
                checked={c.isPayrollDeducted ?? c.jobId !== null}
                onChange={(e) =>
                  onUpdate?.({ isPayrollDeducted: e.target.checked })
                }
                disabled={!onUpdate}
                className="rounded border-strong"
                id={`payroll-ded-${c.id}`}
              />
              <label
                htmlFor={`payroll-ded-${c.id}`}
                className="text-xs text-muted"
              >
                Payroll Deduction
              </label>
            </div>
            <div className="flex items-center gap-2 pt-3">
              <input
                type="checkbox"
                checked={c.autoMaximize}
                onChange={(e) => onUpdate?.({ autoMaximize: e.target.checked })}
                disabled={!onUpdate}
                className="rounded border-strong"
                id={`auto-max-${c.id}`}
              />
              <label
                htmlFor={`auto-max-${c.id}`}
                className="text-xs text-muted"
              >
                Auto Maximize
              </label>
            </div>
            {cfg && !cfg.hasIrsLimit && (
              <InlineText
                label="Annual Target"
                value={c.targetAnnual ?? ""}
                placeholder="No target"
                onSave={(val) => onUpdate?.({ targetAnnual: val || null })}
                disabled={!onUpdate}
              />
            )}
            {cfg?.isOverflowTarget && (
              <div>
                <div className="flex items-center gap-1 mb-0.5">
                  <span className="text-caption text-muted">
                    Overflow Priority
                  </span>
                  <HelpTip text="When contributions exceed IRS limits in tax-advantaged accounts (401k, IRA, HSA), the excess overflows to brokerage accounts. Lower number = filled first. Accounts with an Annual Target are filled up to that target before others. The lowest-priority account receives any remaining overflow." />
                </div>
                <InlineText
                  label=""
                  value={String(c.allocationPriority ?? 0)}
                  placeholder="0"
                  onSave={(val) =>
                    onUpdate?.({ allocationPriority: parseInt(val, 10) || 0 })
                  }
                  disabled={!onUpdate}
                />
              </div>
            )}
            <div className="col-span-2">
              <InlineText
                label="Notes"
                value={c.notes ?? ""}
                placeholder="Optional notes"
                onSave={(val) => onUpdate?.({ notes: val || null })}
                disabled={!onUpdate}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Add Contribution Form
// ---------------------------------------------------------------------------

export function AddContribForm({
  accountType,
  parentCategory,
  performanceAccountId,
  ownerPersonId,
  people,
  jobs,
  onSave,
  onCancel,
}: {
  accountType: string;
  parentCategory: string;
  performanceAccountId: number;
  ownerPersonId: number | null;
  people: { id: number; name: string }[];
  jobs: { id: number; employerName: string }[];
  onSave: (data: Record<string, unknown>) => void;
  onCancel: () => void;
}) {
  const defaultPersonId = ownerPersonId ?? people[0]?.id ?? 1;
  const [personId, setPersonId] = useState(defaultPersonId);
  const [jobId, setJobId] = useState<number | null>(jobs[0]?.id ?? null);
  const [taxTreatment, setTaxTreatment] = useState<string>(
    getDefaultTaxTreatment(accountType as AccountCategory),
  );
  const [matchType, setMatchType] = useState("none");
  const [matchValue, setMatchValue] = useState("");
  const [maxMatchPct, setMaxMatchPct] = useState("");

  const handleSubmit = () => {
    onSave({
      personId,
      jobId,
      accountType,
      parentCategory,
      performanceAccountId,
      taxTreatment,
      employerMatchType: matchType,
      ...(matchType !== "none" && matchValue
        ? { employerMatchValue: matchValue }
        : {}),
      ...(matchType !== "none" && maxMatchPct
        ? { employerMaxMatchPct: String(parseFloat(maxMatchPct) / 100) }
        : {}),
      isActive: true,
    });
  };

  return (
    <div className="border border-blue-200 rounded-lg p-3 bg-blue-50/30 space-y-2">
      <div className="text-caption font-semibold text-muted uppercase tracking-wider">
        New Contribution
      </div>
      <p className="text-caption text-faint">
        Set the contribution amount afterward on the Paycheck page or the
        Contribution Profiles tab — accounts don&apos;t carry a value of their
        own.
      </p>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <div>
          <label className="text-caption text-muted">Owner</label>
          <select
            value={personId}
            onChange={(e) => setPersonId(parseInt(e.target.value, 10))}
            className="w-full border rounded px-1.5 py-1 text-xs bg-surface-primary"
          >
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-caption text-muted">Job</label>
          <select
            value={jobId ?? ""}
            onChange={(e) =>
              setJobId(e.target.value ? parseInt(e.target.value, 10) : null)
            }
            className="w-full border rounded px-1.5 py-1 text-xs bg-surface-primary"
          >
            <option value="">Personal</option>
            {jobs.map((j) => (
              <option key={j.id} value={j.id}>
                {j.employerName}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-caption text-muted">Tax Treatment</label>
          <select
            value={taxTreatment}
            onChange={(e) => setTaxTreatment(e.target.value)}
            className="w-full border rounded px-1.5 py-1 text-xs bg-surface-primary"
          >
            {Object.entries(TAX_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-caption text-muted">Match Type</label>
          <select
            value={matchType}
            onChange={(e) => setMatchType(e.target.value)}
            className="w-full border rounded px-1.5 py-1 text-xs bg-surface-primary"
          >
            {Object.entries(MATCH_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
        {matchType !== "none" && (
          <>
            <div>
              <label className="text-caption text-muted">Match Value</label>
              <input
                type="number"
                value={matchValue}
                onChange={(e) => setMatchValue(e.target.value)}
                placeholder="e.g. 50"
                className="w-full border rounded px-1.5 py-1 text-xs bg-surface-primary"
              />
            </div>
            <div>
              <label className="text-caption text-muted">Max Match %</label>
              <input
                type="number"
                value={maxMatchPct}
                onChange={(e) => setMaxMatchPct(e.target.value)}
                placeholder="e.g. 7"
                className="w-full border rounded px-1.5 py-1 text-xs bg-surface-primary"
              />
            </div>
          </>
        )}
      </div>
      <div className="flex gap-2 pt-1">
        <button
          onClick={handleSubmit}
          className="text-xs px-3 py-1 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
        >
          Create
        </button>
        <button
          onClick={onCancel}
          className="text-xs px-3 py-1 rounded text-muted hover:bg-surface-elevated"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
