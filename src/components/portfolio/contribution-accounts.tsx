"use client";

/** Top-level account and contribution settings panel that fetches all portfolio data via tRPC and orchestrates CRUD mutations across accounts, contributions, and sub-accounts. */

import React, { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useUser, isAdmin } from "@/lib/context/user-context";
import { Card } from "@/components/ui/card";
import { HelpTip } from "@/components/ui/help-tip";
import { TAX_TREATMENT_LABELS as TAX_LABELS } from "@/lib/config/display-labels";
import {
  ACCOUNT_TYPE_CONFIG,
  getAllCategories,
} from "@/lib/config/account-types";
import type { PortfolioSub } from "./contribution-accounts-types";
import { AccountCard } from "./contribution-accounts-card";
import { CreateAccountForm } from "./contribution-accounts-create-form";

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
