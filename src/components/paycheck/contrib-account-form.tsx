"use client";

/**
 * Full-field contribution-account create form — the one complete surface
 * for `settings.contributionAccounts.create`'s entire field set. Mirrors
 * the field set and conditional-visibility logic already proven in
 * ContributionRow's edit panel (contribution-accounts-contrib-row.tsx),
 * plus the three fields that panel doesn't need because it edits an
 * account already scoped inside one institution's card: institution
 * (performanceAccountId), label, and subType.
 *
 * No Value/Method fields here — an account is purely structural.
 * contributionValue/contributionMethod are ALWAYS a Contribution Profile's
 * active-field entry, set afterward in the Contribution Profile editor, not
 * at creation time (see applyContribActiveFields — accounts carry no value
 * of their own, no fallback).
 *
 * Used by What-If's "Make real", the Contribution Profiles tab's
 * "+ Add Account", and the Paycheck page's create flow — the three
 * surfaces that previously either sent a hardcoded field subset or had no
 * creation path at all.
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { FormField, FormInput, FormSelect } from "@/components/forms";
import {
  ACCOUNT_TYPE_CONFIG,
  getAllCategories,
  getDefaultTaxTreatment,
  getParentCategory,
} from "@/lib/config/account-types";
import type { AccountCategory } from "@/lib/config/account-types";
import {
  TAX_TREATMENT_LABELS as TAX_LABELS,
  EMPLOYER_MATCH_LABELS as MATCH_LABELS,
  EMPLOYER_MATCH_VALUE_UNIT,
  MATCH_TAX_LABELS,
  HSA_COVERAGE_LABELS,
} from "@/lib/config/display-labels";
import { InstitutionPicker } from "./institution-picker";
import { resolveContribFieldDisplayState } from "@/lib/pure/profiles";

type TaxTreatment = "pre_tax" | "tax_free" | "after_tax" | "hsa";
type EmployerMatchType =
  "none" | "percent_of_contribution" | "dollar_match" | "fixed_annual";

export type ContribAccountFormValues = {
  /** Set only when the user chose to reuse an existing (often inactive
   *  stub) contribution row instead of creating a new one — callers branch
   *  on this to call `update` instead of `create`. */
  id?: number;
  personId: number | null;
  jobId: number | null;
  accountType: AccountCategory;
  parentCategory: "Retirement" | "Portfolio";
  performanceAccountId: number | null;
  label: string | null;
  subType: string | null;
  taxTreatment: TaxTreatment;
  employerMatchType: EmployerMatchType;
  employerMatchValue: string | null;
  employerMaxMatchPct: string | null;
  employerMatchTaxTreatment: "pre_tax" | "tax_free";
  hsaCoverageType: "self_only" | "family" | null;
  autoMaximize: boolean;
  isActive: boolean;
  ownership: "individual" | "joint";
  targetAnnual: string | null;
  allocationPriority: number;
  notes: string | null;
  isPayrollDeducted: boolean | null;
};

const FIRST_TYPE = getAllCategories()[0]!;

function defaultsFor(
  overrides?: Partial<ContribAccountFormValues>,
): ContribAccountFormValues {
  const accountType = overrides?.accountType ?? FIRST_TYPE;
  return {
    personId: null,
    jobId: null,
    accountType,
    parentCategory: getParentCategory(accountType),
    performanceAccountId: null,
    label: null,
    subType: null,
    taxTreatment: getDefaultTaxTreatment(accountType) as TaxTreatment,
    employerMatchType: "none",
    employerMatchValue: null,
    employerMaxMatchPct: null,
    employerMatchTaxTreatment: "pre_tax",
    hsaCoverageType: null,
    autoMaximize: false,
    isActive: true,
    ownership: "individual",
    targetAnnual: null,
    allocationPriority: 0,
    notes: null,
    isPayrollDeducted: null,
    ...overrides,
  };
}

