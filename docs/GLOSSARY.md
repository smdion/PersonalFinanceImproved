# Ledgr Glossary

> **Audience:** non-finance engineers + new contributors. Helpful when
> reading the calculator code or running the app.

Personal finance has a lot of acronyms. This glossary defines the ones
that show up in the codebase + UI. For canonical definitions, follow
the linked IRS / SSA / CMS publications.

## Account types

| Term          | Meaning                                                                                                                                             |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **401k**      | Employer-sponsored retirement plan, pre-tax or Roth. IRS §401(k).                                                                                   |
| **403b**      | Same as 401k but for non-profits / schools. Shares the IRS elective deferral limit with 401k ("401k limit group").                                  |
| **IRA**       | Individual Retirement Arrangement. Traditional (pre-tax) or Roth (after-tax).                                                                       |
| **HSA**       | Health Savings Account. Triple tax-advantaged: pre-tax in, tax-free growth, tax-free out for qualified medical. Best treatment of any account type. |
| **Brokerage** | Taxable investment account. After-tax dollars in; capital gains tax on growth at withdrawal.                                                        |
| **ESPP**      | Employee Stock Purchase Plan. Brokerage sub-type with a discount on employer stock purchases.                                                       |

## Tax buckets

The engine stores account balances in 4 canonical "tax buckets" — these
are IRS-level categories independent of the account type that holds them.

| Key        | Display label         | Meaning                                                                                                         |
| ---------- | --------------------- | --------------------------------------------------------------------------------------------------------------- |
| `preTax`   | Traditional           | Pre-tax in, tax at withdrawal as ordinary income.                                                               |
| `taxFree`  | Roth                  | After-tax in, tax-free growth, tax-free at withdrawal.                                                          |
| `hsa`      | HSA                   | Special bucket — pre-tax in, tax-free out for qualified medical (otherwise income tax + 20% penalty before 65). |
| `afterTax` | After-tax / Brokerage | After-tax in, capital gains tax on growth.                                                                      |

## Retirement / withdrawal

| Term                                     | Meaning                                                                                                                                                                      |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **RMD**                                  | Required Minimum Distribution. IRS rule forcing withdrawals from traditional retirement accounts starting at age 72/73/75 (depending on birth year per SECURE 2.0).          |
| **Uniform Lifetime Table**               | IRS Pub 590-B Table III. Divisor used to compute the RMD amount based on age.                                                                                                |
| **SECURE 2.0**                           | 2022 federal legislation that raised RMD start ages, added a "super catch-up" for ages 60–63, and indexed catch-up contribution limits.                                      |
| **Catch-up**                             | Extra contribution allowance for age ≥ 50 (e.g., +$7,500/yr on 401k).                                                                                                        |
| **Super catch-up**                       | SECURE 2.0 enhanced catch-up for ages 60–63 only ($11,250 in 2026). Replaces — does NOT add to — the regular catch-up.                                                       |
| **Trinity Study**                        | 1998 academic paper analyzing safe withdrawal rates over 30-year retirements. Origin of the "4% rule."                                                                       |
| **4% rule**                              | Heuristic safe withdrawal rate from a balanced portfolio over 30 years.                                                                                                      |
| **Guyton-Klinger**                       | Dynamic withdrawal strategy with upper/lower guardrails. Cuts spending after a market crash, raises it after a bull run. Reduces sequence-of-returns risk vs. fixed 4% rule. |
| **Sequence-of-returns risk**             | The order matters — bad returns early in retirement deplete the portfolio more than the same returns late.                                                                   |
| **FI / FIRE**                            | Financial Independence / Retire Early. Portfolio large enough to live off withdrawals indefinitely (typically 25× annual expenses).                                          |
| **Wealth Score / Millionaire Next Door** | Stanley & Danko (1996) formula: `(age × salary) / 10`. Scores ≥ 1.0 are PAW (Prodigious Accumulator); ≥ 0.5 is AAW.                                                          |

## Tax

