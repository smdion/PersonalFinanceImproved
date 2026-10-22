/**
 * The household's IRS contribution limits per limit group (a 401(k) and a
 * 403(b) share one), with the flat catch-up and super catch-up figures and
 * who participates in each group, for the projection engine. Pure.
 */
import {
  categoriesWithIrsLimit,
  getAccountTypeConfig,
  getLimitGroup,
} from "@/lib/config/account-types";
import { requireLimit } from "@/server/helpers/settings";

export function computeIrsLimitGroups({
  people,
  activeContribs,
  limitsMap,
  birthYearByPersonId,
}: {
  people: readonly { id: number }[];
  activeContribs: readonly {
    personId: number | null;
    accountType: string;
    hsaCoverageType?: string | null;
  }[];
  limitsMap: Record<string, number>;
  birthYearByPersonId: ReadonlyMap<number, number>;
}) {
  const personAccountTypes = new Map<number, Set<string>>();
  for (const c of activeContribs) {
    // Joint accounts have no single owning person — they don't attribute to
    // any individual's per-person IRS limit tracking below.
    if (c.personId == null) continue;
    if (!personAccountTypes.has(c.personId))
      personAccountTypes.set(c.personId, new Set());
    personAccountTypes.get(c.personId)!.add(c.accountType);
  }

  // Aggregate IRS limits per limit group across people. catchupByGroup /
  // superCatchupByGroup hold the flat per-person IRS catchup dollar figure
  // (not summed across people) — groupParticipants records WHO participates
  // in each group so the engine can gate that figure by each participant's
  // own projected age each year (see catchupGroupParticipants below).
  const limitByGroup: Record<string, number> = {};
  const catchupByGroup: Record<string, number> = {};
  const superCatchupByGroup: Record<string, number> = {};
  const groupParticipants = new Map<string, Map<number, number>>(); // group -> personId -> birthYear
  const groupCounted = new Set<string>();
  for (const p of people) {
    const types = personAccountTypes.get(p.id);
    if (!types) continue;
    const typeArr = Array.from(types);
    for (const cat of categoriesWithIrsLimit()) {
      if (!typeArr.includes(cat)) continue;
      const group = getLimitGroup(cat)!;
      const cfg = getAccountTypeConfig(cat);
      const keys = cfg.irsLimitKeys!;
      // HSA is per-household (counted once), others per-person
      const isHousehold = cfg.isHouseholdLimit;
      if (isHousehold && groupCounted.has(group)) continue;
      // Use coverage-variant limit (e.g. HSA family) when applicable
      let baseKey = keys.base;
      if (keys.coverageVariant) {
        const hsaAcct = activeContribs.find((c) => c.accountType === cat);
        if (hsaAcct?.hsaCoverageType === "family")
          baseKey = keys.coverageVariant;
      }
      limitByGroup[group] =
        (limitByGroup[group] ?? 0) + requireLimit(limitsMap, baseKey);
      if (keys.catchup) catchupByGroup[group] = limitsMap[keys.catchup] ?? 0;
      if (keys.superCatchup)
        superCatchupByGroup[group] = limitsMap[keys.superCatchup] ?? 0;
      if (keys.catchup || keys.superCatchup) {
        const birthYear = birthYearByPersonId.get(p.id);
        if (birthYear != null) {
          if (!groupParticipants.has(group))
            groupParticipants.set(group, new Map());
          groupParticipants.get(group)!.set(p.id, birthYear);
        }
      }
      groupCounted.add(group);
    }
  }
  return {
    limitByGroup,
    catchupByGroup,
    superCatchupByGroup,
    groupParticipants,
  };
}
