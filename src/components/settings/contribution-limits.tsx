"use client";

/** Settings tab for managing IRS contribution limits, FICA rates, and standard deductions by tax year with inline editing, year duplication, and year-over-year change indicators. */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useUser, isAdmin } from "@/lib/context/user-context";
import { InlineEdit } from "@/components/ui/inline-edit";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import {
  taxLimitGroups,
  type TaxLimitFormat,
} from "@/lib/config/tax-limit-keys";
type LimitFormat = TaxLimitFormat;

/** Display value ↔ stored value for a format (percent shows ×100), rounded
 *  to the stored scale so 1.45% round-trips exactly (no float noise that
 *  would read as an edit). */
const toInput = (value: string, format: LimitFormat) =>
  format === "percent" ? String(+(Number(value) * 100).toFixed(4)) : value;
const fromInput = (value: string, format: LimitFormat) => {
  const n = value.replace(/[^0-9.]/g, "");
  return format === "percent" ? String(+(Number(n) / 100).toFixed(6)) : n;
};
const display = (value: number, format: LimitFormat) =>
  format === "percent"
    ? formatPercent(value, 2)
    : format === "year"
      ? String(Math.round(value))
      : formatCurrency(value);

export function ContributionLimitsSettings({ year }: { year: number }) {
  const user = useUser();
  const admin = isAdmin(user);
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.settings.contributionLimits.list.useQuery();
  const updateMut = trpc.settings.contributionLimits.update.useMutation({
    onSuccess: () => utils.settings.contributionLimits.list.invalidate(),
  });
  const createMut = trpc.settings.contributionLimits.create.useMutation({
    onSuccess: () => utils.settings.contributionLimits.list.invalidate(),
  });
  const deleteMut = trpc.settings.contributionLimits.delete.useMutation({
    onSuccess: () => utils.settings.contributionLimits.list.invalidate(),
  });
  const resetMut = trpc.settings.contributionLimits.resetToShipped.useMutation({
    onSuccess: () => utils.settings.contributionLimits.list.invalidate(),
  });

  const [copyFrom, setCopyFrom] = useState<number | null>(null);
  const [confirmDeleteYear, setConfirmDeleteYear] = useState<number | null>(
    null,
  );

  if (isLoading) return <Skeleton className="h-6 w-48" />;

  // Get unique years, sorted descending (newest first)
  const years = Array.from(new Set((data ?? []).map((l) => l.taxYear))).sort(
    (a, b) => b - a,
  );
  const activeYear = year;
  const yearData = (data ?? []).filter((l) => l.taxYear === activeYear);

  // Build a lookup: type -> record for the active year
  const limitsMap = new Map<
    string,
    {
      id: number;
      value: string;
      taxYear: number;
      notes: string | null;
      origin: string;
      shipped: boolean;
    }
  >();
  for (const l of yearData) {
    limitsMap.set(l.limitType, l);
  }

  /** `placeholder`: "+ Set" — a carried-forward 0 until it's filled in or
   *  the real figure ships, not the household's own figure. */
  const handleSave = (
    limitType: string,
    value: string,
    format: LimitFormat,
    placeholder = false,
  ) => {
    const existing = limitsMap.get(limitType);
    const numericValue = fromInput(value, format);

    if (existing) {
      updateMut.mutate({
        id: existing.id,
        taxYear: existing.taxYear,
        limitType,
        value: numericValue,
        notes: existing.notes,
      });
    } else {
      createMut.mutate({
        taxYear: activeYear,
        limitType,
        value: numericValue,
        notes: null,
        ...(placeholder && { carried: true }),
      });
    }
  };

  /** Copies every known limit type from `copyFrom` into the (empty) active
   *  year in one shot — offered next to the group headers below when the
   *  active year has no rows at all yet, as a faster alternative to the
   *  per-row "+ Set" fallback each group already supports. */
  const handleCopyYear = async () => {
    if (!copyFrom || yearData.length > 0) return;
    const sourceData = (data ?? []).filter((l) => l.taxYear === copyFrom);
    for (const l of sourceData) {
      // Carried forward: a release with this year's real figure replaces it.
      await createMut.mutateAsync({
        taxYear: activeYear,
        limitType: l.limitType,
        value: l.value,
        notes: l.notes,
        carried: true,
      });
    }
    setCopyFrom(null);
  };

  const handleDeleteYear = async (yr: number) => {
    const toDelete = (data ?? []).filter((l) => l.taxYear === yr);
    for (const l of toDelete) {
      await deleteMut.mutateAsync({ id: l.id });
    }
    setConfirmDeleteYear(null);
  };

  const limitGroups = taxLimitGroups();
  // Rows Ledgr doesn't use (an old key a household still has).
  const knownTypes = new Set(
    limitGroups.flatMap((g) => g.keys.map((k) => k.key)),
  );
  const unusedLimits = yearData.filter((l) => !knownTypes.has(l.limitType));
  // A year Ledgr ships can't be deleted (it would come back on restart).
  const yearShipped = yearData.some((l) => l.shipped);

  // Compare with previous year for change indicators
  const prevYear = years.find((y) => y < activeYear);
  const prevYearMap = new Map<string, number>();
  if (prevYear) {
    for (const l of (data ?? []).filter((d) => d.taxYear === prevYear)) {
      prevYearMap.set(l.limitType, Number(l.value));
    }
  }

  return (
    <div>
      <h2 className="mb-4 text-lg font-semibold">Contribution & Tax Limits</h2>

      {/* Copy-from-year shortcut — only offered when the active year has no
          rows at all yet; once any row exists, each group's own "+ Set"
          fallback (below) covers filling in the rest one at a time. */}
      {admin && yearData.length === 0 && years.length > 0 && (
        <div className="mb-4 flex items-center gap-3 rounded-lg border border-blue-200 bg-blue-50 p-3">
          <span className="text-secondary text-sm">
            No limits configured for {activeYear} yet.
          </span>
          <label className="text-secondary text-sm">
            Copy from:
            <select
              value={copyFrom ?? years[0] ?? ""}
              onChange={(e) =>
                setCopyFrom(e.target.value ? Number(e.target.value) : null)
              }
              className="ml-2 rounded border px-2 py-1 text-sm"
            >
              {years.map((yr) => (
                <option key={yr} value={yr}>
                  {yr}
                </option>
              ))}
            </select>
          </label>
          <button
            onClick={handleCopyYear}
            disabled={createMut.isPending}
            className="rounded bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Copy
          </button>
        </div>
      )}

      {/* Delete year confirmation */}
      {confirmDeleteYear === activeYear && (
        <div className="mb-4 flex items-center justify-between rounded-lg border border-red-200 bg-red-50 p-3">
          <span className="text-sm text-red-800">
            Delete all {activeYear} limits? This cannot be undone.
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => handleDeleteYear(activeYear)}
              className="rounded bg-red-600 px-3 py-1 text-sm text-white hover:bg-red-700"
            >
              Delete
            </button>
            <button
              onClick={() => setConfirmDeleteYear(null)}
              className="text-muted hover:text-primary px-3 py-1 text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {limitGroups.map((group) => (
          <div key={group.label} className="overflow-hidden rounded-lg border">
            <div className="bg-surface-sunken border-b px-4 py-2">
              <h3 className="text-primary font-medium">{group.label}</h3>
            </div>
            <div className="p-3">
              {group.keys.map((type, idx) => {
                const record = limitsMap.get(type.key);
                const prevVal = prevYearMap.get(type.key);
                const currVal = record ? Number(record.value) : null;
                const changed =
                  prevVal !== undefined &&
                  currVal !== null &&
                  Math.abs(currVal - prevVal) > 0.0001;

                return (
                  <div
                    key={type.key}
                    className={`flex items-center justify-between py-1 text-sm ${idx > 0 ? "border-subtle border-t" : ""}`}
                  >
                    <span className="text-muted">
                      {type.label}
                      {admin && record?.shipped && record.origin === "user" && (
                        <button
                          type="button"
                          onClick={() => resetMut.mutate({ id: record.id })}
                          className="text-caption ml-2 text-blue-600 hover:underline"
                          title="You changed this figure — put back the one Ledgr ships"
                        >
                          Reset to shipped
                        </button>
                      )}
                    </span>
                    <div className="flex items-center gap-1.5">
                      {changed && (
                        <span
                          className={`text-micro ${currVal! > prevVal! ? "text-green-500" : "text-red-500"}`}
                          title={`${prevYear}: ${display(prevVal!, type.format)}`}
                        >
                          {currVal! > prevVal! ? "▲" : "▼"}
                        </span>
                      )}
                      {record ? (
                        <InlineEdit
                          value={toInput(record.value, type.format)}
                          onSave={(v) => handleSave(type.key, v, type.format)}
                          formatDisplay={(v) =>
                            display(
                              Number(fromInput(v, type.format)),
                              type.format,
                            )
                          }
                          parseInput={(v) => v.replace(/[^0-9.]/g, "")}
                          type="number"
                          className="font-medium"
                          isEditable={admin}
                        />
                      ) : admin ? (
                        <button
                          onClick={() => handleSave(type.key, "0", type.format)}
                          className="text-xs text-blue-600 hover:text-blue-800"
                        >
                          + Set
                        </button>
                      ) : (
                        <span className="text-faint text-xs">—</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {unusedLimits.length > 0 && (
        <div className="mt-4 overflow-hidden rounded-lg border">
          <div className="bg-surface-sunken border-b px-4 py-2">
            <h3 className="text-primary font-medium">Not used by Ledgr</h3>
            <p className="text-faint text-xs">
              Figures saved from older versions that nothing reads any more.
            </p>
          </div>
          <div className="p-3">
            {unusedLimits.map((l, idx) => (
              <div
                key={l.id}
                className={`flex items-center justify-between py-1 text-sm ${idx > 0 ? "border-subtle border-t" : ""}`}
              >
                <span className="text-muted">{l.limitType}</span>
                <span className="flex items-center gap-2">
                  <span className="font-medium">
                    {Number(l.value).toLocaleString("en-US")}
                  </span>
                  {admin && (
                    <button
                      type="button"
                      onClick={() => deleteMut.mutate({ id: l.id })}
                      className="text-xs text-red-500 hover:text-red-700"
                    >
                      Delete
                    </button>
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-4 flex items-center justify-between">
        <p className="text-faint text-xs">
          Source: IRS annual limits. Click any value to edit.
        </p>
        {admin &&
          years.length > 1 &&
          !yearShipped &&
          confirmDeleteYear !== activeYear && (
            <button
              onClick={() => setConfirmDeleteYear(activeYear)}
              className="text-xs text-red-500 hover:text-red-700"
            >
              Delete {activeYear}
            </button>
          )}
      </div>
    </div>
  );
}
