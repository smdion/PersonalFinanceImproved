"use client";

/**
 * Consolidated "Reference Data" settings shell — IRS Limits, Tax Brackets,
 * LTCG Brackets, IRMAA Tables, ACA/FPL, and Return Rates used to be 6
 * separate top-level Settings tabs. The first 5 are one conceptual unit
 * (every one of them is "what does the tax law say for year X") and share
 * a year toggle in the top right that persists as you switch between them;
 * Return Rates (age-indexed market-return assumptions, not tax law — no
 * year axis at all) joins the same left-column nav for one-stop "external
 * inputs the projection engine reads" reference data, but the year toggle
 * hides for it since it doesn't apply.
 *
 * The 5 tax tables have no FK/join relating them — a year existing in one
 * doesn't mean it exists in the others (resolveTaxParams, see
 * src/lib/config/tax-params.ts, already resolves each independently and
 * degrades to an engine default when a slice is empty). The shared toggle
 * lists the UNION of years across all 5, annotated with how many of the 5
 * have a row for that year ("2027 · 3/5") so a partial year — previously
 * invisible, now a single click to create — is visible instead of silently
 * degrading downstream.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useUser, isAdmin } from "@/lib/context/user-context";
import { usePersistedSetting } from "@/lib/hooks/use-persisted-setting";
import {
  SK_SETTINGS_TAX_DATA_SECTION,
  SK_SETTINGS_TAX_DATA_YEAR,
} from "@/lib/constants/settings-keys";
import { TAX_YEAR_MIN, TAX_YEAR_MAX } from "@/lib/constants";
import { YearSelector } from "@/components/settings/year-selector";
import { ContributionLimitsSettings } from "@/components/settings/contribution-limits";
import { TaxBracketsSettings } from "@/components/settings/tax-brackets";
import { LtcgBracketsSettings } from "@/components/settings/ltcg-brackets";
import { IrmaaBracketsSettings } from "@/components/settings/irmaa-brackets";
import { FplByHouseholdSettings } from "@/components/settings/fpl-by-household";
import { ReturnRatesSettings } from "@/components/settings/return-rates";

const TAX_YEAR_SECTIONS = [
  { key: "limits", label: "IRS Limits" },
  { key: "tax", label: "Tax Brackets" },
  { key: "ltcg", label: "LTCG Brackets" },
  { key: "irmaa", label: "IRMAA Tables" },
  { key: "fpl", label: "ACA/FPL" },
] as const;

const SECTIONS = [
  ...TAX_YEAR_SECTIONS,
  { key: "returns", label: "Return Rates" },
] as const;

type SectionKey = (typeof SECTIONS)[number]["key"];
type TaxYearSectionKey = (typeof TAX_YEAR_SECTIONS)[number]["key"];

/** Old top-level Settings tab keys (pre-consolidation) — still what
 *  SK_SETTINGS_ACTIVE_TAB may hold for an existing user, and what
 *  SK_SETTINGS_TAX_DATA_SECTION is seeded from the first time a user with
 *  one of these old values lands here (see settings/page.tsx). Identical
 *  to SectionKey today, but kept as its own type so the mapping stays
 *  explicit if either side's keys ever diverge. */
export const OLD_TAX_TAB_KEYS: readonly string[] = [
  "limits",
  "tax",
  "ltcg",
  "irmaa",
  "fpl",
  "returns",
];

