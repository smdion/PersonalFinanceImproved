export type BulkBasisGroupsProps = {
  groups: Map<string, BulkRow[]>;
  updateRow: (
    key: string,
    field: "contributionBasis" | "conversionBasis" | "latestConversionYear",
    value: string,
  ) => void;
};

/** The bulk form's accounts, grouped by owner, each with its basis fields. */
export function BulkBasisGroups({ groups, updateRow }: BulkBasisGroupsProps) {
  return (
    <>
      {Array.from(groups.entries()).map(([owner, groupRows]) => (
        <div key={owner}>
          <div className="border-strong text-primary mb-3 border-b-2 pb-1.5 text-sm font-semibold">
            {owner}
          </div>
          <div className="space-y-3">
            {groupRows.map((row) => {
              const key = `${row.performanceAccountId}-${row.ownerPersonId}`;
              return (
                <div
                  key={key}
                  className="border-subtle border-b pb-3 last:border-0 last:pb-0"
                >
                  <div className="mb-1.5 text-sm font-medium">
                    {row.displayName}{" "}
                    <span className="text-caption text-faint">
                      {row.taxTypeLabel} · {row.year}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <label className="block w-40">
                      <span className="text-caption text-muted mb-0.5 block">
                        Basis (contributions)
                      </span>
                      <input
                        type="number"
                        className="border-default w-full rounded border px-1.5 py-1 text-sm"
                        value={row.contributionBasis}
                        onChange={(e) =>
                          updateRow(key, "contributionBasis", e.target.value)
                        }
                      />
                    </label>
                    <label className="block w-40">
                      <span className="text-caption text-muted mb-0.5 block">
                        Conversion basis
                      </span>
                      <input
                        type="number"
                        className="border-default w-full rounded border px-1.5 py-1 text-sm"
                        value={row.conversionBasis}
                        onChange={(e) =>
                          updateRow(key, "conversionBasis", e.target.value)
                        }
                      />
                    </label>
                    <label className="block w-32">
                      <span className="text-caption text-muted mb-0.5 block">
                        Latest conversion yr
                      </span>
                      <input
                        type="number"
                        className="border-default w-full rounded border px-1.5 py-1 text-sm"
                        value={row.latestConversionYear}
                        onChange={(e) =>
                          updateRow(key, "latestConversionYear", e.target.value)
                        }
                      />
                    </label>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </>
  );
}

export type BulkRow = {
  performanceAccountId: number;
  ownerPersonId: number;
  year: number;
  displayName: string;
  ownerName: string | null;
  taxTypeLabel: string;
  contributionBasis: string;
  conversionBasis: string;
  latestConversionYear: string;
};
