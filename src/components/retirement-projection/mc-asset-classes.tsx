import type {
  AssetClassOverride,
  SimulationInputs,
} from "./mc-simulation-types";
import { formatPercent } from "@/lib/utils/format";
import type { Dispatch, SetStateAction } from "react";

export type AssetClassTableProps = {
  assetClassOverrides: AssetClassOverride[] | undefined;
  draftReturns: Record<number, string>;
  draftVols: Record<number, string>;
  editing: boolean;
  inputs: SimulationInputs;
  setDraftReturns: Dispatch<SetStateAction<Record<number, string>>>;
  setDraftVols: Dispatch<SetStateAction<Record<number, string>>>;
};

export function AssetClassTable({
  assetClassOverrides,
  draftReturns,
  draftVols,
  editing,
  inputs,
  setDraftReturns,
  setDraftVols,
}: AssetClassTableProps) {
  return (
    <>
      {!editing ? (
        <table className="text-label w-full border-collapse">
          <thead>
            <tr className="border-b">
              <th className="text-muted py-1 pr-2 text-left font-medium">
                Asset Class
              </th>
              <th className="text-muted px-1.5 py-1 text-right font-medium">
                Return
              </th>
              <th className="text-muted px-1.5 py-1 text-right font-medium">
                Vol
              </th>
              <th className="text-muted px-1.5 py-1 text-right font-medium">
                DB Return
              </th>
              <th className="text-muted px-1.5 py-1 text-right font-medium">
                Alloc
              </th>
            </tr>
          </thead>
          <tbody>
            {inputs.assetClasses.map((ac) => {
              const override = assetClassOverrides?.find((o) => o.id === ac.id);
              const isOverridden =
                override &&
                (override.meanReturn !== undefined ||
                  override.stdDev !== undefined);
              const dbAc = inputs.dbAssetClasses.find((d) => d.id === ac.id);
              const dbDiff =
                dbAc && Math.abs(dbAc.meanReturn - ac.meanReturn) > 0.001;
              const allocPct = (inputs.currentAllocation[ac.id] ?? 0) * 100;
              return (
                <tr key={ac.id} className="border-subtle border-b">
                  <td
                    className={`py-0.5 pr-2 ${isOverridden ? "font-medium text-amber-700" : "text-muted"}`}
                  >
                    {ac.name}
                  </td>
                  <td
                    className={`px-1.5 py-0.5 text-right font-medium tabular-nums ${isOverridden ? "text-amber-800" : "text-primary"}`}
                  >
                    {formatPercent(ac.meanReturn, 1)}
                  </td>
                  <td
                    className={`px-1.5 py-0.5 text-right font-medium tabular-nums ${isOverridden ? "text-amber-800" : "text-primary"}`}
                  >
                    {formatPercent(ac.stdDev, 1)}
                  </td>
                  <td
                    className={`px-1.5 py-0.5 text-right tabular-nums ${dbDiff ? "text-faint line-through" : "text-faint"}`}
                  >
                    {dbAc ? formatPercent(dbAc.meanReturn, 1) : "—"}
                  </td>
                  <td className="text-muted px-1.5 py-0.5 text-right tabular-nums">
                    {allocPct > 0 ? formatPercent(allocPct / 100) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <div className="space-y-1">
          <div className="text-caption text-faint grid grid-cols-[1fr_80px_80px] gap-1 px-0.5 font-medium">
            <span>Asset Class</span>
            <span className="text-center">Return %</span>
            <span className="text-center">Vol %</span>
          </div>
          {inputs.assetClasses.map((ac) => (
            <div
              key={ac.id}
              className="grid grid-cols-[1fr_80px_80px] items-center gap-1"
            >
              <span className="text-muted truncate text-xs">{ac.name}</span>
              <input
                type="number"
                step="0.1"
                value={draftReturns[ac.id] ?? ""}
                onChange={(e) =>
                  setDraftReturns((prev) => ({
                    ...prev,
                    [ac.id]: e.target.value,
                  }))
                }
                className="w-full rounded border px-1 py-0.5 text-center text-xs focus:border-blue-400 focus:outline-none"
              />
              <input
                type="number"
                step="0.1"
                value={draftVols[ac.id] ?? ""}
                onChange={(e) =>
                  setDraftVols((prev) => ({
                    ...prev,
                    [ac.id]: e.target.value,
                  }))
                }
                className="w-full rounded border px-1 py-0.5 text-center text-xs focus:border-blue-400 focus:outline-none"
              />
            </div>
          ))}
        </div>
      )}
    </>
  );
}
