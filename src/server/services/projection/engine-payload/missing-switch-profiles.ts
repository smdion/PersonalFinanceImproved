/**
 * A "Changes by year" row naming a profile that is gone (a restore, a
 * database without foreign-key checks) changes nothing there, and says so.
 */
type SwitchRow = {
  projectionYear: number;
  contributionProfileId: number | null;
  salaryProfileId: number | null;
};

export function missingSwitchProfileWarnings(
  rows: readonly SwitchRow[],
  contributionProfiles: ReadonlyMap<number, unknown>,
  salaryProfiles: ReadonlyMap<number, unknown>,
): string[] {
  const gone = (year: number, kind: string) =>
    `The ${year} row in Changes by year names a ${kind} that no longer exists, so that part of it changes nothing. Pick another profile or delete the row.`;
  return rows.flatMap((row) => [
    ...(row.contributionProfileId !== null &&
    !contributionProfiles.has(row.contributionProfileId)
      ? [gone(row.projectionYear, "Contribution Profile")]
      : []),
    ...(row.salaryProfileId !== null && !salaryProfiles.has(row.salaryProfileId)
      ? [gone(row.projectionYear, "Salary Profile")]
      : []),
  ]);
}
