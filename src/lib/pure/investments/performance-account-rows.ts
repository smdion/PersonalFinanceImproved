import {
  PERF_BALANCE_MISMATCH_ABS,
  PERF_BALANCE_MISMATCH_PERCENT,
} from "@/lib/constants";
import type { AccountOwnership } from "@/lib/config/enum-values";
import type { accountTypeToPerformanceCategory } from "@/lib/config/display-labels";
import type { isRetirementParent } from "@/lib/config/account-types";
import { toNumber } from "@/lib/utils/numbers";
import { accountDisplayName } from "@/lib/utils/format";
import { parseLocalDateOnly } from "@/lib/utils/date";
import { calendarDateOf } from "@/lib/utils/calendar-date";
import { computeReturn } from "./returns";
import { resolveMaster } from "./annual-rollups";
import {
  parseAcceptedChecks,
  parseEstimatedFields,
} from "./performance-annotations";
import type { PerfCheck } from "./performance-checks";
import type { performanceAnnualRows } from "./performance-annual-rows";

export function resolveOwnerName(
  ownerPersonId: number | null,
  peopleMap: Map<number, string>,
): string | null {
  if (ownerPersonId == null) return null;
  const name = peopleMap.get(ownerPersonId);
  if (name == null) {
    // Data-integrity invariant, not a user error — left as a plain Error so
    // it lands as INTERNAL_SERVER_ERROR (logged, generic toast). Same for
    // resolveMaster()'s two throws (annual-rollups.ts).
    throw new Error(`people.id=${ownerPersonId} not found (orphan FK)`);
  }
  return name;
}

