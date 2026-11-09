import type { SimulationInputs } from "./mc-simulation-types";
import { formatPercent } from "@/lib/utils/format";
import type { Dispatch, SetStateAction } from "react";

export type GlidePathTableProps = {
  draftGlidePath: { age: number; allocations: Record<number, string> }[];
  editingGlidePath: boolean;
  inputs: SimulationInputs;
  setDraftGlidePath: Dispatch<
    SetStateAction<{ age: number; allocations: Record<number, string> }[]>
  >;
};

export function GlidePathTable({
  draftGlidePath,
  editingGlidePath,
  inputs,
  setDraftGlidePath,
}: GlidePathTableProps) {
  return (
    <div className="overflow-x-auto">
      <table className="text-label w-full border-collapse">
        <thead>
          <tr className="border-b">
            <th className="text-muted py-1 pr-2 text-left font-medium">Age</th>
            {inputs.assetClasses.map((ac) => (
              <th
                key={ac.id}
                className="text-muted px-1.5 py-1 text-right font-medium"
              >
                {ac.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {editingGlidePath
            ? draftGlidePath.map((gp, gi) => (
                <tr key={gp.age} className="border-subtle border-b">
                  <td className="text-muted py-0.5 pr-2 font-medium">
                    {gp.age}
                  </td>
                  {inputs.assetClasses.map((ac) => (
                    <td key={ac.id} className="px-0.5 py-0.5">
                      <input
                        type="number"
                        step="1"
                        value={gp.allocations[ac.id] ?? "0"}
                        onChange={(e) => {
                          setDraftGlidePath((prev) =>
                            prev.map((item, index) =>
                              index === gi
                                ? {
                                    age: item.age,
                                    allocations: {
                                      ...item.allocations,
                                      [ac.id]: e.target.value,
                                    },
                                  }
                                : item,
                            ),
                          );
                        }}
                        className="text-caption w-full rounded border px-0.5 py-0.5 text-center tabular-nums focus:border-blue-400 focus:outline-none"
                      />
                    </td>
                  ))}
                </tr>
              ))
            : inputs.glidePath.map((gp) => {
                const isCurrentAge =
                  gp.age <=
                    inputs.currentAge +
                      (inputs.glidePath.find((g) => g.age > inputs.currentAge)
                        ?.age ?? gp.age) && gp.age >= inputs.currentAge;
                return (
                  <tr
                    key={gp.age}
                    className={`border-subtle border-b ${isCurrentAge ? "bg-blue-50/50" : ""}`}
                  >
                    <td className="text-muted py-0.5 pr-2 font-medium">
                      {gp.age}
                      {isCurrentAge && (
                        <span className="text-micro ml-1 text-blue-500">
                          now
                        </span>
                      )}
                    </td>
                    {inputs.assetClasses.map((ac) => {
                      const pct = (gp.allocations[ac.id] ?? 0) * 100;
                      return (
                        <td
                          key={ac.id}
                          className="text-secondary px-1.5 py-0.5 text-right tabular-nums"
                        >
                          {pct > 0 ? formatPercent(pct / 100) : "—"}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
        </tbody>
      </table>
    </div>
  );
}
