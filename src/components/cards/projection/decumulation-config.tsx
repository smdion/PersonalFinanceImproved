"use client";

/** Withdrawal strategy configuration panel — bracket filling, waterfall, and percentage routing modes with account order and tax preference editors. */
import { HelpTip } from "@/components/ui/help-tip";
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
import {
  WITHDRAWAL_ROUTING_MODE_LABELS,
  WITHDRAWAL_ROUTING_MODE_DESCRIPTIONS,
  DEFAULT_WITHDRAWAL_ROUTING_MODE,
} from "@/lib/config/withdrawal-routing";
import { WithdrawalOrderEditor } from "@/components/retirement/withdrawal-order-editor";

type RoutingModeLiteral = "bracket_filling" | "waterfall" | "percentage";
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
    <div className="mb-2 flex items-center justify-between">
      <h4 className="text-muted text-xs font-medium tracking-wide uppercase">
        {title}
        {help && <HelpTip text={help} />}
      </h4>
      {children}
    </div>
  );
}

type DecumulationConfigProps = {
  isPersonFiltered: boolean;
  personFilterName: string;
  showDecumConfig: boolean;
  setShowDecumConfig: (v: boolean) => void;
  withdrawalRoutingMode: RoutingModeLiteral;
  setWithdrawalRoutingMode: (v: RoutingModeLiteral) => void;
  /** Whether the user has actually clicked a mode button this session —
   *  see use-projection-form-state.ts's docblock. Gates which mode this
   *  panel DISPLAYS (the toggle highlight, the sub-control shown, the
   *  "customizing your plan" note) — NOT what gets sent to the engine
   *  (that's use-projection-queries.ts's job, independently). Untouched,
   *  `withdrawalRoutingMode` itself is a meaningless initial literal (see
   *  that hook) — this component must derive its own display value from
   *  `persistedWithdrawalRoutingMode` instead of trusting it directly. */
  withdrawalRoutingModeTouched: boolean;
  withdrawalOrder: AccountCategory[];
  setWithdrawalOrder: (v: AccountCategory[]) => void;
  /** Whether the user has reordered accounts this session. Same
   *  display-vs-send split as `withdrawalRoutingModeTouched`: until it flips,
   *  this panel shows `persistedWithdrawalOrder` (the real saved default),
   *  not the local `withdrawalOrder` initial literal. */
  withdrawalOrderTouched: boolean;
  /** The household's PERSISTED withdrawal-order default
   *  (`retirement_settings.withdrawal_order`), or null/undefined when never
   *  customized (→ config default). Drives `displayedOrder`. */
  persistedWithdrawalOrder?: string[] | null;
  withdrawalSplits: Record<AccountCategory, number>;
  setWithdrawalSplits: React.Dispatch<
    React.SetStateAction<Record<AccountCategory, number>>
  >;
  /** Whether the user has edited splits this session — gates
   *  `displayedSplits` the same way. */
  withdrawalSplitsTouched: boolean;
  /** The household's PERSISTED percentage-split default
   *  (`retirement_settings.withdrawal_splits`), or null when never
   *  customized. Drives `displayedSplits`. */
  persistedWithdrawalSplits?: Record<string, number> | null;
  withdrawalTaxPref: Partial<Record<AccountCategory, "traditional" | "roth">>;
  setWithdrawalTaxPref: React.Dispatch<
    React.SetStateAction<
      Partial<Record<AccountCategory, "traditional" | "roth">>
    >
  >;
  /** Active spending strategy key (from retirement settings). */
  activeSpendingStrategy?: string;
  /** Household default from retirement settings, displayed
   *  read-only here (edited on the settings page, not this per-session
   *  routing-override panel) so it's visible right next to bracket_filling's
   *  other routing controls. */
  discretionaryWithdrawalOrder?: string | null;
  /** The household's PERSISTED routing-mode default
   *  (`retirement_settings.withdrawal_routing_mode`) — same "edited on the
   *  settings page" pattern as `discretionaryWithdrawalOrder` above, but
   *  NOT purely read-only text here: this component derives `displayedMode`
   *  from it (falling back to `withdrawalRoutingMode` only once
   *  `withdrawalRoutingModeTouched`), so an untouched session shows the
   *  real plan default — not a hardcoded literal — in the toggle
   *  highlight, the sub-control shown, and the summary text. What's SENT
   *  to the engine stays independently gated on `touched` in
   *  use-projection-queries.ts; this prop only affects what's displayed. */
  persistedWithdrawalRoutingMode?: string | null;
  enableAcaAwareness?: boolean;
  enableIrmaaAwareness?: boolean;
};

