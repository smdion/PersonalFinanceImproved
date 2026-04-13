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

export function MethodologyContent() {
  return (
    <div className="space-y-6">
      <p className="text-sm text-muted">
        How the retirement projection engine works, what the numbers mean, and
        how it compares to other tools.
      </p>

      <Section title="How It Works">
        <p>
          A Monte Carlo simulation runs thousands of possible futures for your
          portfolio. Instead of assuming a single fixed return every year, each
          trial draws random annual returns from a statistical model calibrated
          to historical market data. The result is a <strong>fan chart</strong>{" "}
          showing the range of outcomes and a <strong>success rate</strong> —
          the percentage of trials where your portfolio lasted through
          retirement.
        </p>

        <h4 className="font-semibold text-secondary mt-4">
          What the fan chart shows
        </h4>
        <p>
          The shaded bands represent percentile ranges across all trials. The
          P50 (median) line is the middle outcome — half of simulated futures
          did better, half did worse. The P10/P90 bands show the 10th and 90th
          percentile outcomes, giving you a sense of the best-case and
          worst-case range.
        </p>

        <h4 className="font-semibold text-secondary mt-4">
          What success rate measures
        </h4>
        <p>
          Success rate is the fraction of trials where your portfolio balance
          never hit zero before your projection end age. A 90% success rate
          means 9 out of 10 simulated futures sustained your spending. It does{" "}
          <em>not</em> guarantee a 90% chance of success in real life — it
          reflects the model&apos;s assumptions about returns, volatility, and
          inflation.
        </p>

        <h4 className="font-semibold text-secondary mt-4">
          Simple vs Advanced mode
        </h4>
        <p>
          <strong>Simple mode</strong> collapses your portfolio into a single
          tax-free balance with no withdrawal taxes. This is comparable to what
          cFIREsim, FireCalc, and the original Trinity Study model — a single
          portfolio with a fixed withdrawal rate. Use this for apples-to-apples
          comparisons with those tools.
        </p>
        <p>
          <strong>Advanced mode</strong> models your actual multi-account
          structure (401k, IRA, HSA, brokerage) with realistic tax treatment on
          each withdrawal. Traditional accounts are taxed as income, brokerage
          withdrawals are taxed on gains only (basis-adjusted), and Roth/HSA
          withdrawals are tax-free. The engine grosses up your expense needs to
          cover the tax cost, which reduces the effective withdrawal rate and
          typically lowers the success rate by 3-8 percentage points compared to
          Simple mode.
        </p>

        <h4 className="font-semibold text-secondary mt-4">The three presets</h4>
        <ul className="list-disc pl-5 space-y-1.5">
          <li>
            <strong>Aggressive</strong> — Full historical returns (Ibbotson
            SBBI), slightly reduced volatility (0.9x), high equity allocation
            (95% at 25 down to 35% at 85). Optimistic scenario.
          </li>
          <li>
            <strong>Default</strong> — Historical returns with standard
            volatility. Hybrid FIRE glide path: Vanguard TDF pacing during
            accumulation, then a 50% equity floor in retirement (per Big ERN and
            Kitces rising equity research for early retirees).
          </li>
          <li>
            <strong>Conservative</strong> — Forward-looking return estimates
            (~5% nominal equity from Vanguard VCMM / JP Morgan LTCMA), +15%
            volatility for regime uncertainty, higher inflation (3% mean), heavy
            bonds. Stress-test scenario.
          </li>
        </ul>

        <h4 className="font-semibold text-secondary mt-4">
          Sequence of returns risk
        </h4>
        <p>
          <strong>Sequence of returns risk</strong> is the biggest threat to a
          retirement portfolio. Two retirees can have the same average return
          over 30 years but wildly different outcomes depending on <em>when</em>{" "}
          the bad years occur. A bear market in years 1-3 of retirement forces
          withdrawals from a shrinking portfolio — locking in losses and
          reducing the base that would benefit from future recoveries. The same
          bear market in years 25-27 has far less impact because the portfolio
          had decades of growth first.
        </p>
        <p>
          This is why Monte Carlo simulation matters: a single average return
          (deterministic mode) tells you nothing about sequence risk. By running
          thousands of randomized return sequences, Monte Carlo reveals how
          sensitive your plan is to unlucky timing. Success rates below 85%
          often indicate that sequence risk could derail your plan if early
          retirement years coincide with a downturn.
        </p>
        <p>
          <strong>How our engine models it:</strong> Each MC trial draws
          independent annual returns from a log-normal distribution. Unlike
          historical sequence tools (which replay ~150 overlapping 30-year
          periods from history), our parametric approach generates millions of
          unique sequences — including bad-timing scenarios that never occurred
          historically but statistically could. This makes our engine more
          conservative for tail-risk assessment but less anchored to any
          specific historical period.
        </p>

        <h4 className="font-semibold text-secondary mt-4">
          Why our numbers differ from other tools
        </h4>
        <p>
          Most retirement calculators (cFIREsim, FireCalc, FICalc, Engaging
          Data) use <strong>historical sequence returns</strong> — each trial
          replays an actual 30+ year historical period. We use{" "}
          <strong>parametric log-normal returns</strong> — each trial draws from
          a statistical distribution calibrated to historical data. This means
          our engine can generate return sequences that never actually occurred,
          which may slightly differ in tail risk behavior.
        </p>
        <p>
          Additionally, in Advanced mode, our tax-aware withdrawal engine adds
          realistic drag that single-balance models don&apos;t capture. Use
          Simple mode for the closest apples-to-apples comparison with tools
          like cFIREsim and FireCalc.
        </p>
        <p>
          Paid tools like Boldin (formerly NewRetirement), ProjectionLab, and
          Pralana Gold offer more comprehensive financial planning (estate
          planning, Roth conversions, healthcare costs) but use deterministic or
          simple Monte Carlo models without our multi-asset correlation
          modeling.
        </p>
      </Section>

      <Section title="Technical Details" defaultOpen={false}>
        <h4 className="font-semibold text-secondary">Return sampling</h4>
        <p>
          Annual returns are sampled from a multivariate log-normal
          distribution. Each asset class has a calibrated mean return and
          standard deviation. Returns are correlated using Cholesky
          decomposition of the asset class correlation matrix — this ensures
          that when US equities drop, international equities tend to drop too,
          while bonds may rise, matching real-world behavior.
        </p>

        <h4 className="font-semibold text-secondary mt-4">
          Glide path interpolation
        </h4>
        <p>
          The glide path defines target allocations at key ages (e.g., 90%
          equity at 25, 50% at 85). Between waypoints, allocations are linearly
          interpolated. Each year of the simulation, the portfolio is rebalanced
          to the target allocation for that age. All asset classes must sum to
          100% at every age.
        </p>

        <h4 className="font-semibold text-secondary mt-4">
          Stochastic inflation
        </h4>
        <p>
          Inflation is not fixed — each year draws from a normal distribution
          (default: 2.5% mean, 1.2% std dev). This models inflation uncertainty
          and its compounding effect on expenses. The Conservative preset uses
          higher inflation (3% mean, 1.5% std dev) for stress testing.
        </p>

        <h4 className="font-semibold text-secondary mt-4">
          Asset class parameters
        </h4>
        <div className="overflow-x-auto">
          <table className="text-xs w-full border-collapse">
            <thead>
              <tr className="border-b text-left">
                <th className="py-1.5 pr-3">Asset Class</th>
                <th className="py-1.5 pr-3">Mean Return</th>
                <th className="py-1.5 pr-3">Std Dev</th>
                <th className="py-1.5">Source</th>
              </tr>
            </thead>
            <tbody className="divide-y ">
              <tr>
                <td className="py-1.5 pr-3">US Equities</td>
                <td className="pr-3">~10%</td>
                <td className="pr-3">~16%</td>
                <td>Ibbotson SBBI 1926-present</td>
              </tr>
              <tr>
                <td className="py-1.5 pr-3">Int&apos;l Equities</td>
                <td className="pr-3">~8%</td>
                <td className="pr-3">~17%</td>
                <td>MSCI EAFE / ACWI ex-US</td>
              </tr>
              <tr>
                <td className="py-1.5 pr-3">US Bonds</td>
                <td className="pr-3">~5%</td>
                <td className="pr-3">~5%</td>
                <td>Bloomberg US Agg</td>
              </tr>
              <tr>
                <td className="py-1.5 pr-3">TIPS</td>
                <td className="pr-3">~3.5%</td>
                <td className="pr-3">~4%</td>
                <td>Barclays TIPS Index</td>
              </tr>
              <tr>
                <td className="py-1.5 pr-3">Cash</td>
                <td className="pr-3">~3%</td>
                <td className="pr-3">~1%</td>
                <td>3-month T-bill</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="text-xs text-faint mt-1">
          Actual values come from your database (asset_class_params table).
          Presets apply multipliers to these base values. The Conservative
          preset overrides with forward-looking estimates.
        </p>

        <h4 className="font-semibold text-secondary mt-4">
          Tax gross-up (Advanced mode)
        </h4>
        <p>
          In Advanced mode, the engine calculates the after-tax cost of each
          withdrawal. For traditional account withdrawals, it applies the
          estimated effective income tax rate (computed from W-4 withholding
          brackets, not a flat rate). For brokerage withdrawals, it taxes only
          the gains portion (withdrawal minus proportional cost basis) at the
          applicable LTCG rate. The total expense need is &ldquo;grossed
          up&rdquo; to cover these taxes — meaning you need to withdraw more
          than your expenses to net the right amount after tax.
        </p>

        <h4 className="font-semibold text-secondary mt-4">
          Withdrawal routing
        </h4>
        <p>
          The engine supports three withdrawal routing modes:{" "}
          <strong>bracket filling</strong> (draw from traditional until hitting
          a target bracket, then Roth/brokerage), <strong>waterfall</strong>
          (draw from accounts in a fixed priority order), and{" "}
          <strong>percentage</strong> (draw from each account type in fixed
          proportions). On top of any routing mode, eight spending strategies
          are available — from <strong>Fixed Real</strong> (inflation-adjusted
          constant withdrawal at your configured rate) to dynamic methods like{" "}
          <strong>Guyton-Klinger guardrails</strong>,{" "}
          <strong>Constant Percentage</strong>, <strong>Endowment</strong>, and{" "}
          <strong>Vanguard Dynamic</strong> (based on Morningstar&apos;s 2025
          retirement income research). Dynamic strategies support higher initial
          withdrawal rates with trade-offs in cash flow variability. Required
          Minimum Distributions (RMDs) are enforced after age 73/75 per SECURE
          2.0 rules.
        </p>

        <h4 className="font-semibold text-secondary mt-4">
          Comparison with other tools
        </h4>
        <div className="overflow-x-auto">
          <table className="text-xs w-full border-collapse">
            <thead>
              <tr className="border-b text-left">
                <th className="py-1.5 pr-2">Feature</th>
                <th className="py-1.5 pr-2 font-bold">This Engine</th>
                <th className="py-1.5 pr-2">cFIREsim</th>
                <th className="py-1.5 pr-2">FireCalc</th>
                <th className="py-1.5 pr-2">FICalc</th>
                <th className="py-1.5 pr-2">Engaging Data</th>
                <th className="py-1.5 pr-2">Boldin</th>
                <th className="py-1.5 pr-2">ProjectionLab</th>
                <th className="py-1.5 pr-2">Fidelity RIP</th>
                <th className="py-1.5">Trinity Study</th>
              </tr>
            </thead>
            <tbody className="divide-y ">
              <tr className="text-[10px] text-faint italic">
                <td className="py-1 pr-2">Cost</td>
                <td className="pr-2">Free (self-hosted)</td>
                <td className="pr-2">Free</td>
                <td className="pr-2">Free</td>
                <td className="pr-2">Free</td>
                <td className="pr-2">Free</td>
                <td className="pr-2">Freemium ($120/yr+)</td>
                <td className="pr-2">Freemium ($80/yr)</td>
                <td className="pr-2">Free (Fidelity acct)</td>
                <td>Academic paper</td>
              </tr>
              <tr>
                <td className="py-1.5 pr-2">Return model</td>
                <td className="pr-2 font-medium">Parametric log-normal</td>
                <td className="pr-2">Historical sequences</td>
                <td className="pr-2">Historical sequences</td>
                <td className="pr-2">Historical sequences</td>
                <td className="pr-2">Historical sequences</td>
                <td className="pr-2">MC (proprietary)</td>
                <td className="pr-2">MC + historical</td>
                <td className="pr-2">MC (proprietary)</td>
                <td>Historical sequences</td>
              </tr>
              <tr>
                <td className="py-1.5 pr-2">Multi-asset</td>
                <td className="pr-2 font-medium">5 correlated classes</td>
                <td className="pr-2">Stocks + bonds</td>
                <td className="pr-2">Stocks + bonds</td>
                <td className="pr-2">Stocks + bonds</td>
                <td className="pr-2">Stocks + bonds</td>
                <td className="pr-2">Multiple classes</td>
                <td className="pr-2">Multiple classes</td>
                <td className="pr-2">Multiple classes</td>
                <td>Stocks + bonds</td>
              </tr>
              <tr>
                <td className="py-1.5 pr-2">Correlations</td>
                <td className="pr-2 font-medium">Cholesky-correlated</td>
                <td className="pr-2">None</td>
                <td className="pr-2">None</td>
                <td className="pr-2">None</td>
                <td className="pr-2">None</td>
                <td className="pr-2">Unclear</td>
                <td className="pr-2">Unclear</td>
                <td className="pr-2">Unclear</td>
                <td>None</td>
              </tr>
              <tr>
                <td className="py-1.5 pr-2">Tax modeling</td>
                <td className="pr-2 font-medium">Full (Adv) / None (Simple)</td>
                <td className="pr-2">None</td>
                <td className="pr-2">None</td>
                <td className="pr-2">None</td>
                <td className="pr-2">None</td>
                <td className="pr-2">Full (paid tier)</td>
                <td className="pr-2">Full</td>
                <td className="pr-2">Basic</td>
                <td>None</td>
              </tr>
              <tr>
                <td className="py-1.5 pr-2">Multi-account</td>
                <td className="pr-2 font-medium">
                  Yes (401k, IRA, HSA, brokerage)
                </td>
                <td className="pr-2">No</td>
                <td className="pr-2">No</td>
                <td className="pr-2">No</td>
                <td className="pr-2">No</td>
                <td className="pr-2">Yes</td>
                <td className="pr-2">Yes</td>
                <td className="pr-2">Yes</td>
                <td>No</td>
              </tr>
              <tr>
                <td className="py-1.5 pr-2">Glide path</td>
                <td className="pr-2 font-medium">Custom per-age waypoints</td>
                <td className="pr-2">Fixed allocation</td>
                <td className="pr-2">Fixed allocation</td>
                <td className="pr-2">Fixed allocation</td>
                <td className="pr-2">Fixed allocation</td>
                <td className="pr-2">Adjustable</td>
                <td className="pr-2">Custom</td>
                <td className="pr-2">Target-date</td>
                <td>Fixed allocation</td>
              </tr>
              <tr>
                <td className="py-1.5 pr-2">Inflation</td>
                <td className="pr-2 font-medium">Stochastic</td>
                <td className="pr-2">Historical CPI</td>
                <td className="pr-2">Historical CPI</td>
                <td className="pr-2">Historical CPI</td>
                <td className="pr-2">Historical CPI</td>
                <td className="pr-2">Fixed rate</td>
                <td className="pr-2">Configurable</td>
                <td className="pr-2">Fixed rate</td>
                <td>Historical CPI</td>
              </tr>
              <tr>
                <td className="py-1.5 pr-2">Accumulation</td>
                <td className="pr-2 font-medium">
                  Yes (salary + contributions)
                </td>
                <td className="pr-2">Optional</td>
                <td className="pr-2">No</td>
                <td className="pr-2">No</td>
                <td className="pr-2">No</td>
                <td className="pr-2">Yes</td>
                <td className="pr-2">Yes</td>
                <td className="pr-2">Yes</td>
                <td>No</td>
              </tr>
              <tr>
                <td className="py-1.5 pr-2">Social Security</td>
                <td className="pr-2 font-medium">Yes (flat benefit)</td>
                <td className="pr-2">Optional</td>
                <td className="pr-2">Optional</td>
                <td className="pr-2">Optional</td>
                <td className="pr-2">Optional</td>
                <td className="pr-2">Detailed (PIA)</td>
                <td className="pr-2">Detailed</td>
                <td className="pr-2">Detailed (PIA)</td>
                <td>No</td>
              </tr>
              <tr>
                <td className="py-1.5 pr-2">Roth conversions</td>
                <td className="pr-2 font-medium">Yes (bracket-fill)</td>
                <td className="pr-2">No</td>
                <td className="pr-2">No</td>
                <td className="pr-2">No</td>
                <td className="pr-2">No</td>
                <td className="pr-2">Yes (paid)</td>
                <td className="pr-2">Yes</td>
                <td className="pr-2">No</td>
                <td>No</td>
              </tr>
              <tr>
                <td className="py-1.5 pr-2">RMDs</td>
                <td className="pr-2 font-medium">Yes (SECURE 2.0)</td>
                <td className="pr-2">No</td>
                <td className="pr-2">No</td>
                <td className="pr-2">No</td>
                <td className="pr-2">No</td>
                <td className="pr-2">Yes</td>
                <td className="pr-2">Yes</td>
                <td className="pr-2">Yes</td>
                <td>No</td>
              </tr>
              <tr>
                <td className="py-1.5 pr-2">Withdrawal strategy</td>
                <td className="pr-2 font-medium">
                  8 strategies (Morningstar) + 3 routing modes
                </td>
                <td className="pr-2">Fixed rate</td>
                <td className="pr-2">Fixed rate</td>
                <td className="pr-2">Variable (VPW, etc.)</td>
                <td className="pr-2">Fixed / variable</td>
                <td className="pr-2">Guardrails + custom</td>
                <td className="pr-2">Multiple strategies</td>
                <td className="pr-2">Basic</td>
                <td>Fixed rate</td>
              </tr>
              <tr>
                <td className="py-1.5 pr-2">IRMAA / ACA</td>
                <td className="pr-2 font-medium">Yes (cliff awareness)</td>
                <td className="pr-2">No</td>
                <td className="pr-2">No</td>
                <td className="pr-2">No</td>
                <td className="pr-2">No</td>
                <td className="pr-2">Partial</td>
                <td className="pr-2">Partial</td>
                <td className="pr-2">No</td>
                <td>No</td>
              </tr>
              <tr>
                <td className="py-1.5 pr-2">Open source</td>
                <td className="pr-2 font-medium">Yes (self-hosted)</td>
                <td className="pr-2">Yes</td>
                <td className="pr-2">No</td>
                <td className="pr-2">Yes</td>
                <td className="pr-2">No</td>
                <td className="pr-2">No</td>
                <td className="pr-2">No</td>
                <td className="pr-2">No</td>
                <td>N/A</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="text-xs text-faint mt-2">
          <strong>Free tools</strong> (cFIREsim, FireCalc, FICalc, Engaging
          Data) are best for quick validation using historical data.{" "}
          <strong>Paid tools</strong> (Boldin, ProjectionLab) offer
          comprehensive planning features but limited simulation transparency.{" "}
          <strong>This engine</strong> combines parametric MC rigor with full
          tax-aware modeling and open-source transparency. Use Simple mode for
          closest comparison with free historical tools.
        </p>

        <h4 className="font-semibold text-secondary mt-4">
          Known limitations and future improvements
        </h4>
        <ul className="list-disc pl-5 space-y-1.5">
          <li>
            <strong>Roth conversions are automatic, not optimized.</strong> The
            engine fills remaining bracket room with Traditional-to-Roth
            conversions each year, paying tax from brokerage. It does not yet
            optimize conversion timing across years or consider the interaction
            between conversion amount and future RMDs. Manual overrides can be
            used to fine-tune.
          </li>
          <li>
            <strong>Social Security is modeled but simplified.</strong> The
            engine applies a flat monthly benefit starting at your configured SS
            start age (default 67). It reduces withdrawal needs accordingly and
            uses the IRS provisional income formula (3-tier: 0%/50%/85% taxable)
            for accurate SS taxation. However, it does not model spousal
            benefits, early/delayed claiming strategies, or benefit reductions
            for early retirement.
          </li>
          <li>
            <strong>IRMAA/ACA awareness is reporting-only.</strong> The engine
            reports IRMAA surcharges and ACA subsidy cliff warnings but does not
            yet automatically reduce Roth conversions or cap Traditional
            withdrawals to stay below cliffs. Use the warnings to manually
            adjust.
          </li>
          <li>
            <strong>Parametric vs historical.</strong> Log-normal returns can
            produce sequences that never occurred historically. This may
            slightly understate or overstate tail risks compared to historical
            sequence methods.
          </li>
        </ul>

        <h4 className="font-semibold text-secondary mt-4">Sources</h4>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            Bengen, W. (1994). &ldquo;Determining Withdrawal Rates Using
            Historical Data&rdquo;
          </li>
          <li>
            Cooley, Hubbard, Walz (1998). &ldquo;Retirement Savings: Choosing a
            Withdrawal Rate That Is Sustainable&rdquo; (Trinity Study)
          </li>
          <li>
            Pfau, W. (2018). &ldquo;An International Perspective on Safe
            Withdrawal Rates&rdquo;
          </li>
          <li>
            Kitces, M. (2014). &ldquo;Should Equity Exposure Decrease In
            Retirement, Or Is A Rising Equity Glide Path Actually Better?&rdquo;
          </li>
          <li>
            Karsten / Big ERN (2016-present). Safe Withdrawal Rate Series
            (earlyretirementnow.com)
          </li>
          <li>Vanguard VCMM 10-Year Capital Market Forecasts</li>
          <li>JP Morgan 2026 Long-Term Capital Market Assumptions</li>
        </ul>
      </Section>
    </div>
  );
}
