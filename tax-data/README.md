# Tax data

Every yearly figure Ledgr's tax math uses: IRS contribution limits and other yearly amounts, withholding tables (Publication 15-T), long-term capital gains brackets, Medicare IRMAA brackets, and federal poverty levels for ACA. It is the only source — each install's reference tables are reconciled from it on every start.

```
tax-data/
  us-federal/
    index.json      formatVersion + dataVersion
    2025.json       one file a year
    2026.json
  schema/           generated — don't edit (pnpm tax-data:schema)
```

Ledgr reads the folder as one file (the year files assembled under `index.json`); the signed file installs download between releases is that same assembled file.

## How an install uses it

- Figures Ledgr ships are kept current: a new year, or a corrected figure, reaches every install on its next start.
- A figure the household changed in **Settings → Reference Data** is never overwritten. **Reset to shipped** hands it back.
- A "+Year" copy is _carried forward_ until the real figures ship, then replaced.

## Adding a year

```sh
pnpm tax-data:new-year 2027   # copies 2026.json to 2027.json with every figure blank
# fill in each figure from its published notice, with its citation and link,
# then raise dataVersion in index.json
pnpm tax-data:check           # seconds; no database or .env needed
```

The check refuses a blank, so no figure or citation can carry over from last year unnoticed — and Ledgr skips a year that still has one, so a half-done year never reaches an install. Use only figures from published notices — never estimates or projections.

## A year file

```jsonc
{
  "$schema": "../schema/year.schema.json", // editor autocomplete and checks
  "revision": 1, // this year's own revision
  "source": "IRS Notice 2025-67; IRS Rev. Proc. 2025-32", // every citation the year uses
  "sources": {
    // each citation → a link to the document
    "IRS Notice 2025-67": "https://www.irs.gov/pub/irs-drop/n-25-67.pdf",
  },
  "limits": {
    "ira_limit": {
      "value": 7500,
      "source": "IRS Notice 2025-67", // citations only, joined by "; "
      "notes": "plain words about the figure", // optional
      "supersedes": [7000], // older values this replaces (corrections)
      "exception": { "reason": "…", "source": "…" }, // outside the bounds, on purpose
    },
  },
  "withholding": {
    "source": "…",
    "tables": { "MFJ": { "standard": [], "checkbox": [] } },
  },
  "ltcg": { "source": "…", "brackets": { "MFJ": [] } },
  "irmaa": { "source": "…", "brackets": { "MFJ": [] } },
  "fpl": { "source": "…", "amounts": { "1": 15650 } },
}
```

## Conventions

- **Citations, not descriptions.** A `source` names documents only ("IRS Notice 2025-67", "IRC 3101(b)(2)"), several joined by `"; "`. Each one must be a key in the year's `sources` with an `https://` link to that document — prefer permanent links (`irs.gov/pub/irs-drop/…`, `irs.gov/pub/irs-prior/…`) over pages that change every year. What a figure is goes in `notes`.
- **Rates are fractions**: 6.2% is `0.062`.
- **`threshold: null` is the top bracket** (no upper end) in the capital-gains brackets.
- **Withholding tables** are Publication 15-T's _Percentage Method Tables for Automated Payroll Systems_ (annual): `standard` is the STANDARD schedule (a 2020-or-later Form W-4 with Step 2 not checked, or a 2019-or-earlier one), `checkbox` the Step 2 Checkbox schedule. Each row's `baseWithholding` must equal the previous row's plus its rate × the gap (within $1).
- **IRMAA** `annualSurcharge` is per person, a year: the Part B and Part D income-related adjustments, monthly × 12, above `magiThreshold`.
- **Poverty lines run a year behind**: a coverage year uses the previous year's HHS guidelines (2026 holds HHS 2025), the 48 contiguous states and DC.
- **`revision` vs `dataVersion`.** Raise a year's `revision` when that year's figures change (a correction). Raise `dataVersion` in `index.json` by one on _every_ change to any file — installs take the higher `dataVersion` as newer, so two different versions must never share one.
- **Two pull requests that both raise `dataVersion`**: whichever merges second takes the next number after `main`'s (rebase, set it to `main`'s + 1). CI fails a change that doesn't raise it.
- **A correction** keeps the old value in `supersedes` (for a section, the old rows by filing status), so installs still holding it pick up the fix.

## What CI checks

`pnpm tax-data:check` runs the same checks CI and the app do:

- only known keys; every year, section and figure cites a source, and every citation links to its document;
- every year keeps the keys and filing statuses the year before had;
- inflation-indexed figures move −2%…+15% a year; rates and fixed-by-law amounts don't move — unless an `exception` says why;
- withholding tables add up; no blanks;
- the generated schemas and the key table below are current.

## Keys

