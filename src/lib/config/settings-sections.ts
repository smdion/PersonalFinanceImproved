/**
 * Settings tabs and their sections — the one list the Settings page, its
 * panels and every "open this in Settings" link read, so a link can't point
 * at a section that doesn't exist.
 */

export const SETTINGS_TABS = [
  { key: "general", label: "General" },
  { key: "taxdata", label: "Reference Data" },
  { key: "integrations", label: "Integrations" },
] as const;

export const ADMIN_SETTINGS_TABS = [
  { key: "access", label: "Access Control" },
  { key: "debug", label: "Debug" },
  { key: "api", label: "API" },
] as const;

export const GENERAL_SECTIONS = [
  { key: "people", label: "People" },
  { key: "household", label: "Household" },
  { key: "retirement", label: "Retirement" },
  { key: "livingCosts", label: "Living Costs Mapping" },
  { key: "dataSources", label: "Data Sources" },
] as const;

export const TAX_YEAR_SECTIONS = [
  { key: "limits", label: "IRS Limits" },
  { key: "tax", label: "Tax Brackets" },
  { key: "ltcg", label: "LTCG Brackets" },
  { key: "irmaa", label: "IRMAA Tables" },
  { key: "fpl", label: "ACA/FPL" },
] as const;

export const TAX_DATA_SECTIONS = [
  ...TAX_YEAR_SECTIONS,
  { key: "returns", label: "Return Rates" },
  { key: "law", label: "Fixed by law" },
] as const;

export const INTEGRATIONS_SECTIONS = [
  { key: "ynab", label: "YNAB" },
  { key: "actual", label: "Actual Budget" },
  { key: "simplefin", label: "SimpleFIN" },
  { key: "tiingo", label: "Tiingo" },
  { key: "sec", label: "SEC fund facts" },
  { key: "taxData", label: "Tax data updates" },
  { key: "syncBehavior", label: "Sync Behavior" },
] as const;
export type GeneralSectionKey = (typeof GENERAL_SECTIONS)[number]["key"];
export type TaxDataSectionKey = (typeof TAX_DATA_SECTIONS)[number]["key"];
export type IntegrationsSectionKey =
  (typeof INTEGRATIONS_SECTIONS)[number]["key"];

export type SettingsSectionsByTab = {
  general: GeneralSectionKey;
  taxdata: TaxDataSectionKey;
  integrations: IntegrationsSectionKey;
};

/** Query params a Settings link uses (read by `useDeepLinkParam`). */
export const SETTINGS_TAB_PARAM = "tab";
export const SETTINGS_SECTION_PARAM = "section";

/** Link to a Settings tab, optionally one of its sections. */
export function settingsHref<T extends keyof SettingsSectionsByTab>(
  tab: T,
  section?: SettingsSectionsByTab[T],
): string {
  const qs = new URLSearchParams({ [SETTINGS_TAB_PARAM]: tab });
  if (section) qs.set(SETTINGS_SECTION_PARAM, section);
  return `/settings?${qs.toString()}`;
}

/** Plain-words name of a Settings location, e.g. "Settings → Integrations → SimpleFIN". */
export function settingsLocationLabel<T extends keyof SettingsSectionsByTab>(
  tab: T,
  section?: SettingsSectionsByTab[T],
): string {
  const tabLabel = SETTINGS_TABS.find((t) => t.key === tab)!.label;
  const sections: readonly { key: string; label: string }[] =
    tab === "general"
      ? GENERAL_SECTIONS
      : tab === "taxdata"
        ? TAX_DATA_SECTIONS
        : INTEGRATIONS_SECTIONS;
  const sectionLabel = section
    ? sections.find((s) => s.key === section)?.label
    : undefined;
  return ["Settings", tabLabel, sectionLabel].filter(Boolean).join(" → ");
}
