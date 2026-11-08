import { useState } from "react";
import { isTaxFreeBucket, tracksRothBasis } from "@/lib/config/account-types";
import { AccountEntry, bucketTaxTypeLabel } from "./tax-buckets-account-row";

type BulkRow = {
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

/** All Roth-basis-editable accounts in one screen — mirrors
 *  UpdatePerformanceForm's shape (grouped rows, one Save for everything). */
export function BulkRothBasisForm({
  accounts,
  onSave,
  isSaving,
  error,
}: {
  accounts: AccountEntry[];
  onSave: (
    entries: {
      performanceAccountId: number;
      ownerPersonId: number;
      year: number;
      contributionBasis: string;
      conversionBasis: string;
      latestConversionYear: number | null;
    }[],
  ) => void;
  isSaving: boolean;
  error: string | null;
}) {
  const currentCalendarYear = new Date().getFullYear();

  const [rows, setRows] = useState<BulkRow[]>(() =>
    accounts
      .filter(
        (
          a,
        ): a is AccountEntry & {
          performanceAccountId: number;
          ownerPersonId: number;
        } =>
          isTaxFreeBucket(a.taxType) &&
          tracksRothBasis(a.category) &&
          a.performanceAccountId != null &&
          a.ownerPersonId != null,
      )
      .map((a) => ({
        performanceAccountId: a.performanceAccountId,
        ownerPersonId: a.ownerPersonId,
        year: a.rothBasisMeta?.year ?? currentCalendarYear,
        displayName: a.displayName,
        ownerName: a.ownerName,
        taxTypeLabel: bucketTaxTypeLabel(a.category, a.taxType),
        contributionBasis: String(a.rothBasisMeta?.contributionBasis ?? 0),
        conversionBasis: String(a.rothBasisMeta?.conversionBasis ?? 0),
        latestConversionYear:
          a.rothBasisMeta?.latestConversionYear != null
            ? String(a.rothBasisMeta.latestConversionYear)
            : "",
      })),
  );

  const updateRow = (
    key: string,
    field: "contributionBasis" | "conversionBasis" | "latestConversionYear",
    value: string,
  ) => {
    setRows((prev) =>
      prev.map((r) =>
        `${r.performanceAccountId}-${r.ownerPersonId}` === key
          ? { ...r, [field]: value }
          : r,
      ),
    );
  };

  const groups = new Map<string, BulkRow[]>();
  for (const row of rows) {
    const key = row.ownerName ?? "Joint";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }

  const handleSave = () => {
    onSave(
      rows.map((r) => ({
        performanceAccountId: r.performanceAccountId,
        ownerPersonId: r.ownerPersonId,
        year: r.year,
        contributionBasis: r.contributionBasis || "0",
        conversionBasis: r.conversionBasis || "0",
        latestConversionYear: r.latestConversionYear
          ? Number(r.latestConversionYear)
          : null,
      })),
    );
  };

  if (rows.length === 0) {
    return (
      <p className="text-muted text-sm">
        No Roth accounts to update yet — link a Roth IRA or 401k/403b Roth
        sub-account first.
      </p>
    );
  }

  return (
    <div className="space-y-4">
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

      <div className="flex items-center gap-3 pt-2">
        <div className="flex-1" />
        <button
          type="button"
          onClick={handleSave}
          disabled={isSaving}
          className="bg-primary rounded px-4 py-1.5 text-sm text-white disabled:opacity-50"
        >
          {isSaving ? "Saving..." : "Save all"}
        </button>
      </div>
      {error && <p className="text-sm text-red-600">Error: {error}</p>}
    </div>
  );
}
