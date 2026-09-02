"use client";

/** Withdrawal strategy configuration panel — bracket filling, waterfall, and percentage routing modes with account order and tax preference editors. */
import { HelpTip } from "@/components/ui/help-tip";
import { AccountBadge } from "@/components/ui/account-badge";
import type { AccountCategory } from "@/lib/calculators/types";
import { accountTextColor, taxTypeLabel } from "@/lib/utils/colors";
import { formatPercent } from "@/lib/utils/format";
import {
  getAccountTypeConfig,
  categoriesWithTaxPreference,
  categoriesWithoutTaxPreference,
  tradPreferenceEngineCategories,
} from "@/lib/config/account-types";
import { ALL_CATEGORIES } from "./utils";
import {
  WITHDRAWAL_STRATEGY_CONFIG,
  type WithdrawalStrategyType,
} from "@/lib/config/withdrawal-strategies";
/** Shared small heading for the config sub-sections below. (Formerly lived
 *  in overrides-panel.tsx alongside a since-deleted unified panel; that
 *  file's only remaining export, so folded in here — its one consumer.) */
function SectionHeader({
  title,
  help,
  children,
}: {
  title: string;
  help?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between mb-2">
      <h4 className="text-xs font-medium text-muted uppercase tracking-wide">
        {title}
        {help && <HelpTip text={help} />}
      </h4>
      {children}
    </div>
  );
}

function OrderEditor({
  order,
  onChange,
  filter,
}: {
  order: AccountCategory[];
  onChange: (order: AccountCategory[]) => void;
  /** v0.7.10 R51 (Gap A): when set, only these categories are shown and
   *  reordered — used by bracket_filling's "Traditional Account Order"
   *  sub-control, which edits the SAME underlying `withdrawalOrder`
   *  waterfall's full editor writes (single source of truth — the
   *  engine's Phase 1 loop reads `withdrawalOrder` filtered to
   *  Traditional-preference categories regardless of which UI wrote it),
   *  just restricted to the subset that actually affects bracket_filling.
   *  A swap permutes only the filtered categories' OCCUPANTS — every
   *  other category (brokerage/HSA) keeps its exact position in the full
   *  array, since bracket_filling's cost-ranked Phases 2-4 already decide
   *  those, unaffected by this order. Omitted ⇒ identical behavior to
   *  before this prop existed (waterfall's unrestricted full-order
   *  editor). */
  filter?: AccountCategory[];
}) {
  const filterSet = filter ? new Set(filter) : null;
  const visible = filterSet ? order.filter((c) => filterSet.has(c)) : order;

  function swapWithPrevious(idx: number) {
    if (!filterSet) {
      const next = [...order];
      [next[idx - 1], next[idx]] = [next[idx]!, next[idx - 1]!];
      onChange(next);
      return;
    }
    // Filtered mode: find where these two categories actually sit in the
    // FULL array (not necessarily adjacent there — an unfiltered category
    // may sit between them) and swap only those two slots.
    const a = visible[idx - 1]!;
    const b = visible[idx]!;
    const posA = order.indexOf(a);
    const posB = order.indexOf(b);
    const next = [...order];
    next[posA] = b;
    next[posB] = a;
    onChange(next);
  }

  return (
    <div className="flex items-center gap-1">
      {visible.map((cat, idx) => (
        <span key={cat} className="flex items-center gap-0.5">
          {idx > 0 && <span className="text-faint mx-0.5">&rarr;</span>}
          <AccountBadge type={cat} />
          {idx > 0 && (
            <button
              type="button"
              onClick={() => swapWithPrevious(idx)}
              className="text-faint hover:text-blue-600 p-0.5"
              title={`Move ${cat} left`}
            >
              <svg
                className="w-3 h-3"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M15 19l-7-7 7-7"
                />
              </svg>
            </button>
          )}
        </span>
      ))}
    </div>
  );
}

