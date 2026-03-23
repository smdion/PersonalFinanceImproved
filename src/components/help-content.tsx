"use client";

import { useState } from "react";
import Link from "next/link";
import {
  LayoutDashboard,
  Wallet,
  ClipboardList,
  Receipt,
  TrendingUp,
  Trophy,
  BarChart3,
  Palmtree,
  Home,
  Building2,
  CreditCard,
  PiggyBank,
  ScrollText,
  Wrench,
  Save,
  Settings,
  ChevronRight,
  type LucideIcon,
} from "lucide-react";

/* ── Reusable section shell ── */

function Section({
  title,
  icon: Icon,
  children,
  defaultOpen = false,
}: {
  title: string;
  icon?: LucideIcon;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-default rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-3 px-4 py-3 bg-surface-sunken text-sm font-medium text-secondary hover:bg-surface-elevated transition-colors"
      >
        {Icon && <Icon className="w-4 h-4 shrink-0 text-blue-500" />}
        <span className="flex-1 text-left">{title}</span>
        <ChevronRight
          className={`w-4 h-4 shrink-0 text-faint transition-transform duration-150 ${open ? "rotate-90" : ""}`}
        />
      </button>
      {open && (
        <div className="px-4 py-4 space-y-4 text-sm text-muted leading-relaxed">
          {children}
        </div>
      )}
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="px-1.5 py-0.5 text-xs font-mono bg-surface-sunken border border-default rounded">
      {children}
    </kbd>
  );
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="text-blue-600 hover:text-blue-700 underline">
      {children}
    </Link>
  );
}

/* ── Main content ── */

