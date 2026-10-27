## What changed

<!-- A sentence or two on what this changes and why. -->

## Checks

- [ ] `pnpm test`, `pnpm lint`, `pnpm build` pass

### Tax data (only if `tax-data/` changed)

- [ ] `pnpm tax-data:check` passes
- [ ] Every changed figure cites its document, and each citation has its link in the year's `sources` (IRS notice / Rev. Proc. / Publication, SSA, CMS, HHS, the Code)
- [ ] `dataVersion` in `tax-data/us-federal/index.json` is raised (and the year's `revision`, for a correction)
- [ ] A corrected figure lists the old value in `supersedes`
- [ ] Anything outside the year-to-year bounds has an `exception` with a reason and source
