# Ledgr Glossary

> **Audience:** non-finance engineers + new contributors. Helpful when
> reading the calculator code or running the app.

Personal finance has a lot of acronyms. This glossary defines the ones
that show up in the codebase + UI. For canonical definitions, follow
the linked IRS / SSA / CMS publications.

## Ledgr terms

| Term                              | Meaning                                                                                                                                                                                |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Profile**                       | A complete, named set of one kind of assumption: Salary, Contribution, Budget or Retirement. Only the **active** profile of each kind counts; there is no default or baseline profile. |
| **Plan**                          | A saved set of profiles, one of each kind. Applying it makes them the active ones.                                                                                                     |
| **What-If**                       | The Profiles page's sandbox; it never changes the active profiles.                                                                                                                     |
| **Retirement vs Portfolio money** | Every account has a parent category. Retirement accounts fund retirement; Portfolio accounts (savings outside the retirement plan) never do — retirement answers ignore them.          |
| **Baseline vs Simulation**        | Baseline = the projection with fixed returns. Simulation = many trials with random returns (Monte Carlo); shown as a median and a middle range.                                        |
| **Changes by year**               | Settings that change from a given year onward (contribution rate, spending, salary, …), "sticky" until the next change.                                                                |
| **Coast FIRE**                    | The year after which you could stop contributing and still reach your retirement need.                                                                                                 |
| **Sinking fund**                  | Cash saved monthly toward a known future expense.                                                                                                                                      |

## Account types

| Term          | Meaning                                                                                                                                                                              |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **401k**      | Employer-sponsored retirement plan, pre-tax or Roth. IRS §401(k).                                                                                                                    |
| **403b**      | Same as 401k but for non-profits / schools. Shares the IRS elective deferral limit with 401k ("401k limit group"). A 457(b) has its own deferral limit and doesn't share this group. |
| **IRA**       | Individual Retirement Arrangement. Traditional (pre-tax) or Roth (after-tax).                                                                                                        |
| **HSA**       | Health Savings Account. Triple tax-advantaged: pre-tax in, tax-free growth, tax-free out for qualified medical. Best treatment of any account type.                                  |
| **Brokerage** | Taxable investment account. After-tax dollars in; capital gains tax on growth at withdrawal.                                                                                         |
| **ESPP**      | Employee Stock Purchase Plan. Brokerage sub-type with a discount on employer stock purchases.                                                                                        |

## Tax buckets

The engine stores account balances in 4 canonical "tax buckets" — these
are IRS-level categories independent of the account type that holds them.

| Key        | Display label         | Meaning                                                                                                                                                                           |
| ---------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `preTax`   | Traditional           | Pre-tax in, tax at withdrawal as ordinary income.                                                                                                                                 |
| `taxFree`  | Roth                  | After-tax in, tax-free growth, tax-free at withdrawal.                                                                                                                            |
| `hsa`      | HSA                   | Special bucket — pre-tax in, tax-free out for qualified medical (otherwise income tax + 20% penalty before 65; after 65 a non-medical draw is still income, without the penalty). |
| `afterTax` | After-tax / Brokerage | After-tax in, capital gains tax on growth.                                                                                                                                        |

## Retirement / withdrawal

