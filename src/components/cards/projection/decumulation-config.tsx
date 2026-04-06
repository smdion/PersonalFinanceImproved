"use client";

/** Withdrawal strategy configuration panel — bracket filling, waterfall, and percentage routing modes with account order and tax preference editors. */
import { HelpTip } from "@/components/ui/help-tip";
import { AccountBadge } from "@/components/ui/account-badge";
import type { AccountCategory } from "@/lib/calculators/types";
import { accountTextColor, taxTypeLabel } from "@/lib/utils/colors";
import { formatPercent } from "@/lib/utils/format";
import {
  getAllCategories,
  getAccountTypeConfig,
  categoriesWithTaxPreference,
  ACCOUNT_TYPE_CONFIG,
} from "@/lib/config/account-types";
import { ALL_CATEGORIES } from "./utils";
import {
  WITHDRAWAL_STRATEGY_CONFIG,
  type WithdrawalStrategyType,
} from "@/lib/config/withdrawal-strategies";

// Re-use SectionHeader and OrderEditor from index — import them
// For now we define a lightweight SectionHeader inline to avoid circular deps.
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
}: {
  order: AccountCategory[];
  onChange: (order: AccountCategory[]) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      {order.map((cat, idx) => (
        <span key={cat} className="flex items-center gap-0.5">
          {idx > 0 && <span className="text-faint mx-0.5">&rarr;</span>}
          <AccountBadge type={cat} />
          {idx > 0 && (
            <button
              type="button"
              onClick={() => {
                const next = [...order];
                [next[idx - 1], next[idx]] = [next[idx]!, next[idx - 1]!];
                onChange(next);
              }}
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
      ? "Tax-optimal: Traditional up to bracket ceiling → Roth → Brokerage (graduated LTCG) → HSA. Includes RMDs, SS taxation, Roth conversions, and IRMAA/ACA awareness."
      : withdrawalRoutingMode === "waterfall"
        ? "Drain accounts in priority order. Customize the order below."
        : "Split withdrawals by fixed percentages across accounts.";

  // Compact order display for collapsed view
  const orderSummary =
    withdrawalRoutingMode === "bracket_filling"
      ? `${taxTypeLabel("preTax")} → ${taxTypeLabel("taxFree")} → Brokerage → HSA`
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
          <h4 className="text-[11px] font-semibold text-muted uppercase tracking-wider">
            {isPersonFiltered
              ? `Withdrawal Routing — ${personFilterName}`
              : "Withdrawal Routing"}
          </h4>
          <HelpTip text="Determines WHICH accounts fund your spending. The spending amount comes from your strategy in Decumulation Plan above." />
          {!showDecumConfig && (
            <span className="text-[10px] text-faint">
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
        <div className="text-[10px] text-indigo-700 bg-indigo-50 rounded px-2.5 py-1.5">
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
                {getAllCategories()
                  .filter((cat) => !ACCOUNT_TYPE_CONFIG[cat].supportsRothSplit)
                  .map((cat) => (
                    <div key={cat} className="flex items-center">
                      <div>
                        <span
                          className={`text-xs font-medium ${accountTextColor(cat)}`}
                        >
                          {getAccountTypeConfig(cat).displayLabel}
                        </span>
                        <p className="text-[10px] text-faint">
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
