"use client";

import { useState } from "react";
import { SlidePanel } from "@/components/ui/slide-panel";

// ---------------------------------------------------------------------------
// Strategy Guide — benefits and shortfalls for each withdrawal strategy
// ---------------------------------------------------------------------------

type StrategyGuideEntry = {
  name: string;
  oneLiner: string;
  how: string;
  strengths: string[];
  weaknesses: string[];
  bestFor: string;
  stabilityNote: string;
};

const STRATEGY_GUIDE: Record<string, StrategyGuideEntry> = {
  fixed: {
    name: "Fixed Real",
    oneLiner:
      'The classic "4% rule" — withdraw a constant inflation-adjusted amount every year.',
    how: "Your first-year withdrawal is set by your retirement budget. Each subsequent year, that amount is adjusted upward by your post-retirement raise rate to maintain purchasing power.",
    strengths: [
      "Predictable, stable income — you know exactly what to expect each year",
      "Simple to understand and implement",
      "Spending stability tracks success rate (if the portfolio survives, income is maintained)",
    ],
    weaknesses: [
      "No feedback loop — spending ignores portfolio performance entirely",
      "In bad markets, you withdraw the same dollar amount from a shrinking portfolio, accelerating depletion",
      "In good markets, you leave money on the table (large unspent legacy)",
    ],
    bestFor:
      "Retirees who prioritize income certainty and have a conservative withdrawal rate.",
    stabilityNote:
      "Stability ≈ success rate. If the portfolio survives, spending is always maintained.",
  },
  forgo_inflation_after_loss: {
    name: "Forgo Inflation After Loss",
    oneLiner:
      "Like Fixed Real, but skip the inflation raise in any year following a portfolio loss.",
    how: "Identical to Fixed Real, except: if the portfolio had a negative return last year, this year's spending stays flat (no inflation adjustment). This creates cumulative real spending cuts over time.",
    strengths: [
      "Simple, conservative tweak to Fixed Real",
      "Automatically reduces spending pressure after bad years",
      "Higher sustainable withdrawal rate than Fixed Real (~4.4% vs ~3.9%)",
    ],
    weaknesses: [
      'Skipped raises are permanent — spending never "catches up" after market recovery',
      "Multiple consecutive loss years compound the real spending cut",
      "Still no upside feedback — doesn't increase spending after strong gains",
    ],
    bestFor:
      "Retirees who want slightly higher initial spending with a modest safety valve.",
    stabilityNote:
      "Stability < success rate because skipped inflation years erode real spending. ~9+ cumulative loss years can push spending below the 75% threshold.",
  },
  rmd_spending: {
    name: "RMD-Based Spending",
    oneLiner:
      "Withdraw based on IRS Required Minimum Distribution tables — spending rises with age.",
    how: "Each year after RMD age (72–75), withdraw your portfolio balance divided by the IRS life expectancy factor, times an optional multiplier. Before RMD age, spending tracks your retirement budget with inflation.",
    strengths: [
      "Mathematically self-correcting — can never fully deplete the portfolio",
      "Spending naturally increases as time horizon shortens (higher % in later years)",
      "Backed by actuarial tables designed for lifetime distribution",
    ],
    weaknesses: [
      "Spending is volatile year-to-year (directly tied to portfolio balance)",
      "Early retirement gap — no RMD guidance before age 72, falls back to fixed spending",
      "Rising withdrawal percentages in very old age (10%+ at 95) may exceed needs",
    ],
    bestFor:
      "Retirees comfortable with variable income who want a rules-based, self-correcting approach.",
    stabilityNote:
      "Pre-RMD years track inflation closely. Post-RMD spending varies with portfolio performance, which reduces stability in volatile trials.",
  },
  guyton_klinger: {
    name: "Guardrails (Guyton-Klinger)",
    oneLiner:
      "Dynamic guardrails that increase or decrease spending based on portfolio performance.",
    how: "Start with your budget, adjusted for inflation each year. If your current withdrawal rate drops below 80% of the initial rate (portfolio doing well), increase spending 10%. If it exceeds 120% (portfolio struggling), cut spending 10%. Also skips inflation after loss years.",
    strengths: [
      "Strong portfolio protection — 100% success rate in most scenarios",
      "Responds to both good and bad markets with clear, rule-based adjustments",
      "Well-researched (Guyton & Klinger 2006, widely used by financial planners)",
    ],
    weaknesses: [
      "Spending cuts can compound — multiple 10% cuts stack multiplicatively",
      "Very conservative on the upside — massive portfolio growth may produce only modest spending increases",
      "The prosperity rule (skip inflation after loss) adds to real spending erosion",
      "Can leave very large unspent legacies while restricting current spending",
    ],
    bestFor:
      "Retirees who prioritize portfolio survival and accept variable income for safety.",
    stabilityNote:
      "Lower stability than Fixed/Forgo despite 100% success. The guardrail cuts and inflation skips erode real spending over time — the strategy sacrifices income stability for portfolio preservation.",
  },
  spending_decline: {
    name: "Spending Decline",
    oneLiner:
      "Spending declines 2% per year in real terms, reflecting how retirees naturally spend less with age.",
    how: "Based on EBRI research showing retirees' real spending declines ~2% annually. Spending grows with CPI (maintaining nominal value) but the 2% real decline means purchasing power intentionally reduces each year.",
    strengths: [
      "Matches actual retiree behavior — most people spend less as they age",
      "Higher initial withdrawal rate than Fixed Real (~5.0% vs ~3.9%)",
      "Very conservative over time — builds large legacy",
    ],
    weaknesses: [
      "No market feedback — spending follows a predetermined schedule regardless of portfolio performance",
      "Spending stability will always read 0% because the intentional decline eventually crosses the 75% threshold (~14 years)",
      "May under-spend in later years when healthcare costs actually increase",
    ],
    bestFor:
      "Retirees who want higher early spending and expect to naturally slow down.",
    stabilityNote:
      "Always 0% stability — by design. The 2% annual real decline means spending crosses below 75% of the inflation-adjusted baseline around year 14. This is the strategy working as intended, not a failure.",
  },
  constant_percentage: {
    name: "Constant Percentage",
    oneLiner:
      "Withdraw a fixed percentage of your current portfolio balance each year.",
    how: "Each year, withdraw 5% of whatever your portfolio is worth. A nominal floor at 90% of your initial withdrawal prevents the most severe cuts. Because you only take a percentage, the portfolio can never reach zero.",
    strengths: [
      "Self-correcting — spending automatically adjusts to portfolio performance",
      "Can never fully deplete the portfolio (mathematically impossible without the floor binding)",
      "Simple to understand and implement",
    ],
    weaknesses: [
      "Income is volatile — a 30% portfolio drop means a ~30% spending cut",
      "The nominal floor erodes in real terms over time",
      "Spending stability is inherently low because income tracks portfolio volatility",
    ],
    bestFor:
      "Retirees with guaranteed income (SS, pensions) covering essentials, using portfolio for variable discretionary spending.",
    stabilityNote:
      "Low stability (3–5%) is expected — not a flaw. Spending tracks portfolio balance, so over a 40-year horizon, nearly every scenario has at least one year where spending dips below 75% of the inflation-adjusted baseline.",
  },
  endowment: {
    name: "Endowment",
    oneLiner:
      "Like Constant Percentage, but uses a rolling average balance to smooth volatility.",
    how: "Withdraw 5% of the 5-year rolling average portfolio balance. This smooths out year-to-year market swings. A nominal floor at 90% of initial withdrawal prevents severe cuts.",
    strengths: [
      "Smoother income than Constant Percentage — volatility is dampened by the rolling average",
      "Based on how university endowments (Yale, Stanford) manage spending",
      "Self-correcting like Constant Percentage",
    ],
    weaknesses: [
      "Slower to recover after market downturns (averaging lags behind recovery)",
      "Slower to benefit from market gains for the same reason",
      "Still has low spending stability because income ultimately tracks portfolio performance",
    ],
    bestFor:
      "Retirees who want portfolio-linked spending but with less year-to-year income volatility.",
    stabilityNote:
      "Slightly higher stability than Constant % due to smoothing, but still low (3–5%). The rolling average dampens short-term swings but can't prevent long-term portfolio-driven spending changes.",
  },
  vanguard_dynamic: {
    name: "Vanguard Dynamic (Floor & Ceiling)",
    oneLiner:
      "Percentage of portfolio with guardrails on year-to-year spending changes.",
    how: "Withdraw 5% of your current portfolio, but limit year-over-year changes: spending can rise at most 5% or fall at most 2.5% from the prior year. This creates a smoother income stream than pure Constant Percentage.",
    strengths: [
      "Excellent downside protection — spending can only fall 2.5% per year, not 30%+",
      "Asymmetric guardrails favor stability (tighter floor than ceiling)",
      "Based on Vanguard research (2012), well-tested methodology",
      "High success rate — typically 100%",
    ],
    weaknesses: [
      "Compounding 2.5% annual cuts during prolonged bear markets can still erode spending significantly",
      "Slow to recover spending after downturns (5% ceiling limits the bounce-back)",
      "No absolute floor — spending can drift down indefinitely through compounding small cuts",
    ],
    bestFor:
      "Retirees who want portfolio-linked spending with strong short-term income stability.",
    stabilityNote:
      "Low stability (3–5%) despite smooth year-to-year changes. The metric measures against an inflation-adjusted baseline over the full retirement, and even small compounding cuts accumulate over 40 years.",
  },
};

