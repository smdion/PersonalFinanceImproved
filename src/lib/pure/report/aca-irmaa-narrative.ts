/** Risk-watchlist section of the advisor report: RMD shortfall/excise
 *  exposure and ACA/IRMAA cliff proximity — both currently buried in a
 *  per-row hover tooltip (projection-table-decum-row.tsx's "diag" trigger)
 *  and never aggregated into a plan-level statement. Pure function: reads
 *  only the STRUCTURED fields the engine already computes
 *  (irmaaCost/acaMagiHeadroom/acaSubsidyPreserved/rmdShortfallAmount) —
 *  never the free-form `warnings[]` strings, which have no typed link to
 *  this code and could drift silently if matched on text.
 *
 * Consecutive years with the SAME condition are collapsed into one range
 * entry rather than one line per year — found live, 2026-08-31: a
 * household with a decades-long ACA cliff exposure got 40 near-identical
 * lines ("2044: ACA subsidy was lost", "2045: ACA subsidy was lost", ...),
 * which is unreadable in a document meant to be read, not scanned like a
 * table (the full year-by-year table already exists separately, Phase 4,
 * for households that want every year). A ranged entry can't show one
 * exact dollar figure (amounts vary year to year within the range), so
 * multi-year ranges state the condition and point to that table instead
 * of a specific amount; a single-year entry still shows its real figure.
 */
import type { EngineDecumulationYear } from "@/lib/calculators/types/engine-projection";
import { formatCurrency } from "@/lib/utils/format";

export interface WatchlistItem {
  startYear: number;
  endYear: number;
  detail: string;
  severity: "info" | "warning";
}

export interface WatchlistSection {
  items: WatchlistItem[];
  narrative: string;
}

/** Below this MAGI headroom, a year reads as "close to the cliff" even
 *  though the subsidy technically held — matches the per-row diag
 *  tooltip's own framing of headroom as a proximity signal, not just a
 *  binary preserved/lost flag. */
const ACA_CLOSE_TO_CLIFF_THRESHOLD = 3000;

type FlagKind = "rmd-shortfall" | "irmaa" | "aca-lost" | "aca-close";

interface YearFlag {
  year: number;
  kind: FlagKind;
  severity: "info" | "warning";
  /** Deflated amount, when this kind of flag has one — used only for a
   *  single-year (unranged) entry's exact-figure sentence. */
  amount?: number;
}

function singleYearDetail(flag: YearFlag): string {
  switch (flag.kind) {
    case "rmd-shortfall":
      return `Required Minimum Distribution shortfall of ${formatCurrency(flag.amount!)} — this portion couldn't be forced out as a real taxable distribution, which can trigger a 25% excise tax on the shortfall.`;
    case "irmaa":
      return `Medicare IRMAA surcharge of ${formatCurrency(flag.amount!)} due to income in this year.`;
    case "aca-lost":
      return "ACA premium subsidy was lost this year — income exceeded the subsidy cliff.";
    case "aca-close":
      return `Within ${formatCurrency(flag.amount!)} of losing your ACA premium subsidy.`;
  }
}

function rangeDetail(kind: FlagKind, yearCount: number): string {
  switch (kind) {
    case "rmd-shortfall":
      return `Required Minimum Distribution shortfall in each of these ${yearCount} years — this can trigger a 25% excise tax on the shortfall each year. See the year-by-year table for exact amounts.`;
    case "irmaa":
      return `Medicare IRMAA surcharge in each of these ${yearCount} years. See the year-by-year table for exact amounts.`;
    case "aca-lost":
      return `ACA premium subsidy was lost in each of these ${yearCount} years — income exceeded the subsidy cliff.`;
    case "aca-close":
      return `Close to losing your ACA premium subsidy in each of these ${yearCount} years.`;
  }
}

const KIND_LABEL: Record<FlagKind, string> = {
  "rmd-shortfall": "a Required Minimum Distribution shortfall",
  irmaa: "a Medicare IRMAA surcharge",
  "aca-lost": "an ACA subsidy loss",
  "aca-close": "close proximity to the ACA subsidy cliff",
};

export function buildWatchlist(
  decumulationYears: EngineDecumulationYear[],
  deflate: (v: number, year: number) => number,
): WatchlistSection {
  const flags: YearFlag[] = [];

  for (const y of decumulationYears) {
    if (y.rmdShortfallAmount > 0) {
      flags.push({
        year: y.year,
        kind: "rmd-shortfall",
        severity: "warning",
        amount: deflate(y.rmdShortfallAmount, y.year),
      });
    }
    if (y.irmaaCost > 0) {
      flags.push({
        year: y.year,
        kind: "irmaa",
        severity: "info",
        amount: deflate(y.irmaaCost, y.year),
      });
    }
    if (y.acaSubsidyPreserved === false) {
      flags.push({ year: y.year, kind: "aca-lost", severity: "warning" });
    } else if (
      y.acaMagiHeadroom > 0 &&
      y.acaMagiHeadroom <= ACA_CLOSE_TO_CLIFF_THRESHOLD
    ) {
      flags.push({
        year: y.year,
        kind: "aca-close",
        severity: "info",
        amount: deflate(y.acaMagiHeadroom, y.year),
      });
    }
  }

  // Group each kind's own years into consecutive runs — a household can
  // have both an RMD-shortfall run AND an ACA-lost run overlapping the
  // same years; each kind is grouped independently.
  const items: WatchlistItem[] = [];
  const kinds: FlagKind[] = ["rmd-shortfall", "irmaa", "aca-lost", "aca-close"];
  for (const kind of kinds) {
    const kindFlags = flags
      .filter((f) => f.kind === kind)
      .sort((a, b) => a.year - b.year);
    let i = 0;
    while (i < kindFlags.length) {
      let j = i;
      while (
        j + 1 < kindFlags.length &&
        kindFlags[j + 1]!.year === kindFlags[j]!.year + 1
      ) {
        j++;
      }
      const run = kindFlags.slice(i, j + 1);
      const first = run[0]!;
      items.push({
        startYear: first.year,
        endYear: run[run.length - 1]!.year,
        severity: first.severity,
        detail:
          run.length === 1
            ? singleYearDetail(first)
            : rangeDetail(kind, run.length),
      });
      i = j + 1;
    }
  }
  items.sort((a, b) => a.startYear - b.startYear);

  const parts: string[] = [];
  for (const kind of kinds) {
    const count = flags.filter((f) => f.kind === kind).length;
    if (count > 0) {
      parts.push(
        `${count} year${count !== 1 ? "s" : ""} with ${KIND_LABEL[kind]}`,
      );
    }
  }

  const narrative =
    parts.length === 0
      ? "No Medicare IRMAA surcharges, ACA subsidy losses, or Required Minimum Distribution shortfalls were found in your projection."
      : `Across your retirement, this plan has ${parts.join(", ")}. See below for the specific years.`;

  return { items, narrative };
}
