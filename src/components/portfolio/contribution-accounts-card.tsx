"use client";

/** Expandable account card that composes settings, sub-accounts, and contributions sections for a single performance account. */

import React, { useState } from "react";
import { formatCurrency, accountDisplayName } from "@/lib/utils/format";
import { ACCOUNT_TYPE_CONFIG } from "@/lib/config/account-types";
import type { AccountCategory } from "@/lib/config/account-types";
import type { ContribRow, PortfolioSub } from "./contribution-accounts-types";
import { InlineText, InlineSelect } from "./contribution-accounts-inline";
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
