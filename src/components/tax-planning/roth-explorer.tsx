"use client";

/**
 * Roth conversion explorer (roadmap #1). Two moves, both over the shared
 * `rothConversionWhatIf` procedure:
 *  - "Optimize" → the engine's own multi-year search for the lifetime-tax-
 *    minimizing bracket target (delegates to optimizeRothBracketTarget).
 *  - An explicit target-rate applied from a start year → before/after:
 *    lifetime tax with vs. without, break-even year, and a per-year
 *    conversion / tax / RMD-reduction table.
 *
 * "Simulation" wording, never "Monte Carlo" (this is the deterministic
 * run). Values the user sets are "adjusted", never "overridden".
 */
import { useState } from "react";
import type { RouterInputs } from "@/lib/trpc";
import { trpc } from "@/lib/trpc";
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import { Skeleton } from "@/components/ui/skeleton";

type Selection = Partial<
  Pick<
    RouterInputs["projection"]["rothConversionWhatIf"],
    "retirementProfileId"
  >
>;

export function RothExplorer({ selection }: { selection: Selection }) {
  const [targetPct, setTargetPct] = useState(22);
  const [startYear, setStartYear] = useState<number | "">("");

  const optimize = trpc.projection.rothConversionWhatIf.useQuery(
    { ...selection, mode: "optimize" as const },
    { placeholderData: (prev) => prev },
  );
  const recommended =
    optimize.data?.mode === "optimize" && optimize.data.result
      ? optimize.data.result.recommendedTarget
      : null;
  const current =
    optimize.data?.mode === "optimize" && optimize.data.result
      ? optimize.data.result.currentTarget
      : null;

  // Explicit-schedule run only fires once a start year is chosen.
  const explicit = trpc.projection.rothConversionWhatIf.useQuery(
    startYear === ""
      ? { ...selection, mode: "optimize" as const } // inert placeholder; disabled below
      : {
          ...selection,
          mode: "explicit" as const,
          conversionTargets: [
            { year: Number(startYear), targetRate: targetPct / 100 },
          ],
        },
    { enabled: startYear !== "", placeholderData: (prev) => prev },
  );
  const exp = explicit.data?.mode === "explicit" ? explicit.data.result : null;

  return (
    <div className="space-y-4">
      {/* Optimize */}
      <div className="bg-surface-sunken/40 rounded border p-3 text-xs">
        <p className="text-muted">
          The engine can search your own real marginal brackets for the
          conversion ceiling that minimises lifetime tax.
        </p>
        {optimize.isLoading ? (
          <Skeleton className="mt-2 h-5 w-64" />
        ) : recommended != null ? (
          <p className="mt-1">
            Recommended conversion ceiling:{" "}
            <span className="font-semibold">
              {formatPercent(recommended, 0)} marginal rate
            </span>
            {current != null && (
              <span className="text-muted">
                {" "}
                (your profile is at {formatPercent(current, 0)})
              </span>
            )}
          </p>
        ) : (
          <p className="text-muted mt-1">
            No recommendation — your profile has no configured target, or no
            candidate beats it.
          </p>
        )}
      </div>

      {/* Explicit schedule */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-end gap-3 text-xs">
          <label className="flex flex-col gap-1">
            <span className="text-faint">Convert up to this marginal rate</span>
            <span className="flex items-center gap-2">
              <input
                type="range"
                min={0}
                max={40}
                step={1}
                value={targetPct}
                onChange={(e) => setTargetPct(Number(e.target.value))}
              />
              <span className="w-10 tabular-nums">{targetPct}%</span>
            </span>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-faint">Starting in year</span>
            <input
              type="number"
              placeholder="e.g. 2035"
              value={startYear}
              onChange={(e) =>
                setStartYear(
                  e.target.value === "" ? "" : Number(e.target.value),
                )
              }
              className="w-24 rounded border px-2 py-1"
            />
          </label>
        </div>

        {startYear === "" ? (
          <p className="text-muted text-xs">
            Pick a start year to model an explicit conversion schedule.
          </p>
        ) : explicit.isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : exp ? (
          <>
            <div className="flex flex-wrap gap-4 text-xs">
              <Stat
                label="Lifetime tax — with conversions"
                value={formatCurrency(exp.lifetimeTaxWith)}
              />
              <Stat
                label="Lifetime tax — without"
                value={formatCurrency(exp.lifetimeTaxWithout)}
              />
              <Stat
                label="Break-even year"
                value={exp.breakEvenYear ? String(exp.breakEvenYear) : "—"}
              />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-right text-xs tabular-nums">
                <thead>
                  <tr className="border-strong text-muted border-b-2 text-[11px]">
                    <th className="px-2 py-1.5 text-left">Age</th>
                    <th className="px-2 py-1.5">Converted</th>
                    <th className="px-2 py-1.5">Tax now</th>
                    <th className="px-2 py-1.5">RMD reduction</th>
                    <th className="px-2 py-1.5">IRMAA Δ</th>
                  </tr>
                </thead>
                <tbody>
                  {exp.perYear
                    .filter(
                      (y) =>
                        y.conversionAmount > 0 ||
                        y.rmdReduction !== 0 ||
                        y.irmaaWith !== y.irmaaOff,
                    )
                    .map((y) => (
                      <tr key={y.year}>
                        <td className="px-2 py-1 text-left">{y.age}</td>
                        <td className="px-2 py-1">
                          {formatCurrency(y.conversionAmount)}
                        </td>
                        <td className="px-2 py-1">
                          {formatCurrency(y.conversionTaxNow)}
                        </td>
                        <td className="px-2 py-1 text-green-700">
                          {y.rmdReduction > 0
                            ? formatCurrency(y.rmdReduction)
                            : "—"}
                        </td>
                        <td className="px-2 py-1">
                          {formatCurrency(y.irmaaWith - y.irmaaOff)}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <p className="text-muted text-xs">
            No projection available for this schedule.
          </p>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-surface-primary rounded border px-3 py-2">
      <div className="text-faint text-[10px] tracking-wide uppercase">
        {label}
      </div>
      <div className="text-primary font-semibold tabular-nums">{value}</div>
    </div>
  );
}