export function HelpContent() {
  return (
    <div className="space-y-3">
      {/* ── Quick overview ── */}
      <div className="text-sm text-muted space-y-2 pb-2">
        <p>
          Ledgr is a self-hosted personal finance dashboard. It brings together
          your income, budgets, investments, savings, and retirement
          planning into one place so you can see your full financial picture and
          run what-if scenarios without sharing data with third parties.
        </p>
        <p>
          Click any section below to learn how that part of the app works.
        </p>
      </div>

      {/* ── Getting started ── */}
      <Section title="Getting Started" defaultOpen>
        <p>
          When you first log in, the <strong>Onboarding Wizard</strong> walks
          you through the essential setup steps:
        </p>
        <ol className="list-decimal list-inside space-y-1 ml-2">
          <li>
            <strong>Add people</strong> &mdash; Create household members in{" "}
            <NavLink href="/settings">Settings &gt; People</NavLink>. Each
            person gets their own paycheck, tax bracket, and contribution
            limits.
          </li>
          <li>
            <strong>Set IRS limits</strong> &mdash; Review the current-year
            401(k), HSA, and IRA limits under{" "}
            <NavLink href="/settings">Settings &gt; IRS Limits</NavLink>. These
            are pre-populated but can be adjusted.
          </li>
          <li>
            <strong>Configure a paycheck</strong> &mdash; Head to the{" "}
            <NavLink href="/paycheck">Paycheck</NavLink> page to enter gross
            salary, deductions, and contribution elections. This drives numbers
            across the rest of the app.
          </li>
          <li>
            <strong>Connect a budget API</strong> (optional) &mdash; If you use
            YNAB or Actual Budget, link them in{" "}
            <NavLink href="/settings">Settings &gt; Integrations</NavLink> to
            automatically sync budget categories and balances.
          </li>
        </ol>
        <p>
          Once these basics are in place, the Dashboard will populate with
          meaningful cards. You can always refine things later &mdash; every page
          works independently.
        </p>
      </Section>

      {/* ── Navigation ── */}
      <Section title="Navigation & Layout">
        <p>
          The app is organized into a <strong>sidebar</strong> on the left with
          five groups: <em>Cash Flow</em>, <em>Wealth</em>, <em>Net Worth</em>,{" "}
          <em>Analysis</em>, and <em>System</em>, plus the Dashboard at the top
          and Help at the bottom.
        </p>
        <ul className="list-disc list-inside space-y-1 ml-2">
          <li>
            <strong>Collapse the sidebar</strong> &mdash; Click the{" "}
            <Kbd>Collapse</Kbd> button at the bottom of the sidebar to switch to
            icon-only mode. Click again to expand.
          </li>
          <li>
            <strong>Mobile</strong> &mdash; On smaller screens, tap the hamburger
            menu to open the sidebar as an overlay.
          </li>
          <li>
            <strong>Theme</strong> &mdash; Toggle dark/light mode from the
            sidebar footer. Your preference is saved in the browser.
          </li>
          <li>
            <strong>Data freshness</strong> &mdash; The sidebar shows when data
            was last refreshed from your budget API (if connected).
          </li>
        </ul>
      </Section>

      {/* ── Dashboard ── */}
      <Section title="Dashboard" icon={LayoutDashboard}>
        <p>
          The <NavLink href="/">Dashboard</NavLink> is your at-a-glance
          overview. It shows up to 13 cards covering the key metrics from every
          area of the app:
        </p>
        <ul className="list-disc list-inside space-y-1 ml-2">
          <li><strong>Net Worth</strong> &mdash; Current total net worth.</li>
          <li><strong>Household Income</strong> &mdash; Combined monthly/annual income.</li>
          <li><strong>Financial Checkup</strong> &mdash; Health score across key metrics.</li>
          <li><strong>Savings Goals</strong> &mdash; Progress toward your sinking funds.</li>
          <li><strong>Retirement Status</strong> &mdash; Projection summary.</li>
          <li><strong>Contributions</strong> &mdash; 401(k), HSA, and IRA funding status.</li>
          <li><strong>Fidelity &amp; Dollar Multipliers</strong> &mdash; Financial independence benchmarks.</li>
          <li><strong>Living Costs</strong> &mdash; Monthly expense total.</li>
          <li><strong>Mortgage Status</strong> &mdash; Remaining balance and progress.</li>
          <li><strong>Savings Rate</strong> &mdash; Percentage of income saved.</li>
          <li><strong>Budget Status</strong> &mdash; Spending versus target.</li>
          <li><strong>Tax Summary</strong> &mdash; Effective tax rate breakdown.</li>
        </ul>
        <p>
          Each card links to its full page for deeper detail. If a card shows an
          error, it won&rsquo;t affect the others &mdash; each card is
          independently error-isolated.
        </p>
      </Section>

      {/* ━━ CASH FLOW ━━ */}
      <h3 className="text-xs font-semibold uppercase tracking-wider text-faint pt-2">Cash Flow</h3>

      {/* ── Paycheck ── */}
      <Section title="Paycheck" icon={Wallet}>
        <p>
          The <NavLink href="/paycheck">Paycheck</NavLink> page is a
          gross-to-net calculator. It computes federal and state taxes, FICA
          (Social Security &amp; Medicare), and all your deductions to show your
          actual take-home pay.
        </p>
        <h4 className="font-semibold text-secondary">Key features</h4>
        <ul className="list-disc list-inside space-y-1 ml-2">
          <li>
            <strong>Pay schedule</strong> &mdash; Set weekly, biweekly,
            semi-monthly, or monthly pay periods. The app computes per-period
            and annual totals.
          </li>
          <li>
            <strong>Contribution elections</strong> &mdash; Enter 401(k), HSA,
            Traditional/Roth IRA percentages or dollar amounts. The app tracks
            these against IRS annual limits and flags when you&rsquo;ll hit the
            cap.
          </li>
          <li>
            <strong>Deductions</strong> &mdash; Add health insurance, FSA, and
            other pre/post-tax deductions.
          </li>
          <li>
            <strong>Multi-person</strong> &mdash; Compare paychecks
            side-by-side for each household member.
          </li>
          <li>
            <strong>Contribution profiles</strong> &mdash; Save named sets of
            contribution elections (e.g. &ldquo;Max Out Everything&rdquo; vs
            &ldquo;Minimum Match&rdquo;) and switch between them instantly.
          </li>
          <li>
            <strong>Scenario mode</strong> &mdash; Toggle into what-if mode to
            test salary or contribution changes without affecting your real data.
          </li>
        </ul>
      </Section>

      {/* ── Budget ── */}
      <Section title="Budget" icon={ClipboardList}>
        <p>
          The <NavLink href="/budget">Budget</NavLink> page is a multi-column
          budgeting workspace. Each column can represent a different time period
          or scenario.
        </p>
        <h4 className="font-semibold text-secondary">Key features</h4>
        <ul className="list-disc list-inside space-y-1 ml-2">
          <li>
            <strong>Category-based</strong> &mdash; Organize line items into
            categories (housing, food, transport, etc.). Add, edit, or remove
            categories and items as needed.
          </li>
          <li>
            <strong>API sync</strong> &mdash; If you&rsquo;ve connected YNAB or
            Actual Budget in Settings, your budget categories and actual
            spending are pulled in automatically.
          </li>
          <li>
            <strong>Budget vs. actuals</strong> &mdash; See real-time
            comparisons of what you planned versus what you spent.
          </li>
          <li>
            <strong>Sinking funds</strong> &mdash; Allocate money toward future
            expenses (e.g. car insurance, vacation) and track accumulation.
          </li>
          <li>
            <strong>Push preview</strong> &mdash; Before committing changes, a
            modal shows the impact of your edits across the app.
          </li>
          <li>
            <strong>Salary overrides</strong> &mdash; Temporarily change the
            income assumption to see how a raise or job change would affect your
            budget.
          </li>
        </ul>
      </Section>

      {/* ── Expenses ── */}
      <Section title="Expenses" icon={Receipt}>
        <p>
          The <NavLink href="/expenses">Expenses</NavLink> page visualizes
          where your money goes.
        </p>
        <ul className="list-disc list-inside space-y-1 ml-2">
          <li>
            <strong>Bar chart</strong> &mdash; Spending broken down by category.
          </li>
          <li>
            <strong>Pie chart</strong> &mdash; Essential vs. discretionary
            split.
          </li>
          <li>
            <strong>Budget comparison</strong> &mdash; Each category shows
            spending relative to its budget.
          </li>
          <li>
            <strong>Account balances</strong> &mdash; If connected to a budget
            API, shows live account balances for comparison.
          </li>
        </ul>
      </Section>

      {/* ━━ WEALTH ━━ */}
      <h3 className="text-xs font-semibold uppercase tracking-wider text-faint pt-2">Wealth</h3>

      {/* ── Savings ── */}
      <Section title="Savings" icon={PiggyBank}>
        <p>
          The <NavLink href="/savings">Savings</NavLink> page manages your
          savings goals and sinking funds.
        </p>
        <h4 className="font-semibold text-secondary">Key features</h4>
        <ul className="list-disc list-inside space-y-1 ml-2">
          <li>
            <strong>Sinking funds</strong> &mdash; Create named funds for
            specific goals (vacation, car repair, new laptop, etc.) with target
            amounts and deadlines.
          </li>
          <li>
            <strong>Emergency fund</strong> &mdash; A special fund with tiered
            goals (e.g. 1 month, 3 months, 6 months of expenses).
          </li>
          <li>
            <strong>Allocation editor</strong> &mdash; Distribute your monthly
            savings contributions across funds by percentage or dollar amount.
          </li>
          <li>
            <strong>Transfers</strong> &mdash; Move money between funds when
            priorities change.
          </li>
          <li>
            <strong>Goal projection</strong> &mdash; Charts showing when
            you&rsquo;ll reach each target at your current savings rate.
          </li>
          <li>
            <strong>Budget capacity bar</strong> &mdash; Shows how much of your
            budget is available for saving after fixed expenses.
          </li>
          <li>
            <strong>Brokerage goals</strong> &mdash; Track non-cash savings
            goals held in brokerage accounts.
          </li>
          <li>
            <strong>Reimbursement tracking</strong> &mdash; Track HSA or other
            reimbursable expenses.
          </li>
          <li>
            <strong>API sync</strong> &mdash; Sync fund balances from your
            connected budget app.
          </li>
        </ul>
      </Section>

      {/* ── Portfolio ── */}
      <Section title="Portfolio" icon={TrendingUp}>
        <p>
          The <NavLink href="/portfolio">Portfolio</NavLink> page is your
          investment account hub.
        </p>
        <ul className="list-disc list-inside space-y-1 ml-2">
          <li>
            <strong>Tax-location grouping</strong> &mdash; Accounts are grouped
            by type: Pre-tax (401k, Traditional IRA), Tax-free (Roth),
            HSA, and After-tax (brokerage).
          </li>
          <li>
            <strong>Account details</strong> &mdash; Each account shows the
            institution, owner, current balance, and account type.
          </li>
          <li>
            <strong>Performance linking</strong> &mdash; Link accounts to the
            Performance page for return tracking.
          </li>
          <li>
            <strong>Contribution linking</strong> &mdash; Tie accounts to
            paycheck contributions so deposits are tracked automatically.
          </li>
          <li>
            <strong>Portfolio chart</strong> &mdash; Visualize your allocation
            across all investment accounts.
          </li>
        </ul>
      </Section>

      {/* ── Performance ── */}
      <Section title="Performance" icon={Trophy}>
        <p>
          The <NavLink href="/performance">Performance</NavLink> page tracks
          investment returns over time.
        </p>
        <ul className="list-disc list-inside space-y-1 ml-2">
          <li>
            <strong>Lifetime summary</strong> &mdash; Total gains, CAGR
            (Compound Annual Growth Rate), and overall return metrics.
          </li>
          <li>
            <strong>Year-by-year table</strong> &mdash; Each row shows a
            year&rsquo;s starting balance, contributions, gains, and ending
            balance. Cells are editable for manual corrections.
          </li>
          <li>
            <strong>Category tabs</strong> &mdash; Switch between portfolio-wide
            and brokerage-specific views.
          </li>
          <li>
            <strong>Year finalization</strong> &mdash; Mark a year as finalized
            to lock in the numbers and prevent accidental edits.
          </li>
        </ul>
      </Section>

      {/* ── Brokerage ── */}
      <Section title="Brokerage" icon={BarChart3}>
        <p>
          The <NavLink href="/brokerage">Brokerage</NavLink> page projects the
          growth of your non-retirement (after-tax) investment accounts.
        </p>
        <ul className="list-disc list-inside space-y-1 ml-2">
          <li>
            <strong>Goals</strong> &mdash; Set savings targets for your
            brokerage accounts and track progress.
          </li>
          <li>
            <strong>Planned transactions</strong> &mdash; Schedule future
            deposits or withdrawals.
          </li>
          <li>
            <strong>Large purchase planning</strong> &mdash; Model the impact of
            a major purchase on your brokerage balance over time.
          </li>
          <li>
            <strong>Contribution profiles</strong> &mdash; Uses your paycheck
            contribution profiles to project future growth.
          </li>
        </ul>
      </Section>

      {/* ━━ NET WORTH ━━ */}
      <h3 className="text-xs font-semibold uppercase tracking-wider text-faint pt-2">Net Worth</h3>

      {/* ── House ── */}
      <Section title="House" icon={Home}>
        <p>
          The <NavLink href="/house">House</NavLink> page tracks your primary
          residence.
        </p>
        <ul className="list-disc list-inside space-y-1 ml-2">
          <li>
            <strong>Home value</strong> &mdash; Current estimated value,
            optionally synced from your budget API.
          </li>
          <li>
            <strong>Home improvements</strong> &mdash; Log renovations and
            upgrades with year and cost. These factor into your asset
            calculations.
          </li>
          <li>
            <strong>Property taxes</strong> &mdash; Track assessed values and
            tax amounts year over year.
          </li>
        </ul>
      </Section>

      {/* ── Assets ── */}
      <Section title="Assets" icon={Building2}>
        <p>
          The <NavLink href="/assets">Assets</NavLink> page tracks the value of
          everything you own outside of investment accounts.
        </p>
        <ul className="list-disc list-inside space-y-1 ml-2">
          <li>
            <strong>Real estate</strong> &mdash; Primary home value (linked from
            House page).
          </li>
          <li>
            <strong>Vehicles</strong> &mdash; Track car and vehicle valuations.
          </li>
          <li>
            <strong>Other assets</strong> &mdash; Collectibles, jewelry, or
            anything else with monetary value.
          </li>
          <li>
            <strong>Inline editing</strong> &mdash; Click any value to update it
            directly.
          </li>
          <li>
            <strong>Sync badges</strong> &mdash; Items synced from your budget
            API are marked so you know which are automatic vs. manual.
          </li>
        </ul>
      </Section>

      {/* ── Liabilities ── */}
      <Section title="Liabilities" icon={CreditCard}>
        <p>
          The <NavLink href="/liabilities">Liabilities</NavLink> page tracks all
          your debts and loans.
        </p>
        <h4 className="font-semibold text-secondary">Key features</h4>
        <ul className="list-disc list-inside space-y-1 ml-2">
          <li>
            <strong>Active loans</strong> &mdash; Cards showing each loan with
            balance, interest rate, and monthly payment.
          </li>
          <li>
            <strong>Amortization table</strong> &mdash; Full month-by-month
            breakdown of principal vs. interest for any loan.
          </li>
          <li>
            <strong>Refinance calculator</strong> &mdash; Compare your current
            loan terms against a new rate and term. See break-even point,
            monthly savings, and total interest saved.
          </li>
          <li>
            <strong>What-if section</strong> &mdash; Model different payoff
            scenarios &mdash; extra payments, lump sums, or accelerated
            schedules.
          </li>
          <li>
            <strong>Refinance history</strong> &mdash; Track past refinances for
            reference.
          </li>
          <li>
            <strong>Historical loans</strong> &mdash; Loans you&rsquo;ve paid
            off are preserved for historical tracking.
          </li>
        </ul>
      </Section>

      {/* ── Trends ── */}
      <Section title="Trends" icon={TrendingUp}>
        <p>
          The <NavLink href="/networth">Trends</NavLink> page visualizes your
          net worth over time &mdash; the big-picture view of your financial
          journey.
        </p>
        <h4 className="font-semibold text-secondary">Visualizations</h4>
        <ul className="list-disc list-inside space-y-1 ml-2">
          <li>
            <strong>Net worth line chart</strong> &mdash; Your net worth trend
            over time.
          </li>
          <li>
            <strong>Journey to Abundance</strong> &mdash; A milestone chart
            showing progress through financial stages.
          </li>
          <li>
            <strong>Location pie chart</strong> &mdash; Where your money lives
            (brokerage, retirement, property, cash, etc.).
          </li>
          <li>
            <strong>Tax location pie chart</strong> &mdash; Pre-tax vs. tax-free
            vs. after-tax breakdown.
          </li>
          <li>
            <strong>Composition</strong> &mdash; Assets minus liabilities
            breakdown.
          </li>
          <li>
            <strong>Year-over-year table</strong> &mdash; Compare net worth
            across years to see growth trends.
          </li>
          <li>
            <strong>Financial Independence card</strong> &mdash; Tracks progress
            toward your FI number.
          </li>
        </ul>
        <p>
          You can toggle between <strong>market value</strong> and{" "}
          <strong>cost basis</strong> to see your net worth with or without
          unrealized gains.
        </p>
      </Section>

      {/* ━━ ANALYSIS ━━ */}
      <h3 className="text-xs font-semibold uppercase tracking-wider text-faint pt-2">Analysis</h3>

      {/* ── Retirement ── */}
      <Section title="Retirement" icon={Palmtree}>
        <p>
          The <NavLink href="/retirement">Retirement</NavLink> page is a
          full-featured retirement planner powered by Monte Carlo simulation.
        </p>
        <h4 className="font-semibold text-secondary">Key concepts</h4>
        <ul className="list-disc list-inside space-y-1 ml-2">
          <li>
            <strong>Accumulation phase</strong> &mdash; The years where
            you&rsquo;re saving and investing. The projection models portfolio
            growth using randomized returns calibrated to historical data.{" "}
            <NavLink href="/retirement/accumulation-methodology">
              Read the methodology
            </NavLink>.
          </li>
          <li>
            <strong>Decumulation phase</strong> &mdash; The withdrawal years
            after you retire. The engine models different withdrawal strategies
            (e.g. 4% rule, guardrails) across thousands of scenarios.{" "}
            <NavLink href="/retirement/decumulation-methodology">
              Read the methodology
            </NavLink>.
          </li>
          <li>
            <strong>Success rate</strong> &mdash; The percentage of simulated
            scenarios where your money lasted through retirement.
          </li>
          <li>
            <strong>Fan chart</strong> &mdash; A visual showing the range of
            possible portfolio trajectories (best case, median, worst case).
          </li>
          <li>
            <strong>Withdrawal comparison</strong> &mdash; Compare different
            withdrawal rates side-by-side to find the right balance.
          </li>
          <li>
            <strong>Expense overrides</strong> &mdash; Adjust expected
            retirement expenses to see how lifestyle changes affect outcomes.
          </li>
          <li>
            <strong>Budget profiles</strong> &mdash; Use different budget
            scenarios for retirement spending assumptions.
          </li>
        </ul>
      </Section>

      {/* ── Historical ── */}
      <Section title="Historical" icon={ScrollText}>
        <p>
          The <NavLink href="/historical">Historical</NavLink> page is a
          year-over-year ledger of your financial history.
        </p>
        <ul className="list-disc list-inside space-y-1 ml-2">
          <li>
            <strong>Column groups</strong> &mdash; Toggle visibility of data
            categories: Net Worth, Performance, Portfolio, Assets, Liabilities,
            Income, and Tax.
          </li>
          <li>
            <strong>Editable cells</strong> &mdash; Correct historical income,
            tax rates, or other values by clicking directly in the table.
          </li>
          <li>
            <strong>Job history</strong> &mdash; Track employment changes and
            their income impact.
          </li>
          <li>
            <strong>Notes</strong> &mdash; Add context to any year (e.g.
            &ldquo;bought house&rdquo; or &ldquo;changed jobs&rdquo;).
          </li>
        </ul>
      </Section>

      {/* ── Tools ── */}
      <Section title="Tools" icon={Wrench}>
        <p>
          The <NavLink href="/tools">Tools</NavLink> page is your what-if
          sandbox.
        </p>
        <h4 className="font-semibold text-secondary">Available tools</h4>
        <ul className="list-disc list-inside space-y-1 ml-2">
          <li>
            <strong>Relocation scenario</strong> &mdash; Compare two locations
            side-by-side. Model differences in cost of living, taxes, housing,
            and more. Run year-by-year projections to see the long-term
            financial impact.
          </li>
          <li>
            <strong>Large purchase planner</strong> &mdash; Model a major
            purchase (house, car, renovation). Enter the price, down payment,
            financing terms, and ongoing costs to see how it affects your
            overall financial plan.
          </li>
          <li>
            <strong>Sale proceeds</strong> &mdash; Calculate net proceeds from
            selling an asset after fees, taxes, and payoff amounts.
          </li>
        </ul>
      </Section>

      {/* ━━ SYSTEM ━━ */}
      <h3 className="text-xs font-semibold uppercase tracking-wider text-faint pt-2">System</h3>

      {/* ── Versions ── */}
      <Section title="Versions" icon={Save}>
        <p>
          The <NavLink href="/versions">Versions</NavLink> page manages database
          snapshots &mdash; your safety net.
        </p>
        <ul className="list-disc list-inside space-y-1 ml-2">
          <li>
            <strong>Create snapshot</strong> &mdash; Save the current state of
            your data with a name and description. Useful before making
            significant changes.
          </li>
          <li>
            <strong>Restore</strong> &mdash; Roll back to any previous snapshot.
            A confirmation dialog prevents accidental restores.
          </li>
          <li>
            <strong>Auto-backup</strong> &mdash; The app automatically creates
            snapshots on startup.
          </li>
          <li>
            <strong>Retention policy</strong> &mdash; Configure how long old
            snapshots are kept before automatic cleanup.
          </li>
          <li>
            <strong>Preview</strong> &mdash; Inspect the contents of a snapshot
            before restoring.
          </li>
        </ul>
      </Section>

      {/* ── Settings ── */}
      <Section title="Settings" icon={Settings}>
        <p>
          The <NavLink href="/settings">Settings</NavLink> page is where you
          configure the app. It has multiple tabs:
        </p>
        <h4 className="font-semibold text-secondary">Tabs</h4>
        <ul className="list-disc list-inside space-y-1 ml-2">
          <li>
            <strong>General</strong> &mdash; App-wide preferences, thresholds,
            and display settings. Import/export data.
          </li>
          <li>
            <strong>People</strong> &mdash; Add household members with birth
            dates and W-4 filing status. The W-4 status drives paycheck withholding;
            retirement projections have their own filing status override in the
            Taxes in Retirement section.
          </li>
          <li>
            <strong>IRS Limits</strong> &mdash; Review and adjust annual
            contribution limits for 401(k), HSA, and IRA. Pre-populated with
            current-year values.
          </li>
          <li>
            <strong>Tax Brackets</strong> &mdash; View and edit federal/state
            tax brackets by filing status.
          </li>
          <li>
            <strong>Return Rates</strong> &mdash; Set expected market return
            assumptions used in projections.
          </li>
          <li>
            <strong>Integrations</strong> &mdash; Connect YNAB or Actual Budget.
            Enter your API token or server URL, test the connection, and sync.
          </li>
        </ul>
        <h4 className="font-semibold text-secondary">Admin-only tabs</h4>
        <ul className="list-disc list-inside space-y-1 ml-2">
          <li>
            <strong>Auth</strong> &mdash; Manage user roles and permissions.
          </li>
          <li>
            <strong>RBAC</strong> &mdash; Configure permission groups and
            feature flags.
          </li>
          <li>
            <strong>Debug</strong> &mdash; View diagnostic information and logs.
          </li>
          <li>
            <strong>API</strong> &mdash; Browse the tRPC API endpoint reference.
          </li>
        </ul>
      </Section>

      {/* ── Cross-cutting features ── */}
      <h3 className="text-xs font-semibold uppercase tracking-wider text-faint pt-2">Features</h3>

      <Section title="Scenarios & What-If Mode">
        <p>
          Several pages support <strong>scenario mode</strong> (also called
          what-if mode). When activated, you can make temporary changes to see
          their impact without affecting your real data.
        </p>
        <ul className="list-disc list-inside space-y-1 ml-2">
          <li>
            <strong>Salary overrides</strong> &mdash; Temporarily change the
            income used in calculations. Available on Paycheck, Budget, and
            Brokerage pages.
          </li>
          <li>
            <strong>Contribution profiles</strong> &mdash; Switch between saved
            profiles to model different contribution strategies.
          </li>
          <li>
            <strong>Scenario indicator</strong> &mdash; A visual badge appears
            whenever you&rsquo;re viewing data under a what-if scenario so you
            always know what&rsquo;s real vs. hypothetical.
          </li>
          <li>
            <strong>Push preview</strong> &mdash; On the Budget page, see a
            detailed preview of how your scenario changes would flow through to
            other pages before committing them.
          </li>
        </ul>
      </Section>

      <Section title="Contribution Profiles">
        <p>
          Contribution profiles are reusable sets of paycheck contribution
          elections. They let you quickly switch between different savings
          strategies.
        </p>
        <ul className="list-disc list-inside space-y-1 ml-2">
          <li>
            <strong>Create profiles</strong> on the Paycheck page &mdash; name
            them descriptively (e.g. &ldquo;Max Retirement&rdquo;,
            &ldquo;House Down Payment&rdquo;).
          </li>
          <li>
            <strong>Switch profiles</strong> to instantly recalculate
            take-home pay, budget capacity, and savings projections.
          </li>
          <li>
            Profiles are used across Budget, Brokerage, Savings, and
            Retirement pages for consistent projections.
          </li>
        </ul>
      </Section>

      <Section title="Budget API Integration (YNAB / Actual Budget)">
        <p>
          Ledgr can optionally sync with{" "}
          <strong>YNAB</strong> (You Need A Budget) or{" "}
          <strong>Actual Budget</strong> to pull in real spending data.
        </p>
        <ul className="list-disc list-inside space-y-1 ml-2">
          <li>
            <strong>Setup</strong> &mdash; Go to{" "}
            <NavLink href="/settings">Settings &gt; Integrations</NavLink>.
            For YNAB, enter your personal access token. For Actual Budget,
            enter your server URL and password.
          </li>
          <li>
            <strong>What syncs</strong> &mdash; Budget categories, category
            balances, account balances, and transaction summaries.
          </li>
          <li>
            <strong>Data freshness</strong> &mdash; The sidebar shows the last
            sync time. Data is refreshed automatically on page load.
          </li>
          <li>
            <strong>No API? No problem</strong> &mdash; Every feature works
            without a budget API. You can enter all data manually.
          </li>
        </ul>
      </Section>

      <Section title="Demo Mode">
        <p>
          Demo mode lets you explore Ledgr with sample data without needing to
          set up your own financial information.
        </p>
        <ul className="list-disc list-inside space-y-1 ml-2">
          <li>
            <strong>Profiles</strong> &mdash; Choose from several pre-built
            financial scenarios (early retirement, single income, debt payoff,
            dual income family).
          </li>
          <li>
            <strong>Read-only</strong> &mdash; Demo mode data cannot be
            modified, so feel free to explore without worrying about breaking
            anything.
          </li>
          <li>
            <strong>Switch profiles</strong> &mdash; Use the sidebar&rsquo;s
            &ldquo;Switch Profile&rdquo; button to try different scenarios.
          </li>
        </ul>
      </Section>

      {/* ── Tips ── */}
      <Section title="Tips & Shortcuts">
        <ul className="list-disc list-inside space-y-2 ml-2">
          <li>
            <strong>Inline editing</strong> &mdash; On many pages, you can click
            a value to edit it directly without opening a form.
          </li>
          <li>
            <strong>Help tips</strong> &mdash; Look for small{" "}
            <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-surface-sunken border border-default text-[10px] font-bold text-faint">?</span>{" "}
            icons throughout the app. Hover over them for contextual
            explanations.
          </li>
          <li>
            <strong>Collapsible cards</strong> &mdash; Many cards can be
            collapsed by clicking their title to reduce clutter on busy pages.
          </li>
          <li>
            <strong>Error isolation</strong> &mdash; If one card or section
            fails to load, the rest of the page still works. Refresh the page
            or check Settings if something looks wrong.
          </li>
          <li>
            <strong>Snapshots before big changes</strong> &mdash; Visit{" "}
            <NavLink href="/versions">Versions</NavLink> and create a snapshot
            before making significant data changes. You can always restore if
            something goes wrong.
          </li>
          <li>
            <strong>Keyboard navigation</strong> &mdash; The app includes a
            &ldquo;Skip to content&rdquo; link for accessibility. Collapsible
            sections support <Kbd>Enter</Kbd> and <Kbd>Space</Kbd> keys.
          </li>
        </ul>
      </Section>
    </div>
  );
}
