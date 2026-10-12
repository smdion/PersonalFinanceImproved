/**
 * Pure helpers for the sidebar's "Data" freshness indicator.
 */
import {
  DATA_SOURCES,
  type DataSourceDefinition,
  type DataSourceKey,
} from "@/lib/config/data-sources";

/** What is known about one source right now. Absent = not in use (not connected / never entered). */
export type DataSourceInput = {
  /** Date-only ("YYYY-MM-DD") or ISO timestamp of the last update. Null = connected but never run. */
  lastUpdated: string | null;
  /** Last run's error, for automatic sources. */
  error?: string | null;
  /** Problems found in what the source collected (monitors). */
  warnings?: readonly string[];
};

export type DataSourceInputs = Partial<Record<DataSourceKey, DataSourceInput>>;

export type DataSourceStatus = {
  source: DataSourceDefinition;
  lastUpdated: string | null;
  /** Whole days since the last update, or null when never updated. */
  ageDays: number | null;
  needsAttention: boolean;
  /** Short reason, set when it needs attention. */
  reason: string | null;
};

function parseRaw(raw: string): Date {
  return new Date(raw.includes("T") ? raw : raw + "T00:00:00");
}

const DAY_MS = 86_400_000;

/**
 * Each in-use source's status for the sidebar, in registry order. A source
 * needs attention only when it is late for its own rhythm or its last run
 * failed.
 */
export function evaluateDataSources(
  inputs: DataSourceInputs,
  now: Date = new Date(),
): DataSourceStatus[] {
  const statuses: DataSourceStatus[] = [];
  for (const source of DATA_SOURCES) {
    const input = inputs[source.key];
    if (!input) continue;
    const last = input.lastUpdated ? parseRaw(input.lastUpdated) : null;
    const valid = last && !Number.isNaN(last.getTime()) ? last : null;
    const ageDays = valid
      ? Math.max(0, Math.floor((now.getTime() - valid.getTime()) / DAY_MS))
      : null;

    let reason: string | null = null;
    const warnings = input.warnings ?? [];
    if (input.error) {
      reason = "last sync failed";
    } else if (warnings.length > 0) {
      reason =
        warnings.length === 1 ? warnings[0]! : `${warnings.length} problems`;
    } else if (!valid) {
      reason = source.mode === "automatic" ? "never synced" : "never updated";
    } else if (source.rhythm.kind === "days") {
      if (ageDays! > source.rhythm.days) reason = `${ageDays} days old`;
    } else {
      const due = new Date(
        now.getFullYear(),
        source.rhythm.dueMonth - 1,
        source.rhythm.dueDay,
        23,
        59,
        59,
      );
      // The yearly update covers the year just ended, so an update from
      // its last day onward counts.
      const coversLastYear = valid >= new Date(now.getFullYear() - 1, 11, 31);
      if (now > due && !coversLastYear)
        reason = `due ${due.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
    }
    statuses.push({
      source,
      lastUpdated: input.lastUpdated,
      ageDays,
      needsAttention: reason !== null,
      reason,
    });
  }
  return statuses;
}
