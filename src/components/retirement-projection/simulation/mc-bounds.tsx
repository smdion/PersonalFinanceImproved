import type { SimulationInputs } from "./mc-simulation-types";
import { HelpTip } from "@/components/ui/help-tip";
import { formatPercent } from "@/lib/utils/format";
import { AssumptionRow } from "./assumption-row";
import type { Dispatch, SetStateAction } from "react";

export function correlationMatrix(inputs: SimulationInputs) {
  const idToName = new Map(inputs.assetClasses.map((ac) => [ac.id, ac.name]));
  const names = Array.from(
    new Set(
      inputs.correlations.flatMap((c) => [
        idToName.get(c.classAId) ?? String(c.classAId),
        idToName.get(c.classBId) ?? String(c.classBId),
      ]),
    ),
  ).sort();
  const corrMap = new Map<string, number>();
  for (const c of inputs.correlations) {
    const a = idToName.get(c.classAId) ?? String(c.classAId);
    const b = idToName.get(c.classBId) ?? String(c.classBId);
    corrMap.set(`${a}|${b}`, c.correlation);
    corrMap.set(`${b}|${a}`, c.correlation);
  }
  return (
    <div className="overflow-x-auto">
      <table className="text-caption border-collapse">
        <thead>
          <tr>
            <th className="text-faint py-0.5 pr-1.5 text-left font-medium" />
            {names.map((n) => (
              <th
                key={n}
                className="text-faint px-1 py-0.5 text-right font-medium whitespace-nowrap"
              >
                {n.length > 8 ? n.slice(0, 7) + "…" : n}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {names.map((row) => (
            <tr key={row} className="border-subtle border-t">
              <td className="text-muted py-0.5 pr-1.5 font-medium whitespace-nowrap">
                {row.length > 8 ? row.slice(0, 7) + "…" : row}
              </td>
              {names.map((col) => {
                const val =
                  row === col ? 1 : (corrMap.get(`${row}|${col}`) ?? 0);
                const bg =
                  row === col
                    ? "bg-surface-elevated"
                    : val > 0.5
                      ? "bg-green-50 text-green-700"
                      : val > 0
                        ? "bg-green-50/50 text-green-600"
                        : val < -0.3
                          ? "bg-red-50 text-red-600"
                          : val < 0
                            ? "bg-red-50/50 text-red-500"
                            : "text-faint";
                return (
                  <td
                    key={col}
                    className={`px-1 py-0.5 text-right tabular-nums ${bg}`}
                  >
                    {val.toFixed(2)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export type ReturnClampSectionProps = {
  draftClampMax: string;
  draftClampMin: string;
  editingClamps: boolean;
  inputs: SimulationInputs;
  onClampBoundsChange: ((min: number, max: number) => void) | undefined;
  setDraftClampMax: Dispatch<SetStateAction<string>>;
  setDraftClampMin: Dispatch<SetStateAction<string>>;
  setEditingClamps: Dispatch<SetStateAction<boolean>>;
};

export function ReturnClampSection({
  draftClampMax,
  draftClampMin,
  editingClamps,
  inputs,
  onClampBoundsChange,
  setDraftClampMax,
  setDraftClampMin,
  setEditingClamps,
}: ReturnClampSectionProps) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <div className="text-label text-muted font-medium">
          Return Clamp Bounds
          <HelpTip text="Simulated annual returns are clamped to this range to prevent extreme outliers from dominating results." />
        </div>
        {onClampBoundsChange &&
          inputs.preset === "custom" &&
          !editingClamps && (
            <button
              type="button"
              onClick={() => {
                setDraftClampMin((inputs.returnClampMin * 100).toFixed(0));
                setDraftClampMax((inputs.returnClampMax * 100).toFixed(0));
                setEditingClamps(true);
              }}
              className="text-caption text-blue-600 underline hover:text-blue-800"
            >
              Edit
            </button>
          )}
        {editingClamps && (
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => setEditingClamps(false)}
              className="text-caption text-muted hover:text-secondary underline"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                if (onClampBoundsChange) {
                  onClampBoundsChange(
                    parseFloat(draftClampMin) / 100,
                    parseFloat(draftClampMax) / 100,
                  );
                }
                setEditingClamps(false);
              }}
              className="text-caption font-medium text-blue-600 underline hover:text-blue-800"
            >
              Apply
            </button>
          </div>
        )}
      </div>
      {editingClamps ? (
        <div className="text-label grid grid-cols-2 gap-x-4 gap-y-1">
          <div className="flex items-center gap-1">
            <span className="text-muted">Min (floor)</span>
            <input
              aria-label="Min (floor)"
              type="number"
              step="1"
              value={draftClampMin}
              onChange={(e) => setDraftClampMin(e.target.value)}
              className="text-caption w-16 rounded border px-1 py-0.5 text-center focus:border-blue-400 focus:outline-none"
            />
            <span className="text-faint">%</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-muted">Max (ceiling)</span>
            <input
              aria-label="Max (ceiling)"
              type="number"
              step="1"
              value={draftClampMax}
              onChange={(e) => setDraftClampMax(e.target.value)}
              className="text-caption w-16 rounded border px-1 py-0.5 text-center focus:border-blue-400 focus:outline-none"
            />
            <span className="text-faint">%</span>
          </div>
        </div>
      ) : (
        <div className="text-label grid grid-cols-2 gap-x-4 gap-y-0.5">
          <AssumptionRow
            label="Min (floor)"
            value={formatPercent(inputs.returnClampMin, 0)}
          />
          <AssumptionRow
            label="Max (ceiling)"
            value={formatPercent(inputs.returnClampMax, 0)}
          />
        </div>
      )}
    </div>
  );
}
