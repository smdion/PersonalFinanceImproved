# Engine ledgers

Hand-style year-by-year ledgers for wave 3, Yearly engine. Written blind: nothing here came from `src/` or `tests/`. The rules they follow are in the November review's engine spec (`.scratch/docs/reviews/2026-11-01/specs/engine.md`, not shipped); `EY-` and `UD-` ids point there. Copied from that review's `specs/engine-ledgers/` for the answer key (`tests/calculators/answer-key-ledgers.test.ts`), with the generator beside them.

| Household | Shape                                           | Years     | Exercises                                                                                                                         |
| --------- | ----------------------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------- |
| H1        | MFJ, one earner, retires 2036                   | 2026-2047 | contributions, match, HSA, Portfolio scope, Social Security claims, first RMD 2046, reinvestment into a projection-only brokerage |
| H2        | MFJ, two earners, A stops 2027, B stops 2032    | 2026-2044 | per-owner tracking, gap years 2028-2032, phase change 2033, first RMDs 2039 and 2043                                              |
| H3        | MFJ, retired, no jobs                           | 2026-2037 | decumulation from year 0, senior deduction to 2028, first RMDs 2027 (age 73) and 2035 (age 75)                                    |
| H4        | Single, retired at 48 on a Retirement brokerage | 2026-2054 | average-cost gains, 0% LTCG, brokerage runs out in 2046, first RMD 2053                                                           |
| H5        | Single, retires 2039 at 60                      | 2026-2056 | limit binds and overflows, catch-up at 50, lump sum 2031, rate step at 60, Roth exempt from RMD, first RMD 2054                   |
| H6        | Single, one Traditional IRA, retired at 49      | 2026-2054 | 10% penalty in the gross-up, 59 1/2 on Jan 1 2037, first RMD 2052 above the need                                                  |
| H7        | Single, plan fails                              | 2026-2036 | first RMD 2029 inside the draw, depletion 2034, unmet need                                                                        |

## Files

- `H#.input.json`: everything the ledger depends on. Generated from `households.py`.
- `H#.ledger.csv`: one row a year. `H#.accounts.csv`: one row per account per year.
- `ledgers.xlsx`: the same, one sheet per household plus one for accounts, with `check_ret` and `check_all` as live formulas. The builder writes it; it isn't committed (`.gitignore`).
- `load.ts`: reads these files for the tests and turns an input into the engine's `ProjectionInput`.
- `build_ledgers.py`: builds everything. Whole cents; starts with 14 published cases.
- `verify_ledgers.py`: second check. Reads only the CSVs and input JSON, shares no code with the builder, and takes federal figures from `tax-data/us-federal/2026.json`.

Result: 153 household-years, 454 account-years, 0 problems. Changing one tax cell makes it fail. Removing the Portfolio accounts from H1 and H5 leaves every retirement column unchanged.

## The balance

`start + contributions + growth - withdrawals - tax = end`, to the cent, for Retirement money (`ret_*`) and for all accounts (`all_*`).

- `contributions`: employee, match, overflow and lump sums.
- `withdrawals`: after-tax money that leaves the accounts for spending.
- `tax`: federal tax and penalty paid out of the accounts. In a retirement year that is all of it. In a gap year it is what the draw and Social Security add on top of the tax already taken from pay (`wage_only_tax`). In other working years pay covers the budget, so it is 0.
- `gross_distributions = withdrawals + tax + reinvested`. Reinvested RMD money moves between accounts, so it isn't in the balance line.

Spending check, retirement and gap years: `withdrawals + social_security + take_home + unmet_need = spending`, within a few cents (the gross-up stops at the first whole cent that covers the need).

## Order used each year

Working year: contributions, match, overflow, lump sum, then growth on the result. Retirement or gap year: gross-up and routing, RMD top-up, deduct, reinvest, then growth on the result. Conversions and QCDs are off.

## Assumptions, and why no ledger depends on an undefined rule

Each input was chosen so readings of an undefined rule agree. Feed the input as given and don't change these.

| Choice in the inputs                                                                                                                                                                                                   | Avoids                                         |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| As-of 2026-01-01; base tax year 2026, pinned                                                                                                                                                                           | UD-01 proration; a later "latest enacted year" |
| Jobs end Dec 31, so the next year is whole                                                                                                                                                                             | UD-02                                          |
| Birthdays Jan 15 (H6: Jul 1)                                                                                                                                                                                           | UD-13, UD-14                                   |
| Spending above income in every row                                                                                                                                                                                     | UD-03                                          |
| RMD top-ups only where no routed dollar sits above someone's minimum; the builder stops otherwise                                                                                                                      | UD-04                                          |
| No RMD age reached in a working year                                                                                                                                                                                   | UD-05                                          |
| HSA last in H1's order and never reached; Roth draws never reached                                                                                                                                                     | UD-06, UD-07                                   |
| No conversions, no QCDs                                                                                                                                                                                                | UD-08, UD-09                                   |
| MAGI under IRMAA tier 1 from age 63 on (checked); no ACA                                                                                                                                                               | UD-10                                          |
| Birth years avoid 1959                                                                                                                                                                                                 | UD-16                                          |
| No dividends or interest on brokerage; growth is all price                                                                                                                                                             | UD-18                                          |
| One account per waterfall step                                                                                                                                                                                         | UD-27                                          |
| H6 runs with penalized withdrawals allowed (`allowPenalizedWithdrawals`). The default, `avoidPenalizedWithdrawals` on, draws $0 before 59 1/2 and shows $40,000 unmet with $2,000,000 in the account                   | EY-MC-06's penalty-locked exemption            |
| `rothBracketTarget` unset, so the bracket target is disabled; H4 and H5 match only with it disabled. The payload sets 0.12 by default (engine-verdicts E2)                                                             | E2                                             |
| Fixed contributions are flat dollars every year. The engine grows a "fixed amount" with limits (E9; renamed and a true fixed option added, decided 2026-11-02, id D11), so H1 from 2027 and H5 differ until that lands | UD-32                                          |

Four things are not avoidable. A row that depends on one is **conditional**: if the decision differs, that row changes and the ledger must be rebuilt, not read as a bug.

| Assumption                                                                                                                                            | Rows                                                                      |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| C1. Indexed tax figures grow at the plan's inflation from 2026, unrounded (allowed by annual-tax IX-2; UD-22)                                         | Every row after 2026 with tax                                             |
| C2. Gap-year take-home = pay - employee contributions - FICA - federal tax on wages alone, by the annual method, and the draw stacks on wages (UD-11) | H2 2028-2032                                                              |
| C3. Limits grow at `limitGrowth` from 2026, unrounded, with the catch-up (UD-12)                                                                      | H5 2027-2038: split between 401(k) and overflow only; totals don't change |
| C4. Average-cost basis (UD-17)                                                                                                                        | H4 2026-2046, H4 tax 2046                                                 |

Spending and benefits: `today's figure × (1 + inflation)^(year - 2026)`, so 2026 uses the figure as typed (UD-24). Salary grows the same way at its own rate, with no cap (UD-23). Per-account growth, flows and tax are rounded to the cent (UD-28). A comparison with an engine should allow $1 a row for rounding and convergence (UD-25), and carries through to balances.

Rebuild: `python3 -B build_ledgers.py && python3 -B verify_ledgers.py`, then `npx prettier --write tests/fixtures/engine-ledgers` (the builder writes `json.dump` layout; the repo keeps Prettier's). The builder needs `openpyxl` for the workbook.
