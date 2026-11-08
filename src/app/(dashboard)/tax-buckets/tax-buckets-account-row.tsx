import { useState } from "react";
import type { FocusStateValue } from "@/lib/config/focus-topics";
import { Badge } from "@/components/ui/badge";
import { HelpTip } from "@/components/ui/help-tip";
import type { AccountAnalysisEntry } from "@/lib/pure/accounts/tax-bucket-analysis";
import {
  isTaxFreeBucket,
  isPreTaxType,
  isAfterTaxType,
  isHsaTaxType,
  isHsaCategory,
  isIraCategory,
  tracksRothBasis,
} from "@/lib/config/account-types";

// The pure type, not a tRPC-inferred one — inferRouterOutputs types
// `rothBasisMeta.updatedAt` as `Date` (the procedure's TS return type),
// but it actually arrives as an ISO string (no superjson transformer on
// this router). Using the pure AccountAnalysisEntry type (whose
// `updatedAt` is `Date | string` for exactly this reason) lets "now" data
// (from the wire) and "at retirement" data (computed client-side by
// computeTaxBucketProjection, same pure type) share one type everywhere
// on this page instead of fighting a spurious Date-vs-string mismatch.
export type AccountEntry = AccountAnalysisEntry;

/** Richer label ("Roth IRA", "Traditional 401k") than
 *  `@/lib/utils/colors.ts`'s canonical `taxTypeLabel(taxType)` (which only
 *  returns "Traditional"/"Roth"/"HSA"/"After-Tax") — deliberately named
 *  differently to avoid a same-name, different-signature collision with
 *  that function. */
export function bucketTaxTypeLabel(category: string, taxType: string): string {
  if (isTaxFreeBucket(taxType)) {
    return isIraCategory(category) ? "Roth IRA" : `Roth ${category}`;
  }
  if (isPreTaxType(taxType)) {
    return isIraCategory(category)
      ? "Traditional IRA"
      : `Traditional ${category}`;
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
  // Hidden while still employed there (source "active") — there's no real
  // separation date to enter yet, and showing a blank editable field
  // invites entering a planned/future date, which is exactly what Rule of
  // 55 must never be evaluated against.
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

      {entry.ruleOf55 && (
        <div className="text-caption mt-1 flex items-center gap-2">
          <Badge
            color={
              entry.ruleOf55.eligible
                ? "green"
                : entry.ruleOf55.eligible === false
                  ? "amber"
                  : "gray"
            }
          >
            Rule of 55:{" "}
            {entry.ruleOf55.eligible == null
              ? "unknown"
              : entry.ruleOf55.eligible
                ? "eligible"
                : "not yet"}
          </Badge>
          {entry.ruleOf55.separationYear != null && (
            <span className="text-faint">
              separation year {entry.ruleOf55.separationYear} (
              {entry.ruleOf55.source})
            </span>
          )}
          <HelpTip text="Rule of 55: separating from that plan's employer in or after the year you turn 55 grants permanent penalty-free access to that specific plan — even if it later sits dormant. Rolling it into an IRA forfeits this for that money. Many plans only permit a lump-sum withdrawal, not partial, once separated." />
        </div>
      )}

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
