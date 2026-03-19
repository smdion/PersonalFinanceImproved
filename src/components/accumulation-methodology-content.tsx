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

export function AccumulationMethodologyContent() {
  return (
    <div className="space-y-6">
      <p className="text-sm text-muted">
        How the accumulation engine routes contributions across accounts, grows
        balances, and handles year-over-year overrides during working years.
      </p>

      <Section title="How It Works">
        <p>
          The accumulation engine models your <strong>working years</strong> —
          from your current age to retirement. Each year it computes your
          salary, determines how much you contribute, routes those contributions
          across tax-advantaged accounts (401k, IRA, HSA) and brokerage, applies
          employer matches, and grows all balances by the simulated return for
          that year.
        </p>

        <h4 className="font-semibold text-secondary mt-4">
          What it computes each year
        </h4>
        <ol className="list-decimal pl-5 space-y-1.5">
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
            year&apos;s simulated return (deterministic or Monte Carlo sampled).
          </li>
        </ol>

        <h4 className="font-semibold text-secondary mt-4">
          Contribution routing modes
        </h4>
        <ul className="list-disc pl-5 space-y-2">
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

        <h4 className="font-semibold text-secondary mt-4">
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
      </Section>

      <Section title="Defaults" defaultOpen={false}>
        <p>
          These are the page-level defaults that apply every year unless
          overridden. They are loaded from your saved settings in the database.
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
                <td className="py-1.5 pr-3 font-mono text-[11px]">
                  contributionRate
                </td>
                <td className="pr-3">Decimal</td>
                <td>Fraction of gross salary to save (e.g. 0.25 = 25%)</td>
              </tr>
              <tr>
                <td className="py-1.5 pr-3 font-mono text-[11px]">
                  routingMode
                </td>
                <td className="pr-3">Enum</td>
                <td>
                  &apos;waterfall&apos;, &apos;percentage&apos;, or
                  &apos;bracket_filling&apos;
                </td>
              </tr>
              <tr>
                <td className="py-1.5 pr-3 font-mono text-[11px]">
                  accountOrder
                </td>
                <td className="pr-3">Array</td>
                <td>
                  Priority order for waterfall mode (e.g. [401k, hsa, ira,
                  brokerage])
                </td>
              </tr>
              <tr>
                <td className="py-1.5 pr-3 font-mono text-[11px]">
                  accountSplits
                </td>
                <td className="pr-3">Record</td>
                <td>
                  Per-account percentages for percentage mode (must sum to 1.0)
                </td>
              </tr>
              <tr>
                <td className="py-1.5 pr-3 font-mono text-[11px]">taxSplits</td>
                <td className="pr-3">Record</td>
                <td>
                  Roth fraction per account type (e.g. {"{"}401k: 0.7, ira: 1.0
                  {"}"} = 70% Roth 401k, 100% Roth IRA)
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <h4 className="font-semibold text-secondary mt-4">
          Additional engine inputs
        </h4>
        <ul className="list-disc pl-5 space-y-1.5">
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
      </Section>

      <Section title="Overrides (Sticky-Forward)" defaultOpen={false}>
        <p>
          Overrides let you change any accumulation setting starting at a
          specific calendar year. They use <strong>sticky-forward</strong>{" "}
          semantics: once set, a field stays at the overridden value until a
          later override changes it again. Each field is independent —
          overriding
          <code className="text-[11px] bg-surface-elevated px-1 rounded">
            contributionRate
          </code>{" "}
          in 2030 does not affect your{" "}
          <code className="text-[11px] bg-surface-elevated px-1 rounded">
            taxSplits
          </code>{" "}
          from a 2028 override.
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
                <td className="py-1.5 pr-3 font-mono text-[11px]">
                  contributionRate
                </td>
                <td>New contribution rate from this year onward</td>
              </tr>
              <tr>
                <td className="py-1.5 pr-3 font-mono text-[11px]">
                  routingMode
                </td>
                <td>Switch routing mode (waterfall ↔ percentage)</td>
              </tr>
              <tr>
                <td className="py-1.5 pr-3 font-mono text-[11px]">
                  accountOrder
                </td>
                <td>New waterfall priority order</td>
              </tr>
              <tr>
                <td className="py-1.5 pr-3 font-mono text-[11px]">
                  accountSplits
                </td>
                <td>New percentage splits (merged with existing)</td>
              </tr>
              <tr>
                <td className="py-1.5 pr-3 font-mono text-[11px]">taxSplits</td>
                <td>New Roth fractions (merged with existing)</td>
              </tr>
              <tr>
                <td className="py-1.5 pr-3 font-mono text-[11px]">
                  accountCaps
                </td>
                <td>
                  Artificial dollar caps below IRS limits per account. Set null
                  to remove a cap.
                </td>
              </tr>
              <tr>
                <td className="py-1.5 pr-3 font-mono text-[11px]">
                  taxTypeCaps
                </td>
                <td>
                  Cross-account caps on total Roth or Traditional contributions
                </td>
              </tr>
              <tr>
                <td className="py-1.5 pr-3 font-mono text-[11px]">reset</td>
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
          Year 2028: contributionRate → 0.30 (increase savings to 30%)
          <br />
          Year 2030: taxSplits → {"{"}401k: 0.0{"}"} (switch 401k to 100%
          Traditional)
          <br />
          Year 2033: reset → true (revert everything to defaults)
        </p>
        <p className="text-xs text-faint mt-1">
          In this example, from 2028-2029 you save 30% with original tax splits.
          From 2030-2032, you still save 30% (sticky) but 401k is 100%
          Traditional. From 2033 onward, everything reverts to whatever your
          page-level defaults are.
        </p>
      </Section>

      <Section title="Technical Details" defaultOpen={false}>
        <h4 className="font-semibold text-secondary">
          Year 0 special handling
        </h4>
        <p>
          The first projection year is pro-rated based on the current month. If
          your projection starts in March, year 0 contributions are multiplied
          by 10/12 (remaining months). If you have real payroll data, the engine
          uses your actual year-to-date contributions instead of projecting.
        </p>

        <h4 className="font-semibold text-secondary mt-4">IRS limit growth</h4>
        <p>
          Each account&apos;s IRS limit scales by{" "}
          <code className="text-[11px] bg-surface-elevated px-1 rounded">
            (1 + limitGrowthRate)^year
          </code>{" "}
          each year. Catch-up contributions apply at age 50+ for most account
          types. SECURE 2.0 super catch-up (ages 60-63) replaces the regular
          catch-up amount with a higher limit.
        </p>

        <h4 className="font-semibold text-secondary mt-4">
          Contribution ceiling
        </h4>
        <p>
          The engine enforces a ceiling of{" "}
          <code className="text-[11px] bg-surface-elevated px-1 rounded">
            salary × contributionRate
          </code>
          . If per-account specs sum to more than this ceiling, contributions
          are capped and a warning is emitted. This prevents specs from
          over-allocating relative to your stated savings goal.
        </p>

        <h4 className="font-semibold text-secondary mt-4">Overflow handling</h4>
        <p>
          When a contribution exceeds an account&apos;s effective limit (the
          lesser of the IRS limit and any artificial cap), the excess overflows
          to the next account in waterfall mode, or redistributes proportionally
          in percentage mode. Brokerage is always the final unlimited overflow
          target — any contribution that can&apos;t fit elsewhere lands here.
        </p>

        <h4 className="font-semibold text-secondary mt-4">
          Cross-account tax-type caps
        </h4>
        <p>
          Tax-type caps limit total Roth or Traditional contributions across all
          accounts in a year. For example, setting a Roth cap of $15,000 means
          your combined Roth contributions across 401k + IRA can&apos;t exceed
          $15,000 — any excess converts to Traditional within the same account.
          These caps are checked during routing and can be overridden per-year.
        </p>

        <h4 className="font-semibold text-secondary mt-4">
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
      </Section>
    </div>
  );
}
