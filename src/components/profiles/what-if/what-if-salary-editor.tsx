import {
  type SandboxSalaryEntries,
  type PaycheckPersonView,
} from "@/lib/hooks/use-paycheck-person-views";
import { WhatIfPinnedCell } from "./what-if-editors";

/** Per-person salary/bonus fields feeding the server recompute's
 *  sandboxSalaryEntries. Cells pre-fill with the picked Salary Profile's value;
 *  an untouched cell stays live, a changed one pins that field. */
export function WhatIfSalaryEditor({
  views,
  entries,
  onChange,
}: {
  views: PaycheckPersonView[];
  entries: SandboxSalaryEntries;
  onChange: (
    personId: number,
    field: keyof SandboxSalaryEntry,
    value: number | undefined,
  ) => void;
}) {
  if (views.length === 0) return null;

  return (
    <table className="w-full border-collapse text-xs">
      <thead>
        <tr className="border-strong border-b-2">
          <th className="text-muted py-2 pr-3 pl-4 text-left font-medium">
            Person
          </th>
          <th className="text-muted w-32 px-3 py-2 text-right font-medium">
            Salary
          </th>
          <th className="text-muted w-24 px-3 py-2 text-right font-medium">
            Bonus %
          </th>
          <th className="text-muted w-24 px-3 py-2 text-right font-medium">
            Bonus ×
          </th>
        </tr>
      </thead>
      <tbody>
        {views.map((v, rowIndex) => {
          const entry = entries[String(v.person.id)] ?? {};
          return (
            <tr
              key={v.person.id}
              className={`border-subtle border-b transition-colors hover:bg-blue-50/60 ${
                rowIndex % 2 === 1
                  ? "bg-surface-sunken/60"
                  : "bg-surface-primary"
              }`}
            >
              <td className="text-secondary py-1.5 pr-3 pl-4">
                {v.person.name}
              </td>
              <td className="px-3 py-1.5 text-right">
                <WhatIfPinnedCell
                  liveValue={v.salary}
                  pinnedValue={entry.salary}
                  onCommit={(n) => onChange(v.person.id, "salary", n)}
                  onReset={() => onChange(v.person.id, "salary", undefined)}
                  label={`Salary, ${v.person.name}`}
                  step="1000"
                  width="w-28"
                />
              </td>
              <td className="px-3 py-1.5 text-right">
                <WhatIfPinnedCell
                  liveValue={v.resolvedBonusTerms.bonusPercent * 100}
                  pinnedValue={
                    entry.bonusPercent != null
                      ? entry.bonusPercent * 100
                      : undefined
                  }
                  onCommit={(n) =>
                    onChange(v.person.id, "bonusPercent", n / 100)
                  }
                  onReset={() =>
                    onChange(v.person.id, "bonusPercent", undefined)
                  }
                  label={`Bonus %, ${v.person.name}`}
                  step="0.5"
                  width="w-16"
                />
              </td>
              <td className="px-3 py-1.5 text-right">
                <WhatIfPinnedCell
                  liveValue={v.resolvedBonusTerms.bonusMultiplier}
                  pinnedValue={entry.bonusMultiplier}
                  onCommit={(n) => onChange(v.person.id, "bonusMultiplier", n)}
                  onReset={() =>
                    onChange(v.person.id, "bonusMultiplier", undefined)
                  }
                  label={`Bonus ×, ${v.person.name}`}
                  step="0.1"
                  width="w-16"
                />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export type SandboxSalaryEntry = SandboxSalaryEntries[string];
