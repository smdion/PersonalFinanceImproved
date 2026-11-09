/**
 * `earlyAccessInputs` (server/services/tax/early-access-inputs.ts): the one
 * row mapping Tax Buckets and the engine payload both feed to
 * computeTaxBucketAnalysis (RULES § Single Computation Path; census row 25).
 * Guards the cross-path rule: both read the same job links (inactive ones
 * kept, as Rule of 55's evidence) and each pair's current Roth basis row.
 */
import { describe, it, expect } from "vitest";
import { earlyAccessInputs } from "@/server/services/tax/early-access-inputs";

const updatedAt = new Date("2026-03-01T12:00:00Z");
const basisRow = (id: number, year: number, isFinalized: boolean) => ({
  id,
  performanceAccountId: 7,
  ownerPersonId: 1,
  year,
  contributionBasis: `${year - 2000}000.50`,
  conversionBasis: "0",
  latestConversionYear: null,
  isFinalized,
  isSeeded: !isFinalized,
  updatedAt,
});

const out = earlyAccessInputs({
  jobs: [
    { id: 1, endDate: "2025-06-30", isSpeculative: false },
    { id: 2, endDate: null, isSpeculative: true },
  ],
  jobLinkRows: [
    { performanceAccountId: 7, jobId: 1 },
    { performanceAccountId: 8, jobId: 2 },
    { performanceAccountId: null, jobId: 1 },
    { performanceAccountId: 9, jobId: null },
  ],
  accountBasisRows: [basisRow(1, 2025, true), basisRow(2, 2026, false)],
  perfAccounts: [
    {
      id: 7,
      accountType: "401k",
      ownerPersonId: 1,
      isActive: false,
      separationDate: "2025-06-30",
      costBasis: "1234.56",
      accountLabel: "Old plan",
      displayName: null,
      institution: "Fidelity",
    },
  ],
});

describe("earlyAccessInputs", () => {
  it("keeps every complete job link, the ended job's end date and the speculative flag", () => {
    expect(out.jobLinks).toEqual([
      {
        performanceAccountId: 7,
        endDate: new Date("2025-06-30"),
        isSpeculative: false,
      },
      { performanceAccountId: 8, endDate: null, isSpeculative: true },
    ]);
  });

  it("takes each pair's current Roth basis row: its latest non-finalized year", () => {
    expect(out.rothBasisRows).toEqual([
      {
        performanceAccountId: 7,
        ownerPersonId: 1,
        year: 2026,
        contributionBasis: 26000.5,
        conversionBasis: 0,
        latestConversionYear: null,
        isSeeded: true,
        updatedAt,
      },
    ]);
  });

  it("maps each account with its numbers parsed and its dates as dates", () => {
    expect(out.performanceAccounts).toEqual([
      {
        id: 7,
        accountType: "401k",
        ownerPersonId: 1,
        isActive: false,
        separationDate: new Date("2025-06-30"),
        costBasis: 1234.56,
        accountLabel: "Old plan",
        displayName: null,
        institution: "Fidelity",
      },
    ]);
  });
});
