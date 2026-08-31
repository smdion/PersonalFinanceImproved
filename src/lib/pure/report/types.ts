/** Pure data shape for the retirement advisor report — narrative modules in
 *  this directory produce this, report/*.tsx components render it. No JSX,
 *  no React, so every section is unit-testable without a DOM. */

export interface ReportVerdict {
  /** Plain-English headline, e.g. "Your plan is on track" /
   *  "Your plan needs attention." */
  headline: string;
  /** True when the deterministic projection never depletes the portfolio
   *  AND the Monte Carlo success rate clears a reasonable bar — the
   *  single fact the cover page's badge renders. */
  onTrack: boolean;
}

export interface ReportExecutiveSummary {
  verdict: ReportVerdict;
  /** 2-4 sentence narrative paragraph, second person, warm-but-authoritative. */
  narrative: string;
  /** Key headline numbers, already formatted for display. */
  keyNumbers: {
    label: string;
    value: string;
  }[];
  /** One-line Coast FIRE mention, when available — not a full section. */
  coastFireLine?: string;
}

export interface ReportWithdrawalStrategySection {
  narrative: string;
  /** Per-year "why this account" detail, already formatted strings, for
   *  the strategy section's supporting detail list — not the full
   *  year-by-year table (that's report-year-table.tsx, Phase 4). */
  highlights: { year: number; detail: string }[];
}

export interface ReportNarrative {
  executiveSummary: ReportExecutiveSummary;
  withdrawalStrategy: ReportWithdrawalStrategySection;
  risk: import("./risk-narrative").RiskNarrative;
  riskBandPoints: import("./risk-narrative").RiskBandPoint[];
  watchlist: import("./aca-irmaa-narrative").WatchlistSection;
  actionItems: import("./action-items").ActionItemsSection;
  yearTableRows: import("./year-table").YearTableRow[];
}