| Term                           | Meaning                                                                                                                                                                                                                                                                                                                               |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **RMD**                        | Required Minimum Distribution. IRS rule forcing withdrawals from traditional retirement accounts starting at age 72/73/75 (depending on birth year per SECURE 2.0).                                                                                                                                                                   |
| **Uniform Lifetime Table**     | IRS Pub 590-B Table III. Divisor used to compute the RMD amount based on age. Exception: when the sole beneficiary is a spouse more than 10 years younger, Table II (Joint Life) applies; Ledgr uses Table III only.                                                                                                                  |
| **SECURE 2.0**                 | 2022 federal legislation that raised RMD start ages, added a "super catch-up" for ages 60–63, and indexed catch-up contribution limits.                                                                                                                                                                                               |
| **Catch-up**                   | Extra contribution allowance for age ≥ 50 (a yearly figure; see the IRS limits in Settings).                                                                                                                                                                                                                                          |
| **Super catch-up**             | SECURE 2.0 enhanced catch-up for ages 60–63 only ($11,250 in 2026). Replaces — does NOT add to — the regular catch-up.                                                                                                                                                                                                                |
| **Trinity Study**              | 1998 academic paper analyzing safe withdrawal rates over 30-year retirements. Origin of the "4% rule."                                                                                                                                                                                                                                |
| **4% rule**                    | Heuristic safe withdrawal rate from a balanced portfolio over 30 years.                                                                                                                                                                                                                                                               |
| **Guyton-Klinger**             | Dynamic withdrawal strategy with upper/lower guardrails. Cuts spending after a market crash, raises it after a bull run. Reduces sequence-of-returns risk vs. fixed 4% rule.                                                                                                                                                          |
| **Fixed Real**                 | The first year's spending, raised by inflation every year after. Never tested against the balance.                                                                                                                                                                                                                                    |
| **Forgo Inflation After Loss** | Fixed spending, except no inflation raise in a year after the portfolio lost money. The missed raise is never made up.                                                                                                                                                                                                                |
| **Spending Decline**           | Inflation-adjusted spending that falls by a set rate each year.                                                                                                                                                                                                                                                                       |
| **RMD-Based Spending**         | Retirement balance ÷ the Uniform Lifetime Table divisor for the primary person's age, times a multiplier. Before the RMD age, fixed spending raised by inflation.                                                                                                                                                                     |
| **Constant Percentage**        | A fixed % of the current retirement balance each year, never below a floor set as a share of the first year's withdrawal (nominal).                                                                                                                                                                                                   |
| **Endowment**                  | A fixed % of the average of the last N retirement balances, with the same nominal floor as Constant Percentage.                                                                                                                                                                                                                       |
| **Bracket Filling**            | The default withdrawal routing: Traditional up to a target tax bracket, then the rest ranked by cost (DESIGN § The Projection Engine).                                                                                                                                                                                                |
| **Waterfall**                  | Withdrawal routing that draws accounts in the household's priority order, with per-account and per-tax-type caps.                                                                                                                                                                                                                     |
| **Percentage (routing)**       | Withdrawal routing that draws each account by a fixed share; an emptied or capped account's share moves to the others.                                                                                                                                                                                                                |
| **Sequence-of-returns risk**   | The order matters — bad returns early in retirement deplete the portfolio more than the same returns late.                                                                                                                                                                                                                            |
| **FI / FIRE**                  | Financial Independence / Retire Early. Portfolio large enough to live off withdrawals indefinitely (typically 25× annual expenses).                                                                                                                                                                                                   |
| **Wealth Score**               | Net worth ÷ lifetime earnings.                                                                                                                                                                                                                                                                                                        |
| **Wealth formula / AAW score** | Net worth ÷ `(average age × household income) ÷ (10 + years until 40)` (Money Guy's enhanced Millionaire Next Door; Stanley & Danko's book form has no under-40 term). PAW (Prodigious Accumulator) at 2× or more, UAW at ½ or less, AAW between (the book's rule of thumb). The book also takes out inherited wealth; Ledgr doesn't. |

## Tax

| Term             | Meaning                                                                                                                                                                                                                                                                           |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **MAGI**         | Modified Adjusted Gross Income. Each use has its own version: IRMAA (AGI + tax-exempt interest), ACA (adds all Social Security and tax-exempt interest), NIIT, Roth IRA contribution limits.                                                                                      |
| **AGI**          | Adjusted Gross Income. Bottom of Form 1040 page 1.                                                                                                                                                                                                                                |
| **MFJ**          | Married Filing Jointly. Filing status.                                                                                                                                                                                                                                            |
| **MFS**          | Married Filing Separately.                                                                                                                                                                                                                                                        |
| **HOH**          | Head of Household.                                                                                                                                                                                                                                                                |
| **LTCG**         | Long-Term Capital Gains. Held > 1 year. Taxed at 0%/15%/20% federal brackets stacked on top of ordinary taxable income, so an unused deduction shelters gains.                                                                                                                    |
| **STCG**         | Short-Term Capital Gains. Held ≤ 1 year. Taxed as ordinary income.                                                                                                                                                                                                                |
| **NIIT**         | Net Investment Income Tax. 3.8% of the smaller of net investment income or MAGI over the threshold ($200k Single/HOH, $250k MFJ/QSS, $125k MFS). IRC §1411. NOT indexed to inflation.                                                                                             |
| **AMT**          | Alternative Minimum Tax. Parallel tax system that limits certain deductions for high earners. (Not currently modeled in ledgr.)                                                                                                                                                   |
| **W-4**          | Federal withholding form. The "2(c)" checkbox is the multi-job adjustment that uses different withholding brackets. It is for exactly two jobs in the household and must be ticked on both W-4s.                                                                                  |
| **FICA**         | Federal Insurance Contributions Act — payroll tax. Social Security (6.2% up to wage base) + Medicare (1.45% no cap) + 0.9% Additional Medicare: the employer withholds above $200,000 per employer; owed above $250,000 MFJ, $125,000 MFS, $200,000 otherwise (Single, HOH, QSS). |
| **SS wage base** | Annual cap on the 6.2% Social Security tax portion of FICA. A yearly figure; see the IRS limits in Settings.                                                                                                                                                                      |
| **FEIE**         | Foreign Earned Income Exclusion. (Not modeled.)                                                                                                                                                                                                                                   |
| **QBI**          | Qualified Business Income deduction (IRC §199A). 20% deduction for eligible self-employment income. (Not modeled.)                                                                                                                                                                |

## Health insurance

| Term      | Meaning                                                                                                                                                                                                                                                      |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **IRMAA** | Income-Related Monthly Adjustment Amount. Medicare Part B + D surcharge for MAGI above thresholds. Cliff-based — $1 over a tier triggers the full surcharge. Lookback is 2 years. Per person; a QSS filer uses the individual table. CMS publishes annually. |
| **ACA**   | Affordable Care Act health insurance subsidies via Healthcare.gov. Subsidy cliff at 400% of Federal Poverty Level (FPL), absent 2021-2025 under the enhanced credits, back from 2026. Pre-65 retirees rely heavily on this.                                  |
| **FPL**   | Federal Poverty Level. HHS publishes annually.                                                                                                                                                                                                               |
| **COBRA** | Continuation of employer health insurance after leaving a job. Expensive but bridge between jobs.                                                                                                                                                            |

## Social Security

| Term                                | Meaning                                                                                                                                                                                                                                                                                                                                                    |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **PIA**                             | Primary Insurance Amount. Your monthly SS benefit at full retirement age.                                                                                                                                                                                                                                                                                  |
| **FRA**                             | Full Retirement Age. 67 for anyone born January 2, 1960 or later.                                                                                                                                                                                                                                                                                          |
| **SS torpedo / provisional income** | The 3-tier formula that determines how much of your SS is taxable. Thresholds ($25k/$34k single, $32k/$44k MFJ) are NOT indexed — more retirees hit them every year. Marginal rates inside the torpedo zone can hit 40-46%. IRS Pub 915. Married filing separately and living together, the thresholds are zero (up to 85% taxable from the first dollar). |
| **WEP / GPO**                       | Windfall Elimination Provision / Government Pension Offset. Repealed by the Social Security Fairness Act (P.L. 118-273); not modeled.                                                                                                                                                                                                                      |

## Budget API integrations

| Term               | Meaning                                                                                      |
| ------------------ | -------------------------------------------------------------------------------------------- |
| **YNAB**           | You Need a Budget. SaaS budgeting tool. Ledgr syncs both ways (categories, cash, snapshots). |
| **Actual**         | Actual Budget. Open-source self-hosted budgeting tool. Ledgr integrates the same way.        |
| **Milliunits**     | YNAB stores amounts as integers in 1000ths of a dollar ($1.00 = 1000).                       |
| **Sync direction** | `pull` (read API → update local), `push` (write local → API), or `both`.                     |

## Architecture / dev

| Term                   | Meaning                                                                                                                                                                        |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **tRPC**               | End-to-end typesafe RPC for the API layer. No REST routes.                                                                                                                     |
| **Drizzle**            | TypeScript ORM with a SQL-like query builder. Used for both PG and SQLite.                                                                                                     |
| **Authentik**          | OIDC identity provider used in production. Dev mode has a bypass via `ALLOW_DEV_MODE=true`.                                                                                    |
| **Squash migration**   | Consolidating a release line's migrations into one fresh baseline (`0000_v<N>_initial_schema`); later migrations are incremental.                                              |
| **`AUTO-GEN` markers** | HTML comments in DESIGN.md / TESTING.md that `pnpm docs:update` rewrites from counts read from the filesystem (`pnpm docs:verify` checks them) (e.g., number of tRPC routers). |
