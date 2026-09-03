"use client";

/** Expandable account card that composes settings, sub-accounts, and contributions sections for a single performance account. */

import React, { useState } from "react";
import {
  formatCurrency,
  formatPercent,
  accountDisplayName,
} from "@/lib/utils/format";
import {
  EARLY_WITHDRAWAL_PENALTY_RATE,
  HSA_NON_MEDICAL_PENALTY_RATE,
} from "@/lib/constants";
import { confirm } from "@/components/ui/confirm-dialog";
import {
  accountBorderColor,
  accountMatchColor,
  accountColor,
} from "@/lib/utils/colors";
import {
  getAccountTypeConfig,
  isHsaCategory,
} from "@/lib/config/account-types";
import type { AccountCategory } from "@/lib/config/account-types";
import type { ContribRow, PortfolioSub } from "./contribution-accounts-types";
import { InlineText, InlineSelect } from "./contribution-accounts-inline";
import { HelpTip } from "@/components/ui/help-tip";
import {
  SubAccountRow,
  SubAccountInactiveSection,
  AddSubAccountForm,
} from "./contribution-accounts-sub-account";
import {
  ContributionRow,
  AddContribForm,
} from "./contribution-accounts-contrib-row";

export function AccountCard({
  account: pa,
  contributions,
  balance,
  portfolioSubs,
  people,
  jobs,
  personOptions,
  categoryOptions,
  accountTypeOptions,
  activeProfileName,
  activeProfileFields,
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
    retirementBehavior?: string;
    contributionScaling?: string;
    allowPenalizedWithdrawals?: boolean;
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
  /** Name of the globally-active Contribution Profile, or null if none —
   *  shown per contribution row so "why is this here" is answerable
   *  without leaving the Portfolio page. */
  activeProfileName: string | null;
  /** That profile's raw active-fields map, keyed by contribution account id
   *  — a key absent from this map means the account has no entry in the
   *  active profile at all, not that it's `null`. */
  activeProfileFields: Record<string, Record<string, unknown>>;
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
    updates: {
      ownerPersonId?: number | null;
      isActive?: boolean;
      label?: string | null;
      taxType?: string;
    },
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
  const cfg = acctType ? getAccountTypeConfig(acctType) : null;
  const borderColor = acctType ? accountBorderColor(acctType) : "";
  const bgLight = acctType ? accountMatchColor(acctType) : "";

  const activeContribs = contributions.filter((c) => c.isActive);
  const inactiveContribs = contributions.filter((c) => !c.isActive);
  // At most one active contribution per account holds real employer match
  // config (computeGroupedEmployerMatch enforces this) — its match applies
  // to the whole account, combining every active split's contribution
  // before capping, not just its own. A sibling split with no config of its
  // own still earns a real, proportional share of that match; ContributionRow
  // uses this to say so instead of showing nothing.
  const matchConfigContrib = activeContribs.find(
    (c) => c.employerMatchType && c.employerMatchType !== "none",
  );
  const activeSubs = portfolioSubs.filter((s) => s.isActive);
  const inactiveSubs = portfolioSubs.filter((s) => !s.isActive);

  const toggleSection = (s: "subs" | "contribs" | "settings") =>
    setOpenSection(openSection === s ? null : s);

  return (
    <div
      className={`overflow-hidden rounded-lg border ${!pa.isActive ? "opacity-50" : ""} ${borderColor}`}
    >
      {" "}
      {/* Header row — always visible fields */}{" "}
      <div
        className={`hover:bg-surface-sunken flex cursor-pointer items-center gap-3 px-4 py-2.5 ${isExpanded ? bgLight : "bg-surface-primary"}`}
        onClick={onToggleExpand}
      >
        {/* Color indicator */}
        <div
          className={`h-8 w-1.5 rounded-full ${acctType ? accountColor(acctType) : "bg-surface-strong"} flex-shrink-0`}
        />
        {/* Name */}
        <div className="min-w-0 flex-1">
          <div className="text-primary truncate text-sm font-medium">
            {accountDisplayName(pa)}
          </div>
          <div className="text-caption text-faint">{pa.institution}</div>
        </div>
        {/* Account Type */}
        <div className="text-muted w-20 text-center text-xs">
          {cfg?.displayLabel ?? "—"}
        </div>
        {/* Balance */}
        <div className="text-muted w-24 text-right font-mono text-xs">
          {balance !== null ? formatCurrency(balance) : "—"}
        </div>
        {/* Owner */}
        <div className="text-muted w-20 text-center text-xs">
          {pa.ownerPersonId
            ? (people.find((p) => p.id === pa.ownerPersonId)?.name ?? "?")
            : "Joint"}
        </div>
        {/* Category */}
        <div className="text-muted w-20 text-center text-xs">
          {pa.parentCategory}
        </div>
        {/* Contrib count */}
        <div className="text-caption text-faint w-16 text-center">
          {activeContribs.length > 0
            ? `${activeContribs.length} contrib${activeContribs.length > 1 ? "s" : ""}`
            : ""}{" "}
        </div>{" "}
        {/* Expand indicator */}{" "}
        <span
          className={`text-faint text-xs transition-transform ${isExpanded ? "rotate-90" : ""}`}
        >
          {" "}
          &#9654;{" "}
        </span>{" "}
      </div>{" "}
      {/* Expanded detail — collapsible sections */}{" "}
      {isExpanded && (
        <div className="border-subtle bg-surface-sunken/50 border-t">
          {" "}
          {/* ── Account Settings section (auto-expanded, first) ── */}{" "}
          {onPerfUpdate && (
            <div className="border-subtle border-b">
              {" "}
              <button
                onClick={() => toggleSection("settings")}
                className="text-caption text-muted hover:bg-surface-elevated/50 flex w-full items-center justify-between px-4 py-2 font-semibold tracking-wider uppercase"
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
                <div className="space-y-4 px-4 pb-3">
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                    <div>
                      <label className="text-caption text-muted mb-0.5 block">
                        Name (computed)
                      </label>
                      <div className="border-subtle bg-surface-sunken text-muted rounded border px-2 py-1 text-xs">
                        {/* lint-violation-ok: "Name (computed)" field deliberately shows the raw programmatic label, not the user-override displayName */}
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
                    <InlineSelect
                      label="After retirement"
                      value={
                        pa.retirementBehavior ?? "stops_at_owner_retirement"
                      }
                      options={[
                        {
                          value: "stops_at_owner_retirement",
                          label: "Stop contributions",
                        },
                        {
                          value: "stops_when_last_retires",
                          label: "Continue until last person retires",
                        },
                        {
                          value: "continues_after_retirement",
                          label: "Continue indefinitely",
                        },
                      ]}
                      onChange={(val) =>
                        onPerfUpdate({ retirementBehavior: val })
                      }
                    />
                    <InlineSelect
                      label="Contribution scaling"
                      value={pa.contributionScaling ?? "scales_with_salary"}
                      options={[
                        {
                          value: "scales_with_salary",
                          label: "Scales with salary",
                        },
                        {
                          value: "fixed_amount",
                          label: "Fixed amount",
                        },
                      ]}
                      onChange={(val) =>
                        onPerfUpdate({ contributionScaling: val })
                      }
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
                  <div className="mt-3 border-t pt-2">
                    <button
                      onClick={() => setShowDanger(!showDanger)}
                      className="text-caption font-semibold tracking-wider text-red-400 uppercase hover:text-red-500"
                    >
                      {showDanger ? "▾" : "▸"} Danger Zone
                    </button>
                    {showDanger && (
                      <div className="mt-2 flex items-center gap-3">
                        <button
                          onClick={async () => {
                            if (
                              !pa.isActive ||
                              (await confirm(
                                "Close this account? Its balance will be recorded as $0 starting with your next portfolio snapshot — this snapshot's total won't change until then.",
                              ))
                            ) {
                              onPerfUpdate({ isActive: !pa.isActive });
                            }
                          }}
                          className={`rounded border px-2.5 py-1 text-xs ${pa.isActive ? "border-red-200 text-red-500 hover:bg-red-50" : "border-green-200 text-green-600 hover:bg-green-50"}`}
                        >
                          {" "}
                          {pa.isActive
                            ? "Close Account"
                            : "Reopen Account"}{" "}
                        </button>{" "}
                        {onDelete && (
                          <button
                            onClick={onDelete}
                            className="rounded border border-red-200 px-2.5 py-1 text-xs text-red-400 hover:bg-red-50 hover:text-red-600"
                          >
                            {" "}
                            Delete Account{" "}
                          </button>
                        )}{" "}
                      </div>
                    )}{" "}
                    {showDanger && pa.ownershipType !== "joint" && (
                      <div className="mt-2 flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={pa.allowPenalizedWithdrawals ?? false}
                          onChange={async (e) => {
                            const checked = e.target.checked;
                            const rate = formatPercent(
                              isHsaCategory(pa.accountType)
                                ? HSA_NON_MEDICAL_PENALTY_RATE
                                : EARLY_WITHDRAWAL_PENALTY_RATE,
                              0,
                            );
                            if (
                              !checked ||
                              (await confirm(
                                `Allow the retirement projection to draw from this account even when it's early-withdrawal penalty-exposed? The projection will pay the ${rate} penalty on any exposed dollars it draws here. The household still avoids the penalty on every other account.`,
                              ))
                            ) {
                              onPerfUpdate({
                                allowPenalizedWithdrawals: checked,
                              });
                            }
                          }}
                          disabled={!onPerfUpdate}
                          className="border-strong rounded"
                          id={`allow-penalty-${pa.id}`}
                        />
                        <label
                          htmlFor={`allow-penalty-${pa.id}`}
                          className="text-muted text-xs"
                        >
                          Allow early-withdrawal penalty on this account
                        </label>
                        <HelpTip
                          text={`If checked, the retirement projection may draw penalty-exposed money from this specific account, paying the ${formatPercent(EARLY_WITHDRAWAL_PENALTY_RATE, 0)} (${formatPercent(HSA_NON_MEDICAL_PENALTY_RATE, 0)} for HSA) penalty when it does. The household still avoids the penalty on every other account. This is not a last-resort-only setting — normal withdrawal order decides when it's drawn.`}
                        />
                      </div>
                    )}{" "}
                  </div>{" "}
                </div>
              )}{" "}
            </div>
          )}{" "}
          {/* ── Sub-Accounts section ── */}{" "}
          {portfolioSubs.length > 0 && (
            <div className="border-subtle border-b">
              {" "}
              <button
                onClick={() => toggleSection("subs")}
                className="text-caption text-muted hover:bg-surface-elevated/50 flex w-full items-center justify-between px-4 py-2 font-semibold tracking-wider uppercase"
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
                <div className="space-y-2 px-4 pb-3">
                  {" "}
                  <p className="text-caption text-faint -mt-1 mb-1">
                    Balance entries tracked in your portfolio snapshots for this
                    account — distinct from the Contributions below, which is
                    about where new money is directed.
                  </p>
                  <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
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
              className="text-caption text-muted hover:bg-surface-elevated/50 flex w-full items-center justify-between px-4 py-2 font-semibold tracking-wider uppercase"
            >
              {" "}
              <span> Contributions ({activeContribs.length})</span>
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
                        activeProfileName={activeProfileName}
                        activeProfileFields={
                          activeProfileFields[String(c.id)] ?? null
                        }
                        sharedMatchFrom={
                          (!c.employerMatchType ||
                            c.employerMatchType === "none") &&
                          matchConfigContrib &&
                          matchConfigContrib.id !== c.id
                            ? matchConfigContrib
                            : undefined
                        }
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
                      className="text-caption text-faint hover:text-secondary"
                    >
                      {showInactiveContribs ? "Hide" : "Show"}{" "}
                      {inactiveContribs.length} not funding a target
                    </button>
                    {showInactiveContribs && (
                      <div className="mt-2 space-y-2">
                        {inactiveContribs.map((c) => (
                          <ContributionRow
                            key={c.id}
                            contrib={c}
                            people={people}
                            jobs={jobs}
                            accountTypeOptions={accountTypeOptions}
                            activeProfileName={activeProfileName}
                            activeProfileFields={
                              activeProfileFields[String(c.id)] ?? null
                            }
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
                    <p className="text-faint py-1 text-xs">
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
