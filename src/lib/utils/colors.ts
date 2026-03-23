/**
 * Centralized color definitions for account types and tax treatments.
 * All pages should use these to ensure consistent visual identity.
 *
 * Account-type colors are derived from ACCOUNT_TYPE_CONFIG — adding a new
 * account type with a `colors` block automatically wires it up here.
 */

import { ACCOUNT_TYPE_CONFIG } from "@/lib/config/account-types";

// ── Account-type colors (paycheck, dashboard contribution cards) ──

type ColorSet = { bg: string; bgLight: string; border: string; text: string };

// Build ACCOUNT_TYPE_COLORS from the central config.
// Config uses bg/bgLight/border/text too, but with slightly different Tailwind
// classes (e.g. config uses `bg-blue-600` and `border-blue-300` while this
// module historically used `bg-blue-500` and `border-l-blue-500`).
// We translate config colors into the border-l variant expected by cards.
const ACCOUNT_TYPE_COLORS: Record<string, ColorSet> = Object.fromEntries(
  Object.entries(ACCOUNT_TYPE_CONFIG).map(([cat, cfg]) => [
    cat,
    {
      bg: cfg.colors.bg,
      bgLight: cfg.colors.bgLight,
      border: cfg.colors.border.replace("border-", "border-l-"),
      text: cfg.colors.text,
    },
  ]),
);

// Sub-type display colors — derive from subTypeDisplay config on each account type
for (const cfg of Object.values(ACCOUNT_TYPE_CONFIG)) {
  for (const [subKey, subCfg] of Object.entries(cfg.subTypeDisplay)) {
    ACCOUNT_TYPE_COLORS[subKey] = {
      bg: subCfg.colors.bg,
      bgLight: subCfg.colors.bgLight,
      border: subCfg.colors.border.replace("border-", "border-l-"),
      text: subCfg.colors.text,
    };
  }
}

const DEFAULT_ACCOUNT_COLORS: ColorSet = {
  bg: "bg-gray-500",
  bgLight: "bg-gray-300/60",
  border: "border-l-gray-500",
  text: "text-gray-700",
};

function getColorSet(type: string): ColorSet {
  return ACCOUNT_TYPE_COLORS[type] ?? DEFAULT_ACCOUNT_COLORS;
}

/** Primary fill color for account type bars/badges (e.g. `bg-blue-500`) */
export function accountColor(type: string): string {
  return getColorSet(type).bg;
}

/** Lighter fill for match/secondary bars (e.g. `bg-blue-300/60`) */
export function accountMatchColor(type: string): string {
  return getColorSet(type).bgLight;
}

/** Left border accent for cards (e.g. `border-l-blue-500`) */
export function accountBorderColor(type: string): string {
  return getColorSet(type).border;
}

/** Text color for labels (e.g. `text-blue-700`) */
export function accountTextColor(type: string): string {
  return getColorSet(type).text;
}

// ── Tax-treatment colors (portfolio, balance projection charts) ──
// Must be visually distinct from each other in stacked bar charts.
// Echoes account-type hues where possible:
//   Pre-Tax → blue (like 401k), Tax-Free → purple (like IRA, often Roth),
//   HSA → green (matches HSA account), After-Tax → amber (like Brokerage)

const TAX_TYPE_COLORS: Record<
  string,
  { bg: string; text: string; label: string }
> = {
  preTax: { bg: "bg-blue-500", text: "text-blue-600", label: "Traditional" },
  taxFree: { bg: "bg-violet-500", text: "text-violet-600", label: "Roth" },
  hsa: { bg: "bg-emerald-500", text: "text-emerald-600", label: "HSA" },
  afterTax: {
    bg: "bg-orange-500",
    text: "text-orange-600",
    label: "After-Tax",
  },
};

/** Bar color for tax treatment breakdown (e.g. `bg-emerald-400` for Roth) */
export function taxTypeColor(taxType: string): string {
  return TAX_TYPE_COLORS[taxType]?.bg ?? "bg-gray-400";
}

/** Text color for tax treatment labels (e.g. `text-blue-500` for Pre-Tax) */
export function taxTypeTextColor(taxType: string): string {
  return TAX_TYPE_COLORS[taxType]?.text ?? "text-gray-500";
}

