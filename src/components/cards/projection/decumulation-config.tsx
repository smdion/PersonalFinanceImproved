"use client";

import { HelpTip } from "@/components/ui/help-tip";
import { AccountBadge } from "@/components/ui/account-badge";
import type { AccountCategory } from "@/lib/calculators/types";
import {
  accountTextColor,
  taxTypeLabel,
} from "@/lib/utils/colors";
import { formatPercent } from "@/lib/utils/format";
import {
  getAllCategories,
  getAccountTypeConfig,
  categoriesWithTaxPreference,
  ACCOUNT_TYPE_CONFIG,
} from "@/lib/config/account-types";
import { ALL_CATEGORIES } from "./utils";

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
  withdrawalTaxPref: Partial<
    Record<AccountCategory, "traditional" | "roth">
  >;
  setWithdrawalTaxPref: React.Dispatch<
    React.SetStateAction<
      Partial<Record<AccountCategory, "traditional" | "roth">>
    >
  >;
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
}: DecumulationConfigProps) {
  return (
    <div className="border rounded-lg p-4 space-y-4">
      <div className="flex items-center justify-between">
        <SectionHeader
          title={
            isPersonFiltered
              ? `Withdrawal Strategy — ${personFilterName}`
              : "Withdrawal Strategy"
          }
          help="How retirement withdrawals are routed across accounts. Bracket Filling (default) is tax-optimal — it fills cheap tax brackets with Traditional, then uses Roth and brokerage, with graduated LTCG rates, accurate SS taxation, RMD enforcement, optional Roth conversions, and IRMAA/ACA cliff awareness. Waterfall and Percentage are manual alternatives. Use spending strategies (in retirement settings) for dynamic spending adjustments — 8 methods from Morningstar research."
        />
        <button
          type="button"
          onClick={() => setShowDecumConfig(!showDecumConfig)}
          className="text-xs text-blue-600 hover:underline"
        >
          {showDecumConfig ? "Hide" : "Configure"}
        </button>
      </div>

      {!showDecumConfig ? (
        <div className="flex flex-wrap gap-4 text-xs text-muted">
          <span>
            Strategy:{""}
            {withdrawalRoutingMode === "bracket_filling"
              ? "Bracket Filling"
              : withdrawalRoutingMode === "waterfall"
                ? "Waterfall"
                : "Percentage"}
          </span>
          {withdrawalRoutingMode === "bracket_filling" ? (
            <span>
              Bracket fill (Traditional → Roth → Brokerage → HSA) with
              RMDs, SS tax torpedo, graduated LTCG
            </span>
          ) : withdrawalRoutingMode === "waterfall" ? (
            <>
              <span>
                Order:{""}
                {withdrawalOrder
                  .map((c) => getAccountTypeConfig(c).displayLabel)
                  .join(" →")}
              </span>
              <span>
                Tax pref:{""}
                {Object.entries(withdrawalTaxPref)
                  .filter(([, v]) => v)
                  .map(([k, v]) => `${k}=${v}`)
                  .join(",") || "default"}
              </span>
            </>
          ) : (
            <span>
              Splits:{""}
              {ALL_CATEGORIES.map(
                (c) =>
                  `${getAccountTypeConfig(c).displayLabel} ${Math.round(withdrawalSplits[c] * 100)}%`,
              ).join(",")}
            </span>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {/* Routing mode */}
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted">Strategy:</span>
              <div className="inline-flex rounded-md border bg-surface-sunken p-0.5">
                <button
                  type="button"
                  onClick={() =>
                    setWithdrawalRoutingMode("bracket_filling")
                  }
                  className={`px-2.5 py-1 text-xs font-medium rounded transition-colors ${
                    withdrawalRoutingMode === "bracket_filling"
                      ? "bg-surface-primary text-primary shadow-sm border"
                      : "text-muted hover:text-secondary"
                  }`}
                >
                  Bracket Filling
                </button>
                <button
                  type="button"
                  onClick={() => setWithdrawalRoutingMode("waterfall")}
                  className={`px-2.5 py-1 text-xs font-medium rounded transition-colors ${
                    withdrawalRoutingMode === "waterfall"
                      ? "bg-surface-primary text-primary shadow-sm border"
                      : "text-muted hover:text-secondary"
                  }`}
                >
                  Waterfall
                </button>
                <button
                  type="button"
                  onClick={() => setWithdrawalRoutingMode("percentage")}
                  className={`px-2.5 py-1 text-xs font-medium rounded transition-colors ${
                    withdrawalRoutingMode === "percentage"
                      ? "bg-surface-primary text-primary shadow-sm border"
                      : "text-muted hover:text-secondary"
                  }`}
                >
                  Percentage
                </button>
              </div>
              <HelpTip
                text={
                  withdrawalRoutingMode === "bracket_filling"
                    ? "Bracket Filling: Fill Traditional withdrawals up to a target tax bracket (using IRS provisional income for SS), then Roth, then brokerage (graduated LTCG rates), HSA last. Enforces RMDs, supports automatic Roth conversions, and respects IRMAA/ACA cliffs when enabled."
                    : withdrawalRoutingMode === "waterfall"
                      ? "Waterfall: Drain accounts in priority order. Empty the first account before moving to the next. RMDs still enforced; Roth conversions and cliff awareness still apply when enabled."
                      : "Percentage: Split withdrawals by a fixed % across accounts. If an account runs dry, its share redistributes proportionally. RMDs still enforced when applicable."
                }
              />
            </div>
          </div>

          {/* Bracket filling description */}
          {withdrawalRoutingMode === "bracket_filling" && (
            <div className="bg-emerald-50 rounded-lg p-3 text-xs text-emerald-800 space-y-2">
              <p className="font-medium">
                Tax-optimal withdrawal order each year:
              </p>
              <ol className="list-decimal list-inside space-y-0.5 text-emerald-700">
                <li>
                  <span className="font-medium">
                    {taxTypeLabel("preTax")}
                  </span>
                  {""}
                  (401k/IRA) up to the bracket ceiling — uses IRS
                  provisional income formula for SS taxation
                </li>
                <li>
                  <span className="font-medium">
                    {taxTypeLabel("taxFree")}
                  </span>
                  {""}
                  (401k/IRA Roth) for the remainder — no tax impact
                </li>
                <li>
                  <span className="font-medium">Brokerage</span> as
                  overflow — taxed at graduated LTCG rates (0%/15%/20%)
                </li>
                <li>
                  <span className="font-medium">HSA</span> last resort —
                  most tax-advantaged, compounds longest
                </li>
              </ol>
              <div className="border-t border-emerald-200 pt-1.5 mt-1.5 space-y-0.5 text-emerald-600">
                <p>
                  <span className="font-medium text-emerald-700">
                    RMDs
                  </span>
                  {""}— Required Minimum Distributions enforced at the IRS
                  start age (SECURE 2.0: 73 or 75). Traditional
                  withdrawals are forced above your bracket target when
                  needed.
                </p>
                <p>
                  <span className="font-medium text-emerald-700">
                    Roth conversions
                  </span>
                  {""}— When enabled, automatically converts Traditional →
                  Roth to fill the target bracket. Most valuable pre-RMD
                  age.
                </p>
                <p>
                  <span className="font-medium text-emerald-700">
                    IRMAA / ACA
                  </span>
                  {""}— When enabled, constrains withdrawals and
                  conversions near Medicare surcharge cliffs (65+) or ACA
                  subsidy cliffs (pre-65).
                </p>
              </div>
              <p className="text-emerald-600">
                Configure bracket targets, Roth conversions, and
                healthcare awareness in retirement settings above.
              </p>
            </div>
          )}

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
                  .filter(
                    (cat) => !ACCOUNT_TYPE_CONFIG[cat].supportsRothSplit,
                  )
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
