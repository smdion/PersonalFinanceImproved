/**
 * Where Ledgr's data comes from, and how often each source is expected to
 * be refreshed. Drives the sidebar's "Data" indicator: a source needs
 * attention only when it is late for its own rhythm or its last run
 * failed — a yearly source is not "stale" for 11 months of the year.
 *
 * Adding a source = one entry here plus its input in
 * `lib/pure/data-freshness.ts`'s `DataSourceInputs`.
 */

export type DataSourceRhythm =
  /** Late once the last update is more than `days` days old. */
  | { kind: "days"; days: number }
  /** Due once a year for the year just ended: late after `dueMonth`/`dueDay` until updated (from Dec 31 on). */
  | { kind: "yearly"; dueMonth: number; dueDay: number };

export type DataSourceDefinition = {
  key: DataSourceKey;
  label: string;
  /** "manual" = entered by the household; "automatic" = synced by Ledgr. */
  mode: "manual" | "automatic";
  rhythm: DataSourceRhythm;
  /** Plain-language rhythm, for Settings. */
  rhythmLabel: string;
  /** Where to fix it. */
  href: string;
};

export type DataSourceKey =
  "balance" | "performance" | "basis" | "budgetApi" | "simplefin";

export const DATA_SOURCES: readonly DataSourceDefinition[] = [
  {
    key: "balance",
    label: "Balance",
    mode: "manual",
    rhythm: { kind: "days", days: 10 },
    rhythmLabel: "Weekly",
    href: "/portfolio",
  },
  {
    key: "performance",
    label: "Performance",
    mode: "manual",
    rhythm: { kind: "days", days: 35 },
    rhythmLabel: "Monthly",
    href: "/performance",
  },
  {
    key: "basis",
    label: "Basis",
    mode: "manual",
    rhythm: { kind: "yearly", dueMonth: 1, dueDay: 31 },
    rhythmLabel: "Yearly, by Jan 31",
    href: "/tax-buckets",
  },
  {
    key: "budgetApi",
    label: "Budget",
    mode: "automatic",
    rhythm: { kind: "days", days: 2 },
    rhythmLabel: "Daily",
    href: "/settings",
  },
  {
    key: "simplefin",
    label: "SimpleFIN",
    mode: "automatic",
    rhythm: { kind: "days", days: 2 },
    rhythmLabel: "Daily",
    href: "/settings",
  },
];