The `limits` keys, generated from `src/lib/config/tax-limit-keys.ts` (and each account type's limits in the account config). Add a key there, then run `pnpm tax-data:schema`.

<!-- BEGIN:keys (pnpm tax-data:schema) -->

| Key                                               | Name                                                    | Settings card                  | Kind              | Latest source             |
| ------------------------------------------------- | ------------------------------------------------------- | ------------------------------ | ----------------- | ------------------------- |
| `401k_employee_limit`                             | Annual limit                                            | 401k                           | inflation-indexed | IRS Notice 2025-67        |
| `401k_catchup_limit`                              | Catch-up (50+)                                          | 401k                           | inflation-indexed | IRS Notice 2025-67        |
| `401k_super_catchup_limit`                        | Super catch-up (60–63)                                  | 401k                           | inflation-indexed | IRS Notice 2025-67        |
| `401k_total_additions_limit`                      | Total additions (employee + employer)                   | 401k                           | inflation-indexed | IRS Notice 2025-67        |
| `ira_limit`                                       | Annual limit                                            | IRA                            | inflation-indexed | IRS Notice 2025-67        |
| `ira_catchup_limit`                               | Catch-up (50+)                                          | IRA                            | inflation-indexed | IRS Notice 2025-67        |
| `hsa_individual_limit`                            | Self-only                                               | HSA                            | inflation-indexed | IRS Rev. Proc. 2025-19    |
| `hsa_family_limit`                                | Family                                                  | HSA                            | inflation-indexed | IRS Rev. Proc. 2025-19    |
| `hsa_catchup_limit`                               | Catch-up (55+)                                          | HSA                            | fixed by law      | IRC 223(b)(3)             |
| `standard_deduction_mfj`                          | Married filing jointly                                  | Standard deduction             | inflation-indexed | IRS Rev. Proc. 2025-32    |
| `standard_deduction_single`                       | Single                                                  | Standard deduction             | inflation-indexed | IRS Rev. Proc. 2025-32    |
| `standard_deduction_hoh`                          | Head of household                                       | Standard deduction             | inflation-indexed | IRS Rev. Proc. 2025-32    |
| `additional_std_deduction_65_married`             | Age 65+ addition, married (per spouse)                  | Standard deduction             | inflation-indexed | IRS Rev. Proc. 2025-32    |
| `additional_std_deduction_65_unmarried`           | Age 65+ addition, single / head of household            | Standard deduction             | inflation-indexed | IRS Rev. Proc. 2025-32    |
| `obbba_senior_deduction_per_person`               | Per person 65+                                          | Senior deduction (2025–2028)   | fixed by law      | OBBBA §70103              |
| `obbba_senior_deduction_phaseout_start_mfj`       | Phase-out starts, married filing jointly                | Senior deduction (2025–2028)   | fixed by law      | OBBBA §70103              |
| `obbba_senior_deduction_phaseout_start_unmarried` | Phase-out starts, single / head of household            | Senior deduction (2025–2028)   | fixed by law      | OBBBA §70103              |
| `obbba_senior_deduction_phaseout_rate`            | Phase-out rate                                          | Senior deduction (2025–2028)   | rate set by law   | OBBBA §70103              |
| `obbba_senior_deduction_sunset_year`              | Last year available                                     | Senior deduction (2025–2028)   | fixed by law      | OBBBA §70103              |
| `ss_wage_base`                                    | Social Security wage base                               | Social Security & Medicare     | inflation-indexed | IRS Publication 15 (2026) |
| `fica_ss_rate`                                    | Social Security rate                                    | Social Security & Medicare     | rate set by law   | IRS Publication 15 (2026) |
| `fica_medicare_rate`                              | Medicare rate                                           | Social Security & Medicare     | rate set by law   | IRS Publication 15 (2026) |
| `fica_medicare_surtax_rate`                       | Additional Medicare rate                                | Social Security & Medicare     | rate set by law   | IRS Publication 15 (2026) |
| `fica_medicare_surtax_threshold`                  | Additional Medicare: employer withholds above           | Social Security & Medicare     | fixed by law      | IRS Publication 15 (2026) |
| `fica_medicare_surtax_liability_mfj`              | Additional Medicare: owed above, married filing jointly | Social Security & Medicare     | fixed by law      | IRC 3101(b)(2)            |
| `fica_medicare_surtax_liability_single`           | Additional Medicare: owed above, single                 | Social Security & Medicare     | fixed by law      | IRC 3101(b)(2)            |
| `fica_medicare_surtax_liability_hoh`              | Additional Medicare: owed above, head of household      | Social Security & Medicare     | fixed by law      | IRC 3101(b)(2)            |
| `roth_ira_phaseout_start_mfj`                     | Phase-out starts, married filing jointly                | Roth IRA eligibility           | inflation-indexed | IRS Notice 2025-67        |
| `roth_ira_phaseout_end_mfj`                       | Phase-out ends, married filing jointly                  | Roth IRA eligibility           | inflation-indexed | IRS Notice 2025-67        |
| `roth_ira_phaseout_start_single`                  | Phase-out starts, single                                | Roth IRA eligibility           | inflation-indexed | IRS Notice 2025-67        |
| `roth_ira_phaseout_end_single`                    | Phase-out ends, single                                  | Roth IRA eligibility           | inflation-indexed | IRS Notice 2025-67        |
| `roth_ira_phaseout_start_hoh`                     | Phase-out starts, head of household                     | Roth IRA eligibility           | inflation-indexed | IRS Notice 2025-67        |
| `roth_ira_phaseout_end_hoh`                       | Phase-out ends, head of household                       | Roth IRA eligibility           | inflation-indexed | IRS Notice 2025-67        |
| `hdhp_min_deductible_self`                        | Minimum deductible, self-only                           | HSA eligibility (HDHP)         | inflation-indexed | IRS Rev. Proc. 2025-19    |
| `hdhp_min_deductible_family`                      | Minimum deductible, family                              | HSA eligibility (HDHP)         | inflation-indexed | IRS Rev. Proc. 2025-19    |
| `qcd_annual_limit`                                | Most an IRA can give to charity, per person             | Charitable distributions (QCD) | inflation-indexed | IRS Notice 2025-67        |
| `supplemental_tax_rate`                           | Bonus (supplemental) withholding rate                   | Withholding                    | rate set by law   | IRS Publication 15 (2026) |

<!-- END:keys -->