/**
 * Withdrawal strategy configuration panel.
 */
export function DecumulationConfig({
  isPersonFiltered,
  personFilterName,
  showDecumConfig,
  setShowDecumConfig,
  withdrawalRoutingMode,
  setWithdrawalRoutingMode,
  withdrawalRoutingModeTouched,
  withdrawalOrder,
  setWithdrawalOrder,
  withdrawalOrderTouched,
  persistedWithdrawalOrder,
  withdrawalSplits,
  setWithdrawalSplits,
  withdrawalSplitsTouched,
  persistedWithdrawalSplits,
  withdrawalTaxPref,
  setWithdrawalTaxPref,
  activeSpendingStrategy,
  discretionaryWithdrawalOrder,
  persistedWithdrawalRoutingMode,
  enableAcaAwareness,
  enableIrmaaAwareness,
}: DecumulationConfigProps) {
  const strategyKey = (activeSpendingStrategy ??
    "fixed") as WithdrawalStrategyType;
  const strategyCfg = WITHDRAWAL_STRATEGY_CONFIG[strategyKey];
  const isDynamic = strategyKey !== "fixed";
  const persistedModeLabel =
    persistedWithdrawalRoutingMode &&
    persistedWithdrawalRoutingMode in WITHDRAWAL_ROUTING_MODE_LABELS
      ? WITHDRAWAL_ROUTING_MODE_LABELS[
          persistedWithdrawalRoutingMode as keyof typeof WITHDRAWAL_ROUTING_MODE_LABELS
        ]
      : null;
  const persistedMode: RoutingModeLiteral =
    persistedWithdrawalRoutingMode &&
    persistedWithdrawalRoutingMode in WITHDRAWAL_ROUTING_MODE_LABELS
      ? (persistedWithdrawalRoutingMode as RoutingModeLiteral)
      : DEFAULT_WITHDRAWAL_ROUTING_MODE;
  // What this panel actually SHOWS — the real plan default until the user
  // clicks a mode button this session, then their choice.
  // `withdrawalRoutingMode` itself is a meaningless initial literal when
  // untouched (see use-projection-form-state.ts), so rendering the
  // toggle/sub-controls straight off it would show a household on a
  // non-default mode the WRONG editor — e.g. hide the Withdrawal Order
  // editor from someone actually running Waterfall. This is
  // display-only; what's SENT to the engine is still gated on `touched`
  // in use-projection-queries.ts, independently, so cache identity is
  // untouched by this.
  const displayedMode: RoutingModeLiteral = withdrawalRoutingModeTouched
    ? withdrawalRoutingMode
    : persistedMode;
  const modeLabel = WITHDRAWAL_ROUTING_MODE_LABELS[displayedMode];
  const modeDescription = WITHDRAWAL_ROUTING_MODE_DESCRIPTIONS[displayedMode];
  const isOverridingPlanDefault =
    withdrawalRoutingModeTouched && displayedMode !== persistedMode;

  // Same display-vs-send split as `displayedMode`: until the user edits the
  // order/splits this session, show the household's real persisted default
  // (not the local config-default seed), so an untouched Waterfall
  // household doesn't see "401k → 403b → …" when the engine is actually
  // running their saved "brokerage first" order. What's SENT stays gated on
  // the *Touched flags in use-projection-queries.ts, independently.
  const displayedOrder: AccountCategory[] = withdrawalOrderTouched
    ? withdrawalOrder
    : ((persistedWithdrawalOrder as AccountCategory[] | null | undefined) ??
      withdrawalOrder);
  const displayedSplits: Record<AccountCategory, number> =
    withdrawalSplitsTouched
      ? withdrawalSplits
      : ((persistedWithdrawalSplits as
          Record<AccountCategory, number> | null | undefined) ??
        withdrawalSplits);

  // bracket_filling's Phase 1 only ever consults the
  // Traditional-preference subset of the order (401k/403b/IRA) —
  // brokerage/HSA's position is decided by cost-ranking regardless of
  // where they sit in the full array, so both the sub-editor and the
  // summary below only show/build from that subset, not the full order.
  const tradPreferenceOrder = displayedOrder.filter((c) =>
    tradPreferenceEngineCategories().includes(c),
  );

  // Compact order display for collapsed view
  const orderSummary =
    displayedMode === "bracket_filling"
      ? `${tradPreferenceOrder.map((c) => getAccountTypeConfig(c).displayLabel).join(" → ")} → ${taxTypeLabel("taxFree")}/Brokerage/HSA (cost-ranked)`
      : displayedMode === "waterfall"
        ? displayedOrder
            .map((c) => getAccountTypeConfig(c).displayLabel)
            .join(" → ")
        : ALL_CATEGORIES.map(
            (c) =>
              `${getAccountTypeConfig(c).displayLabel} ${formatPercent(displayedSplits[c])}`,
          ).join(", ");

  return (
    <div className="space-y-3 rounded-lg border p-4">
      {/* Header — matches overrides panel style */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h4 className="text-label text-muted font-semibold tracking-wider uppercase">
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
          className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
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
        <div className="text-caption rounded bg-indigo-50 px-2.5 py-1.5 text-indigo-700">
          <span className="font-medium">{strategyCfg?.label}</span>
          {strategyCfg?.incomeSource === "formula"
            ? " determines HOW MUCH to withdraw. This section determines FROM WHICH accounts."
            : strategyCfg?.incomeSource === "rate"
              ? " adjusts HOW MUCH to withdraw each year. This section determines FROM WHICH accounts."
              : " sets HOW MUCH to withdraw from your budget. This section determines FROM WHICH accounts."}
        </div>
      )}

      {showDecumConfig && (
        <div className="bg-surface-sunken space-y-3 rounded-lg p-3">
          {/* Mode toggle */}
          <div className="flex items-center gap-2">
            <div className="bg-surface-primary inline-flex rounded-md border p-0.5">
              {(
                Object.entries(WITHDRAWAL_ROUTING_MODE_LABELS) as [
                  "bracket_filling" | "waterfall" | "percentage",
                  string,
                ][]
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setWithdrawalRoutingMode(key)}
                  className={`rounded px-3 py-1.5 text-xs font-medium transition-colors ${
                    displayedMode === key
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
          {persistedModeLabel != null && (
            <p className="text-caption text-faint">
              Your plan&rsquo;s saved default is{" "}
              <span className="font-medium">{persistedModeLabel}</span> (Taxes
              in Retirement).
              {isOverridingPlanDefault
                ? " The selection above only customizes it for this session — it isn't saved."
                : ""}
            </p>
          )}

          {/* Order (waterfall) */}
          {displayedMode === "waterfall" && (
            <div className="bg-surface-sunken rounded-lg p-3">
              <SectionHeader
                title="Withdrawal Order"
                help="Which accounts to draw from first. Tax-efficient default: 401k/IRA first (fill low brackets with Traditional, then Roth), brokerage as overflow, HSA last. RMDs are enforced regardless of order."
              />
              <WithdrawalOrderEditor
                order={displayedOrder}
                onChange={setWithdrawalOrder}
              />
              {withdrawalOrderTouched && (
                <p className="text-caption text-faint mt-1.5">
                  This order only customizes your plan for this session — save
                  it in Taxes in Retirement to make it your default.
                </p>
              )}
            </div>
          )}

          {/* Traditional account order (bracket_filling) — Phase 1 fills
              Traditional up to the bracket cap from
              401k/403b/IRA in THIS order before anything else; previously
              hardcoded, now user-editable like the other two modes. */}
          {displayedMode === "bracket_filling" && (
            <div className="bg-surface-sunken rounded-lg p-3">
              <SectionHeader
                title="Traditional Account Order"
                help="Which Traditional account (401k/403b/IRA) fills the tax bracket first, before anything else is touched. Roth, Brokerage, and HSA are unaffected — bracket_filling always picks whichever of those actually costs least that year. This is the same underlying order Waterfall mode's editor writes, just restricted to the accounts bracket_filling's Traditional fill actually consults."
              />
              <WithdrawalOrderEditor
                order={displayedOrder}
                onChange={setWithdrawalOrder}
                filter={tradPreferenceEngineCategories()}
              />
              {withdrawalOrderTouched && (
                <p className="text-caption text-faint mt-1.5">
                  This order only customizes your plan for this session — save
                  it in Taxes in Retirement to make it your default.
                </p>
              )}
              <div className="mt-3 border-t pt-3">
                <SectionHeader
                  title="Discretionary Withdrawal Order"
                  help="Beyond the Traditional bracket target, which free source drains first: Roth basis, or brokerage's 0%-capital-gains room. Brokerage-first uses that room up sooner, but a brokerage gain still counts toward MAGI for ACA/IRMAA even at 0% federal tax — Roth withdrawals never touch MAGI."
                />
                <div className="text-caption">
                  <span className="text-foreground font-medium">
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
                    <p className="text-caption mt-1 text-amber-700">
                      ACA/IRMAA awareness is on — this will realize MAGI-counted
                      gains sooner each year, which can reduce ACA subsidy or
                      bring you closer to an IRMAA surcharge tier.
                    </p>
                  )}
              </div>
            </div>
          )}

          {/* Splits (percentage) */}
          {displayedMode === "percentage" && (
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
                      value={Math.round((displayedSplits[cat] ?? 0) * 100)}
                      onChange={(e) => {
                        const v = parseFloat(e.target.value) / 100;
                        // Seed the first edit from what's DISPLAYED (the
                        // persisted default until touched), not the local
                        // config-default literal — otherwise editing one
                        // field silently discards the household's saved
                        // splits for every other account.
                        const base = withdrawalSplitsTouched
                          ? withdrawalSplits
                          : displayedSplits;
                        setWithdrawalSplits({
                          ...base,
                          [cat]: isNaN(v) ? 0 : v,
                        });
                      }}
                      className="border-strong mt-1 block w-full rounded border px-2 py-1 text-right text-sm"
                    />
                  </label>
                ))}
              </div>
              {(() => {
                const total = Object.values(displayedSplits).reduce(
                  (s, v) => s + v,
                  0,
                );
                const off = Math.abs(total - 1) > 0.001;
                return off ? (
                  <p className="mt-1 text-xs text-amber-600">
                    Splits total {formatPercent(total)} — should be 100%.
                  </p>
                ) : null;
              })()}
              {withdrawalSplitsTouched && (
                <p className="text-caption text-faint mt-1.5">
                  These splits only customize your plan for this session — save
                  them in Taxes in Retirement to make them your default.
                </p>
              )}
            </div>
          )}

          {displayedMode !== "bracket_filling" && (
            <div className="bg-surface-sunken rounded-lg p-3">
              <SectionHeader
                title="Tax Preference per Account"
                help="Within each account that has both Traditional and Roth balances, which to draw first. Drawing Traditional first lets Roth grow tax-free longer."
              />
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
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
                      className="border-strong mt-1 block w-full rounded border px-2 py-1 text-sm"
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
