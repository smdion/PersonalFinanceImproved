import { useState } from "react";
import type { FocusStateValue } from "@/lib/config/focus-topics";
import { Badge } from "@/components/ui/badge";
import { HelpTip } from "@/components/ui/help-tip";
import type { AccountAnalysisEntry } from "@/lib/pure/accounts/tax-buckets/tax-bucket-analysis";
import {
  isTaxFreeBucket,
  isPreTaxType,
  isAfterTaxType,
  isHsaTaxType,
  isHsaCategory,
  isIraCategory,
  tracksRothBasis,
  getDisplayConfig,
} from "@/lib/config/account-types";
import { RuleOf55Badge } from "./tax-buckets-account-badges";

// The pure type, not the tRPC-inferred one: `rothBasisMeta.updatedAt` arrives
// as an ISO string (no superjson), and "now" and "at retirement" data share
// this type (`Date | string`).
export type AccountEntry = AccountAnalysisEntry;

/** Richer label ("Roth IRA", "Traditional 401k") than colors.ts's
 *  `taxTypeLabel(taxType)`; named differently to avoid a same-name clash. */
export function bucketTaxTypeLabel(category: string, taxType: string): string {
  const label = getDisplayConfig(category).displayLabel;
  if (isTaxFreeBucket(taxType)) {
    return isIraCategory(category) ? "Roth IRA" : `Roth ${label}`;
  }
  if (isPreTaxType(taxType)) {
    return isIraCategory(category) ? "Traditional IRA" : `Traditional ${label}`;
  }
  if (isAfterTaxType(taxType)) return "Brokerage";
  if (isHsaTaxType(taxType)) return "HSA";
  return taxType;
}

export function isoDateOnly(d: string | Date | null): string {
  if (!d) return "";
  const s = typeof d === "string" ? d : d.toISOString();
  return s.slice(0, 10);
}

export function AccountDetailRow({
  entry,
  view,
  fmt,
  canEdit,
  onSaveRothBasis,
  onSaveSeparationDate,
}: {
  entry: AccountEntry;
  view: FocusStateValue<"taxBucketsView">;
  fmt: (amount: number) => string;
  canEdit: boolean;
  onSaveRothBasis: (v: {
    contributionBasis: string;
    conversionBasis: string;
    latestConversionYear: number | null;
  }) => void;
  onSaveSeparationDate: (date: string | null) => void;
}) {
  const isRothEditable =
    isTaxFreeBucket(entry.taxType) &&
    tracksRothBasis(entry.category) &&
    entry.performanceAccountId != null &&
    entry.ownerPersonId != null;
  // Hidden while still employed there (source "active"): Rule of 55 must never
  // be evaluated against a planned future separation date.
  const isSeparationEditable =
    entry.ruleOf55 !== null &&
    entry.ruleOf55.source !== "active" &&
    entry.performanceAccountId != null;

  return (
    <div className="border-subtle border-b pb-4 last:border-0 last:pb-0">
      <div className="flex items-center justify-between">
        <div>
          <span className="font-medium">{entry.displayName}</span>
          {entry.ownerName && (
            <span className="text-caption text-faint ml-2">
              {entry.ownerName}
            </span>
          )}
          <span className="text-caption text-faint ml-2">
            {bucketTaxTypeLabel(entry.category, entry.taxType)}
          </span>
        </div>
        <span className="font-semibold tabular-nums">{fmt(entry.balance)}</span>
      </div>

      <RuleOf55Badge entry={entry} />

      {entry.ageThresholdStatus && (
        <div className="text-caption mt-1 flex items-center gap-2">
          <Badge color={entry.ageThresholdStatus.eligible ? "green" : "amber"}>
            Age {entry.ageThresholdStatus.thresholdAge}:{" "}
            {entry.ageThresholdStatus.eligible ? "eligible" : "not yet"}
          </Badge>
          <HelpTip
            text={
              isHsaCategory(entry.category)
                ? "At 65, non-medical HSA withdrawals stop incurring the 20% penalty — ordinary income tax still applies. Qualified medical withdrawals are always penalty-free and tax-free at any age."
                : "At 59½, retirement-account withdrawals become penalty-free generally. There's no Rule-of-55 equivalent for an IRA (only SEPP/72(t), not modeled here)."
            }
          />
        </div>
      )}

      {entry.slices.length > 0 && (
        <div className="mt-2 space-y-1">
          {entry.slices.map((slice) => (
            <div
              key={slice.label}
              className="text-caption flex items-center justify-between"
            >
              <span className="text-muted">{slice.label}</span>
              <span className="flex items-center gap-2">
                <span className="tabular-nums">{fmt(slice.amount)}</span>
                <Badge color={slice.penaltyFree ? "green" : "amber"}>
                  {slice.penaltyFree ? "penalty-free" : "10% penalty"}
                </Badge>
                <Badge color={slice.taxFree ? "green" : "blue"}>
                  {slice.taxFree ? "tax-free" : "taxable"}
                </Badge>
              </span>
            </div>
          ))}
          {isHsaCategory(entry.category) && (
            <div className="text-caption flex items-center justify-between">
              <span className="text-muted">Qualified medical expenses</span>
              <span className="flex items-center gap-2">
                <span className="tabular-nums">{fmt(entry.balance)}</span>
                <Badge color="green">penalty-free</Badge>
                <Badge color="green">tax-free</Badge>
              </span>
            </div>
          )}
        </div>
      )}

      {isRothEditable && canEdit && (
        <details className="group mt-2">
          <summary className="text-caption text-muted cursor-pointer select-none">
            Edit basis
          </summary>
          <RothBasisForm
            rothBasisMeta={entry.rothBasisMeta}
            onSave={onSaveRothBasis}
          />
        </details>
      )}

      {isSeparationEditable && canEdit && (
        <SeparationDateForm
          current={entry.ruleOf55?.separationYear ?? null}
          source={entry.ruleOf55?.source ?? "no_data"}
          onSave={onSaveSeparationDate}
        />
      )}
      {entry.ruleOf55?.source === "active" && (
        <p className="text-caption text-faint mt-1">
          {view === "now"
            ? "Still employed there — a separation date becomes available once you actually leave."
            : "Assumes you separate from this employer at your household's retirement transition — not yet a real date, since you're still employed there today."}
        </p>
      )}
    </div>
  );
}

