"use client";

/** Settings tab for managing IRS contribution limits, FICA rates, and standard deductions by tax year with inline editing, year duplication, and year-over-year change indicators. */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useUser, isAdmin } from "@/lib/context/user-context";
import { InlineEdit } from "@/components/ui/inline-edit";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import {
  categoriesWithIrsLimit,
  getAccountTypeConfig,
  getLimitGroup,
} from "@/lib/config/account-types";
// Build account-type limit groups from config
type LimitGroupEntry = {
  label: string;
  types: { key: string; label: string; format: "dollar" | "percent" }[];
};

function buildAccountLimitGroups(): LimitGroupEntry[] {
  const seen = new Set<string>();
  const groups: LimitGroupEntry[] = [];
  for (const cat of categoriesWithIrsLimit()) {
    const cfg = getAccountTypeConfig(cat);
    const group = getLimitGroup(cat) ?? cat;
    if (seen.has(group)) continue; // 401k/403b share a group
    seen.add(group);
    if (!cfg.irsLimitKeys) continue;
    const types: {
      key: string;
      label: string;
      format: "dollar" | "percent";
    }[] = [];
    types.push({
      key: cfg.irsLimitKeys.base,
      label: cfg.irsLimitKeys.coverageVariant ? "Self-only" : "Annual limit",
      format: "dollar",
    });
    if (cfg.irsLimitKeys.coverageVariant) {
      types.push({
        key: cfg.irsLimitKeys.coverageVariant,
        label: "Family",
        format: "dollar",
      });
    }
    if (cfg.irsLimitKeys.catchup) {
      const catchupLabel = cfg.catchupAge
        ? `Catch-up (${cfg.catchupAge}+)`
        : "Catch-up";
      types.push({
        key: cfg.irsLimitKeys.catchup,
        label: catchupLabel,
        format: "dollar",
      });
    }
    if (cfg.irsLimitKeys.superCatchup && cfg.superCatchupAgeRange) {
      types.push({
        key: cfg.irsLimitKeys.superCatchup,
        label: `Super catch-up (${cfg.superCatchupAgeRange[0]}-${cfg.superCatchupAgeRange[1]})`,
        format: "dollar",
      });
    }
    groups.push({ label: cfg.displayLabel, types });
  }
  return groups;
}

