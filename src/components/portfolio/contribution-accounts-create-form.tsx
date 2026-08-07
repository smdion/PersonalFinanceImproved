"use client";

/** Form for creating a new performance account with institution, type, ownership, and category fields. */

import React, { useState } from "react";
import {
  ACCOUNT_TYPE_CONFIG,
  getAllCategories,
  getParentCategory,
  type AccountCategory,
} from "@/lib/config/account-types";
import {
  PERF_CATEGORY_RETIREMENT,
  PERF_CATEGORY_PORTFOLIO,
} from "@/lib/config/display-labels";

export function CreateAccountForm({
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
  const [accountType, setAccountType] = useState(getAllCategories()[0]!);
  const [subType, setSubType] = useState("");
  const [label, setLabel] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [ownerPersonId, setOwnerPersonId] = useState<string>("");
  const [ownershipType, setOwnershipType] = useState<"individual" | "joint">(
    "individual",
  );
  // Category defaults from the account type (e.g. Brokerage -> Portfolio) and
  // re-derives whenever the type changes, until the user manually overrides
  // it — otherwise accounts silently get mistagged (e.g. a taxable brokerage
  // account left under "Retirement"), which corrupts the savings-rate
  // breakdown downstream in contribution.ts's computeSummary.
  const [parentCategory, setParentCategory] = useState<
    "Retirement" | "Portfolio"
  >(getParentCategory(accountType));
  const [categoryTouched, setCategoryTouched] = useState(false);

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
            onChange={(e) => {
              const next = e.target.value as AccountCategory;
              setAccountType(next);
              if (!categoryTouched) setParentCategory(getParentCategory(next));
            }}
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
            onChange={(e) => {
              setParentCategory(e.target.value as "Retirement" | "Portfolio");
              setCategoryTouched(true);
            }}
            className="mt-1 block w-full text-sm border border-strong rounded px-2 py-1.5"
          >
            <option value={PERF_CATEGORY_RETIREMENT}>
              {PERF_CATEGORY_RETIREMENT}
            </option>
            <option value={PERF_CATEGORY_PORTFOLIO}>
              {PERF_CATEGORY_PORTFOLIO}
            </option>
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