// ---------------------------------------------------------------------------
// Exported components
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

/** The strategy guide slide panel content. */
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
  const keys = visibleStrategies ?? Object.keys(STRATEGY_GUIDE);

  return (
    <SlidePanel open={open} onClose={onClose} title="Withdrawal Strategy Guide">
      <p className="text-secondary text-sm mb-6">
        Each strategy makes a different tradeoff between income stability,
        portfolio preservation, and spending flexibility. There is no single
        best choice — it depends on your priorities.
      </p>

      <div className="space-y-6">
        {keys.map((key) => {
          const guide = STRATEGY_GUIDE[key];
          if (!guide) return null;
          const isActive = key === activeStrategy;
          return (
            <div
              key={key}
              className={`rounded-lg border p-4 ${isActive ? "border-blue-500/50 bg-blue-900/10" : "border-border"}`}
            >
              <div className="flex items-center gap-2 mb-1.5">
                <h3 className="text-sm font-semibold text-primary">
                  {guide.name}
                </h3>
                {isActive && (
                  <span className="text-[9px] text-blue-400 bg-blue-900/40 px-1.5 py-0.5 rounded">
                    ACTIVE
                  </span>
                )}
              </div>
              <p className="text-xs text-secondary mb-3">{guide.oneLiner}</p>

              <p className="text-xs text-faint mb-2">{guide.how}</p>

              <div className="grid grid-cols-2 gap-3 mb-3">
                <div>
                  <h4 className="text-[10px] font-semibold text-green-400 uppercase tracking-wider mb-1">
                    Strengths
                  </h4>
                  <ul className="space-y-0.5">
                    {guide.strengths.map((s, i) => (
                      <li
                        key={i}
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
                    {guide.weaknesses.map((w, i) => (
                      <li
                        key={i}
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