/** Display label for tax treatment (e.g. `taxFree` → `Tax-Free`) */
export function taxTypeLabel(taxType: string): string {
  return TAX_TYPE_COLORS[taxType]?.label ?? taxType;
}

// ── Badge background colors ──
// Derived from text color → matching light bg. Used by AccountBadge.
// Explicitly listed so Tailwind JIT can detect the class names.
const BADGE_BG: Record<string, string> = {
  "text-blue-700": "bg-blue-100",
  "text-indigo-700": "bg-indigo-100",
  "text-purple-700": "bg-purple-100",
  "text-emerald-700": "bg-emerald-100",
  "text-green-700": "bg-green-100",
  "text-teal-700": "bg-teal-100",
  "text-amber-700": "bg-amber-100",
  "text-gray-700": "bg-gray-100",
};

/** Light background for account-type badges (e.g. `bg-blue-100`) */
export function accountBadgeBg(type: string): string {
  return BADGE_BG[getColorSet(type).text] ?? "bg-gray-100";
}

// ── Chart hex colors (Recharts/SVG — hex equivalents of Tailwind classes) ──
// Centralized so chart components don't define their own hex values.

export const CHART_COLORS = {
  // Net worth line chart
  netWorth: "#4f46e5", // indigo-600
  portfolio: "#ef4444", // red-500
  house: "#3b82f6", // blue-500
  cash: "#f59e0b", // amber-500
  liabilities: "#a855f7", // purple-500
  // Net worth location pie
  piPortfolio: "#ef4444",
  piHouse: "#3b82f6",
  piCash: "#f59e0b",
  piOther: "#6b7280",
  // Journey to Abundance
  avgWealth: "#9ca3af", // gray-400
  prodigiousWealth: "#facc15", // yellow-400
  aawScore: "#059669", // emerald-600
  // Monte Carlo percentile bands
  mcGrid: "#e5e7eb", // gray-200
  mcAxis: "#6b7280", // gray-500
  mcBandOuter: "#dbeafe", // blue-100
  mcBandInner: "#93c5fd", // blue-300
  mcMedian: "#3b82f6", // blue-500
  mcMedianStroke: "#2563eb", // blue-600
  mcDeterministic: "#9ca3af", // gray-400
  // Performance chart
  perfBalance: "#4f46e5", // indigo-600
  perfReturn: "#10b981", // emerald-500
  perfGainLoss: "#f59e0b", // amber-500
  perfContributions: "#8b5cf6", // violet-500
  perfRetirement: "#3b82f6", // blue-500
  perfBrokerage: "#f97316", // orange-500
  perfHsa: "#10b981", // emerald-500
};

/** Hex colors for tax-type pie/chart segments (Recharts needs hex, not Tailwind classes) */
export const TAX_PIE_COLORS: Record<string, string> = {
  preTax: "#3b82f6", // blue-500
  taxFree: "#8b5cf6", // violet-500
  hsa: "#10b981", // emerald-500
  afterTax: "#f97316", // orange-500
};

/** Hex chart colors per account category, with roth (lighter) and traditional (standard) variants */
const CATEGORY_CHART_HEX: Record<string, { standard: string; roth: string }> = {
  "401k":      { standard: "#3b82f6", roth: "#93c5fd" }, // blue-500 / blue-300
  "403b":      { standard: "#3b82f6", roth: "#93c5fd" }, // shares 401k colors
  ira:         { standard: "#8b5cf6", roth: "#c4b5fd" }, // violet-500 / violet-300
  hsa:         { standard: "#10b981", roth: "#6ee7b7" }, // emerald-500 / emerald-300
  brokerage:   { standard: "#f97316", roth: "#fdba74" }, // orange-500 / orange-300
  espp:        { standard: "#f59e0b", roth: "#fcd34d" }, // amber-500 / amber-300
  pension:     { standard: "#6366f1", roth: "#a5b4fc" }, // indigo-500 / indigo-300
};
const DEFAULT_CHART_HEX = { standard: "#6b7280", roth: "#9ca3af" }; // gray-500 / gray-400

/** Get hex color for a category chart segment (Recharts/SVG) */
export function categoryChartHex(category: string, isRoth: boolean): string {
  const entry = CATEGORY_CHART_HEX[category] ?? DEFAULT_CHART_HEX;
  return isRoth ? entry.roth : entry.standard;
}
