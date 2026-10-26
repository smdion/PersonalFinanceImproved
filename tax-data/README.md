# Tax data

`us-federal.json` holds every yearly figure Ledgr's tax math uses: IRS contribution limits and other yearly amounts, withholding tables (Publication 15-T), long-term capital gains brackets, Medicare IRMAA brackets, and federal poverty levels for ACA. It is the only source — each install's reference tables are reconciled from it on every start.

## How an install uses it

- Figures Ledgr ships are kept current: a new year, or a corrected figure, reaches every install on its next start.
- A figure the household changed in **Settings → Reference Data** is never overwritten. **Reset to shipped** hands it back.
- A "+Year" copy is _carried forward_ until the real figures ship, then replaced.

## Format (`formatVersion` 1)

```jsonc
{
  "formatVersion": 1,
  "dataVersion": 2, // bump on every change
  "years": {
    "2026": {
      "revision": 1, // the year's own revision (shown with the data)
      "source": "IRS Notice 2025-67; Rev. Proc. 2025-32; …",
      "limits": {
        "ira_limit": {
          "value": 7500,
          "source": "IRS Notice 2025-67",
          "notes": "optional plain-words note",
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
    },
  },
}
```

The keys under `limits` are listed, with their names and kinds, in `src/lib/config/tax-limit-keys.ts`.

## Proposing a change

Open a pull request that edits `us-federal.json` and cites the published source for every changed figure. CI checks:

- only known keys; a source on every year, section and figure;
- every year keeps the keys and filing statuses the year before had;
- inflation-indexed figures move −2%…+15% a year; rates and fixed-by-law amounts don't move — unless an `exception` says why;
- withholding tables add up (each row's base = the previous base + its rate × the gap, within $1).

Only figures from published notices — never estimates.
