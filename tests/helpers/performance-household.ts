/**
 * An invented household for the Performance summary's stages
 * (lib/pure/investments/performance-annual-rows.ts and
 * performance-account-rows.ts): a 401k, a taxable brokerage account and a
 * Retirement-goal brokerage account, one year of account rows and no stored
 * annual rows except a stray Retirement row from the year before.
 */
const masters = [
  { id: 1, accountType: "401k", parentCategory: "Retirement" },
  { id: 2, accountType: "brokerage", parentCategory: "Portfolio" },
  { id: 3, accountType: "brokerage", parentCategory: "Retirement" },
].map((m) => ({
  ...m,
  institution: "Acme",
  accountLabel: `Acct ${m.id}`,
  ownershipType: "individual" as const,
  subType: null,
  displayOrder: m.id,
}));
export const perfLookups = new Map(masters.map((m) => [m.id, m]));

function accountRow(
  id: number,
  begin: number,
  gain: number,
  extra: Partial<
    Record<"contribs" | "employer" | "fees" | "dist", number>
  > = {},
) {
  const end =
    begin +
    gain +
    (extra.contribs ?? 0) -
    (extra.fees ?? 0) -
    (extra.dist ?? 0);
  return {
    id,
    year: 2025,
    institution: "Acme",
    accountLabel: `Acct ${id}`,
    performanceAccountId: id,
    // Stored legacy value; the stage replaces it with the master's.
    parentCategory: "Brokerage",
    ownerPersonId: 1 as number | null,
    isActive: true,
    note: null,
    estimatedFields: null,
    acceptedChecks: null,
    beginningBalance: String(begin),
    totalContributions: String(extra.contribs ?? 0),
    yearlyGainLoss: String(gain),
    endingBalance: String(end),
    employerContributions: String(extra.employer ?? 0),
    distributions: String(extra.dist ?? 0),
    fees: String(extra.fees ?? 0),
    rollovers: "0",
  };
}

export function household() {
  const accounts = [
    accountRow(1, 1000, 50, { contribs: 100, employer: 10, fees: 5 }),
    accountRow(2, 500, 20, { dist: 15 }),
    accountRow(3, 200, 10),
  ];
  const strayRetirement = {
    id: 9,
    year: 2024,
    category: "Retirement",
    beginningBalance: "0",
    totalContributions: "0",
    yearlyGainLoss: "0",
    endingBalance: "999",
    annualReturnPct: null,
    employerContributions: "0",
    distributions: "0",
    fees: "0",
    rollovers: "0",
    lifetimeGains: "0",
    lifetimeContributions: "0",
    lifetimeMatch: "0",
    isCurrentYear: false,
    isFinalized: true,
  };
  return { accounts, annual: [strayRetirement] };
}
