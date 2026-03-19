"use client";

import React, { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useUser, isAdmin } from "@/lib/context/user-context";
import { Card } from "@/components/ui/card";
import { HelpTip } from "@/components/ui/help-tip";
import { formatCurrency, accountDisplayName } from "@/lib/utils/format";
import { taxTypeLabel } from "@/lib/utils/colors";
import {
  CONTRIBUTION_METHOD_LABELS as METHOD_LABELS,
  TAX_TREATMENT_LABELS as TAX_LABELS,
  EMPLOYER_MATCH_LABELS as MATCH_LABELS,
  MATCH_TAX_LABELS,
  HSA_COVERAGE_LABELS,
} from "@/lib/config/display-labels";
import {
  ACCOUNT_TYPE_CONFIG,
  getAllCategories,
  getDefaultTaxTreatment,
} from "@/lib/config/account-types";
import type { AccountCategory } from "@/lib/config/account-types";

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ContributionAccountsSettings() {
  const user = useUser();
  const admin = isAdmin(user);
  const utils = trpc.useUtils();
  const { data: people } = trpc.settings.people.list.useQuery();
  const { data: jobs } = trpc.settings.jobs.list.useQuery();
  const { data: contribs } = trpc.settings.contributionAccounts.list.useQuery();
  const { data: perfAccounts } =
    trpc.settings.performanceAccounts.list.useQuery();
  const { data: latestSnap } =
    trpc.settings.portfolioSnapshots.getLatest.useQuery();
  const [showClosed, setShowClosed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [expandedAcctId, setExpandedAcctId] = useState<number | null>(null);
  const [creatingAccount, setCreatingAccount] = useState(false);

  // Mutations
  const updatePerfMut = trpc.settings.performanceAccounts.update.useMutation({
    onSuccess: () => {
      utils.settings.performanceAccounts.invalidate();
      utils.retirement.invalidate();
      utils.projection.invalidate();
      utils.networth.invalidate();
    },
  });
  const createPerfMut = trpc.settings.performanceAccounts.create.useMutation({
    onSuccess: () => {
      utils.settings.performanceAccounts.invalidate();
      setCreatingAccount(false);
    },
  });
  const deletePerfMut = trpc.settings.performanceAccounts.delete.useMutation({
    onSuccess: () => utils.settings.performanceAccounts.invalidate(),
  });
  const updateContribMut =
    trpc.settings.contributionAccounts.update.useMutation({
      onSuccess: () => {
        utils.settings.contributionAccounts.invalidate();
        utils.retirement.invalidate();
        utils.projection.invalidate();
      },
    });
  const createContribMut =
    trpc.settings.contributionAccounts.create.useMutation({
      onSuccess: () => {
        utils.settings.contributionAccounts.invalidate();
        utils.retirement.invalidate();
        utils.projection.invalidate();
      },
    });
  const updatePortfolioAccountMut =
    trpc.settings.portfolioSnapshots.updateAccount.useMutation({
      onSuccess: () => {
        utils.settings.portfolioSnapshots.getLatest.invalidate();
        utils.networth.invalidate();
      },
    });
  const createPortfolioAccountMut =
    trpc.settings.portfolioSnapshots.createAccount.useMutation({
      onSuccess: () => {
        utils.settings.portfolioSnapshots.getLatest.invalidate();
        utils.networth.invalidate();
      },
    });

  // Derived data
  const allContribs = contribs ?? [];
  const allAccounts = (perfAccounts ?? []).sort((a, b) => {
    if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
    return a.displayOrder - b.displayOrder;
  });
  const activeAccounts = allAccounts.filter((pa) => pa.isActive);
  const closedAccounts = allAccounts.filter((pa) => !pa.isActive);
  const peopleList = people ?? [];
  const jobsList = jobs ?? [];

  // Map: perfAccountId → contribution accounts linked to it
  const contribsByPerfId = new Map<number, typeof allContribs>();
  for (const c of allContribs) {
    if (c.performanceAccountId !== null) {
      const arr = contribsByPerfId.get(c.performanceAccountId) ?? [];
      arr.push(c);
      contribsByPerfId.set(c.performanceAccountId, arr);
    }
  }
  const unlinkedContribs = allContribs.filter(
    (c) => c.performanceAccountId === null && c.isActive,
  );

  // Balance + portfolio sub-accounts from latest snapshot
  const balanceByPerfId = new Map<number, number>();
  const portfolioSubsByPerfId = new Map<number, PortfolioSub[]>();
  if (latestSnap?.accounts) {
    for (const a of latestSnap.accounts) {
      if (a.performanceAccountId) {
        if (a.isActive !== false) {
          balanceByPerfId.set(
            a.performanceAccountId,
            (balanceByPerfId.get(a.performanceAccountId) ?? 0) +
              parseFloat(a.amount),
          );
        }
        const subs = portfolioSubsByPerfId.get(a.performanceAccountId) ?? [];
        subs.push({
          id: a.id,
          taxType: a.taxType,
          subType: a.subType,
          label: a.label,
          amount: a.amount,
          accountType: a.accountType,
          ownerPersonId: a.ownerPersonId,
          isActive: a.isActive ?? true,
        });
        portfolioSubsByPerfId.set(a.performanceAccountId, subs);
      }
    }
  }

  // Helpers
  const jobLabel = (id: number | null) => {
    if (!id) return "Personal";
    const j = jobsList.find((j) => j.id === id);
    return j ? j.employerName : String(id);
  };

  const personOptions = [
    { value: "joint", label: "Joint" },
    ...peopleList.map((p) => ({ value: String(p.id), label: p.name })),
  ];

  const categoryOptions = [
    { value: "Retirement", label: "Retirement" },
    { value: "Portfolio", label: "Portfolio" },
  ];

  const accountTypeOptions = getAllCategories().map((c) => ({
    value: c,
    label: ACCOUNT_TYPE_CONFIG[c].displayLabel,
  }));

  // Mutation helpers
  const handlePerfUpdate = (
    pa: (typeof allAccounts)[0],
    updates: Partial<{
      displayName: string | null;
      institution: string;
      accountType: string;
      subType: string | null;
      label: string | null;
      parentCategory: "Retirement" | "Portfolio";
      ownerPersonId: number | null;
      ownershipType: "individual" | "joint";
      isActive: boolean;
    }>,
  ) => {
    updatePerfMut.mutate({
      id: pa.id,
      institution: updates.institution ?? pa.institution,
      accountType: updates.accountType ?? pa.accountType,
      subType:
        updates.subType !== undefined ? updates.subType : (pa.subType ?? null),
      label: updates.label !== undefined ? updates.label : (pa.label ?? null),
      displayName:
        updates.displayName !== undefined
          ? updates.displayName
          : (pa.displayName ?? null),
      ownerPersonId:
        updates.ownerPersonId !== undefined
          ? updates.ownerPersonId
          : pa.ownerPersonId,
      ownershipType:
        updates.ownershipType !== undefined
          ? updates.ownershipType
          : (pa.ownershipType as "individual" | "joint"),
      parentCategory:
        updates.parentCategory !== undefined
          ? updates.parentCategory
          : (pa.parentCategory as "Retirement" | "Portfolio"),
      isActive: updates.isActive !== undefined ? updates.isActive : pa.isActive,
      displayOrder: pa.displayOrder,
    });
  };

  const handleContribUpdate = (
    c: (typeof allContribs)[0],
    updates: Partial<{
      accountType: string;
      personId: number;
      jobId: number | null;
      taxTreatment: string;
      contributionMethod: string;
      contributionValue: string;
      employerMatchType: string;
      employerMatchValue: string | null;
      employerMaxMatchPct: string | null;
      employerMatchTaxTreatment: string;
      hsaCoverageType: string | null;
      autoMaximize: boolean;
      isActive: boolean;
      ownership: "individual" | "joint";
      performanceAccountId: number | null;
      targetAnnual: string | null;
      allocationPriority: number;
      notes: string | null;
      isPayrollDeducted: boolean | null;
    }>,
  ) => {
    updateContribMut.mutate({
      id: c.id,
      personId: updates.personId ?? c.personId,
      jobId: updates.jobId !== undefined ? updates.jobId : c.jobId,
      accountType: (updates.accountType ?? c.accountType) as
        | "401k"
        | "403b"
        | "ira"
        | "hsa"
        | "brokerage",
      taxTreatment: (updates.taxTreatment ?? c.taxTreatment) as
        | "pre_tax"
        | "tax_free"
        | "after_tax"
        | "hsa",
      contributionMethod: (updates.contributionMethod ??
        c.contributionMethod) as
        | "percent_of_salary"
        | "fixed_per_period"
        | "fixed_monthly"
        | "fixed_annual",
      contributionValue: updates.contributionValue ?? c.contributionValue,
      employerMatchType: (updates.employerMatchType ?? c.employerMatchType) as
        | "none"
        | "percent_of_contribution"
        | "dollar_match"
        | "fixed_annual",
      employerMatchValue:
        updates.employerMatchValue !== undefined
          ? updates.employerMatchValue
          : c.employerMatchValue,
      employerMaxMatchPct:
        updates.employerMaxMatchPct !== undefined
          ? updates.employerMaxMatchPct
          : c.employerMaxMatchPct,
      employerMatchTaxTreatment: (updates.employerMatchTaxTreatment ??
        c.employerMatchTaxTreatment) as "pre_tax" | "tax_free",
      hsaCoverageType: (updates.hsaCoverageType !== undefined
        ? updates.hsaCoverageType
        : c.hsaCoverageType) as "self_only" | "family" | null | undefined,
      autoMaximize:
        updates.autoMaximize !== undefined
          ? updates.autoMaximize
          : c.autoMaximize,
      isActive: updates.isActive !== undefined ? updates.isActive : c.isActive,
      ownership: updates.ownership ?? (c.ownership as "individual" | "joint"),
      performanceAccountId:
        updates.performanceAccountId !== undefined
          ? updates.performanceAccountId
          : c.performanceAccountId,
      targetAnnual:
        updates.targetAnnual !== undefined
          ? updates.targetAnnual
          : c.targetAnnual,
      allocationPriority:
        updates.allocationPriority !== undefined
          ? updates.allocationPriority
          : (c.allocationPriority ?? 0),
      notes: updates.notes !== undefined ? updates.notes : c.notes,
      isPayrollDeducted:
        updates.isPayrollDeducted !== undefined
          ? updates.isPayrollDeducted
          : c.isPayrollDeducted,
    });
  };

  const handleLinkContrib = (
    contribId: number,
    perfAccountId: number | null,
  ) => {
    const c = allContribs.find((x) => x.id === contribId);
    if (!c) return;
    handleContribUpdate(c, { performanceAccountId: perfAccountId });
  };

  if (allAccounts.length === 0 && !creatingAccount) return null;

  const visibleAccounts = showClosed ? allAccounts : activeAccounts;

  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-5 py-3 bg-surface-primary border rounded-lg shadow-sm hover:bg-surface-sunken transition-colors"
      >
        <div className="flex items-center gap-2">
          {" "}
          <span
            className={`text-xs text-faint transition-transform ${expanded ? "rotate-90" : ""}`}
          >
            &#9654;
          </span>
          <span className="font-semibold text-primary">
            Account &amp; Contribution Settings
          </span>
          <HelpTip
            maxWidth={360}
            lines={[
              <>
                <strong>Accounts</strong> — Real-world investment accounts (e.g.
                your 401k at Fidelity). Click to expand and manage.
              </>,
              "",
              "Each account card has three collapsible sections:",
              <>
                <strong>Account Settings</strong> — Edit name, owner, category,
                institution. Danger zone (close/delete) is hidden by default.
              </>,
              <>
                <strong>Sub-Accounts</strong> — Tax-type breakdowns from your
                latest snapshot (Roth, Traditional, etc.). You can add,
                deactivate, or change owners here.
              </>,
              <>
                <strong>Contributions</strong> — Paycheck rules (how much you
                contribute + employer match). Drives projections and paycheck
                calculations. Add, edit, or deactivate here.
              </>,
            ]}
          />
          <span className="text-xs text-faint">
            ({activeAccounts.length} account
            {activeAccounts.length !== 1 ? "s" : ""})
          </span>
        </div>
        <span className="text-xs text-faint">
          {expanded ? "Click to collapse" : "Click to expand"}
        </span>
      </button>

      {expanded && (
        <>
          {/* Unlinked contributions warning */}
          {unlinkedContribs.length > 0 && (
            <div className="bg-amber-50 border border-amber-300 rounded-lg p-3 mt-3 text-sm">
              <p className="font-medium text-amber-800">
                {unlinkedContribs.length} contribution
                {unlinkedContribs.length > 1 ? "s" : ""} not linked to a
                portfolio account
              </p>
              <p className="text-amber-700 text-xs mt-1">
                Unlinked contributions are excluded from retirement projections.
              </p>
              <div className="mt-2 space-y-1.5">
                {unlinkedContribs.map((c) => {
                  const taxLabel = TAX_LABELS[c.taxTreatment] ?? c.taxTreatment;
                  const acctType = c.subType ?? c.accountType;
                  const contribDetail =
                    c.contributionMethod === "percent_of_salary"
                      ? `${c.contributionValue}% of salary`
                      : c.contributionMethod === "fixed_per_period"
                        ? `$${c.contributionValue}/period`
                        : c.contributionMethod === "fixed_monthly"
                          ? `$${c.contributionValue}/mo`
                          : c.contributionMethod === "fixed_annual"
                            ? `$${c.contributionValue}/yr`
                            : `$${c.contributionValue}`;
                  const matchDetail =
                    c.employerMatchType !== "none" && c.employerMatchValue
                      ? `, ${c.employerMatchValue}% match${c.employerMaxMatchPct ? ` up to ${(parseFloat(c.employerMaxMatchPct) * 100).toFixed(0)}%` : ""}`
                      : "";
                  const employer = jobLabel(c.jobId);
                  const compatibleAccounts = activeAccounts.filter(
                    (pa) =>
                      pa.ownerPersonId === c.personId ||
                      pa.ownerPersonId === null,
                  );
                  return (
                    <div
                      key={c.id}
                      className="flex items-center gap-2 flex-wrap"
                    >
                      <select
                        value={
                          c.ownership === "joint" ? "joint" : String(c.personId)
                        }
                        onChange={(e) => {
                          const val = e.target.value;
                          if (val === "joint") {
                            handleContribUpdate(c, { ownership: "joint" });
                          } else {
                            handleContribUpdate(c, {
                              personId: parseInt(val, 10),
                              ownership: "individual",
                            });
                          }
                        }}
                        disabled={!admin}
                        className="border border-amber-300 rounded px-1 py-0.5 text-xs bg-surface-primary text-amber-800"
                      >
                        {personOptions.map((po) => (
                          <option key={po.value} value={po.value}>
                            {po.label}
                          </option>
                        ))}
                      </select>
                      <span className="text-amber-800 text-xs">
                        {taxLabel} {acctType} — {contribDetail}
                        {matchDetail} ({employer})
                        {!c.isActive && (
                          <span className="ml-1 text-[9px] px-1 py-0.5 rounded bg-surface-strong text-muted font-semibold">
                            INACTIVE
                          </span>
                        )}
                      </span>
                      <select
                        value=""
                        onChange={(e) => {
                          const val = e.target.value;
                          if (val) handleLinkContrib(c.id, parseInt(val, 10));
                        }}
                        disabled={!admin}
                        className="border border-amber-300 rounded px-1.5 py-0.5 text-xs bg-surface-primary"
                      >
                        <option value="">Link to...</option>
                        {compatibleAccounts.map((pa) => {
                          const linkedCount =
                            contribsByPerfId.get(pa.id)?.length ?? 0;
                          return (
                            <option key={pa.id} value={String(pa.id)}>
                              {pa.displayName ?? pa.accountLabel} —{" "}
                              {pa.parentCategory}
                              {linkedCount > 0
                                ? ` [${linkedCount} linked]`
                                : ""}
                            </option>
                          );
                        })}
                      </select>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <Card className="mt-0 rounded-t-none border-t-0 p-4">
            {/* Add Account button */}
            {admin && (
              <div className="flex justify-end items-center gap-1 mb-3">
                <HelpTip
                  maxWidth={360}
                  lines={[
                    <>
                      <strong>+ Add Account</strong> creates a new
                      portfolio-level account (e.g. a 401k at Fidelity).
                    </>,
                    "",
                    "Once created, expand the account to:",
                    <>
                      <strong>Add Sub-Accounts</strong> — Use &quot;+ Add
                      Sub-Account&quot; inside the Sub-Accounts section
                      (tax-type breakdowns like Roth, Traditional).
                    </>,
                    <>
                      <strong>Add Contributions</strong> — Use &quot;+ Add
                      Contribution&quot; inside the Contributions section
                      (paycheck rules for how much you contribute).
                    </>,
                  ]}
                />
                <button
                  onClick={() => setCreatingAccount(true)}
                  className="text-xs font-medium px-3 py-1.5 rounded bg-blue-600 text-white hover:bg-blue-700"
                >
                  + Add Account
                </button>
              </div>
            )}

            {/* Create account form */}
            {creatingAccount && (
              <div className="mb-4 border border-blue-200 rounded-lg p-4 bg-blue-50/50">
                <CreateAccountForm
                  people={peopleList}
                  onSubmit={(vals) => createPerfMut.mutate(vals)}
                  onCancel={() => setCreatingAccount(false)}
                  isPending={createPerfMut.isPending}
                />
              </div>
            )}

            {/* Account cards */}
            <div className="space-y-3">
              {visibleAccounts.map((pa) => (
                <AccountCard
                  key={pa.id}
                  account={pa}
                  contributions={contribsByPerfId.get(pa.id) ?? []}
                  balance={balanceByPerfId.get(pa.id) ?? null}
                  portfolioSubs={portfolioSubsByPerfId.get(pa.id) ?? []}
                  people={peopleList}
                  jobs={jobsList}
                  personOptions={personOptions}
                  categoryOptions={categoryOptions}
                  accountTypeOptions={accountTypeOptions}
                  isExpanded={expandedAcctId === pa.id}
                  onToggleExpand={() =>
                    setExpandedAcctId(expandedAcctId === pa.id ? null : pa.id)
                  }
                  onPerfUpdate={
                    admin
                      ? (updates) => handlePerfUpdate(pa, updates)
                      : undefined
                  }
                  onContribUpdate={admin ? handleContribUpdate : undefined}
                  onDelete={
                    admin
                      ? () => {
                          if (
                            confirm(
                              "Delete this account? Linked contributions will be unlinked.",
                            )
                          ) {
                            deletePerfMut.mutate({ id: pa.id });
                          }
                        }
                      : undefined
                  }
                  activeAccounts={activeAccounts}
                  onLinkContrib={admin ? handleLinkContrib : undefined}
                  onCreateContrib={
                    admin
                      ? (data: Record<string, unknown>) =>
                          createContribMut.mutate(
                            data as Parameters<
                              typeof createContribMut.mutate
                            >[0],
                          )
                      : undefined
                  }
                  onSubAccountUpdate={
                    admin
                      ? (id, updates) =>
                          updatePortfolioAccountMut.mutate({ id, ...updates })
                      : undefined
                  }
                  onCreateSubAccount={
                    admin && latestSnap
                      ? (data) =>
                          createPortfolioAccountMut.mutate({
                            ...data,
                            taxType: data.taxType as
                              | "preTax"
                              | "taxFree"
                              | "hsa"
                              | "afterTax",
                            parentCategory: data.parentCategory as
                              | "Retirement"
                              | "Portfolio"
                              | undefined,
                            snapshotId: latestSnap.snapshot.id,
                            performanceAccountId: pa.id,
                          })
                      : undefined
                  }
                />
              ))}
            </div>

            {/* Closed accounts toggle */}
            {closedAccounts.length > 0 && (
              <div className="border-t mt-3 pt-2">
                <button
                  onClick={() => setShowClosed(!showClosed)}
                  className="text-xs text-muted hover:text-secondary"
                >
                  {showClosed ? "Hide" : "Show"} {closedAccounts.length} closed
                  account
                  {closedAccounts.length > 1 ? "s" : ""}
                </button>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Account Card — one card per performance account
// ---------------------------------------------------------------------------

type ContribRow = typeof import("@/lib/db/schema").contributionAccounts.$inferSelect;

type PortfolioSub = {
  id: number;
  taxType: string;
  subType: string | null;
  label: string | null;
  amount: string;
  accountType: string;
  ownerPersonId: number | null;
  isActive: boolean;
};

function AccountCard({
  account: pa,
  contributions,
  balance,
  portfolioSubs,
  people,
  jobs,
  personOptions,
  categoryOptions,
  accountTypeOptions,
  isExpanded,
  onToggleExpand,
  onPerfUpdate,
  onContribUpdate,
  onDelete,
  activeAccounts: _activeAccounts,
  onLinkContrib: _onLinkContrib,
  onCreateContrib,
  onSubAccountUpdate,
  onCreateSubAccount,
}: {
  account: {
    id: number;
    institution: string;
    accountType: string;
    subType: string | null;
    label: string | null;
    accountLabel: string;
    displayName: string | null;
    ownerPersonId: number | null;
    ownershipType: string;
    parentCategory: string;
    isActive: boolean;
    displayOrder: number;
  };
  contributions: ContribRow[];
  balance: number | null;
  portfolioSubs: PortfolioSub[];
  people: { id: number; name: string }[];
  jobs: { id: number; employerName: string }[];
  personOptions: { value: string; label: string }[];
  categoryOptions: { value: string; label: string }[];
  accountTypeOptions: { value: string; label: string }[];
  isExpanded: boolean;
  onToggleExpand: () => void;
  onPerfUpdate?: (updates: Record<string, unknown>) => void;
  onContribUpdate?: (c: ContribRow, updates: Record<string, unknown>) => void;
  onDelete?: () => void;
  activeAccounts: { id: number; institution: string; accountLabel: string }[];
  onLinkContrib?: (contribId: number, perfAccountId: number | null) => void;
  onCreateContrib?: (data: Record<string, unknown>) => void;
  onSubAccountUpdate?: (
    id: number,
    updates: { ownerPersonId?: number | null; isActive?: boolean },
  ) => void;
  onCreateSubAccount?: (data: {
    institution: string;
    taxType: string;
    amount: string;
    accountType: string;
    subType?: string | null;
    label?: string | null;
    parentCategory: string;
    ownerPersonId?: number | null;
  }) => void;
}) {
  const [showAddContrib, setShowAddContrib] = useState(false);
  const [showAddSubAccount, setShowAddSubAccount] = useState(false);
  const [showInactiveContribs, setShowInactiveContribs] = useState(false);
  const [showDanger, setShowDanger] = useState(false);
  const [openSection, setOpenSection] = useState<
    "subs" | "contribs" | "settings" | null
  >("settings");

  // Account type from the master record (no resolution needed)
  const acctType = pa.accountType as AccountCategory | null;
  const cfg = acctType ? ACCOUNT_TYPE_CONFIG[acctType] : null;
  const borderColor = cfg?.colors.border ?? "";
  const bgLight = cfg?.colors.bgLight ?? "";

  const activeContribs = contributions.filter((c) => c.isActive);
  const inactiveContribs = contributions.filter((c) => !c.isActive);
  const activeSubs = portfolioSubs.filter((s) => s.isActive);
  const inactiveSubs = portfolioSubs.filter((s) => !s.isActive);

  const toggleSection = (s: "subs" | "contribs" | "settings") =>
    setOpenSection(openSection === s ? null : s);

  return (
    <div
      className={`border rounded-lg overflow-hidden ${!pa.isActive ? "opacity-50" : ""}${borderColor}`}
    >
      {" "}
      {/* Header row — always visible fields */}{" "}
      <div
        className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-surface-sunken${isExpanded ? bgLight : "bg-surface-primary"}`}
        onClick={onToggleExpand}
      >
        {/* Color indicator */}
        <div
          className={`w-1.5 h-8 rounded-full ${cfg?.colors.bg ?? "bg-surface-strong"} flex-shrink-0`}
        />
        {/* Name */}
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-primary truncate">
            {accountDisplayName(pa)}
          </div>
          <div className="text-[10px] text-faint">{pa.institution}</div>
        </div>
        {/* Account Type */}
        <div className="text-xs text-muted w-20 text-center">
          {cfg?.displayLabel ?? "—"}
        </div>
        {/* Balance */}
        <div className="text-xs text-muted w-24 text-right font-mono">
          {balance !== null ? formatCurrency(balance) : "—"}
        </div>
        {/* Owner */}
        <div className="text-xs text-muted w-20 text-center">
          {pa.ownerPersonId
            ? (people.find((p) => p.id === pa.ownerPersonId)?.name ?? "?")
            : "Joint"}
        </div>
        {/* Category */}
        <div className="text-xs text-muted w-20 text-center">
          {pa.parentCategory}
        </div>
        {/* Contrib count */}
        <div className="text-[10px] text-faint w-16 text-center">
          {activeContribs.length > 0
            ? `${activeContribs.length} contrib${activeContribs.length > 1 ? "s" : ""}`
            : ""}{" "}
        </div>{" "}
        {/* Expand indicator */}{" "}
        <span
          className={`text-xs text-faint transition-transform ${isExpanded ? "rotate-90" : ""}`}
        >
          {" "}
          &#9654;{" "}
        </span>{" "}
      </div>{" "}
      {/* Expanded detail — collapsible sections */}{" "}
      {isExpanded && (
        <div className="border-t border-subtle bg-surface-sunken/50">
          {" "}
          {/* ── Account Settings section (auto-expanded, first) ── */}{" "}
          {onPerfUpdate && (
            <div className="border-b border-subtle">
              {" "}
              <button
                onClick={() => toggleSection("settings")}
                className="w-full flex items-center justify-between px-4 py-2 text-[10px] font-semibold text-muted uppercase tracking-wider hover:bg-surface-elevated/50"
              >
                {" "}
                <span>Account Settings</span>{" "}
                <span
                  className={`transition-transform ${openSection === "settings" ? "rotate-90" : ""}`}
                >
                  &#9654;
                </span>
              </button>
              {openSection === "settings" && (
                <div className="px-4 pb-3 space-y-4">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div>
                      <label className="block text-[10px] text-muted mb-0.5">
                        Name (computed)
                      </label>
                      <div className="border border-subtle bg-surface-sunken rounded px-2 py-1 text-xs text-muted">
                        {pa.accountLabel}
                      </div>
                    </div>
                    <InlineText
                      label="Institution"
                      value={pa.institution}
                      onSave={(val) => {
                        if (val) onPerfUpdate({ institution: val });
                      }}
                    />
                    <InlineSelect
                      label="Account Type"
                      value={pa.accountType}
                      options={accountTypeOptions}
                      onChange={(val) => onPerfUpdate({ accountType: val })}
                    />
                    <InlineText
                      label="Label"
                      value={pa.label ?? ""}
                      placeholder="e.g. Long Term, Retirement"
                      onSave={(val) => onPerfUpdate({ label: val || null })}
                    />
                    <InlineSelect
                      label="Owner"
                      value={
                        pa.ownerPersonId ? String(pa.ownerPersonId) : "joint"
                      }
                      options={personOptions}
                      onChange={(val) => {
                        if (val === "joint") {
                          onPerfUpdate({
                            ownerPersonId: null,
                            ownershipType: "joint",
                          });
                        } else {
                          onPerfUpdate({
                            ownerPersonId: parseInt(val, 10),
                            ownershipType: "individual",
                          });
                        }
                      }}
                    />
                    <InlineSelect
                      label="Category"
                      value={pa.parentCategory}
                      options={categoryOptions}
                      onChange={(val) => onPerfUpdate({ parentCategory: val })}
                    />
                    <InlineText
                      label="Display Name"
                      value={pa.displayName ?? ""}
                      placeholder="Optional override"
                      onSave={(val) =>
                        onPerfUpdate({ displayName: val || null })
                      }
                    />
                  </div>
                  {/* Danger zone — collapsed by default */}
                  <div className="border-t pt-2 mt-3">
                    <button
                      onClick={() => setShowDanger(!showDanger)}
                      className="text-[10px] text-red-400 hover:text-red-500 font-semibold uppercase tracking-wider"
                    >
                      {showDanger ? "▾" : "▸"} Danger Zone
                    </button>
                    {showDanger && (
                      <div className="flex items-center gap-3 mt-2">
                        <button
                          onClick={() =>
                            onPerfUpdate({ isActive: !pa.isActive })
                          }
                          className={`text-xs px-2.5 py-1 rounded border ${pa.isActive ? "border-red-200 text-red-500 hover:bg-red-50" : "border-green-200 text-green-600 hover:bg-green-50"}`}
                        >
                          {" "}
                          {pa.isActive
                            ? "Close Account"
                            : "Reopen Account"}{" "}
                        </button>{" "}
                        {onDelete && (
                          <button
                            onClick={onDelete}
                            className="text-xs px-2.5 py-1 rounded border border-red-200 text-red-400 hover:bg-red-50 hover:text-red-600"
                          >
                            {" "}
                            Delete Account{" "}
                          </button>
                        )}{" "}
                      </div>
                    )}{" "}
                  </div>{" "}
                </div>
              )}{" "}
            </div>
          )}{" "}
          {/* ── Sub-Accounts section ── */}{" "}
          {portfolioSubs.length > 0 && (
            <div className="border-b border-subtle">
              {" "}
              <button
                onClick={() => toggleSection("subs")}
                className="w-full flex items-center justify-between px-4 py-2 text-[10px] font-semibold text-muted uppercase tracking-wider hover:bg-surface-elevated/50"
              >
                {" "}
                <span>
                  {" "}
                  Sub-Accounts ({activeSubs.length}{" "}
                  {inactiveSubs.length > 0
                    ? ` + ${inactiveSubs.length} inactive`
                    : ""}
                  )
                </span>
                <span
                  className={`transition-transform ${openSection === "subs" ? "rotate-90" : ""}`}
                >
                  {" "}
                  &#9654;{" "}
                </span>{" "}
              </button>{" "}
              {openSection === "subs" && (
                <div className="px-4 pb-3 space-y-2">
                  {" "}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                    {" "}
                    {activeSubs.map((sub) => (
                      <SubAccountRow
                        key={sub.id}
                        sub={sub}
                        people={people}
                        onUpdate={onSubAccountUpdate}
                      />
                    ))}{" "}
                  </div>{" "}
                  {inactiveSubs.length > 0 && (
                    <SubAccountInactiveSection
                      subs={inactiveSubs}
                      people={people}
                      onUpdate={onSubAccountUpdate}
                    />
                  )}{" "}
                  {onCreateSubAccount && (
                    <div className="pt-1">
                      {" "}
                      {!showAddSubAccount ? (
                        <button
                          onClick={() => setShowAddSubAccount(true)}
                          className="text-xs text-blue-500 hover:text-blue-700"
                        >
                          {" "}
                          + Add Sub-Account{" "}
                        </button>
                      ) : (
                        <AddSubAccountForm
                          institution={pa.institution}
                          accountType={pa.accountType}
                          parentCategory={pa.parentCategory}
                          ownerPersonId={pa.ownerPersonId}
                          people={people}
                          onSave={(data) => {
                            onCreateSubAccount(data);
                            setShowAddSubAccount(false);
                          }}
                          onCancel={() => setShowAddSubAccount(false)}
                        />
                      )}{" "}
                    </div>
                  )}{" "}
                </div>
              )}{" "}
            </div>
          )}{" "}
          {/* ── Contributions section ── */}{" "}
          <div>
            {" "}
            <button
              onClick={() => toggleSection("contribs")}
              className="w-full flex items-center justify-between px-4 py-2 text-[10px] font-semibold text-muted uppercase tracking-wider hover:bg-surface-elevated/50"
            >
              {" "}
              <span>
                {" "}
                Contributions ({activeContribs.length}{" "}
                {inactiveContribs.length > 0
                  ? ` + ${inactiveContribs.length} inactive`
                  : ""}
                )
              </span>
              <span
                className={`transition-transform ${openSection === "contribs" ? "rotate-90" : ""}`}
              >
                &#9654;
              </span>
            </button>
            {openSection === "contribs" && (
              <div className="px-4 pb-3">
                {activeContribs.length > 0 && (
                  <div className="space-y-2">
                    {activeContribs.map((c) => (
                      <ContributionRow
                        key={c.id}
                        contrib={c}
                        people={people}
                        jobs={jobs}
                        accountTypeOptions={accountTypeOptions}
                        onUpdate={
                          onContribUpdate
                            ? (updates) => onContribUpdate(c, updates)
                            : undefined
                        }
                      />
                    ))}
                  </div>
                )}
                {inactiveContribs.length > 0 && (
                  <div className="mt-2">
                    <button
                      onClick={() =>
                        setShowInactiveContribs(!showInactiveContribs)
                      }
                      className="text-[10px] text-faint hover:text-secondary"
                    >
                      {showInactiveContribs ? "Hide" : "Show"}{" "}
                      {inactiveContribs.length} inactive
                    </button>
                    {showInactiveContribs && (
                      <div className="space-y-2 mt-2">
                        {inactiveContribs.map((c) => (
                          <ContributionRow
                            key={c.id}
                            contrib={c}
                            people={people}
                            jobs={jobs}
                            accountTypeOptions={accountTypeOptions}
                            onUpdate={
                              onContribUpdate
                                ? (updates) => onContribUpdate(c, updates)
                                : undefined
                            }
                          />
                        ))}
                      </div>
                    )}
                  </div>
                )}
                {activeContribs.length === 0 &&
                  inactiveContribs.length === 0 &&
                  !showAddContrib && (
                    <p className="text-xs text-faint py-1">
                      No contributions linked yet.
                    </p>
                  )}
                {onCreateContrib && (
                  <div className="pt-2">
                    {!showAddContrib ? (
                      <button
                        onClick={() => setShowAddContrib(true)}
                        className="text-xs text-blue-500 hover:text-blue-700"
                      >
                        + Add Contribution
                      </button>
                    ) : (
                      <AddContribForm
                        accountType={pa.accountType}
                        parentCategory={pa.parentCategory}
                        performanceAccountId={pa.id}
                        ownerPersonId={pa.ownerPersonId}
                        people={people}
                        jobs={jobs}
                        onSave={(data) => {
                          onCreateContrib(data);
                          setShowAddContrib(false);
                        }}
                        onCancel={() => setShowAddContrib(false)}
                      />
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-Account Row + Inactive Section
// ---------------------------------------------------------------------------

function SubAccountRow({
  sub,
  people,
  onUpdate,
}: {
  sub: PortfolioSub;
  people: { id: number; name: string }[];
  onUpdate?: (
    id: number,
    updates: { ownerPersonId?: number | null; isActive?: boolean },
  ) => void;
}) {
  const taxLabel = taxTypeLabel(sub.taxType);
  const subLabel = sub.label || sub.subType || taxLabel;
  const ownerName = sub.ownerPersonId
    ? (people.find((p) => p.id === sub.ownerPersonId)?.name ?? "?")
    : "Joint";
  return (
    <div
      className={`px-3 py-2 bg-surface-primary border border-subtle rounded text-xs ${!sub.isActive ? "opacity-50" : ""}`}
    >
      {/* Line 1: label + amount */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-secondary font-medium truncate">
          {subLabel}
          {subLabel !== taxLabel && (
            <span className="text-faint ml-1 font-normal">({taxLabel})</span>
          )}
        </span>
        <span className="font-mono text-secondary shrink-0">
          {formatCurrency(parseFloat(sub.amount))}
        </span>
      </div>
      {/* Line 2: owner + action */}
      <div className="flex items-center justify-between gap-2 mt-1">
        <select
          value={sub.ownerPersonId ?? ""}
          onChange={(e) =>
            onUpdate?.(sub.id, {
              ownerPersonId: e.target.value
                ? parseInt(e.target.value, 10)
                : null,
            })
          }
          disabled={!onUpdate}
          className={`text-[10px] text-faint bg-transparent border-none p-0 focus:ring-0${onUpdate ? "cursor-pointer hover:text-secondary" : "cursor-default"}`}
          title={`Owner: ${ownerName}`}
        >
          <option value="">Joint</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        {onUpdate && (
          <button
            onClick={() => onUpdate(sub.id, { isActive: !sub.isActive })}
            className={`text-[10px] shrink-0 ${sub.isActive ? "text-red-400 hover:text-red-600" : "text-green-500 hover:text-green-700"}`}
            title={sub.isActive ? "Deactivate" : "Reactivate"}
          >
            {sub.isActive ? "Deactivate" : "Reactivate"}
          </button>
        )}
      </div>
    </div>
  );
}

function SubAccountInactiveSection({
  subs,
  people,
  onUpdate,
}: {
  subs: PortfolioSub[];
  people: { id: number; name: string }[];
  onUpdate?: (
    id: number,
    updates: { ownerPersonId?: number | null; isActive?: boolean },
  ) => void;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="mt-2">
      <button
        onClick={() => setShow(!show)}
        className="text-[10px] text-faint hover:text-secondary"
      >
        {show ? "Hide" : "Show"} {subs.length} inactive sub-account
        {subs.length > 1 ? "s" : ""}
      </button>
      {show && (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-1.5 mt-2">
          {subs.map((sub) => (
            <SubAccountRow
              key={sub.id}
              sub={sub}
              people={people}
              onUpdate={onUpdate}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Add Sub-Account Form
// ---------------------------------------------------------------------------

function AddSubAccountForm({
  institution,
  accountType,
  parentCategory,
  ownerPersonId,
  people,
  onSave,
  onCancel,
}: {
  institution: string;
  accountType: string;
  parentCategory: string;
  ownerPersonId: number | null;
  people: { id: number; name: string }[];
  onSave: (data: {
    institution: string;
    taxType: string;
    amount: string;
    accountType: string;
    subType?: string | null;
    label?: string | null;
    parentCategory: string;
    ownerPersonId?: number | null;
  }) => void;
  onCancel: () => void;
}) {
  const [taxType, setTaxType] = useState("preTax");
  const [amount, setAmount] = useState("0");
  const [subType, setSubType] = useState("");
  const [label, setLabel] = useState("");
  const [owner, setOwner] = useState<number | null>(ownerPersonId);

  return (
    <div className="border border-blue-200 rounded-lg p-3 bg-blue-50/30 space-y-2">
      <div className="text-[10px] font-semibold text-muted uppercase tracking-wider">
        New Sub-Account
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <div>
          <label className="text-[10px] text-muted">Tax Type</label>
          <select
            value={taxType}
            onChange={(e) => setTaxType(e.target.value)}
            className="w-full border rounded px-1.5 py-1 text-xs bg-surface-primary"
          >
            <option value="preTax">Pre-Tax</option>
            <option value="taxFree">Tax-Free (Roth)</option>
            <option value="afterTax">After-Tax</option>
            <option value="hsa">HSA</option>
          </select>
        </div>
        <div>
          <label className="text-[10px] text-muted">Amount</label>
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            className="w-full border rounded px-1.5 py-1 text-xs bg-surface-primary"
          />
        </div>
        <div>
          <label className="text-[10px] text-muted">Sub-Type</label>
          <input
            type="text"
            value={subType}
            onChange={(e) => setSubType(e.target.value)}
            placeholder="e.g. ESPP, Rollover"
            className="w-full border rounded px-1.5 py-1 text-xs bg-surface-primary"
          />
        </div>
        <div>
          <label className="text-[10px] text-muted">Label</label>
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. Employer Match"
            className="w-full border rounded px-1.5 py-1 text-xs bg-surface-primary"
          />
        </div>
        <div>
          <label className="text-[10px] text-muted">Owner</label>
          <select
            value={owner ?? ""}
            onChange={(e) =>
              setOwner(e.target.value ? parseInt(e.target.value, 10) : null)
            }
            className="w-full border rounded px-1.5 py-1 text-xs bg-surface-primary"
          >
            <option value="">Joint</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="flex gap-2 pt-1">
        <button
          onClick={() =>
            onSave({
              institution,
              taxType,
              amount: amount || "0",
              accountType,
              subType: subType.trim() || null,
              label: label.trim() || null,
              parentCategory,
              ownerPersonId: owner,
            })
          }
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

// ---------------------------------------------------------------------------
// Contribution Row — one row per contribution account, all fields editable
// ---------------------------------------------------------------------------

function ContributionRow({
  contrib: c,
  people,
  jobs,
  accountTypeOptions,
  onUpdate,
}: {
  contrib: ContribRow;
  people: { id: number; name: string }[];
  jobs: { id: number; employerName: string }[];
  accountTypeOptions: { value: string; label: string }[];
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
    ? `${(parseFloat(c.employerMaxMatchPct) * 100).toFixed(0)}%`
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
          <span className="text-faint">·</span>
          <span className="text-secondary font-mono">
            {c.contributionValue}
          </span>
          <span className="text-faint text-[10px]">
            {METHOD_LABELS[c.contributionMethod] ?? ""}
          </span>
          {c.employerMatchType !== "none" && c.employerMatchValue && (
            <>
              <span className="text-faint">·</span>
              <span className="text-faint">
                {c.employerMatchValue}% match
                {matchCapDisplay ? ` up to ${matchCapDisplay}` : ""}
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
            <span className="text-[10px] text-amber-500 font-medium">
              Inactive
            </span>
          )}
          {onUpdate && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onUpdate({ isActive: !c.isActive });
              }}
              className={`text-[10px] shrink-0 ${c.isActive ? "text-red-400 hover:text-red-600" : "text-green-500 hover:text-green-700"}`}
              title={c.isActive ? "Deactivate" : "Reactivate"}
            >
              {c.isActive ? "Deactivate" : "Reactivate"}
            </button>
          )}
          {onUpdate && (
            <button
              onClick={() => setShowAdvanced(true)}
              className="text-[10px] text-faint hover:text-secondary shrink-0"
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
            <span className="text-[10px] font-semibold text-muted uppercase tracking-wider">
              Edit Contribution
            </span>
            <button
              onClick={() => setShowAdvanced(false)}
              className="text-[10px] text-indigo-500 hover:text-indigo-700"
            >
              Done
            </button>
          </div>
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
                  onUpdate?.({ ownership: "joint" });
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
              label="Method"
              value={c.contributionMethod}
              options={Object.entries(METHOD_LABELS).map(([k, v]) => ({
                value: k,
                label: v,
              }))}
              onChange={(val) => onUpdate?.({ contributionMethod: val })}
              disabled={!onUpdate}
            />
            <InlineText
              label="Value"
              value={c.contributionValue}
              onSave={(val) => {
                if (val) onUpdate?.({ contributionValue: val });
              }}
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
                  label="Match Tax"
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
              <InlineText
                label="Overflow Priority"
                value={String(c.allocationPriority ?? 0)}
                placeholder="0"
                onSave={(val) =>
                  onUpdate?.({ allocationPriority: parseInt(val, 10) || 0 })
                }
                disabled={!onUpdate}
              />
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
// Create Account Form
// ---------------------------------------------------------------------------

function CreateAccountForm({
  people,
  onSubmit,
  onCancel,
  isPending,
}: {
  people: { id: number; name: string }[];
  onSubmit: (vals: {
    institution: string;
    accountType: string;
    subType: string | null;
    label: string | null;
    displayName: string | null;
    ownerPersonId: number | null;
    ownershipType: "individual" | "joint";
    parentCategory: "Retirement" | "Portfolio";
    isActive: boolean;
    displayOrder: number;
  }) => void;
  onCancel: () => void;
  isPending: boolean;
}) {
  const [institution, setInstitution] = useState("");
  const [accountType, setAccountType] = useState("401k");
  const [subType, setSubType] = useState("");
  const [label, setLabel] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [ownerPersonId, setOwnerPersonId] = useState<string>("");
  const [ownershipType, setOwnershipType] = useState<"individual" | "joint">(
    "individual",
  );
  const [parentCategory, setParentCategory] = useState<
    "Retirement" | "Portfolio"
  >("Retirement");

  const typeOptions = getAllCategories().map((c) => ({
    value: c,
    label: ACCOUNT_TYPE_CONFIG[c].displayLabel,
  }));

  return (
    <div className="space-y-3">
      <div className="text-xs font-semibold text-muted uppercase tracking-wider">
        New Account
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <label className="block">
          <span className="text-xs text-muted">Institution</span>
          <input
            type="text"
            value={institution}
            onChange={(e) => setInstitution(e.target.value)}
            className="mt-1 block w-full text-sm border border-strong rounded px-2 py-1.5"
          />
        </label>
        <label className="block">
          <span className="text-xs text-muted">Account Type</span>
          <select
            value={accountType}
            onChange={(e) => setAccountType(e.target.value)}
            className="mt-1 block w-full text-sm border border-strong rounded px-2 py-1.5"
          >
            {typeOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-xs text-muted">Sub-Type</span>
          <input
            type="text"
            value={subType}
            onChange={(e) => setSubType(e.target.value)}
            placeholder="e.g. ESPP, Rollover"
            className="mt-1 block w-full text-sm border border-strong rounded px-2 py-1.5"
          />
        </label>
        <label className="block">
          <span className="text-xs text-muted">Label</span>
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. Long Term"
            className="mt-1 block w-full text-sm border border-strong rounded px-2 py-1.5"
          />
        </label>
        <label className="block">
          <span className="text-xs text-muted">Ownership</span>
          <select
            value={ownershipType}
            onChange={(e) => {
              const v = e.target.value as "individual" | "joint";
              setOwnershipType(v);
              if (v === "joint") setOwnerPersonId("");
            }}
            className="mt-1 block w-full text-sm border border-strong rounded px-2 py-1.5"
          >
            <option value="individual">Individual</option>
            <option value="joint">Joint</option>
          </select>
        </label>
        {ownershipType === "individual" && (
          <label className="block">
            <span className="text-xs text-muted">Owner</span>
            <select
              value={ownerPersonId}
              onChange={(e) => setOwnerPersonId(e.target.value)}
              className="mt-1 block w-full text-sm border border-strong rounded px-2 py-1.5"
            >
              <option value="">Select...</option>
              {people.map((p) => (
                <option key={p.id} value={String(p.id)}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="block">
          <span className="text-xs text-muted">Category</span>
          <select
            value={parentCategory}
            onChange={(e) =>
              setParentCategory(e.target.value as "Retirement" | "Portfolio")
            }
            className="mt-1 block w-full text-sm border border-strong rounded px-2 py-1.5"
          >
            <option value="Retirement">Retirement</option>
            <option value="Portfolio">Portfolio</option>
          </select>
        </label>
        <label className="block">
          <span className="text-xs text-muted">Display Name</span>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Optional override"
            className="mt-1 block w-full text-sm border border-strong rounded px-2 py-1.5"
          />
        </label>
      </div>
      <div className="flex gap-2">
        <button
          onClick={() =>
            onSubmit({
              institution,
              accountType,
              subType: subType.trim() || null,
              label: label.trim() || null,
              displayName: displayName.trim() || null,
              ownerPersonId: ownerPersonId ? parseInt(ownerPersonId, 10) : null,
              ownershipType,
              parentCategory,
              isActive: true,
              displayOrder: 0,
            })
          }
          disabled={isPending || !institution || !accountType}
          className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
        >
          {isPending ? "Creating..." : "Create Account"}
        </button>
        <button
          onClick={onCancel}
          className="px-3 py-1.5 text-sm text-muted hover:text-primary"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Reusable inline edit primitives
// ---------------------------------------------------------------------------

function InlineText({
  label,
  value,
  placeholder,
  onSave,
  disabled,
}: {
  label: string;
  value: string;
  placeholder?: string;
  onSave: (val: string) => void;
  disabled?: boolean;
}) {
  return (
    <div>
      <label className="block text-[10px] text-muted mb-0.5">{label}</label>
      {disabled ? (
        <div className="border border-subtle bg-surface-sunken rounded px-2 py-1 text-xs text-muted">
          {value || placeholder || "—"}
        </div>
      ) : (
        <input
          type="text"
          defaultValue={value}
          placeholder={placeholder}
          onBlur={(e) => {
            const val = e.target.value.trim();
            if (val !== value) onSave(val);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          className="border rounded px-2 py-1 text-xs w-full"
        />
      )}
    </div>
  );
}

function InlineSelect({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (val: string) => void;
  disabled?: boolean;
}) {
  return (
    <div>
      <label className="block text-[10px] text-muted mb-0.5">{label}</label>
      {disabled ? (
        <div className="border border-subtle bg-surface-sunken rounded px-2 py-1 text-xs text-muted">
          {options.find((o) => o.value === value)?.label ?? value}
        </div>
      ) : (
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="border rounded px-2 py-1 text-xs w-full"
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Add Contribution Form — inline form to create a contribution linked to an account
// ---------------------------------------------------------------------------

function AddContribForm({
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
  const [method, setMethod] = useState("percent_of_salary");
  const [value, setValue] = useState("");
  const [matchType, setMatchType] = useState("none");
  const [matchValue, setMatchValue] = useState("");
  const [maxMatchPct, setMaxMatchPct] = useState("");

  const handleSubmit = () => {
    if (!value) return;
    onSave({
      personId,
      jobId,
      accountType,
      parentCategory,
      performanceAccountId,
      taxTreatment,
      contributionMethod: method,
      contributionValue: value,
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
      <div className="text-[10px] font-semibold text-muted uppercase tracking-wider">
        New Contribution
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <div>
          <label className="text-[10px] text-muted">Owner</label>
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
          <label className="text-[10px] text-muted">Job</label>
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
          <label className="text-[10px] text-muted">Tax Treatment</label>
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
          <label className="text-[10px] text-muted">Method</label>
          <select
            value={method}
            onChange={(e) => setMethod(e.target.value)}
            className="w-full border rounded px-1.5 py-1 text-xs bg-surface-primary"
          >
            {Object.entries(METHOD_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-[10px] text-muted">Value</label>
          <input
            type="number"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={
              method === "percent_of_salary" ? "e.g. 10" : "e.g. 500"
            }
            className="w-full border rounded px-1.5 py-1 text-xs bg-surface-primary"
          />
        </div>
        <div>
          <label className="text-[10px] text-muted">Match Type</label>
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
              <label className="text-[10px] text-muted">Match Value</label>
              <input
                type="number"
                value={matchValue}
                onChange={(e) => setMatchValue(e.target.value)}
                placeholder="e.g. 50"
                className="w-full border rounded px-1.5 py-1 text-xs bg-surface-primary"
              />
            </div>
            <div>
              <label className="text-[10px] text-muted">Max Match %</label>
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
          disabled={!value}
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
