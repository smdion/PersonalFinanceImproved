/** Advisor report risk watchlist: RMD shortfall and ACA/IRMAA cliff proximity, from the
 *  engine's structured fields (never `warnings[]` text). Consecutive years with the same
 *  condition collapse into one range, which points to the year table instead of an amount. */
import type { EngineDecumulationYear } from "@/lib/pure/engine/types/index";
import { formatCurrency } from "@/lib/utils/format";

interface WatchlistItem {
  startYear: number;
  endYear: number;
  detail: string;
  severity: "info" | "warning";
}

export interface WatchlistSection {
  items: WatchlistItem[];
  narrative: string;
}

/** Real-dollar MAGI headroom at or below which a year reads as "close to the cliff"
 *  though the subsidy held. */
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
      return `Medicare IRMAA surcharge of ${formatCurrency(flag.amount!)} due to income two years earlier.`;
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
    } else {
      // acaMagiHeadroom is nominal: deflate before comparing with the real-dollar
      // threshold, or the window shrinks in later years, where the cliff bites hardest.
      const realHeadroom = deflate(y.acaMagiHeadroom, y.year);
      if (realHeadroom > 0 && realHeadroom <= ACA_CLOSE_TO_CLIFF_THRESHOLD) {
        flags.push({
          year: y.year,
          kind: "aca-close",
          severity: "info",
          amount: realHeadroom,
        });
      }
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
      : `Across your retirement, this projection has ${parts.join(", ")}. See below for the specific years.`;

  return { items, narrative };
}
