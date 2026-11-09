"use client";

/**
 * IRMAA-cliff callout from existing row fields: years with an IRMAA surcharge, or where a Roth
 * conversion is capped to stay under a threshold.
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
            {surchargeYears.length > 1 ? "s" : ""} pay an IRMAA surcharge (
            {surchargeYears.at(0)?.year}–{surchargeYears.at(-1)?.year}),
            totalling {formatCurrency(totalSurcharge)} in today-nominal dollars.
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
