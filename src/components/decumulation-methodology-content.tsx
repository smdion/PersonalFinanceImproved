"use client";

import { useState } from "react";

function Section({
  title,
  children,
  defaultOpen = true,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 bg-surface-sunken text-sm font-medium text-secondary hover:bg-surface-elevated transition-colors"
      >
        {title}
        <svg
          aria-hidden="true"
          className={`w-4 h-4 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>
      {open && (
        <div className="px-4 py-4 space-y-4 text-sm text-muted leading-relaxed">
          {children}
        </div>
      )}
    </div>
  );
}

export function DecumulationMethodologyContent() {
  return (
    <div className="space-y-6">
      <p className="text-sm text-muted">
        How the decumulation engine handles withdrawals, taxes, RMDs, Roth
        conversions, and dynamic spending during retirement years.
      </p>

      <Section title="How It Works">
        <p>
          The decumulation engine models your <strong>retirement years</strong>{" "}
          — from retirement age to the end of your projection. Each year it
          computes your expense need (inflation-adjusted), optionally applies
          dynamic spending guardrails, routes withdrawals across accounts with
          tax awareness, enforces Required Minimum Distributions, performs Roth
          conversions when beneficial, checks for IRMAA/ACA cliffs, and deducts
          withdrawals from account balances.
        </p>

        <h4 className="font-semibold text-secondary mt-4">
          What it computes each year
        </h4>
        <p className="text-caption text-faint">
          Steps 1–2 below work differently depending on your selected strategy —
          4 of the 8 strategies (Fixed, Forgo Inflation After Loss, Spending
          Decline, Guardrails) start from your stated budget and adjust it; the
          other 4 (RMD-Based, Constant Percentage, Endowment, Vanguard Dynamic)
          compute spending directly from your portfolio balance and never read
          the budget figure at all. See the per-strategy descriptions further
          down this page for exactly how each one works.
        </p>
        <ol className="list-decimal pl-5 space-y-1.5">
          <li>
            <strong>Annual expense need (budget-seeded strategies)</strong> —
            for Fixed, Forgo Inflation After Loss, Spending Decline, and
            Guardrails, your retirement &ldquo;salary&rdquo; (set by the
            Retirement Budget) is the starting point. Fixed and Guardrails grow
            it each year by the Post-Retirement Raise rate (Guardrails then
            applies guardrail raises/cuts on top); Spending Decline compounds it
            by inflation minus its own decline rate instead, never reading the
            raise rate; Forgo Inflation After Loss grows it like Fixed except
            skips the raise the year after a loss. Budget overrides
            (sticky-forward by year) can change the base amount at any point for
            all four.
          </li>
          <li>
            <strong>
              Portfolio-derived spending (balance-based strategies)
            </strong>{" "}
            — RMD-Based Spending, Constant Percentage, Endowment, and Vanguard
            Dynamic compute the year&apos;s spending directly from your current
            portfolio balance (or a rolling average, for Endowment) each year —
            the Retirement Budget figure is not read at all for these four;
            it&apos;s replaced outright by each strategy&apos;s own formula, not
            adjusted from it. RMD-Based falls back to budget-seeded spending
            only before RMD age (72–75).
          </li>
          <li>
            <strong>Tax estimation</strong> — the engine estimates the tax cost
            of withdrawals using your W-4 brackets (from DB) or a fallback flat
            rate, then grosses up the withdrawal amount so you net your full
            expense need after taxes.
          </li>
          <li>
            <strong>Withdrawal routing</strong> — your expense need (grossed up
            for taxes) is distributed across accounts using one of three routing
            modes (see below).
          </li>
          <li>
            <strong>RMD enforcement</strong> — after routing, the engine checks
            whether Traditional withdrawals meet the IRS Required Minimum
            Distribution. If not, it forces additional Traditional withdrawals
            to satisfy the RMD floor.
          </li>
          <li>
            <strong>Roth conversions</strong> — if enabled, the engine converts
            Traditional balances to Roth to fill remaining room in the target
            tax bracket, paying the tax from brokerage.
          </li>
          <li>
            <strong>IRMAA/ACA cliff checks</strong> — warnings are emitted if
            total income (withdrawals + conversions + Social Security) crosses
            Medicare surcharge or ACA subsidy thresholds.
          </li>
          <li>
            <strong>Balance deduction</strong> — withdrawals are subtracted from
            account balances. If any account depletes, it&apos;s recorded and
            remaining need shifts to other accounts.
          </li>
        </ol>

        <h4 className="font-semibold text-secondary mt-4">
          Withdrawal routing modes
        </h4>
        <ul className="list-disc pl-5 space-y-2">
          <li>
            <strong>Bracket filling (default)</strong> — the tax-optimal
            approach. Draws from Traditional accounts up to a target tax bracket
            threshold (your &ldquo;Bracket Ceiling&rdquo; setting), then covers
            any remaining need from whichever of Roth or your brokerage account
            is actually cheaper <em>this year</em>, instead of a fixed order.
            Roth isn&apos;t automatically free once you&apos;ve drawn down what
            you originally contributed — the growth portion is taxed as ordinary
            income, so in a year your brokerage account happens to sit in the 0%
            long-term capital gains zone, the engine draws from brokerage first
            and leaves your Roth balance compounding tax-free for longer. In a
            year brokerage gains would cost more than Roth growth, it flips
            back. This is a single-year decision, not a lifetime plan — it
            doesn&apos;t look ahead to how today&apos;s choice affects a future
            Required Minimum Distribution. Requires tax brackets to be
            configured; falls back to waterfall if not available.
          </li>
          <li>
            <strong>Waterfall</strong> — drains accounts in a fixed priority
            order (e.g. brokerage first, then 401k, then IRA, then HSA last).
            Each account is fully drawn down before moving to the next. Within
            each account, you can set a tax preference for whether to draw
            Traditional or Roth first.
          </li>
          <li>
            <strong>Percentage</strong> — splits withdrawals by fixed
            percentages across account types (e.g. 50% from brokerage, 30% from
            401k, 20% from IRA). If an account has insufficient balance, the
            shortfall redistributes proportionally to the others.
          </li>
        </ul>

        <h4 className="font-semibold text-secondary mt-4">
          Spending strategies
        </h4>
        <p className="text-xs text-faint mb-2">
          Based on Morningstar&apos;s &ldquo;State of Retirement Income:
          2025&rdquo; research. The SWR (starting safe withdrawal rate) shown is
          the maximum starting rate each strategy can support at 90% historical
          success over 30 years with a 40/60 portfolio.
        </p>

        <div className="bg-blue-50 border border-blue-200 rounded-md px-3 py-2 text-xs text-blue-800 mb-3">
          <strong>Why do dynamic strategies have higher success rates?</strong>{" "}
          Fixed Real has no feedback loop — if your portfolio drops 40%, you
          still withdraw the same dollar amount, which can deplete it. Dynamic
          strategies automatically reduce spending when the portfolio drops,
          acting as a circuit breaker against depletion. The trade-off: your
          annual spending will vary year to year instead of being perfectly
          predictable. The more a strategy self-corrects, the higher its success
          rate — but the less stable your income.
        </div>

        <ul className="list-disc pl-5 space-y-3">
          <li>
            <strong>Fixed Real (SWR ~3.9%)</strong> — your initial withdrawal
            amount is set by your configured withdrawal rate applied to your
            portfolio balance at retirement, then adjusted for inflation each
            year regardless of portfolio performance. No feedback loop —
            spending never changes based on how the portfolio is doing.
            <br />
            <span className="text-faint text-label">
              Best for: retirees who need perfectly predictable income and are
              comfortable with a lower starting rate. Pair with a conservative
              withdrawal rate (3-4%).
            </span>
          </li>
          <li>
            <strong>Forgo Inflation After Loss (SWR ~4.4%)</strong> — identical
            to Fixed Real, except the annual inflation adjustment is skipped in
            any year following a negative portfolio return. A minimal feedback
            mechanism — spending doesn&apos;t increase after bad years, giving
            the portfolio time to recover.
            <br />
            <span className="text-faint text-label">
              Best for: retirees who want mostly stable income but are willing
              to forgo raises in bad years. The simplest dynamic strategy — easy
              to understand and follow manually.
            </span>
          </li>
          <li>
            <strong>RMD-Based Spending (SWR ~5.4%)</strong> — withdraw each year
            based on the IRS Required Minimum Distribution factor for your age,
            scaled by a configurable multiplier. Before RMD age, falls back to
            fixed-real spending. Withdrawals scale with the portfolio and
            increase as a percentage in later years (the IRS table assumes
            you&apos;ll spend it down).
            <br />
            <span className="text-faint text-label">
              Best for: retirees who want a simple, IRS-aligned rule that
              naturally scales with their portfolio. Good if you plan to spend
              more in early retirement and don&apos;t need to leave a large
              legacy.
            </span>
          </li>
          <li>
            <strong>Guardrails / Guyton-Klinger (SWR ~5.2%)</strong> — dynamic
            spending that responds to portfolio performance. When your current
            withdrawal rate drops below the upper guardrail (portfolio grew),
            spending increases. When it rises above the lower guardrail
            (portfolio shrank), spending decreases. The prosperity rule skips
            inflation adjustments after a loss year.
            <br />
            <span className="text-faint text-label">
              Best for: retirees who want explicit rules for when to increase or
              cut spending. Provides clear guardrails — you always know exactly
              when and why your spending changes. Good balance between higher
              starting rate and moderate cash flow variability.
            </span>
          </li>
          <li>
            <strong>Spending Decline (SWR ~5.0%)</strong> — annual real spending
            declines by a fixed rate (default 2%), reflecting actual reduced
            consumption in later retirement per EBRI spending data. Not
            market-responsive — the decline is predetermined regardless of
            portfolio performance.
            <br />
            <span className="text-faint text-label">
              Best for: retirees who expect to spend less as they age (less
              travel, fewer activities) and want to front-load spending. Based
              on research showing retirees naturally spend ~2% less per year in
              real terms.
            </span>
          </li>
          <li>
            <strong>Constant Percentage (SWR ~5.7%)</strong> — withdraw a fixed
            percentage of the current portfolio balance each year. A floor
            (default 90% of initial amount) prevents severe cuts. The portfolio
            can mathematically never fully deplete — you&apos;re always taking a
            percentage of what&apos;s left.
            <br />
            <span className="text-faint text-label">
              Best for: retirees comfortable with spending that rises and falls
              with the market. Highest starting rate available. Good if you have
              flexible expenses or other guaranteed income (Social Security,
              pension) covering your baseline needs.
            </span>
          </li>
          <li>
            <strong>Endowment (SWR ~5.7%)</strong> — like Constant Percentage,
            but uses a rolling N-year average of portfolio balance instead of
            the current balance. This smooths out market volatility — a single
            bad year doesn&apos;t immediately slash your income.
            <br />
            <span className="text-faint text-label">
              Best for: retirees who want the high starting rate of Constant
              Percentage but with smoother year-to-year income. The rolling
              average acts as a shock absorber — how university endowments and
              foundations manage their spending.
            </span>
          </li>
          <li>
            <strong>Vanguard Dynamic Floor &amp; Ceiling (SWR ~4.7%)</strong> —
            withdraw a base percentage of the current portfolio, but cap
            year-over-year spending changes: maximum 5% increase (ceiling) and
            maximum 2.5% decrease (floor). Your spending adjusts with the market
            but can never swing wildly in either direction.
            <br />
            <span className="text-faint text-label">
              Best for: retirees who want market-responsive spending with
              bounded volatility. You get some upside when markets are good, but
              your worst-case annual cut is limited. A good middle ground
              between Fixed Real and Constant Percentage.
            </span>
          </li>
        </ul>
      </Section>

      <Section title="Defaults" defaultOpen={false}>
        <p>
          These are the page-level defaults that apply every retirement year
          unless overridden.
        </p>

        <div className="overflow-x-auto">
          <table className="text-xs w-full border-collapse">
            <thead>
              <tr className="border-b text-left">
                <th className="py-1.5 pr-3">Setting</th>
                <th className="py-1.5 pr-3">Type</th>
                <th className="py-1.5">Description</th>
              </tr>
            </thead>
            <tbody className="divide-y ">
              <tr>
                <td className="py-1.5 pr-3 font-mono text-label">
                  withdrawalRate
                </td>
                <td className="pr-3">Decimal</td>
                <td>
                  A reference rate (e.g. 0.04 = 4%) used to size the &ldquo;FI
                  target&rdquo; estimate on other pages. None of the 8
                  withdrawal strategies below read this field to compute actual
                  spending — see &ldquo;What it computes each year&rdquo; above
                  for what really drives the withdrawal amount for your selected
                  strategy.
                </td>
              </tr>
              <tr>
                <td className="py-1.5 pr-3 font-mono text-label">
                  withdrawalRoutingMode
                </td>
                <td className="pr-3">Enum</td>
                <td>
                  &apos;bracket_filling&apos; (default), &apos;waterfall&apos;,
                  or &apos;percentage&apos;
                </td>
              </tr>
              <tr>
                <td className="py-1.5 pr-3 font-mono text-label">
                  withdrawalOrder
                </td>
                <td className="pr-3">Array</td>
                <td>
                  Priority order for waterfall mode (e.g. [brokerage, 401k, ira,
                  hsa])
                </td>
              </tr>
              <tr>
                <td className="py-1.5 pr-3 font-mono text-label">
                  withdrawalSplits
                </td>
                <td className="pr-3">Record</td>
                <td>
                  Per-account percentages for percentage mode (must sum to 1.0)
                </td>
              </tr>
              <tr>
                <td className="py-1.5 pr-3 font-mono text-label">
                  withdrawalTaxPreference
                </td>
                <td className="pr-3">Record</td>
                <td>
                  Per-account preference for drawing Traditional or Roth first
                </td>
              </tr>
              <tr>
                <td className="py-1.5 pr-3 font-mono text-label">
                  withdrawalStrategy
                </td>
                <td className="pr-3">Enum</td>
                <td>
                  One of 8 spending strategies: fixed,
                  forgo_inflation_after_loss, rmd_spending, guyton_klinger,
                  spending_decline, constant_percentage, endowment,
                  vanguard_dynamic
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <h4 className="font-semibold text-secondary mt-4">Tax configuration</h4>
        <div className="overflow-x-auto">
          <table className="text-xs w-full border-collapse">
            <thead>
              <tr className="border-b text-left">
                <th className="py-1.5 pr-3">Setting</th>
                <th className="py-1.5">Description</th>
              </tr>
            </thead>
            <tbody className="divide-y ">
              <tr>
                <td className="py-1.5 pr-3 font-mono text-label">
                  traditionalFallbackRate
                </td>
                <td>
                  Flat tax rate used when no W-4 brackets are available (e.g.
                  0.22 = 22%)
                </td>
              </tr>
              <tr>
                <td className="py-1.5 pr-3 font-mono text-label">
                  taxBrackets
                </td>
                <td>
                  W-4 withholding brackets from your profile (threshold, base
                  withholding, marginal rate)
                </td>
              </tr>
              <tr>
                <td className="py-1.5 pr-3 font-mono text-label">
                  taxMultiplier
                </td>
                <td>
                  Scale factor for future tax uncertainty (1.0 = current law,
                  1.2 = assume 20% higher taxes)
                </td>
              </tr>
              <tr>
                <td className="py-1.5 pr-3 font-mono text-label">
                  grossUpForTaxes
                </td>
                <td>
                  When true (default), withdrawals are increased so after-tax
                  proceeds meet your expense need
                </td>
              </tr>
              <tr>
                <td className="py-1.5 pr-3 font-mono text-label">
                  rothBracketTarget
                </td>
                <td>
                  Target marginal rate for Roth conversions (e.g. 0.12 = fill up
                  to the 12% bracket)
                </td>
              </tr>
              <tr>
                <td className="py-1.5 pr-3 font-mono text-label">
                  enableRothConversions
                </td>
                <td>
                  Whether to auto-convert Traditional → Roth to fill remaining
                  bracket room each year
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <h4 className="font-semibold text-secondary mt-4">
          Strategy parameters
        </h4>
        <p className="text-xs text-faint mb-2">
          Each strategy has its own tunable parameters. Select a strategy to see
          its controls. All parameters have sensible defaults from
          Morningstar&apos;s research.
        </p>
        <div className="overflow-x-auto">
          <table className="text-xs w-full border-collapse">
            <thead>
              <tr className="border-b text-left">
                <th className="py-1.5 pr-3">Strategy</th>
                <th className="py-1.5 pr-3">Parameter</th>
                <th className="py-1.5 pr-3">Default</th>
                <th className="py-1.5">Description</th>
              </tr>
            </thead>
            <tbody className="divide-y ">
              <tr>
                <td className="py-1 pr-3 font-medium" colSpan={4}>
                  Guyton-Klinger
                </td>
              </tr>
              <tr>
                <td className="py-1 pr-3"></td>
                <td className="pr-3 font-mono text-label">upperGuardrail</td>
                <td className="pr-3">0.80</td>
                <td>
                  If current rate &lt; initial rate × 0.80 (portfolio grew),
                  increase spending
                </td>
              </tr>
              <tr>
                <td className="py-1 pr-3"></td>
                <td className="pr-3 font-mono text-label">lowerGuardrail</td>
                <td className="pr-3">1.20</td>
                <td>
                  If current rate &gt; initial rate × 1.20 (portfolio shrank),
                  decrease spending
                </td>
              </tr>
              <tr>
                <td className="py-1 pr-3"></td>
                <td className="pr-3 font-mono text-label">increasePercent</td>
                <td className="pr-3">0.10</td>
                <td>Spending increase when upper guardrail triggers (10%)</td>
              </tr>
              <tr>
                <td className="py-1 pr-3"></td>
                <td className="pr-3 font-mono text-label">decreasePercent</td>
                <td className="pr-3">0.10</td>
                <td>Spending decrease when lower guardrail triggers (10%)</td>
              </tr>
              <tr>
                <td className="py-1 pr-3"></td>
                <td className="pr-3 font-mono text-label">
                  skipInflationAfterLoss
                </td>
                <td className="pr-3">true</td>
                <td>Prosperity rule: skip inflation after a loss year</td>
              </tr>
              <tr>
                <td className="py-1 pr-3 font-medium" colSpan={4}>
                  Spending Decline
                </td>
              </tr>
              <tr>
                <td className="py-1 pr-3"></td>
                <td className="pr-3 font-mono text-label">annualDeclineRate</td>
                <td className="pr-3">0.02</td>
                <td>
                  Annual real spending decline rate (2% matches EBRI data)
                </td>
              </tr>
              <tr>
                <td className="py-1 pr-3 font-medium" colSpan={4}>
                  Constant Percentage
                </td>
              </tr>
              <tr>
                <td className="py-1 pr-3"></td>
                <td className="pr-3 font-mono text-label">withdrawalPercent</td>
                <td className="pr-3">0.05</td>
                <td>Percentage of current balance withdrawn each year</td>
              </tr>
              <tr>
                <td className="py-1 pr-3"></td>
                <td className="pr-3 font-mono text-label">floorPercent</td>
                <td className="pr-3">0.90</td>
                <td>
                  Minimum withdrawal as % of initial amount (prevents severe
                  cuts)
                </td>
              </tr>
              <tr>
                <td className="py-1 pr-3 font-medium" colSpan={4}>
                  Endowment
                </td>
              </tr>
              <tr>
                <td className="py-1 pr-3"></td>
                <td className="pr-3 font-mono text-label">withdrawalPercent</td>
                <td className="pr-3">0.05</td>
                <td>
                  Percentage of rolling average balance withdrawn each year
                </td>
              </tr>
              <tr>
                <td className="py-1 pr-3"></td>
                <td className="pr-3 font-mono text-label">rollingYears</td>
                <td className="pr-3">10</td>
                <td>Number of years for the rolling average window</td>
              </tr>
              <tr>
                <td className="py-1 pr-3"></td>
                <td className="pr-3 font-mono text-label">floorPercent</td>
                <td className="pr-3">0.90</td>
                <td>Minimum withdrawal as % of initial amount</td>
              </tr>
              <tr>
                <td className="py-1 pr-3 font-medium" colSpan={4}>
                  Vanguard Dynamic
                </td>
              </tr>
              <tr>
                <td className="py-1 pr-3"></td>
                <td className="pr-3 font-mono text-label">basePercent</td>
                <td className="pr-3">0.05</td>
                <td>Base percentage of current portfolio balance</td>
              </tr>
              <tr>
                <td className="py-1 pr-3"></td>
                <td className="pr-3 font-mono text-label">ceilingPercent</td>
                <td className="pr-3">0.05</td>
                <td>Max year-over-year spending increase (5%)</td>
              </tr>
              <tr>
                <td className="py-1 pr-3"></td>
                <td className="pr-3 font-mono text-label">floorPercent</td>
                <td className="pr-3">0.025</td>
                <td>Max year-over-year spending decrease (2.5%)</td>
              </tr>
              <tr>
                <td className="py-1 pr-3 font-medium" colSpan={4}>
                  RMD-Based Spending
                </td>
              </tr>
              <tr>
                <td className="py-1 pr-3"></td>
                <td className="pr-3 font-mono text-label">rmdMultiplier</td>
                <td className="pr-3">1.0</td>
                <td>Multiplier on IRS RMD amount (1.0 = standard RMD)</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Overrides (Sticky-Forward)" defaultOpen={false}>
        <p>
          Overrides let you change any decumulation setting starting at a
          specific calendar year. They use the same{" "}
          <strong>sticky-forward</strong> semantics as accumulation: once set, a
          field stays at the overridden value until a later override changes it
          again.
        </p>

        <h4 className="font-semibold text-secondary mt-4">Override fields</h4>
        <div className="overflow-x-auto">
          <table className="text-xs w-full border-collapse">
            <thead>
              <tr className="border-b text-left">
                <th className="py-1.5 pr-3">Field</th>
                <th className="py-1.5">Effect</th>
              </tr>
            </thead>
            <tbody className="divide-y ">
              <tr>
                <td className="py-1.5 pr-3 font-mono text-label">
                  withdrawalRate
                </td>
                <td>New withdrawal rate from this year onward</td>
              </tr>
              <tr>
                <td className="py-1.5 pr-3 font-mono text-label">
                  withdrawalRoutingMode
                </td>
                <td>
                  Switch routing mode (bracket_filling ↔ waterfall ↔ percentage)
                </td>
              </tr>
              <tr>
                <td className="py-1.5 pr-3 font-mono text-label">
                  withdrawalOrder
                </td>
                <td>New waterfall priority order</td>
              </tr>
              <tr>
                <td className="py-1.5 pr-3 font-mono text-label">
                  withdrawalSplits
                </td>
                <td>New percentage splits (merged with existing)</td>
              </tr>
              <tr>
                <td className="py-1.5 pr-3 font-mono text-label">
                  withdrawalTaxPreference
                </td>
                <td>
                  Per-account tax draw preference (Traditional or Roth first)
                </td>
              </tr>
              <tr>
                <td className="py-1.5 pr-3 font-mono text-label">
                  withdrawalAccountCaps
                </td>
                <td>Dollar limit on withdrawals per account per year</td>
              </tr>
              <tr>
                <td className="py-1.5 pr-3 font-mono text-label">
                  withdrawalTaxTypeCaps
                </td>
                <td>
                  Cross-account caps on total Traditional or Roth withdrawals
                </td>
              </tr>
              <tr>
                <td className="py-1.5 pr-3 font-mono text-label">
                  rothConversionTarget
                </td>
                <td>
                  Override the Roth conversion target bracket (set to 0 to
                  disable conversions)
                </td>
              </tr>
              <tr>
                <td className="py-1.5 pr-3 font-mono text-label">reset</td>
                <td>
                  When true, ALL fields revert to page-level defaults from this
                  year onward
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <h4 className="font-semibold text-secondary mt-4">Example</h4>
        <p className="text-xs bg-surface-sunken border rounded p-3 font-mono leading-relaxed">
          Year 2045: withdrawalRate → 0.035 (reduce to 3.5% after downturn)
          <br />
          Year 2048: withdrawalAccountCaps → {"{"}401k: 50000{"}"} (limit 401k
          draws to $50k/year)
          <br />
          Year 2050: rothConversionTarget → 0 (stop Roth conversions —
          approaching IRMAA cliff)
          <br />
          Year 2055: reset → true (revert everything to defaults)
        </p>
      </Section>

      <Section title="Technical Details" defaultOpen={false}>
        <h4 className="font-semibold text-secondary">Tax gross-up</h4>
        <p>
          When{" "}
          <code className="text-label bg-surface-elevated px-1 rounded">
            grossUpForTaxes
          </code>{" "}
          is enabled (default), the engine increases withdrawal amounts so that
          after-tax proceeds equal your expense need. For Traditional
          withdrawals, it applies your effective income tax rate (from W-4
          brackets or the fallback flat rate). For brokerage withdrawals, only
          gains are taxed, at the real progressive LTCG bracket rate
          (0%/15%/20%, stacked on top of your other ordinary income — not a flat
          rate) plus the 3.8% NIIT surtax once your MAGI is above its threshold.
          Roth withdrawals are tax-free only up to your tracked
          contribution/conversion basis; a non-qualified withdrawal of growth
          beyond that basis is taxed as ordinary income (and may carry the 10%
          early-withdrawal penalty pre-59½ — see the Withdrawal Ordering
          methodology page). HSA withdrawals are tax-free when qualified.
        </p>
        <p>
          Example: you need $40,000 after tax. At a 22% effective rate, the
          engine withdraws ~$51,282 from Traditional to net $40,000 after the
          $11,282 tax cost.
        </p>

        <h4 className="font-semibold text-secondary mt-4">
          Cost-aware source selection (bracket filling mode)
        </h4>
        <p>
          Once Traditional withdrawals hit the bracket-ceiling cap, the engine
          ranks the remaining sources — Roth, brokerage, HSA — by their actual
          marginal cost for that specific year rather than a fixed order. Basis
          (in either Roth or brokerage) is always free and drawn first. For the
          rest, it compares the ordinary-income rate a non-qualified Roth
          withdrawal would cost against the real LTCG-bracket rate (plus NIIT
          where it applies) a brokerage withdrawal would cost, and draws from
          whichever is cheaper. This estimate assumes your configured Roth
          conversion (if enabled) claims its usual bracket room first, so the
          two features don&apos;t both assume the same cheap room is available.
          HSA is always last — its combined ordinary-rate-plus-20%- penalty cost
          (when withdrawn non-medically pre-65) is realistically never the
          cheapest option. None of this looks ahead to IRMAA or ACA cliffs, or
          to future tax years — those are handled by the separate checks below.
        </p>

        <h4 className="font-semibold text-secondary mt-4">
          Required Minimum Distributions
        </h4>
        <p>
          RMDs are enforced after withdrawal routing completes, not during. The
          engine computes the RMD using the prior year-end Traditional balance
          divided by the IRS Uniform Lifetime Table factor for your age. RMD
          start age follows SECURE 2.0 rules: age 73 for those born 1951-1959,
          age 75 for those born 1960+. If your routed Traditional withdrawals
          already meet or exceed the RMD, no adjustment is needed. If they fall
          short, the shortfall is distributed proportionally across your
          Traditional accounts.
        </p>

        <h4 className="font-semibold text-secondary mt-4">Roth conversions</h4>
        <p>
          When enabled, the engine performs bracket-filling Roth conversions
          each year. After withdrawals and RMDs determine your taxable income,
          the engine computes remaining room up to the target bracket threshold
          and converts that amount from Traditional to Roth. The income tax on
          the conversion is paid from brokerage (not from the converted amount).
          When IRMAA awareness is enabled, the conversion amount is capped to
          stay below the next IRMAA cliff (see below) — this defaults on
          automatically whenever IRMAA awareness is on. ACA awareness does not
          cap conversions; it only reports how close you are to the cliff.
        </p>

        <h4 className="font-semibold text-secondary mt-4">
          Social Security integration
        </h4>
        <p>
          Social Security benefits reduce the amount you need to withdraw from
          your portfolio. The engine applies the IRS provisional income formula
          for Social Security taxation: up to 85% of benefits may be taxable
          depending on your total income. The three-tier formula (0%/50%/85%
          taxable) is computed against combined income (AGI + tax-exempt
          interest + half of SS benefits). SS benefits start at your configured
          start age (default 67) as a flat monthly amount.
        </p>

        <h4 className="font-semibold text-secondary mt-4">
          IRMAA and ACA awareness
        </h4>
        <p>
          <strong>IRMAA</strong> (Income-Related Monthly Adjustment Amount) adds
          Medicare Part B and Part D surcharges at age 65+ based on modified AGI
          from two years prior. The engine reports the surcharge and, when
          it&apos;s about to push you over the next tier, caps that year&apos;s
          Roth conversion to stay under the cliff — this cap is the one place
          IRMAA awareness actually changes a withdrawal number, not just a
          warning.
        </p>
        <p>
          <strong>ACA</strong> (Affordable Care Act) subsidy cliffs apply before
          age 65 if you purchase marketplace insurance. Income above 400% of the
          Federal Poverty Level eliminates premium tax credits entirely. The
          engine warns when early-retiree income approaches this cliff, but —
          unlike IRMAA — never caps a conversion or withdrawal to avoid it;
          it&apos;s reporting-only. Use the warning to manually adjust via
          overrides.
        </p>
        <p className="text-xs text-faint mt-1">
          IRMAA&apos;s cliff is looked up two years ahead of the income that
          triggers it (its real 2-year MAGI lookback), so the conversion cap
          compares this year&apos;s income against the threshold that will apply
          two years from now, not this year&apos;s.
        </p>

        <h4 className="font-semibold text-secondary mt-4">Threshold growth</h4>
        <p>
          Your W-4 tax brackets, standard deduction, LTCG brackets, IRMAA
          brackets, and the ACA subsidy cliff are all legally inflation-indexed
          — the IRS/CMS/HHS raise them most years. The engine grows each one
          forward from its own data vintage using your configured inflation
          rate, the same way it grows your spending need, instead of comparing a
          40-year projection against a single frozen year&apos;s numbers. (Two
          thresholds are deliberately NOT grown: the 3.8% NIIT surtax threshold
          and the Social Security taxation thresholds are genuinely fixed in
          nominal dollars by law and have not been inflation-indexed since 1984
          and 2013 respectively.)
        </p>

        <h4 className="font-semibold text-secondary mt-4">Account depletion</h4>
        <p>
          When an account balance reaches zero, it&apos;s recorded with the
          depletion year and the remaining withdrawal need shifts to other
          accounts. If all accounts deplete, the portfolio has failed for that
          simulation trial. The engine tracks per-account depletion separately,
          which is visible in the year-by-year projection table.
        </p>
      </Section>
    </div>
  );
}
