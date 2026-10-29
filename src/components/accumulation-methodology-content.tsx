"use client";

import { ProseSection } from "@/components/ui/prose-section";

export function AccumulationMethodologyContent() {
  return (
    <div className="space-y-6">
      <p className="text-muted text-sm">
        How the accumulation engine routes contributions across accounts, grows
        balances, and applies your changes by year during working years.
      </p>

      <ProseSection title="How It Works" defaultOpen>
        <p>
          The accumulation engine models your <strong>working years</strong> —
          from your current age to retirement. Each year it computes your
          salary, determines how much you contribute, routes those contributions
          across tax-advantaged accounts (401k, IRA, HSA) and brokerage, applies
          employer matches, and grows all balances by the simulated return for
          that year.
        </p>

        <h4 className="text-secondary mt-4 font-semibold">
          What it computes each year
        </h4>
        <ol className="list-decimal space-y-1.5 pl-5">
          <li>
            <strong>Salary</strong> — grows by your configured salary growth
            rate, capped at the salary ceiling if set. Per-person salaries are
            tracked independently for joint households.
          </li>
          <li>
            <strong>Target contribution</strong> — your contribution rate (e.g.
            25%) applied to gross salary. In year 0, contributions are pro-rated
            to the remaining months in the calendar year.
          </li>
          <li>
            <strong>IRS limit growth</strong> — each account&apos;s IRS
            contribution limit is inflation-adjusted annually. Catch-up
            contributions apply at age 50+, with SECURE 2.0 super catch-up for
            ages 60-63.
          </li>
          <li>
            <strong>Contribution routing</strong> — your target contribution is
            distributed across accounts using one of three routing modes (see
            below). Any overflow that can&apos;t fit in tax-advantaged accounts
            spills to brokerage.
          </li>
          <li>
            <strong>Employer match</strong> — applied per account, grows with
            salary, and is subject to IRS limits. Always goes to the traditional
            (pre-tax) side.
          </li>
          <li>
            <strong>Balance growth</strong> — all account balances grow by the
            year&apos;s simulated return (deterministic or simulation sampled).
          </li>
        </ol>

        <h4 className="text-secondary mt-4 font-semibold">
          Contribution routing modes
        </h4>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong>Waterfall</strong> — fills accounts in a configured priority
            order (e.g. 401k → HSA → IRA → brokerage). Each account fills to its
            IRS or artificial cap before overflow moves to the next. Brokerage
            is always the unlimited catch-all at the end.
          </li>
          <li>
            <strong>Percentage</strong> — splits contributions by fixed
            percentages across accounts (e.g. 60% to 401k, 20% to IRA, 20% to
            brokerage). If a percentage requests more than the IRS limit allows,
            the excess redistributes proportionally to the remaining accounts.
          </li>
          <li>
            <strong>Specs (production default)</strong> — uses per-account
            contribution specs loaded from your database. Each spec defines a
            flat annual amount or a percentage of salary, with its own Roth
            fraction. The engine routes each spec independently and
            redistributes employer match overflow when limits are hit.
          </li>
        </ul>

        <h4 className="text-secondary mt-4 font-semibold">
          Tax splits (Roth vs Traditional)
        </h4>
        <p>
          For accounts that support both Roth and Traditional contributions
          (401k, 403b, IRA), you configure a <strong>Roth fraction</strong> —
          the percentage of employee contributions that go to the Roth side. For
          example, a 0.7 Roth fraction on your 401k means 70% of your 401k
          contributions are Roth and 30% are Traditional. HSA contributions are
          always pre-tax, and brokerage contributions are always after-tax.
        </p>
      </ProseSection>

      <ProseSection title="Defaults">
        <p>
          These are the page-level defaults that apply every year unless a
          change by year sets something else. They are loaded from your saved
          settings in the database.
        </p>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-b text-left">
                <th className="py-1.5 pr-3">Setting</th>
                <th className="py-1.5 pr-3">Type</th>
                <th className="py-1.5">Description</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              <tr>
                <td className="text-label py-1.5 pr-3 font-mono">
                  contributionRate
                </td>
                <td className="pr-3">Decimal</td>
                <td>
                  Fraction of gross salary to save for retirement (e.g. 0.25 =
                  25%) — Portfolio-account savings come on top
                </td>
              </tr>
              <tr>
                <td className="text-label py-1.5 pr-3 font-mono">
                  routingMode
                </td>
                <td className="pr-3">Enum</td>
                <td>
                  &apos;waterfall&apos;, &apos;percentage&apos;, or
                  &apos;bracket_filling&apos;
                </td>
              </tr>
              <tr>
                <td className="text-label py-1.5 pr-3 font-mono">
                  accountOrder
                </td>
                <td className="pr-3">Array</td>
                <td>
                  Priority order for waterfall mode (e.g. [401k, hsa, ira,
                  brokerage])
                </td>
              </tr>
              <tr>
                <td className="text-label py-1.5 pr-3 font-mono">
                  accountSplits
                </td>
                <td className="pr-3">Record</td>
                <td>
                  Per-account percentages for percentage mode (must sum to 1.0)
                </td>
              </tr>
              <tr>
                <td className="text-label py-1.5 pr-3 font-mono">taxSplits</td>
                <td className="pr-3">Record</td>
                <td>
                  Roth fraction per account type (e.g. {"{"}401k: 0.7, ira: 1.0
                  {"}"} = 70% Roth 401k, 100% Roth IRA)
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <h4 className="text-secondary mt-4 font-semibold">
          Additional engine inputs
        </h4>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            <strong>salaryGrowthRate</strong> — annual salary increase rate
            (e.g. 0.03 = 3%)
          </li>
          <li>
            <strong>salaryCap</strong> — maximum salary ceiling (null = no cap)
          </li>
          <li>
            <strong>limitGrowthRate</strong> — annual IRS limit inflation rate
            (used to project future 401k/IRA/HSA limits)
          </li>
          <li>
            <strong>catchupAge</strong> — age at which catch-up contributions
            begin (50 for most accounts)
          </li>
          <li>
            <strong>brokerageRamp</strong> — optional additional annual
            brokerage contribution that increases each year
          </li>
        </ul>
      </ProseSection>

      <ProseSection title="Changes by year (carry forward)">
        <p>
          A change by year sets any accumulation setting starting at a specific
          calendar year. It <strong>carries forward</strong>: once set, a field
          keeps that value until a later change sets it again. Each field is
          independent — changing
          <code className="text-label bg-surface-elevated rounded px-1">
            contributionRate
          </code>{" "}
          in 2030 does not affect your{" "}
          <code className="text-label bg-surface-elevated rounded px-1">
            taxSplits
          </code>{" "}
          from a 2028 change.
        </p>

        <h4 className="text-secondary mt-4 font-semibold">
          Fields you can change
        </h4>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-b text-left">
                <th className="py-1.5 pr-3">Field</th>
                <th className="py-1.5">Effect</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              <tr>
                <td className="text-label py-1.5 pr-3 font-mono">
                  contributionRate
                </td>
                <td>New retirement contribution rate from this year onward</td>
              </tr>
              <tr>
                <td className="text-label py-1.5 pr-3 font-mono">
                  routingMode
                </td>
                <td>Switch routing mode (waterfall ↔ percentage)</td>
              </tr>
              <tr>
                <td className="text-label py-1.5 pr-3 font-mono">
                  accountOrder
                </td>
                <td>New waterfall priority order</td>
              </tr>
              <tr>
                <td className="text-label py-1.5 pr-3 font-mono">
                  accountSplits
                </td>
                <td>New percentage splits (merged with existing)</td>
              </tr>
              <tr>
                <td className="text-label py-1.5 pr-3 font-mono">taxSplits</td>
                <td>New Roth fractions (merged with existing)</td>
              </tr>
              <tr>
                <td className="text-label py-1.5 pr-3 font-mono">
                  accountCaps
                </td>
                <td>
                  Artificial dollar caps below IRS limits per account. Set null
                  to remove a cap.
                </td>
              </tr>
              <tr>
                <td className="text-label py-1.5 pr-3 font-mono">
                  taxTypeCaps
                </td>
                <td>
                  Cross-account caps on total Roth or Traditional contributions
                </td>
              </tr>
              <tr>
                <td className="text-label py-1.5 pr-3 font-mono">reset</td>
                <td>
                  When true, ALL fields revert to page-level defaults from this
                  year onward
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <h4 className="text-secondary mt-4 font-semibold">Example</h4>
        <p className="bg-surface-sunken rounded border p-3 font-mono text-xs leading-relaxed">
          Year 2028: contributionRate → 0.30 (increase savings to 30%)
          <br />
          Year 2030: taxSplits → {"{"}401k: 0.0{"}"} (switch 401k to 100%
          Traditional)
          <br />
          Year 2033: reset → true (revert everything to defaults)
        </p>
        <p className="text-faint mt-1 text-xs">
          In this example, from 2028-2029 you save 30% with original tax splits.
          From 2030-2032, you still save 30% (sticky) but 401k is 100%
          Traditional. From 2033 onward, everything reverts to whatever your
          page-level defaults are.
        </p>
      </ProseSection>

      <ProseSection title="Technical Details">
        <h4 className="text-secondary font-semibold">
          Year 0 special handling
        </h4>
        <p>
          The first projection year is pro-rated based on the current month. If
          your projection starts in March, year 0 contributions are multiplied
          by 10/12 (remaining months). If you have real payroll data, the engine
          uses your actual year-to-date contributions instead of projecting.
        </p>

        <h4 className="text-secondary mt-4 font-semibold">IRS limit growth</h4>
        <p>
          Each account&apos;s IRS limit scales by{" "}
          <code className="text-label bg-surface-elevated rounded px-1">
            (1 + limitGrowthRate)^year
          </code>{" "}
          each year. Catch-up contributions apply at age 50+ for most account
          types. SECURE 2.0 super catch-up (ages 60-63) replaces the regular
          catch-up amount with a higher limit.
        </p>

        <h4 className="text-secondary mt-4 font-semibold">
          Contribution ceiling
        </h4>
        <p>
          The engine derives a retirement contribution rate from your current
          contributions to retirement accounts divided by total compensation —
          savings into Portfolio accounts don&apos;t count and are never scaled.
          For example, if you contribute $81k to retirement accounts on a $280k
          salary, your rate is ~29%. This becomes a ceiling: each projected
          year, retirement contributions cannot exceed{" "}
          <code className="text-label bg-surface-elevated rounded px-1">
            salary × contributionRate
          </code>
          .
        </p>
        <p className="mt-1.5">
          When the sum of all per-account contributions exceeds this ceiling,
          every account is scaled down proportionally to fit. This prevents the
          projection from assuming you&apos;ll save more than you currently do.
          You can change this rate for any future year in the Changes by year
          panel.
        </p>

        <h4 className="text-secondary mt-4 font-semibold">Overflow handling</h4>
        <p>
          When a contribution exceeds an account&apos;s effective limit (the
          lesser of the IRS limit and any artificial cap), the excess overflows
          to the next account in waterfall mode, or redistributes proportionally
          in percentage mode. Brokerage is always the final unlimited overflow
          target — any contribution that can&apos;t fit elsewhere lands here.
          Overflow is retirement money, so it goes to a Retirement brokerage (a
          Portfolio brokerage only when you have none). Portfolio savings — the
          Brokerage page&apos;s contributions, yearly increase and lump sums —
          stay in Portfolio accounts.
        </p>

        <h4 className="text-secondary mt-4 font-semibold">
          Cross-account tax-type caps
        </h4>
        <p>
          Tax-type caps limit total Roth or Traditional contributions across all
          accounts in a year. For example, setting a Roth cap of $15,000 means
          your combined Roth contributions across 401k + IRA can&apos;t exceed
          $15,000 — any excess converts to Traditional within the same account.
          These caps are checked during routing and can be changed for any year.
        </p>

        <h4 className="text-secondary mt-4 font-semibold">
          Employer match tracking
        </h4>
        <p>
          Employer matches are computed per account category, grow
          proportionally with salary, and always go to the Traditional (pre-tax)
          side. Matches are subject to IRS limits — if employee contributions
          plus employer match exceed the total limit, the match is reduced.
          Match amounts are tracked separately from employee contributions for
          accurate reporting.
        </p>
      </ProseSection>
    </div>
  );
}