| Term             | Meaning                                                                                                                                                           |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **MAGI**         | Modified Adjusted Gross Income. Used by ACA, IRMAA, NIIT, Roth IRA limits. Adjustments vary by purpose.                                                           |
| **AGI**          | Adjusted Gross Income. Bottom of Form 1040 page 1.                                                                                                                |
| **MFJ**          | Married Filing Jointly. Filing status.                                                                                                                            |
| **MFS**          | Married Filing Separately.                                                                                                                                        |
| **HOH**          | Head of Household.                                                                                                                                                |
| **LTCG**         | Long-Term Capital Gains. Held > 1 year. Taxed at 0%/15%/20% federal brackets stacked on top of ordinary income.                                                   |
| **STCG**         | Short-Term Capital Gains. Held ≤ 1 year. Taxed as ordinary income.                                                                                                |
| **NIIT**         | Net Investment Income Tax. 3.8% on investment income above $200k single / $250k MFJ MAGI. IRC §1411. NOT indexed to inflation.                                    |
| **AMT**          | Alternative Minimum Tax. Parallel tax system that limits certain deductions for high earners. (Not currently modeled in ledgr.)                                   |
| **W-4**          | Federal withholding form. The "2(c)" checkbox is the multi-job adjustment that uses different withholding brackets.                                               |
| **FICA**         | Federal Insurance Contributions Act — payroll tax. Social Security (6.2% up to wage base) + Medicare (1.45% no cap) + 0.9% surtax above $200k single / $250k MFJ. |
| **SS wage base** | Annual cap on the 6.2% Social Security tax portion of FICA. $176,100 in 2026.                                                                                     |
| **FEIE**         | Foreign Earned Income Exclusion. (Not modeled.)                                                                                                                   |
| **QBI**          | Qualified Business Income deduction (IRC §199A). 20% deduction for eligible self-employment income. (Not modeled.)                                                |

## Health insurance

| Term      | Meaning                                                                                                                                                                                                   |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **IRMAA** | Income-Related Monthly Adjustment Amount. Medicare Part B + D surcharge for MAGI above thresholds. Cliff-based — $1 over a tier triggers the full surcharge. Lookback is 2 years. CMS publishes annually. |
| **ACA**   | Affordable Care Act health insurance subsidies via Healthcare.gov. Subsidy cliff at 400% of Federal Poverty Level (FPL). Pre-65 retirees rely heavily on this.                                            |
| **FPL**   | Federal Poverty Level. HHS publishes annually.                                                                                                                                                            |
| **COBRA** | Continuation of employer health insurance after leaving a job. Expensive but bridge between jobs.                                                                                                         |

## Social Security

| Term                                | Meaning                                                                                                                                                                                                                                  |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **PIA**                             | Primary Insurance Amount. Your monthly SS benefit at full retirement age.                                                                                                                                                                |
| **FRA**                             | Full Retirement Age. 67 for anyone born 1960+.                                                                                                                                                                                           |
| **SS torpedo / provisional income** | The 3-tier formula that determines how much of your SS is taxable. Thresholds ($25k/$34k single, $32k/$44k MFJ) are NOT indexed — more retirees hit them every year. Marginal rates inside the torpedo zone can hit 40-46%. IRS Pub 915. |
| **WEP / GPO**                       | Windfall Elimination Provision / Government Pension Offset. Reduce SS for people with non-SS-covered pensions. (Not currently modeled.)                                                                                                  |

## Budget API integrations

| Term               | Meaning                                                                               |
| ------------------ | ------------------------------------------------------------------------------------- |
| **YNAB**           | You Need a Budget. SaaS budgeting tool. Ledgr integrates as a read-mostly client.     |
| **Actual**         | Actual Budget. Open-source self-hosted budgeting tool. Ledgr integrates the same way. |
| **Milliunits**     | YNAB stores amounts as integers in 1000ths of a dollar ($1.00 = 1000).                |
| **Sync direction** | `pull` (read API → update local), `push` (write local → API), or `both`.              |

## Architecture / dev

| Term                   | Meaning                                                                                                                                                                |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **tRPC**               | End-to-end typesafe RPC for the API layer. No REST routes.                                                                                                             |
| **Drizzle**            | TypeScript ORM with a SQL-like query builder. Used for both PG and SQLite.                                                                                             |
| **Authentik**          | OIDC identity provider used in production. Dev mode has a bypass via `ALLOW_DEV_MODE=true`.                                                                            |
| **Squash migration**   | Consolidating multiple incremental migrations into a single fresh schema dump. v0.3 squashed earlier history; v0.5 squashed v0.3 + 2 follow-ups into a clean baseline. |
| **`AUTO-GEN` markers** | HTML comments in DESIGN.md / TESTING.md that get rewritten by `pnpm docs:verify --update` based on counts read from the filesystem (e.g., number of tRPC routers).     |
