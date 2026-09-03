"use client";

/**
 * Top-level account and contribution settings panel.
 *
 * Fetches all portfolio data via tRPC and orchestrates CRUD mutations via
 * useContributionAccountsMutations. Renders the collapsible panel with
 * UnlinkedContribsBanner + AccountCard list.
 */

import React, { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { useUser, isAdmin } from "@/lib/context/user-context";
import { Card } from "@/components/ui/card";
import { HelpTip } from "@/components/ui/help-tip";
import {
  PERF_CATEGORY_RETIREMENT,
  PERF_CATEGORY_PORTFOLIO,
} from "@/lib/config/display-labels";
import {
  ACCOUNT_TYPE_CONFIG,
  getAllCategories,
} from "@/lib/config/account-types";
import type { PortfolioSub } from "./contribution-accounts-types";
import { AccountCard } from "./contribution-accounts-card";
import { CreateAccountForm } from "./contribution-accounts-create-form";
import { useContributionAccountsMutations } from "./use-contribution-accounts-mutations";
import { UnlinkedContribsBanner } from "./unlinked-contribs-banner";
import { useActiveContribProfile } from "@/lib/hooks/use-active-contrib-profile";
import { useEffectiveProfileId } from "@/lib/hooks/use-effective-profile-id";

export function ContributionAccountsSettings() {
  const user = useUser();
  const admin = isAdmin(user);
  const { data: people } = trpc.settings.people.list.useQuery();
  const { data: jobs } = trpc.settings.jobs.list.useQuery();
  const { data: contribs } = trpc.settings.contributionAccounts.list.useQuery();
  const { data: perfAccounts } =
    trpc.performance.performanceAccounts.list.useQuery();
  const { data: latestSnap } =
    trpc.networth.portfolioSnapshots.getLatest.useQuery();

  // Employer-match/auto-maximize fields on a contribution account are
  // profile-ownable (see contribAccountActiveFieldsSchema) — when a
  // Contribution Profile is active, editing them here must write into that
  // same profile entry the Paycheck/Budget pages write into, not the raw
  // account row, or an edit made here would be silently shadowed by the
  // active profile everywhere else in the app.
  const [rawActiveContribProfileId] = useActiveContribProfile();
  const { data: contribProfilesList } =
    trpc.contributionProfile.list.useQuery();
  const { profileId: activeContribProfileId } = useEffectiveProfileId(
    "contribution",
    {
      validIds: contribProfilesList?.map((p) => p.id),
      localSelection: null,
      globalDefaultId: rawActiveContribProfileId,
    },
  );
  // Powers each contribution row's "$X in <profile name>" status line —
  // the account itself carries no value, only the active Contribution
  // Profile's own entry does (see applyContribActiveFields), and that fact
  // otherwise lives entirely on the Budget page, two navigations away from
  // where a user would actually notice a row behaving unexpectedly.
  const { data: contribCompareData } =
    trpc.contributionProfile.compareData.useQuery();
  const activeProfileName =
    contribProfilesList?.find((p) => p.id === activeContribProfileId)?.name ??
    null;
  const activeProfileFields =
    contribCompareData?.profiles.find((p) => p.id === activeContribProfileId)
      ?.accountActiveFields ?? {};
  const [showClosed, setShowClosed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [expandedAcctId, setExpandedAcctId] = useState<number | null>(null);
  const [creatingAccount, setCreatingAccount] = useState(false);

  // ---- Derived data ----
  const allContribs = useMemo(() => contribs ?? [], [contribs]);
  const allAccounts = useMemo(
    () =>
      (perfAccounts ?? []).sort((a, b) => {
        if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
        return a.displayOrder - b.displayOrder;
      }),
    [perfAccounts],
  );
  const activeAccounts = useMemo(
    () => allAccounts.filter((pa) => pa.isActive),
    [allAccounts],
  );
  const closedAccounts = useMemo(
    () => allAccounts.filter((pa) => !pa.isActive),
    [allAccounts],
  );
  const peopleList = people ?? [];
  const jobsList = jobs ?? [];

  const { contribsByPerfId, unlinkedContribs } = useMemo(() => {
    const map = new Map<number, typeof allContribs>();
    for (const c of allContribs) {
      if (c.performanceAccountId !== null) {
        const arr = map.get(c.performanceAccountId) ?? [];
        arr.push(c);
        map.set(c.performanceAccountId, arr);
      }
    }
    const unlinked = allContribs.filter(
      (c) => c.performanceAccountId === null && c.isActive,
    );
    return { contribsByPerfId: map, unlinkedContribs: unlinked };
  }, [allContribs]);

  const { balanceByPerfId, portfolioSubsByPerfId } = useMemo(() => {
    const balMap = new Map<number, number>();
    const subMap = new Map<number, PortfolioSub[]>();
    if (latestSnap?.accounts) {
      for (const a of latestSnap.accounts) {
        if (a.performanceAccountId) {
          if (a.isActive !== false) {
            balMap.set(
              a.performanceAccountId,
              (balMap.get(a.performanceAccountId) ?? 0) + parseFloat(a.amount),
            );
          }
          const subs = subMap.get(a.performanceAccountId) ?? [];
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
          subMap.set(a.performanceAccountId, subs);
        }
      }
    }
    return { balanceByPerfId: balMap, portfolioSubsByPerfId: subMap };
  }, [latestSnap]);

  // ---- Helpers ----
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
    { value: PERF_CATEGORY_RETIREMENT, label: PERF_CATEGORY_RETIREMENT },
    { value: PERF_CATEGORY_PORTFOLIO, label: PERF_CATEGORY_PORTFOLIO },
  ];
  const accountTypeOptions = getAllCategories().map((c) => ({
    value: c,
    label: ACCOUNT_TYPE_CONFIG[c].displayLabel,
  }));

  // ---- Mutations ----
  const {
    createPerfMut,
    deletePerfMut,
    createContribMut,
    updatePortfolioAccountMut,
    createPortfolioAccountMut,
    handlePerfUpdate,
    handleContribUpdate,
    handleLinkContrib,
  } = useContributionAccountsMutations({
    allContribs,
    activeContribProfileId,
  });

  if (allAccounts.length === 0 && !creatingAccount) return null;

  const visibleAccounts = showClosed ? allAccounts : activeAccounts;

  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="bg-surface-primary hover:bg-surface-sunken flex w-full items-center justify-between rounded-lg border px-5 py-3 shadow-sm transition-colors"
      >
        <div className="flex items-center gap-2">
          {" "}
          <span
            className={`text-faint text-xs transition-transform ${expanded ? "rotate-90" : ""}`}
          >
            &#9654;
          </span>
          <span className="text-primary font-semibold">
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
          <span className="text-faint text-xs">
            ({activeAccounts.length} account
            {activeAccounts.length !== 1 ? "s" : ""})
          </span>
        </div>
        <span className="text-faint text-xs">
          {expanded ? "Click to collapse" : "Click to expand"}
        </span>
      </button>

      {expanded && (
        <>
          <UnlinkedContribsBanner
            unlinkedContribs={unlinkedContribs}
            activeAccounts={activeAccounts}
            contribsByPerfId={contribsByPerfId}
            personOptions={personOptions}
            jobLabel={jobLabel}
            admin={admin}
            onContribOwnerChange={(c, update) => {
              const full = allContribs.find((x) => x.id === c.id);
              if (full) handleContribUpdate(full, update);
            }}
            onLinkContrib={handleLinkContrib}
          />

          <Card className="mt-0 rounded-t-none border-t-0 p-4">
            {admin && (
              <div className="mb-3 flex items-center justify-end gap-1">
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
                  className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
                >
                  + Add Account
                </button>
              </div>
            )}

            {creatingAccount && (
              <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50/50 p-4">
                <CreateAccountForm
                  people={peopleList}
                  onSubmit={(vals) =>
                    createPerfMut.mutate(
                      {
                        ...vals,
                        accountType:
                          vals.accountType as import("@/lib/config/account-types").AccountCategory,
                      },
                      { onSuccess: () => setCreatingAccount(false) },
                    )
                  }
                  onCancel={() => setCreatingAccount(false)}
                  isPending={createPerfMut.isPending}
                />
              </div>
            )}

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
                  activeProfileName={activeProfileName}
                  activeProfileFields={activeProfileFields}
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
                          updatePortfolioAccountMut.mutate({
                            id,
                            ...updates,
                            taxType: updates.taxType as
                              | "preTax"
                              | "taxFree"
                              | "afterTax"
                              | "hsa"
                              | undefined,
                          })
                      : undefined
                  }
                  onCreateSubAccount={
                    admin && latestSnap
                      ? (data) =>
                          createPortfolioAccountMut.mutate({
                            ...data,
                            accountType:
                              data.accountType as import("@/lib/config/account-types").AccountCategory,
                            taxType: data.taxType as
                              "preTax" | "taxFree" | "hsa" | "afterTax",
                            parentCategory: data.parentCategory as
                              "Retirement" | "Portfolio" | undefined,
                            snapshotId: latestSnap.snapshot.id,
                            performanceAccountId: pa.id,
                          })
                      : undefined
                  }
                />
              ))}
            </div>

            {closedAccounts.length > 0 && (
              <div className="mt-3 border-t pt-2">
                <button
                  onClick={() => setShowClosed(!showClosed)}
                  className="text-muted hover:text-secondary text-xs"
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
