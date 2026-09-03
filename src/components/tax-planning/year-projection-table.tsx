"use client";

/**
 * The always-visible year-by-year tax projection table (roadmap #4).
 * Renders `projectTaxYears` rows straight — no math here, the engine did
 * it all. Nominal dollars; a "flags" column surfaces only the notable
 * years (shared `taxYearFlags` vocabulary).
 */
import type { RouterOutputs } from "@/lib/trpc";
import { formatCurrency, formatPercent } from "@/lib/utils/format";

export type TaxYearRow =
  RouterOutputs["projection"]["projectTaxYears"]["rows"][number];

const FLAG_COLOR: Record<string, string> = {
  IRMAA: "bg-amber-100 text-amber-800",
  "Roth capped (IRMAA)": "bg-amber-100 text-amber-800",
  "RMD shortfall": "bg-red-100 text-red-800",
  "ACA lost": "bg-red-100 text-red-800",
  RMD: "bg-slate-100 text-slate-700",
  "Roth conversion": "bg-indigo-100 text-indigo-800",
};

function Num({ v, muted }: { v: number; muted?: boolean }) {
  if (!v) return <span className="text-faint">—</span>;
  return (
    <span className={muted ? "text-muted" : undefined}>
      {formatCurrency(v)}
    </span>
  );
}

export function YearProjectionTable({ rows }: { rows: TaxYearRow[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full border-collapse text-right text-xs tabular-nums">
        <thead>
          <tr className="border-strong text-muted border-b-2 text-[11px] font-medium">
            <th className="px-2 py-2 text-left">Age</th>
            <th className="px-2 py-2">Year</th>
            <th className="px-2 py-2">Soc. Sec.</th>
            <th className="px-2 py-2">Trad. draw</th>
            <th className="px-2 py-2">Roth draw</th>
            <th className="px-2 py-2">RMD</th>
            <th className="px-2 py-2">Roth conv.</th>
            <th className="px-2 py-2">Fed. tax</th>
            <th className="px-2 py-2">NIIT</th>
            <th className="px-2 py-2">IRMAA</th>
            <th className="px-2 py-2">Eff. rate</th>
            <th className="px-2 py-2">Cumul. tax</th>
            <th className="px-2 py-2">End bal.</th>
            <th className="px-2 py-2 text-left">Flags</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr
              key={r.year}
              className={i % 2 ? "bg-surface-sunken/40" : undefined}
            >
              <td className="px-2 py-1 text-left font-medium">{r.age}</td>
              <td className="text-muted px-2 py-1">{r.year}</td>
              <td className="px-2 py-1">
                <Num v={r.income.socialSecurity} />
              </td>
              <td className="px-2 py-1">
                <Num v={r.income.traditionalWithdrawal} />
              </td>
              <td className="px-2 py-1">
                <Num v={r.income.rothWithdrawal} />
              </td>
              <td className="px-2 py-1">
                <Num v={r.income.requiredMinimumDistribution} muted />
              </td>
              <td className="px-2 py-1">
                <Num v={r.income.rothConversion} />
              </td>
              <td className="px-2 py-1">
                <Num v={r.federalTax} />
              </td>
              <td className="px-2 py-1">
                <Num v={r.niit} muted />
              </td>
              <td className="px-2 py-1">
                <Num v={r.irmaaSurcharge} muted />
              </td>
              <td className="px-2 py-1">
                {formatPercent(r.effectiveTaxRate, 1)}
              </td>
              <td className="px-2 py-1 font-medium">
                {formatCurrency(r.cumulativeTax)}
              </td>
              <td className="text-muted px-2 py-1">
                {formatCurrency(r.endingBalance)}
              </td>
              <td className="px-2 py-1 text-left">
                <span className="flex flex-wrap gap-1">
                  {r.flags.map((f) => (
                    <span
                      key={f}
                      className={`rounded px-1 py-0.5 text-[10px] font-medium ${
                        FLAG_COLOR[f] ?? "bg-slate-100 text-slate-700"
                      }`}
                    >
                      {f}
                    </span>
                  ))}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