export function performanceAccountRows(
  accounts: (Parameters<typeof performanceAnnualRows>[1][number] & {
    ownerPersonId: number | null;
    isActive: boolean;
    note: string | null;
    estimatedFields: unknown;
    acceptedChecks: unknown;
  })[],
  perfLookups: Map<
    number,
    Parameters<typeof accountDisplayName>[0] & {
      id: number;
      accountType: NonNullable<
        Parameters<typeof accountTypeToPerformanceCategory>[0]
      >;
      ownershipType: AccountOwnership;
      parentCategory: NonNullable<Parameters<typeof isRetirementParent>[0]>;
      subType: string | null;
      displayOrder: number;
    }
  >,
  basisRows: {
    performanceAccountId: number;
    ownerPersonId: number;
    year: number;
    contributionBasis: string;
    conversionBasis: string;
    latestConversionYear: number | null;
  }[],
  basisByKey: Map<string, (typeof basisRows)[number]>,
  peopleMap: Map<number, string>,
  checksByRow: Map<number, PerfCheck[]>,
  rowsPerAccountYear: Map<string, number>,
) {
  const accountRows = accounts.map((r) => {
    const master = resolveMaster(r, perfLookups);
    const beginBalance = toNumber(r.beginningBalance);
    const contribs = toNumber(r.totalContributions);
    const gainLoss = toNumber(r.yearlyGainLoss);
    const employer = toNumber(r.employerContributions);
    const distributions = toNumber(r.distributions);
    const fees = toNumber(r.fees);
    const rollovers = toNumber(r.rollovers);
    // One row can cover an account two people hold, so every person's Roth basis
    // rides along and the row's figures are their total. With a row per person,
    // each row keeps its own person, so nothing counts twice.
    const perPerson =
      (rowsPerAccountYear.get(`${r.performanceAccountId}|${r.year}`) ?? 0) > 1;
    const owners = basisRows.filter(
      (b) =>
        b.performanceAccountId === r.performanceAccountId &&
        b.year === r.year &&
        (!perPerson || b.ownerPersonId === r.ownerPersonId),
    );
    const own =
      r.ownerPersonId != null
        ? basisByKey.get(
            `${r.performanceAccountId}|${r.ownerPersonId}|${r.year}`,
          )
        : undefined;
    const basisByOwner = (
      owners.length > 0
        ? owners
        : r.ownerPersonId != null
          ? [
              {
                ownerPersonId: r.ownerPersonId,
                contributionBasis: "0",
                conversionBasis: "0",
                latestConversionYear: null,
                recorded: false,
              },
            ]
          : []
    )
      .map((b) => ({
        ownerPersonId: b.ownerPersonId,
        ownerName: resolveOwnerName(b.ownerPersonId, peopleMap),
        contributionBasis: toNumber(b.contributionBasis),
        conversionBasis: toNumber(b.conversionBasis),
        latestConversionYear: b.latestConversionYear,
        /** False when there's no basis row for this person and year yet. */
        recorded: !("recorded" in b),
      }))
      .sort((a, b) => a.ownerPersonId - b.ownerPersonId);
    const sumBasis = (f: "contributionBasis" | "conversionBasis") =>
      basisByOwner.reduce((t, b) => t + b[f], 0);
    return {
      id: r.id,
      year: r.year,
      institution: r.institution,
      accountLabel: accountDisplayName(master),
      ownerName: resolveOwnerName(r.ownerPersonId, peopleMap),
      ownerPersonId: r.ownerPersonId,
      ownershipType: master.ownershipType,
      beginningBalance: beginBalance,
      totalContributions: contribs,
      yearlyGainLoss: gainLoss,
      endingBalance: toNumber(r.endingBalance),
      annualReturnPct: computeReturn(
        beginBalance,
        contribs,
        gainLoss,
        distributions,
        fees,
        rollovers,
      ),
      employerContributions: employer,
      fees,
      distributions,
      rollovers,
      parentCategory: master.parentCategory,
      accountType: master.accountType,
      subType: master.subType ?? null,
      isActive: r.isActive,
      performanceAccountId: r.performanceAccountId,
      displayOrder: master.displayOrder,
      contributionBasis:
        owners.length > 0 || own ? sumBasis("contributionBasis") : null,
      conversionBasis:
        owners.length > 0 || own ? sumBasis("conversionBasis") : null,
      latestConversionYear:
        basisByOwner.reduce<number | null>(
          (y, b) =>
            b.latestConversionYear !== null &&
            (y === null || b.latestConversionYear > y)
              ? b.latestConversionYear
              : y,
          null,
        ) ?? null,
      basisByOwner,
      checks: checksByRow.get(r.id) ?? [],
      note: r.note,
      estimatedFields: parseEstimatedFields(r.estimatedFields),
      acceptedChecks: parseAcceptedChecks(r.acceptedChecks),
    };
  });
  return { accountRows };
}

export function performanceBalanceMismatch(
  snapshotData: { snapshot: { snapshotDate: string }; total: number } | null,
  performanceLastUpdated: string | null,
  accountRows: { year: number; isActive: boolean; endingBalance: number }[],
  currentYear: number | null,
) {
  const balanceMismatch = (() => {
    if (!snapshotData) return null;
    const snapDate = snapshotData.snapshot.snapshotDate;
    // The stamp is a UTC instant; the snapshot date is the household's
    // calendar day — compare on the household's day (an evening edit is
    // already tomorrow in UTC).
    const perfDate =
      typeof performanceLastUpdated === "string"
        ? calendarDateOf(parseLocalDateOnly(performanceLastUpdated))
        : null;
    if (!perfDate || snapDate !== perfDate) return null;

    const perfTotal = accountRows
      .filter((r) => r.year === currentYear && r.isActive)
      .reduce((sum, r) => sum + r.endingBalance, 0);
    const snapTotal = snapshotData.total;
    const delta = perfTotal - snapTotal;
    const threshold = Math.max(
      PERF_BALANCE_MISMATCH_ABS,
      snapTotal * PERF_BALANCE_MISMATCH_PERCENT,
    );
    if (Math.abs(delta) <= threshold) return null;
    return { perfTotal, snapTotal, delta };
  })();
  return { balanceMismatch };
}