// Group limit types by category for display
const limitGroups: LimitGroupEntry[] = [
  ...buildAccountLimitGroups(),
  {
    label: "FICA / Medicare",
    types: [
      { key: "ss_wage_base", label: "SS wage base", format: "dollar" },
      { key: "fica_ss_rate", label: "SS rate", format: "percent" },
      { key: "fica_medicare_rate", label: "Medicare rate", format: "percent" },
      {
        key: "fica_medicare_surtax_rate",
        label: "Additional Medicare rate",
        format: "percent",
      },
      {
        key: "fica_medicare_surtax_threshold",
        label: "Additional Medicare threshold",
        format: "dollar",
      },
    ],
  },
  {
    label: "Other",
    types: [
      {
        key: "standard_deduction_mfj",
        label: "Standard deduction (MFJ)",
        format: "dollar",
      },
      {
        key: "standard_deduction_single",
        label: "Standard deduction (Single)",
        format: "dollar",
      },
      {
        key: "standard_deduction_hoh",
        label: "Standard deduction (HoH)",
        format: "dollar",
      },
      {
        key: "additional_std_deduction_65_married",
        label: "Additional standard deduction, age 65+ (married, per spouse)",
        format: "dollar",
      },
      {
        key: "additional_std_deduction_65_unmarried",
        label: "Additional standard deduction, age 65+ (single / HoH)",
        format: "dollar",
      },
      {
        key: "obbba_senior_deduction_per_person",
        label: "OBBBA senior deduction, per person 65+ (2025-2028 only)",
        format: "dollar",
      },
      {
        key: "obbba_senior_deduction_phaseout_start_mfj",
        label: "OBBBA senior deduction phaseout start (MFJ)",
        format: "dollar",
      },
      {
        key: "obbba_senior_deduction_phaseout_start_unmarried",
        label: "OBBBA senior deduction phaseout start (single / HoH)",
        format: "dollar",
      },
      {
        key: "obbba_senior_deduction_phaseout_rate",
        label: "OBBBA senior deduction phaseout rate",
        format: "percent",
      },
      // obbba_senior_deduction_sunset_year deliberately NOT listed here — a
      // plain year (e.g. "2028"), not a dollar or percent figure, and this
      // table's format union is dollar|percent only. It still edits fine
      // via the "custom" fallback section below, which renders unknown
      // limit types generically.
      {
        key: "supplemental_tax_rate",
        label: "Supplemental tax rate",
        format: "percent",
      },
    ],
  },
];

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
    { id: number; value: string; taxYear: number; notes: string | null }
  >();
  for (const l of yearData) {
    limitsMap.set(l.limitType, l);
  }

  const handleSave = (
    limitType: string,
    value: string,
    format: "dollar" | "percent",
  ) => {
    const existing = limitsMap.get(limitType);
    const numericValue =
      format === "percent"
        ? String(Number(value.replace(/[^0-9.]/g, "")) / 100)
        : value.replace(/[^0-9.]/g, "");

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
      await createMut.mutateAsync({
        taxYear: activeYear,
        limitType: l.limitType,
        value: l.value,
        notes: l.notes,
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

  // Collect any limit types not in our groups
  const knownTypes = new Set(
    limitGroups.flatMap((g) => g.types.map((t) => t.key)),
  );
  const customLimits = yearData.filter((l) => !knownTypes.has(l.limitType));

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
      <h2 className="text-lg font-semibold mb-4">Contribution & Tax Limits</h2>

      {/* Copy-from-year shortcut — only offered when the active year has no
          rows at all yet; once any row exists, each group's own "+ Set"
          fallback (below) covers filling in the rest one at a time. */}
      {admin && yearData.length === 0 && years.length > 0 && (
        <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg flex items-center gap-3">
          <span className="text-sm text-secondary">
            No limits configured for {activeYear} yet.
          </span>
          <label className="text-sm text-secondary">
            Copy from:
            <select
              value={copyFrom ?? years[0] ?? ""}
              onChange={(e) =>
                setCopyFrom(e.target.value ? Number(e.target.value) : null)
              }
              className="ml-2 px-2 py-1 text-sm border rounded"
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
            className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          >
            Copy
          </button>
        </div>
      )}

      {/* Delete year confirmation */}
      {confirmDeleteYear === activeYear && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center justify-between">
          <span className="text-sm text-red-800">
            Delete all {activeYear} limits? This cannot be undone.
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => handleDeleteYear(activeYear)}
              className="px-3 py-1 text-sm bg-red-600 text-white rounded hover:bg-red-700"
            >
              Delete
            </button>
            <button
              onClick={() => setConfirmDeleteYear(null)}
              className="px-3 py-1 text-sm text-muted hover:text-primary"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {limitGroups.map((group) => (
          <div key={group.label} className="border rounded-lg overflow-hidden">
            <div className="bg-surface-sunken px-4 py-2 border-b">
              <h3 className="font-medium text-primary">{group.label}</h3>
            </div>
            <div className="p-3">
              {group.types.map((type, idx) => {
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
                    className={`flex justify-between items-center text-sm py-1 ${idx > 0 ? "border-t border-subtle" : ""}`}
                  >
                    <span className="text-muted">{type.label}</span>
                    <div className="flex items-center gap-1.5">
                      {changed && (
                        <span
                          className={`text-micro ${currVal! > prevVal! ? "text-green-500" : "text-red-500"}`}
                          title={`${prevYear}: ${type.format === "percent" ? formatPercent(prevVal!, 2) : formatCurrency(prevVal!)}`}
                        >
                          {currVal! > prevVal! ? "▲" : "▼"}
                        </span>
                      )}
                      {record ? (
                        <InlineEdit
                          value={
                            type.format === "percent"
                              ? String(Number(record.value) * 100)
                              : record.value
                          }
                          onSave={(v) => handleSave(type.key, v, type.format)}
                          formatDisplay={(v) => {
                            const n = Number(v);
                            return type.format === "percent"
                              ? formatPercent(n / 100, 2)
                              : formatCurrency(n);
                          }}
                          parseInput={(v) => v.replace(/[^0-9.]/g, "")}
                          type="number"
                          className="font-medium"
                          isEditable={admin}
                        />
                      ) : admin ? (
                        <button
                          onClick={() =>
                            handleSave(
                              type.key,
                              type.format === "percent" ? "0" : "0",
                              type.format,
                            )
                          }
                          className="text-xs text-blue-600 hover:text-blue-800"
                        >
                          + Set
                        </button>
                      ) : (
                        <span className="text-xs text-faint">—</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {customLimits.length > 0 && (
        <div className="mt-4 border rounded-lg overflow-hidden">
          <div className="bg-surface-sunken px-4 py-2 border-b">
            <h3 className="font-medium text-primary">Custom</h3>
          </div>
          <div className="p-3">
            {customLimits.map((l, idx) => {
              const isPercent = Number(l.value) < 1;
              return (
                <div
                  key={l.id}
                  className={`flex justify-between items-center text-sm py-1 ${idx > 0 ? "border-t border-subtle" : ""}`}
                >
                  <span className="text-muted">{l.limitType}</span>
                  <InlineEdit
                    value={isPercent ? String(Number(l.value) * 100) : l.value}
                    onSave={(v) =>
                      handleSave(
                        l.limitType,
                        v,
                        isPercent ? "percent" : "dollar",
                      )
                    }
                    formatDisplay={(v) => {
                      const n = Number(v);
                      return isPercent
                        ? formatPercent(n / 100, 2)
                        : formatCurrency(n);
                    }}
                    parseInput={(v) => v.replace(/[^0-9.]/g, "")}
                    type="number"
                    className="font-medium"
                    isEditable={admin}
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between mt-4">
        <p className="text-xs text-faint">
          Source: IRS annual limits. Click any value to edit.
        </p>
        {admin && years.length > 1 && confirmDeleteYear !== activeYear && (
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