type DecumulationConfigProps = {
  isPersonFiltered: boolean;
  personFilterName: string;
  showDecumConfig: boolean;
  setShowDecumConfig: (v: boolean) => void;
  withdrawalRoutingMode: "bracket_filling" | "waterfall" | "percentage";
  setWithdrawalRoutingMode: (
    v: "bracket_filling" | "waterfall" | "percentage",
  ) => void;
  withdrawalOrder: AccountCategory[];
  setWithdrawalOrder: (v: AccountCategory[]) => void;
  withdrawalSplits: Record<AccountCategory, number>;
  setWithdrawalSplits: React.Dispatch<
    React.SetStateAction<Record<AccountCategory, number>>
  >;
  withdrawalTaxPref: Partial<Record<AccountCategory, "traditional" | "roth">>;
  setWithdrawalTaxPref: React.Dispatch<
    React.SetStateAction<
      Partial<Record<AccountCategory, "traditional" | "roth">>
    >
  >;
  /** Active spending strategy key (from retirement settings). */
  activeSpendingStrategy?: string;
  /** R55 follow-up — household default from retirement settings, displayed
   *  read-only here (edited on the settings page, not this per-session
   *  routing-override panel) so it's visible right next to bracket_filling's
   *  other routing controls. */
  discretionaryWithdrawalOrder?: string | null;
  enableAcaAwareness?: boolean;
  enableIrmaaAwareness?: boolean;
};

/**
 * Withdrawal strategy configuration panel.
 * Extracted from ProjectionCard to reduce file size.
 */
