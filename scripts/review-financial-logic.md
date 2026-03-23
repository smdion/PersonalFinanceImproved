# Financial Logic Validation — Structured Prompt

**When:** After any change to calculators, engine modules, tax tables, or contribution logic.
**How:** Feed this file to Claude as a prompt: `cat scripts/review-financial-logic.md`

---

Validate the financial logic in /workspace/dev/personalfinance.

1. Run the full test suite: `pnpm test` — report any failures
2. Run the validation script: `pnpm validate` — report any diffs vs spreadsheet
3. Review any recently changed calculator files (git diff against last release tag)
4. For each changed formula:
   - Verify the math against the documented source (IRS pub, actuary table, etc.)
   - Check edge cases: zero income, single income, max contributions, early/late retirement
   - Verify tax bracket stacking is correct (LTCG on top of ordinary income)
   - Check that IRMAA, NIIT, and ACA cliff thresholds are applied correctly
5. Run the benchmark suite: check that Trinity study, cFIREsim, and institutional
   benchmarks still pass within tolerance
