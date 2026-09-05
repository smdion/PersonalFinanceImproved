"use client";

/**
 * IRMAA-cliff callout (roadmap #4 sub-item). Reads existing row fields
 * only — years where an IRMAA surcharge is actually charged, or where a
 * Roth conversion was capped to stay under a threshold (Group D flag).
 * No new computation.
 */
import type { RouterOutputs } from "@/lib/trpc";
import { formatCurrency } from "@/lib/utils/format";

export type TaxYearRow =
  RouterOutputs["projection"]["projectTaxYears"]["rows"][number];

export function IrmaaCliffAlert({ rows }: { rows: TaxYearRow[] }) {
  const surchargeYears = rows.filter((r) => r.irmaaSurcharge > 0);
  const cappedYears = rows.filter((r) => r.rothConversionIrmaaCapped);

  if (surchargeYears.length === 0 && cappedYears.length === 0) return null;

  const totalSurcharge = surchargeYears.reduce(
    (s, r) => s + r.irmaaSurcharge,
    0,
  );

  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
      <p className="font-semibold">Medicare (IRMAA) surcharge exposure</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-4">
        {surchargeYears.length > 0 && (
          <li>
            {surchargeYears.length} year
            {surchargeYears.length > 1 ? "s" : ""} pay an IRMAA surcharge (ages{" "}
            {surchargeYears.at(0)?.age}–{surchargeYears.at(-1)?.age}), totalling{" "}
            {formatCurrency(totalSurcharge)} in today-nominal dollars.
          </li>
        )}
        {cappedYears.length > 0 && (
          <li>
            {cappedYears.length} year
            {cappedYears.length > 1 ? "s" : ""} had a Roth conversion capped to
            stay below the next IRMAA threshold — converting more would have
            crossed a premium cliff.
          </li>
        )}
      </ul>
    </div>
  );
}