export function DecumulationConfig({
  isPersonFiltered,
  personFilterName,
  showDecumConfig,
  setShowDecumConfig,
  withdrawalRoutingMode,
  setWithdrawalRoutingMode,
  withdrawalOrder,
  setWithdrawalOrder,
  withdrawalSplits,
  setWithdrawalSplits,
  withdrawalTaxPref,
  setWithdrawalTaxPref,
  activeSpendingStrategy,
  discretionaryWithdrawalOrder,
  enableAcaAwareness,
  enableIrmaaAwareness,
}: DecumulationConfigProps) {
  const strategyKey = (activeSpendingStrategy ??
    "fixed") as WithdrawalStrategyType;
  const strategyCfg = WITHDRAWAL_STRATEGY_CONFIG[strategyKey];
  const isDynamic = strategyKey !== "fixed";
  const modeLabel =
    withdrawalRoutingMode === "bracket_filling"
      ? "Bracket Filling"
      : withdrawalRoutingMode === "waterfall"
        ? "Waterfall"
        : "Percentage";

  const modeDescription =
    withdrawalRoutingMode === "bracket_filling"
      ? "Tax-optimal: Traditional up to bracket ceiling, then whichever of Roth or Brokerage (graduated LTCG) costs less that year, HSA last. Includes RMDs, SS taxation, Roth conversions, and IRMAA/ACA awareness."
      : withdrawalRoutingMode === "waterfall"
        ? "Drain accounts in priority order. Customize the order below."
        : "Split withdrawals by fixed percentages across accounts.";

  // v0.7.10 R51 (Gap A): bracket_filling's Phase 1 only ever consults the
  // Traditional-preference subset of withdrawalOrder (401k/403b/IRA) —
  // brokerage/HSA's position is decided by cost-ranking regardless of
  // where they sit in the full array, so both the sub-editor and the
  // summary below only show/build from that subset, not the full order.
  const tradPreferenceOrder = withdrawalOrder.filter((c) =>
    tradPreferenceEngineCategories().includes(c),
  );

  // Compact order display for collapsed view
  const orderSummary =
    withdrawalRoutingMode === "bracket_filling"
      ? `${tradPreferenceOrder.map((c) => getAccountTypeConfig(c).displayLabel).join(" → ")} → ${taxTypeLabel("taxFree")}/Brokerage/HSA (cost-ranked)`
      : withdrawalRoutingMode === "waterfall"
        ? withdrawalOrder
            .map((c) => getAccountTypeConfig(c).displayLabel)
            .join(" → ")
        : ALL_CATEGORIES.map(
            (c) =>
              `${getAccountTypeConfig(c).displayLabel} ${formatPercent(withdrawalSplits[c])}`,
          ).join(", ");

  return (
    <div className="border rounded-lg p-4 space-y-3">
      {/* Header — matches overrides panel style */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h4 className="text-label font-semibold text-muted uppercase tracking-wider">
            {isPersonFiltered
              ? `Withdrawal Routing — ${personFilterName}`
              : "Withdrawal Routing"}
          </h4>
          <HelpTip text="Determines WHICH accounts fund your spending. The spending amount comes from your strategy in Decumulation Plan above." />
          {!showDecumConfig && (
            <span className="text-caption text-faint">
              {modeLabel} · {orderSummary}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => setShowDecumConfig(!showDecumConfig)}
          className={`text-xs font-medium px-3 py-1 rounded transition-colors ${
            showDecumConfig
              ? "bg-surface-strong text-muted hover:text-primary"
              : "bg-indigo-600 text-white hover:bg-indigo-700"
          }`}
        >
          {showDecumConfig ? "Done" : "Configure"}
        </button>
      </div>

      {/* Spending strategy context — always visible when dynamic */}
      {isDynamic && (
        <div className="text-caption text-indigo-700 bg-indigo-50 rounded px-2.5 py-1.5">
          <span className="font-medium">{strategyCfg?.label}</span>
          {strategyCfg?.incomeSource === "formula"
            ? " determines HOW MUCH to withdraw. This section determines FROM WHICH accounts."
            : strategyCfg?.incomeSource === "rate"
              ? " adjusts HOW MUCH to withdraw each year. This section determines FROM WHICH accounts."
              : " sets HOW MUCH to withdraw from your budget. This section determines FROM WHICH accounts."}
        </div>
      )}

      {showDecumConfig && (
        <div className="bg-surface-sunken rounded-lg p-3 space-y-3">
          {/* Mode toggle */}
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-md border bg-surface-primary p-0.5">
              {(
                [
                  ["bracket_filling", "Bracket Filling"],
                  ["waterfall", "Waterfall"],
                  ["percentage", "Percentage"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setWithdrawalRoutingMode(key)}
                  className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${
                    withdrawalRoutingMode === key
                      ? "bg-indigo-600 text-white shadow-sm"
                      : "text-muted hover:text-secondary"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <HelpTip text={modeDescription} />
          </div>

          {/* Order (waterfall) */}
          {withdrawalRoutingMode === "waterfall" && (
            <div className="bg-surface-sunken rounded-lg p-3">
              <SectionHeader
                title="Withdrawal Order"
                help="Which accounts to draw from first. Tax-efficient default: 401k/IRA first (fill low brackets with Traditional, then Roth), brokerage as overflow, HSA last. RMDs are enforced regardless of order."
              />
              <OrderEditor
                order={withdrawalOrder}
                onChange={setWithdrawalOrder}
              />
            </div>
          )}

          {/* Traditional account order (bracket_filling) — v0.7.10 R51
              Gap A: Phase 1 fills Traditional up to the bracket cap from
              401k/403b/IRA in THIS order before anything else; previously
              hardcoded, now user-editable like the other two modes. */}
          {withdrawalRoutingMode === "bracket_filling" && (
            <div className="bg-surface-sunken rounded-lg p-3">
              <SectionHeader
                title="Traditional Account Order"
                help="Which Traditional account (401k/403b/IRA) fills the tax bracket first, before anything else is touched. Roth, Brokerage, and HSA are unaffected — bracket_filling always picks whichever of those actually costs least that year. This is the same underlying order Waterfall mode's editor writes, just restricted to the accounts bracket_filling's Traditional fill actually consults."
              />
              <OrderEditor
                order={withdrawalOrder}
                onChange={setWithdrawalOrder}
                filter={tradPreferenceEngineCategories()}
              />
              <div className="mt-3 pt-3 border-t">
                <SectionHeader
                  title="Discretionary Withdrawal Order"
                  help="Beyond the Traditional bracket target, which free source drains first: Roth basis, or brokerage's 0%-capital-gains room. Brokerage-first uses that room up sooner, but a brokerage gain still counts toward MAGI for ACA/IRMAA even at 0% federal tax — Roth withdrawals never touch MAGI."
                />
                <div className="text-caption">
                  <span className="font-medium text-foreground">
                    {discretionaryWithdrawalOrder === "brokerage_first"
                      ? "Brokerage 0% room first"
                      : "Roth basis first (default)"}
                  </span>
                  <span className="text-faint">
                    {" "}
                    — edit in Retirement Settings &rarr; Taxes in Retirement.
                  </span>
                </div>
                {discretionaryWithdrawalOrder === "brokerage_first" &&
                  (enableAcaAwareness || enableIrmaaAwareness) && (
                    <p className="mt-1 text-caption text-amber-700">
                      ACA/IRMAA awareness is on — this will realize MAGI-counted
                      gains sooner each year, which can reduce ACA subsidy or
                      bring you closer to an IRMAA surcharge tier.
                    </p>
                  )}
              </div>
            </div>
          )}

          {/* Splits (percentage) */}
          {withdrawalRoutingMode === "percentage" && (
            <div className="bg-surface-sunken rounded-lg p-3">
              <SectionHeader
                title="Withdrawal Splits"
                help="How to split your total withdrawal across accounts. Values should sum to 100%. If an account has insufficient funds, its shortfall redistributes proportionally."
              />
              <div className="grid grid-cols-4 gap-3">
                {ALL_CATEGORIES.map((cat) => (
                  <label key={cat} className="block">
                    <span
                      className={`text-xs font-medium ${accountTextColor(cat)}`}
                    >
                      {getAccountTypeConfig(cat).displayLabel} %
                    </span>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={Math.round(withdrawalSplits[cat] * 100)}
                      onChange={(e) => {
                        const v = parseFloat(e.target.value) / 100;
                        setWithdrawalSplits((prev) => ({
                          ...prev,
                          [cat]: isNaN(v) ? 0 : v,
                        }));
                      }}
                      className="mt-1 block w-full rounded border border-strong px-2 py-1 text-sm text-right"
                    />
                  </label>
                ))}
              </div>
              {(() => {
                const total = Object.values(withdrawalSplits).reduce(
                  (s, v) => s + v,
                  0,
                );
                const off = Math.abs(total - 1) > 0.001;
                return off ? (
                  <p className="text-xs text-amber-600 mt-1">
                    Splits total {formatPercent(total)} — should be 100%.
                  </p>
                ) : null;
              })()}
            </div>
          )}

          {withdrawalRoutingMode !== "bracket_filling" && (
            <div className="bg-surface-sunken rounded-lg p-3">
              <SectionHeader
                title="Tax Preference per Account"
                help="Within each account that has both Traditional and Roth balances, which to draw first. Drawing Traditional first lets Roth grow tax-free longer."
              />
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {categoriesWithTaxPreference().map((cat) => (
                  <label key={cat} className="block">
                    <span
                      className={`text-xs font-medium ${accountTextColor(cat)}`}
                    >
                      {getAccountTypeConfig(cat).displayLabel}
                    </span>
                    <select
                      value={withdrawalTaxPref[cat] ?? "traditional"}
                      onChange={(e) =>
                        setWithdrawalTaxPref((prev) => ({
                          ...prev,
                          [cat]: e.target.value as "traditional" | "roth",
                        }))
                      }
                      className="mt-1 block w-full rounded border border-strong px-2 py-1 text-sm"
                    >
                      <option value="traditional">
                        {taxTypeLabel("preTax")} first
                      </option>
                      <option value="roth">
                        {taxTypeLabel("taxFree")} first
                      </option>
                    </select>
                  </label>
                ))}
                {categoriesWithoutTaxPreference().map((cat) => (
                  <div key={cat} className="flex items-center">
                    <div>
                      <span
                        className={`text-xs font-medium ${accountTextColor(cat)}`}
                      >
                        {getAccountTypeConfig(cat).displayLabel}
                      </span>
                      <p className="text-caption text-faint">
                        {getAccountTypeConfig(cat).taxPreferenceNote}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