export function RothBasisForm({
  rothBasisMeta,
  onSave,
}: {
  rothBasisMeta: AccountEntry["rothBasisMeta"];
  onSave: (v: {
    contributionBasis: string;
    conversionBasis: string;
    latestConversionYear: number | null;
  }) => void;
}) {
  const [contributionBasis, setContributionBasis] = useState(
    rothBasisMeta ? String(rothBasisMeta.contributionBasis) : "",
  );
  const [conversionBasis, setConversionBasis] = useState(
    rothBasisMeta ? String(rothBasisMeta.conversionBasis) : "",
  );
  const [latestConversionYear, setLatestConversionYear] = useState(
    rothBasisMeta?.latestConversionYear != null
      ? String(rothBasisMeta.latestConversionYear)
      : "",
  );

  return (
    <div className="text-caption mt-2 flex flex-wrap items-end gap-2">
      <label className="flex flex-col">
        <span className="text-faint">
          Basis (contributions — what you can pull out anytime, tax and
          penalty-free)
        </span>
        <input
          type="number"
          className="border-subtle bg-surface w-28 rounded border px-2 py-1"
          value={contributionBasis}
          onChange={(e) => setContributionBasis(e.target.value)}
        />
      </label>
      <label className="flex flex-col">
        <span className="text-faint">
          Conversion basis — locked until 5 years after the year of your most
          recent conversion
        </span>
        <input
          type="number"
          className="border-subtle bg-surface w-28 rounded border px-2 py-1"
          value={conversionBasis}
          onChange={(e) => setConversionBasis(e.target.value)}
        />
      </label>
      <label className="flex flex-col">
        <span className="text-faint">Most recent conversion year</span>
        <input
          type="number"
          className="border-subtle bg-surface w-24 rounded border px-2 py-1"
          value={latestConversionYear}
          onChange={(e) => setLatestConversionYear(e.target.value)}
        />
      </label>
      <button
        className="bg-primary rounded px-3 py-1 text-white"
        onClick={() =>
          onSave({
            contributionBasis: contributionBasis || "0",
            conversionBasis: conversionBasis || "0",
            latestConversionYear: latestConversionYear
              ? Number(latestConversionYear)
              : null,
          })
        }
      >
        Save
      </button>
      {rothBasisMeta && (
        <span className="text-faint">
          {rothBasisMeta.isSeeded
            ? `carried forward from ${rothBasisMeta.year - 1}, not yet reviewed for ${rothBasisMeta.year}`
            : `updated ${isoDateOnly(rothBasisMeta.updatedAt)} for ${rothBasisMeta.year}`}
        </span>
      )}
    </div>
  );
}

export function SeparationDateForm({
  current,
  source,
  onSave,
}: {
  current: number | null;
  source: string;
  onSave: (date: string | null) => void;
}) {
  const [date, setDate] = useState(current ? `${current}-01-01` : "");

  return (
    <div className="text-caption mt-2 flex items-end gap-2">
      <label className="flex flex-col">
        <span className="text-faint">
          Separation date{" "}
          {source === "derived" &&
            "(from job history — change it if it's wrong)"}
        </span>
        <input
          type="date"
          className="border-subtle bg-surface rounded border px-2 py-1"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
      </label>
      <button
        className="bg-primary rounded px-3 py-1 text-white"
        onClick={() => onSave(date || null)}
      >
        Save
      </button>
    </div>
  );
}