export function ContribAccountForm({
  initialValues,
  onSave,
  onCancel,
  isPending,
}: {
  initialValues?: Partial<ContribAccountFormValues>;
  onSave: (data: ContribAccountFormValues) => void;
  onCancel: () => void;
  isPending?: boolean;
}) {
  const { data: people } = trpc.settings.people.list.useQuery();
  const { data: jobs } = trpc.settings.jobs.list.useQuery();
  const { data: existingAccounts } =
    trpc.settings.contributionAccounts.list.useQuery();
  const { data: compareData } = trpc.contributionProfile.compareData.useQuery();
  const [v, setV] = useState<ContribAccountFormValues>(() =>
    defaultsFor(initialValues),
  );
  const [linkedExistingId, setLinkedExistingId] = useState<number | null>(
    initialValues?.id ?? null,
  );
  // Match cap is stored server-side as a decimal fraction (0.07) but edited
  // as a percentage (7) — same convention as ContributionRow's edit panel.
  const [matchCapPercent, setMatchCapPercent] = useState(
    v.employerMaxMatchPct
      ? String(parseFloat(v.employerMaxMatchPct) * 100)
      : "",
  );

  // Owner falls back to the first loaded person until the caller pins one
  // or the user picks explicitly — resolved at render/submit time instead
  // of an effect, since `people` arrives async from its own query.
  const effectivePersonId =
    v.ownership === "individual"
      ? (v.personId ?? people?.[0]?.id ?? null)
      : null;

  const set = <K extends keyof ContribAccountFormValues>(
    key: K,
    value: ContribAccountFormValues[K],
  ) => setV((prev) => ({ ...prev, [key]: value }));

  const cfg = ACCOUNT_TYPE_CONFIG[v.accountType];
  const hasCoverage =
    cfg.irsLimitKeys != null && "coverageVariant" in cfg.irsLimitKeys;
  const subTypeOptions = cfg.subTypeOptions;

  // An institution can already have a contribution row for this account
  // type — often an inactive stub auto-created alongside a sibling tax
  // treatment (see settings.contributionAccounts.create), or a real
  // account. Surface it instead of silently creating a duplicate row.
  const matchingExisting = (existingAccounts ?? []).filter(
    (a) =>
      v.performanceAccountId != null &&
      a.performanceAccountId === v.performanceAccountId &&
      a.accountType === v.accountType &&
      a.id !== linkedExistingId,
  );

  // Which Contribution Profiles have set an active value for a given
  // existing account — surfaced as context, not a blocker: reusing an
  // account another profile already values is fine, it just shouldn't be a
  // surprise.
  const profileNamesFor = (accountId: number): string[] =>
    (compareData?.profiles ?? [])
      .filter(
        (p) =>
          resolveContribFieldDisplayState(
            p.accountActiveFields[String(accountId)] ?? null,
          ).hasValue,
      )
      .map((p) => p.name);

  const linkToExisting = (
    match: NonNullable<typeof existingAccounts>[number],
  ) => {
    setLinkedExistingId(match.id);
    setV((prev) => ({
      ...prev,
      personId: match.personId,
      jobId: match.jobId,
      accountType: match.accountType as AccountCategory,
      parentCategory: match.parentCategory as "Retirement" | "Portfolio",
      performanceAccountId: match.performanceAccountId,
      label: match.label,
      subType: match.subType,
      taxTreatment: match.taxTreatment as TaxTreatment,
      employerMatchType: match.employerMatchType as EmployerMatchType,
      employerMatchValue: match.employerMatchValue,
      employerMaxMatchPct: match.employerMaxMatchPct,
      employerMatchTaxTreatment: match.employerMatchTaxTreatment as
        "pre_tax" | "tax_free",
      hsaCoverageType: match.hsaCoverageType as "self_only" | "family" | null,
      autoMaximize: match.autoMaximize,
      isActive: true,
      ownership: match.ownership as "individual" | "joint",
      targetAnnual: match.targetAnnual,
      allocationPriority: match.allocationPriority,
      notes: match.notes,
      isPayrollDeducted: match.isPayrollDeducted,
    }));
    setMatchCapPercent(
      match.employerMaxMatchPct
        ? String(parseFloat(match.employerMaxMatchPct) * 100)
        : "",
    );
  };

  const canSubmit = v.ownership === "joint" || effectivePersonId != null;

  const handleAccountTypeChange = (next: AccountCategory) => {
    const nextCfg = ACCOUNT_TYPE_CONFIG[next];
    setV((prev) => ({
      ...prev,
      accountType: next,
      parentCategory: getParentCategory(next),
      taxTreatment: (
        nextCfg.supportedTaxTreatments as readonly string[]
      ).includes(prev.taxTreatment)
        ? prev.taxTreatment
        : (nextCfg.supportedTaxTreatments[0] as TaxTreatment),
      hsaCoverageType:
        nextCfg.irsLimitKeys != null &&
        "coverageVariant" in nextCfg.irsLimitKeys
          ? prev.hsaCoverageType
          : null,
      // The linked institution is scoped to the previous account type —
      // clear it rather than leave a mismatched id the picker can no
      // longer display an option for.
      performanceAccountId: null,
    }));
    setLinkedExistingId(null);
  };

  const handleSubmit = () => {
    if (!canSubmit) return;
    onSave({
      ...v,
      id: linkedExistingId ?? undefined,
      personId: v.ownership === "joint" ? null : effectivePersonId,
      employerMaxMatchPct:
        v.employerMatchType === "percent_of_contribution" && matchCapPercent
          ? String(parseFloat(matchCapPercent) / 100)
          : null,
    });
  };

  return (
    <div className="space-y-3">
      {/* Always-visible mode indicator — the amber "existing accounts"
          banner and the submit button's label both signal this too, but
          only when scrolled into view; this stays pinned at the top so the
          create-vs-reuse distinction can't be missed. */}
      <div
        className={`rounded-lg px-3 py-2 text-sm font-medium flex items-center justify-between gap-2 ${
          linkedExistingId != null
            ? "bg-blue-50 text-blue-700 border border-blue-200"
            : "bg-surface-sunken text-muted border border-subtle"
        }`}
      >
        <span>
          {linkedExistingId != null ? (
            <>
              {`Reusing your existing ${TAX_LABELS[v.taxTreatment] ?? v.taxTreatment} ${cfg.displayLabel} account — saving will update it, not create a new one.`}
              {(() => {
                const names = profileNamesFor(linkedExistingId);
                return names.length > 0
                  ? ` Note: ${names.join(", ")} ${names.length > 1 ? "have" : "has"} a value set for this account.`
                  : "";
              })()}
            </>
          ) : (
            "Creating a new contribution account. Set its contribution amount afterward in the Contribution Profile editor — accounts don't carry a value of their own."
          )}
        </span>
        {linkedExistingId != null && (
          <button
            type="button"
            onClick={() => setLinkedExistingId(null)}
            className="text-caption text-blue-700 underline hover:no-underline shrink-0"
          >
            Create new instead
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <FormField label="Owner">
          <FormSelect
            value={
              v.ownership === "joint"
                ? "joint"
                : String(effectivePersonId ?? "")
            }
            onChange={(e) => {
              const val = e.target.value;
              if (val === "joint") {
                set("ownership", "joint");
                set("personId", null);
              } else {
                set("ownership", "individual");
                set("personId", parseInt(val, 10));
              }
            }}
          >
            <option value="joint">Joint</option>
            {(people ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </FormSelect>
        </FormField>

        <FormField label="Job">
          <FormSelect
            value={v.jobId ?? ""}
            onChange={(e) =>
              set("jobId", e.target.value ? parseInt(e.target.value, 10) : null)
            }
          >
            <option value="">Personal</option>
            {(jobs ?? []).map((j) => (
              <option key={j.id} value={j.id}>
                {j.employerName}
              </option>
            ))}
          </FormSelect>
        </FormField>

        <FormField label="Account Type">
          <FormSelect
            value={v.accountType}
            onChange={(e) =>
              handleAccountTypeChange(e.target.value as AccountCategory)
            }
          >
            {getAllCategories().map((c) => (
              <option key={c} value={c}>
                {ACCOUNT_TYPE_CONFIG[c].displayLabel}
              </option>
            ))}
          </FormSelect>
        </FormField>

        <InstitutionPicker
          personId={v.ownership === "joint" ? null : effectivePersonId}
          accountType={v.accountType}
          value={v.performanceAccountId}
          onChange={(id) => set("performanceAccountId", id)}
        />

        <FormField label="Label">
          <FormInput
            type="text"
            value={v.label ?? ""}
            onChange={(e) => set("label", e.target.value || null)}
            placeholder="Optional"
          />
        </FormField>

        <FormField label="Sub-Type">
          <FormInput
            type="text"
            list="contrib-account-form-subtype-options"
            value={v.subType ?? ""}
            onChange={(e) => set("subType", e.target.value || null)}
            placeholder="e.g. ESPP, Rollover"
          />
          {subTypeOptions.length > 0 && (
            <datalist id="contrib-account-form-subtype-options">
              {subTypeOptions.map((opt) => (
                <option key={opt} value={opt} />
              ))}
            </datalist>
          )}
        </FormField>

        <FormField label="Tax Treatment">
          <FormSelect
            value={v.taxTreatment}
            onChange={(e) =>
              set("taxTreatment", e.target.value as TaxTreatment)
            }
          >
            {cfg.supportedTaxTreatments.map((t) => (
              <option key={t} value={t}>
                {TAX_LABELS[t] ?? t}
              </option>
            ))}
          </FormSelect>
        </FormField>

        <FormField label="Match Type">
          <FormSelect
            value={v.employerMatchType}
            onChange={(e) =>
              set("employerMatchType", e.target.value as EmployerMatchType)
            }
          >
            {Object.entries(MATCH_LABELS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </FormSelect>
        </FormField>

        {v.employerMatchType !== "none" && (
          <>
            <FormField
              label={
                EMPLOYER_MATCH_VALUE_UNIT[v.employerMatchType] === "$"
                  ? "Match Amount"
                  : "Match Value"
              }
            >
              <FormInput
                type="number"
                step="any"
                value={v.employerMatchValue ?? ""}
                onChange={(e) =>
                  set("employerMatchValue", e.target.value || null)
                }
                placeholder={
                  EMPLOYER_MATCH_VALUE_UNIT[v.employerMatchType] === "$"
                    ? "e.g. 400"
                    : "e.g. 50"
                }
              />
            </FormField>
            {v.employerMatchType === "percent_of_contribution" && (
              <FormField label="Match Cap %">
                <FormInput
                  type="number"
                  step="any"
                  value={matchCapPercent}
                  onChange={(e) => setMatchCapPercent(e.target.value)}
                  placeholder="e.g. 7"
                />
              </FormField>
            )}
            <FormField
              label="Match Deposits To"
              tooltip="Where the employer match itself lands — applies to the account's whole match, regardless of how your own contributions are split between Roth and Traditional. Most 401(k) plans deposit match as Traditional even if you contribute Roth; some newer plans allow a real Roth match (SECURE 2.0)."
            >
              <FormSelect
                value={v.employerMatchTaxTreatment}
                onChange={(e) =>
                  set(
                    "employerMatchTaxTreatment",
                    e.target.value as "pre_tax" | "tax_free",
                  )
                }
              >
                {Object.entries(MATCH_TAX_LABELS).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </FormSelect>
            </FormField>
          </>
        )}

        {hasCoverage && (
          <FormField label="HSA Coverage">
            <FormSelect
              value={v.hsaCoverageType ?? ""}
              onChange={(e) =>
                set(
                  "hsaCoverageType",
                  (e.target.value || null) as "self_only" | "family" | null,
                )
              }
            >
              <option value="">—</option>
              {Object.entries(HSA_COVERAGE_LABELS).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </FormSelect>
          </FormField>
        )}

        {!cfg.hasIrsLimit && (
          <FormField label="Annual Target">
            <FormInput
              type="number"
              step="any"
              value={v.targetAnnual ?? ""}
              onChange={(e) => set("targetAnnual", e.target.value || null)}
              placeholder="No target"
            />
          </FormField>
        )}

        {cfg.isOverflowTarget && (
          <FormField
            label="Overflow Priority"
            tooltip="When contributions exceed IRS limits in tax-advantaged accounts, the excess overflows to brokerage accounts. Lower number = filled first."
          >
            <FormInput
              type="number"
              value={v.allocationPriority}
              onChange={(e) =>
                set("allocationPriority", parseInt(e.target.value, 10) || 0)
              }
            />
          </FormField>
        )}

        <div className="flex items-center gap-2 pt-5">
          <input
            type="checkbox"
            id="contrib-account-form-payroll"
            checked={v.isPayrollDeducted ?? v.jobId !== null}
            onChange={(e) => set("isPayrollDeducted", e.target.checked)}
            className="rounded border-strong"
          />
          <label
            htmlFor="contrib-account-form-payroll"
            className="text-xs text-muted"
          >
            Payroll Deduction
          </label>
        </div>

        <div className="flex items-center gap-2 pt-5">
          <input
            type="checkbox"
            id="contrib-account-form-automax"
            checked={v.autoMaximize}
            onChange={(e) => set("autoMaximize", e.target.checked)}
            className="rounded border-strong"
          />
          <label
            htmlFor="contrib-account-form-automax"
            className="text-xs text-muted"
          >
            Auto Maximize
          </label>
        </div>

        <FormField label="Notes" className="col-span-2 md:col-span-3">
          <FormInput
            type="text"
            value={v.notes ?? ""}
            onChange={(e) => set("notes", e.target.value || null)}
            placeholder="Optional notes"
          />
        </FormField>
      </div>

      {matchingExisting.length > 0 && (
        <div className="border border-amber-300 bg-amber-50 rounded-lg p-3 text-sm space-y-2">
          <p className="text-amber-800 font-medium">
            {matchingExisting.length} existing {cfg.displayLabel} account
            {matchingExisting.length > 1 ? "s" : ""} already{" "}
            {matchingExisting.length > 1 ? "exist" : "exists"} at this
            institution
          </p>
          <div className="space-y-1.5">
            {matchingExisting.map((m) => {
              const profileNames = profileNamesFor(m.id);
              return (
                <div
                  key={m.id}
                  className="flex items-center justify-between gap-2 text-xs text-amber-800"
                >
                  <span>
                    {TAX_LABELS[m.taxTreatment] ?? m.taxTreatment}
                    {!m.isActive && (
                      <span className="ml-1 text-micro text-amber-600 font-semibold italic">
                        not a funding target
                      </span>
                    )}
                    {profileNames.length > 0 && (
                      <span className="block text-micro text-amber-700/80">
                        Has a value in: {profileNames.join(", ")}
                      </span>
                    )}
                  </span>
                  <button
                    type="button"
                    onClick={() => linkToExisting(m)}
                    className="text-blue-600 hover:text-blue-700 font-medium shrink-0"
                  >
                    Use this account
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit || isPending}
          className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
        >
          {isPending
            ? "Saving..."
            : linkedExistingId != null
              ? "Use Existing Account"
              : "Create Account"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1.5 text-sm text-muted hover:text-primary"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
