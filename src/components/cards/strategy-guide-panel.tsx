"use client";

import { useState } from "react";
import { SlidePanel } from "@/components/ui/slide-panel";
import {
  WITHDRAWAL_STRATEGY_CONFIG,
  type WithdrawalStrategyType,
} from "@/lib/config/withdrawal-strategies";

// ---------------------------------------------------------------------------
// Exported components — generic renderers that read the config shape
// ---------------------------------------------------------------------------

/** Button that opens the strategy guide panel. */
export function StrategyGuideButton({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={
          className ??
          "text-[11px] text-sky-400 hover:text-sky-300 border border-sky-400/30 hover:border-sky-400/60 rounded px-2 py-0.5 whitespace-nowrap transition-colors"
        }
      >
        Strategy Guide →
      </button>
      <StrategyGuidePanel open={open} onClose={() => setOpen(false)} />
    </>
  );
}

/** The strategy guide slide panel — reads all content from WithdrawalStrategyConfig. */
export function StrategyGuidePanel({
  open,
  onClose,
  activeStrategy,
  visibleStrategies,
}: {
  open: boolean;
  onClose: () => void;
  activeStrategy?: string | null;
  visibleStrategies?: string[];
}) {
  const keys =
    visibleStrategies ??
    (Object.keys(WITHDRAWAL_STRATEGY_CONFIG) as WithdrawalStrategyType[]);

  return (
    <SlidePanel open={open} onClose={onClose} title="Withdrawal Strategy Guide">
      <p className="text-secondary text-sm mb-6">
        Each strategy makes a different tradeoff between income stability,
        portfolio preservation, and spending flexibility. There is no single
        best choice — it depends on your priorities.
      </p>

      <div className="space-y-6">
        {keys.map((key) => {
          const config =
            WITHDRAWAL_STRATEGY_CONFIG[key as WithdrawalStrategyType];
          if (!config) return null;
          const { guide } = config;
          const isActive = key === activeStrategy;
          return (
            <div
              key={key}
              className={`rounded-lg border p-4 ${isActive ? "border-blue-500/50 bg-blue-900/10" : "border-border"}`}
            >
              <div className="flex items-center gap-2 mb-1.5">
                <h3 className="text-sm font-semibold text-primary">
                  {config.label}
                </h3>
                {isActive && (
                  <span className="text-[9px] text-blue-400 bg-blue-900/40 px-1.5 py-0.5 rounded">
                    ACTIVE
                  </span>
                )}
              </div>
              <p className="text-xs text-secondary mb-3">
                {config.description}
              </p>

              <p className="text-xs text-faint mb-2">{guide.how}</p>

              <div className="grid grid-cols-2 gap-3 mb-3">
                <div>
                  <h4 className="text-[10px] font-semibold text-green-400 uppercase tracking-wider mb-1">
                    Strengths
                  </h4>
                  <ul className="space-y-0.5">
                    {guide.strengths.map((s) => (
                      <li
                        key={s}
                        className="text-[11px] text-secondary flex gap-1"
                      >
                        <span className="text-green-500 shrink-0">+</span>
                        {s}
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h4 className="text-[10px] font-semibold text-red-400 uppercase tracking-wider mb-1">
                    Weaknesses
                  </h4>
                  <ul className="space-y-0.5">
                    {guide.weaknesses.map((w) => (
                      <li
                        key={w}
                        className="text-[11px] text-secondary flex gap-1"
                      >
                        <span className="text-red-500 shrink-0">-</span>
                        {w}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              <p className="text-[11px] text-faint">
                <span className="font-medium text-secondary">Best for:</span>{" "}
                {guide.bestFor}
              </p>
              <p className="text-[11px] text-faint mt-1">
                <span className="font-medium text-secondary">
                  Stability note:
                </span>{" "}
                {guide.stabilityNote}
              </p>
            </div>
          );
        })}
      </div>

      <div className="mt-6 p-3 rounded-lg bg-surface-elevated text-xs text-faint">
        <p className="font-medium text-secondary mb-1">
          About the Stability metric
        </p>
        <p>
          Stability measures the % of simulated scenarios where your spending
          never drops below 75% of your initial plan (adjusted for inflation) in
          any single year. It requires <em>every</em> year to pass — one bad
          year fails the entire scenario.
        </p>
        <p className="mt-1.5">
          This makes it inherently strict over long retirements. Budget-based
          strategies (Fixed, Forgo, G-K) score higher because spending
          doesn&apos;t track portfolio swings. Portfolio-linked strategies
          (Const&nbsp;%, Endowment, Vanguard) score low because portfolio
          volatility directly affects income — even temporarily.
        </p>
        <p className="mt-1.5">
          A low stability score doesn&apos;t mean the strategy is bad — it means
          there&apos;s a high chance of at least one year with a meaningful
          spending dip. The Success rate tells you whether the portfolio
          survives; Stability tells you how smooth the ride is.
        </p>
      </div>
    </SlidePanel>
  );
}
