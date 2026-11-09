"use client";

/**
 * "Reference Data" settings shell. The 5 yearly tax tables share a year toggle listing the union
 * of their years, annotated with coverage ("2027 · 3/5") since each table is resolved separately;
 * Return Rates and Fixed by law have no year axis, so the toggle hides for them.
 */
import { useState } from "react";
import { SourceLinks } from "./source-links";
import { TaxDataUpdates } from "./tax-data-updates";
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
import { IrsLimitGrowthSetting } from "./irs-limit-growth";
import { ReturnRatesSettings } from "@/components/settings/return-rates";
import { FixedByLaw } from "./fixed-by-law";
import { useDeepLinkParam } from "@/components/settings/use-deep-link-param";
import {
  SETTINGS_SECTION_PARAM,
  TAX_DATA_SECTIONS,
  TAX_YEAR_SECTIONS,
  type TaxDataSectionKey,
} from "@/lib/config/settings-sections";

const SECTIONS = TAX_DATA_SECTIONS;
type SectionKey = TaxDataSectionKey;
const SECTION_KEYS = SECTIONS.map((s) => s.key);
type TaxYearSectionKey = (typeof TAX_YEAR_SECTIONS)[number]["key"];

/** Top-level tab keys SK_SETTINGS_ACTIVE_TAB may still hold; they seed
 *  SK_SETTINGS_TAX_DATA_SECTION (see settings-content.tsx). Kept apart from SectionKey on purpose,
 *  though the keys are the same. */
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
  const { data: sectionSources } =
    trpc.settings.taxData.listSectionSources.useQuery();
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

  const [section, setSection] = useDeepLinkParam(
    SETTINGS_SECTION_PARAM,
    SECTION_KEYS,
    usePersistedSetting<SectionKey>(SK_SETTINGS_TAX_DATA_SECTION, "limits"),
  );
  // Return Rates and Fixed by law have no year axis.
  const isYearSection = TAX_YEAR_SECTIONS.some((s) => s.key === section);
  // Years added via "+Year" that no table has a row for yet (not persisted;
  // a year with a row appears in the union below).
  const [extraYears, setExtraYears] = useState<number[]>([]);

  const unionYears = Array.from(
    new Set([
      ...Object.values(yearsByTable).flatMap((s) => Array.from(s)),
      ...extraYears,
    ]),
  ).sort((a, b) => b - a);

  const coverage: Record<number, string> = {};
  for (const year of unionYears) {
    const n = TAX_YEAR_SECTIONS.filter((s) =>
      yearsByTable[s.key].has(year),
    ).length;
    coverage[year] = `${n}/${tableCount}`;
  }

  const [persistedYear, setPersistedYear] = usePersistedSetting<number>(
    SK_SETTINGS_TAX_DATA_YEAR,
    new Date().getFullYear(),
  );
  // Clamp: a persisted year missing from the union (e.g. its last row was
  // deleted) falls back to the newest year in it.
  const activeYear = unionYears.includes(persistedYear)
    ? persistedYear
    : (unionYears[0] ?? persistedYear);

  const [showAddYear, setShowAddYear] = useState(false);
  const [newYear, setNewYear] = useState("");

  const utils = trpc.useUtils();
  const addYear = trpc.settings.taxData.addYear.useMutation({
    onSuccess: () => utils.settings.invalidate(),
  });

  /** One step: every table copies its latest year forward as carried
   *  (replaced when a Ledgr update brings the real figures). */
  const handleAddYear = async () => {
    const year = parseInt(newYear, 10);
    if (isNaN(year) || year < TAX_YEAR_MIN || year > TAX_YEAR_MAX) return;
    await addYear.mutateAsync({ year: year });
    if (!unionYears.includes(year)) setExtraYears((prev) => [...prev, year]);
    setPersistedYear(year);
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
        {isYearSection && <TaxDataUpdates admin={admin} />}

        {/* Return Rates has no year axis — the shared toggle doesn't
            apply there and would just be inert/confusing. */}
        {isYearSection && (
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
                  disabled={addYear.isPending}
                  className="rounded bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  Add
                </button>
                <span className="text-faint text-xs">
                  Copies the latest figures forward, to check
                </span>
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

        {/* All sections stay mounted so drafts (add-year/add-row dialogs,
            copy-from selections) survive switching; only visibility toggles. */}
        <div className={section === "limits" ? "" : "hidden"}>
          <ContributionLimitsSettings year={activeYear} />
          <IrsLimitGrowthSetting />
        </div>
        <div className={section === "tax" ? "" : "hidden"}>
          <SourceLinks
            citations={sectionSources?.[String(activeYear)]?.withholding ?? []}
            label="Source:"
            className="text-caption text-faint mb-2 block"
          />
          <TaxBracketsSettings year={activeYear} />
        </div>
        <div className={section === "ltcg" ? "" : "hidden"}>
          <SourceLinks
            citations={sectionSources?.[String(activeYear)]?.ltcg ?? []}
            label="Source:"
            className="text-caption text-faint mb-2 block"
          />
          <LtcgBracketsSettings year={activeYear} />
        </div>
        <div className={section === "irmaa" ? "" : "hidden"}>
          <SourceLinks
            citations={sectionSources?.[String(activeYear)]?.irmaa ?? []}
            label="Source:"
            className="text-caption text-faint mb-2 block"
          />
          <IrmaaBracketsSettings year={activeYear} />
        </div>
        <div className={section === "fpl" ? "" : "hidden"}>
          <SourceLinks
            citations={sectionSources?.[String(activeYear)]?.fpl ?? []}
            label="Source:"
            className="text-caption text-faint mb-2 block"
          />
          <FplByHouseholdSettings year={activeYear} />
        </div>
        <div className={section === "returns" ? "" : "hidden"}>
          <ReturnRatesSettings />
        </div>
        <div className={section === "law" ? "" : "hidden"}>
          <FixedByLaw />
        </div>
      </div>
    </div>
  );
}
