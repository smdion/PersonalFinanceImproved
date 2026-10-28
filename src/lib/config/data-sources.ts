/**
 * Where Ledgr's data comes from, and how often each source is expected to
 * be refreshed. Drives the sidebar's "Data" indicator: a source needs
 * attention only when it is late for its own rhythm or its last run
 * failed — a yearly source is not "stale" for 11 months of the year.
 *
 * Adding a source = one entry here plus its input in
 * `lib/pure/data-freshness.ts`'s `DataSourceInputs`.
 */

import type { Focus } from "./focus-topics";

type DataSourceRhythm =
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
  focus: Focus;
  /** false: judged by something other than its age (tax data, by
   *  publication dates) — Settings doesn't show "last updated". */
  showsLastUpdated?: false;
};

export type DataSourceKey =
  | "balance"
  | "performance"
  | "basis"
  | "budgetApi"
  | "simplefin"
  | "secFacts"
  | "taxData";

export const DATA_SOURCES: readonly DataSourceDefinition[] = [
  {
    key: "balance",
    label: "Balance",
    mode: "manual",
    rhythm: { kind: "days", days: 10 },
    rhythmLabel: "Weekly",
    focus: { topic: "balances" },
  },
  {
    key: "performance",
    label: "Performance",
    mode: "manual",
    rhythm: { kind: "days", days: 35 },
    rhythmLabel: "Monthly",
    focus: { topic: "performance" },
  },
  {
    key: "basis",
    label: "Basis",
    mode: "manual",
    rhythm: { kind: "yearly", dueMonth: 1, dueDay: 31 },
    rhythmLabel: "Yearly, by Jan 31",
    focus: { topic: "rothBasis" },
  },
  {
    key: "budgetApi",
    label: "Budget",
    mode: "automatic",
    rhythm: { kind: "days", days: 2 },
    rhythmLabel: "Daily",
    focus: { topic: "settings", tab: "integrations" },
  },
  {
    key: "simplefin",
    label: "SimpleFIN",
    mode: "automatic",
    rhythm: { kind: "days", days: 2 },
    rhythmLabel: "Daily",
    focus: { topic: "settings", tab: "integrations", section: "simplefin" },
  },
  {
    key: "secFacts",
    label: "Fund facts",
    mode: "automatic",
    rhythm: { kind: "days", days: 9 },
    rhythmLabel: "Weekly",
    focus: { topic: "settings", tab: "integrations", section: "sec" },
  },
  {
    key: "taxData",
    label: "Tax data",
    mode: "automatic",
    // Judged by its own publication dates (lib/pure/tax-data-status.ts),
    // reported as warnings — never by age.
    rhythm: { kind: "days", days: 100_000 },
    rhythmLabel: "Yearly, with Ledgr updates",
    focus: { topic: "settings", tab: "taxdata" },
    showsLastUpdated: false,
  },
];