export function TaxDataSettings() {
  const user = useUser();
  const admin = isAdmin(user);

  const { data: limitsData } = trpc.settings.contributionLimits.list.useQuery();
  const { data: taxData } = trpc.settings.taxBrackets.list.useQuery();
  const { data: ltcgData } = trpc.settings.ltcgBrackets.list.useQuery();
  const { data: irmaaData } = trpc.settings.irmaaBrackets.list.useQuery();
  const { data: fplData } = trpc.settings.fplByHousehold.list.useQuery();

  const yearsByTable: Record<TaxYearSectionKey, Set<number>> = {
    limits: new Set((limitsData ?? []).map((r) => r.taxYear)),
    tax: new Set((taxData ?? []).map((r) => r.taxYear)),
    ltcg: new Set((ltcgData ?? []).map((r) => r.taxYear)),
    irmaa: new Set((irmaaData ?? []).map((r) => r.taxYear)),
    fpl: new Set((fplData ?? []).map((r) => r.taxYear)),
  };
  const tableCount = TAX_YEAR_SECTIONS.length;

  const [section, setSection] = usePersistedSetting<SectionKey>(
    SK_SETTINGS_TAX_DATA_SECTION,
    "limits",
  );
  // Client-side-only years with no backing row anywhere yet — added via
  // "+Year" below so a brand-new year is selectable before any of the 5
  // tables has a row for it. Not persisted: once a row exists for a year
  // it shows up in the union computed from real data below regardless.
  const [extraYears, setExtraYears] = useState<number[]>([]);

  const unionYears = Array.from(
    new Set([
      ...Object.values(yearsByTable).flatMap((s) => Array.from(s)),
      ...extraYears,
    ]),
  ).sort((a, b) => b - a);

  const coverage: Record<number, string> = {};
  for (const yr of unionYears) {
    const n = TAX_YEAR_SECTIONS.filter((s) =>
      yearsByTable[s.key].has(yr),
    ).length;
    coverage[yr] = `${n}/${tableCount}`;
  }

  const [persistedYear, setPersistedYear] = usePersistedSetting<number>(
    SK_SETTINGS_TAX_DATA_YEAR,
    new Date().getFullYear(),
  );
  // Clamp: a persisted year that no longer appears in the union (e.g. the
  // last table holding it just had that year deleted, and it wasn't a
  // still-being-viewed extraYear) falls back to the newest year that does.
  const activeYear = unionYears.includes(persistedYear)
    ? persistedYear
    : (unionYears[0] ?? persistedYear);

  const [showAddYear, setShowAddYear] = useState(false);
  const [newYear, setNewYear] = useState("");

  const handleAddYear = () => {
    const yr = parseInt(newYear, 10);
    if (isNaN(yr) || yr < TAX_YEAR_MIN || yr > TAX_YEAR_MAX) return;
    if (!unionYears.includes(yr)) setExtraYears((prev) => [...prev, yr]);
    setPersistedYear(yr);
    setShowAddYear(false);
    setNewYear("");
  };

  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-[200px_1fr]">
      <nav className="flex gap-1 overflow-x-auto md:flex-col">
        {SECTIONS.map((s) => (
          <button
            key={s.key}
            onClick={() => setSection(s.key)}
            className={`rounded-md px-3 py-2 text-left text-sm whitespace-nowrap transition-colors ${
              section === s.key
                ? "bg-blue-600 text-white"
                : "text-secondary hover:bg-surface-elevated"
            }`}
          >
            {s.label}
          </button>
        ))}
      </nav>

      <div>
        {/* Return Rates has no year axis — the shared toggle doesn't
            apply there and would just be inert/confusing. */}
        {section !== "returns" && (
          <div className="mb-2 flex flex-col items-end gap-2">
            <YearSelector
              years={unionYears}
              activeYear={activeYear}
              onSelectYear={setPersistedYear}
              admin={admin}
              ariaLabel="Tax data year"
              onAddYearClick={() => {
                setShowAddYear(!showAddYear);
                setNewYear(
                  String((unionYears[0] ?? new Date().getFullYear()) + 1),
                );
              }}
              coverage={coverage}
            />
            {showAddYear && (
              <div className="flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 p-2">
                <label className="text-secondary text-sm">
                  Year:
                  <input
                    type="number"
                    value={newYear}
                    onChange={(e) => setNewYear(e.target.value)}
                    className="ml-2 w-20 rounded border px-2 py-1 text-sm"
                  />
                </label>
                <button
                  onClick={handleAddYear}
                  className="rounded bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-700"
                >
                  Add
                </button>
                <button
                  onClick={() => setShowAddYear(false)}
                  className="text-muted hover:text-primary px-3 py-1 text-sm"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        )}

        {/* All 6 sections stay mounted — several hold in-progress local
            draft state (add-year/add-row dialogs, copy-from selections)
            that would silently reset on a switch away and back otherwise,
            same risk class the Integrations and General shells guard
            against. Only visibility toggles. */}
        <div className={section === "limits" ? "" : "hidden"}>
          <ContributionLimitsSettings year={activeYear} />
        </div>
        <div className={section === "tax" ? "" : "hidden"}>
          <TaxBracketsSettings year={activeYear} />
        </div>
        <div className={section === "ltcg" ? "" : "hidden"}>
          <LtcgBracketsSettings year={activeYear} />
        </div>
        <div className={section === "irmaa" ? "" : "hidden"}>
          <IrmaaBracketsSettings year={activeYear} />
        </div>
        <div className={section === "fpl" ? "" : "hidden"}>
          <FplByHouseholdSettings year={activeYear} />
        </div>
        <div className={section === "returns" ? "" : "hidden"}>
          <ReturnRatesSettings />
        </div>
      </div>
    </div>
  );
}
