/**
 * Hand-built EngineInput fixtures written against the retired household
 * limit fields (baseLimits / catchupLimits / catchupGroupParticipants) →
 * the engine's irsLimitCaps (the caps module's full key record + people).
 * The fixtures' figures are the IRS per-person limits (e.g. 23,500 for a
 * 401(k)), so each person gets them in full; no participants = one person.
 * Accounts (who holds which limited account) come from the specs, as in
 * production; a fixture with no specs routes a household total, so its
 * people hold every group it set a limit for.
 */
import type { EngineInput } from "@/lib/calculators/types";

const KEYS: Record<
  string,
  { base: string[]; catchup?: string; superCatchup?: string }
> = {
  "401k": {
    base: ["401k_employee_limit"],
    catchup: "401k_catchup_limit",
    superCatchup: "401k_super_catchup_limit",
  },
  ira: { base: ["ira_limit"], catchup: "ira_catchup_limit" },
  hsa: {
    base: ["hsa_individual_limit", "hsa_family_limit"],
    catchup: "hsa_catchup_limit",
  },
};

type Legacy = Parameters<typeof capsFromBaseLimits>[0];
/** Caps built with no participants: their people are sized by withCapsAge
 *  from the finished input, like the retired household-age fallback. */
const synthetic = new WeakMap<object, Legacy>();

export function capsFromBaseLimits(legacy: {
  baseLimits: Partial<Record<string, number>>;
  catchupLimits?: Record<string, number>;
  catchupGroupParticipants?: Record<
    string,
    { personId: number; birthYear: number }[]
  >;
  /** The one person's age now, when there are no participants. */
  currentAge?: number;
}): EngineInput["irsLimitCaps"] {
  const byId = new Map<number, number | null>();
  for (const list of Object.values(legacy.catchupGroupParticipants ?? {}))
    for (const p of list) byId.set(p.personId, p.birthYear);
  if (byId.size === 0)
    byId.set(
      1,
      legacy.currentAge === undefined
        ? null
        : new Date().getFullYear() - legacy.currentAge,
    );
  const limits: Record<string, number> = {};
  for (const [group, keys] of Object.entries(KEYS)) {
    for (const k of keys.base) limits[k] = legacy.baseLimits[group] ?? 0;
    if (keys.catchup) limits[keys.catchup] = legacy.catchupLimits?.[group] ?? 0;
    if (keys.superCatchup)
      limits[keys.superCatchup] = legacy.catchupLimits?.[`${group}_super`] ?? 0;
  }
  const caps = {
    filingStatus: "Single",
    limits,
    people: [...byId].map(([id, birthYear]) => ({ id, birthYear })),
    // No specs: everyone holds each group the fixture gave a limit.
    accounts: [...byId.keys()].flatMap((personId) =>
      Object.keys(KEYS)
        .filter((g) => (legacy.baseLimits[g] ?? 0) > 0)
        .map((accountType) => ({
          personId,
          accountType,
          hsaCoverageType: null,
        })),
    ),
  };
  if (!legacy.catchupGroupParticipants) synthetic.set(caps, legacy);
  return caps;
}

/**
 * Size a fixture's caps from the finished input (overrides applied): one
 * person per spec owner (one when no spec names an owner), each aged
 * `currentAge` in the as-of year (the engine's own clock when the fixture
 * has no asOfDate); the specs' accounts; the fixture's filing status.
 */
export function withCapsAge<
  T extends {
    irsLimitCaps: EngineInput["irsLimitCaps"];
    currentAge?: number;
    asOfDate?: Date;
    filingStatus?: string;
    contributionSpecs?: {
      personId?: number | null;
      category: string;
      hsaCoverageType?: string | null;
    }[];
  },
>(input: T): T {
  const legacy = synthetic.get(input.irsLimitCaps);
  // A partial override (no currentAge yet) is sized by the builder it's
  // merged into.
  if (!legacy || input.currentAge === undefined) return input;
  const birthYear =
    (input.asOfDate ?? new Date()).getFullYear() - input.currentAge;
  const ids = [
    ...new Set(
      (input.contributionSpecs ?? []).flatMap((s) =>
        s.personId == null ? [] : [s.personId],
      ),
    ),
  ];
  const participants = (ids.length ? ids : [1]).map((personId) => ({
    personId,
    birthYear,
  }));
  const caps = capsFromBaseLimits({
    ...legacy,
    catchupGroupParticipants: Object.fromEntries(
      Object.keys(KEYS).map((g) => [g, participants]),
    ),
  });
  const specs = input.contributionSpecs ?? [];
  return {
    ...input,
    irsLimitCaps: {
      ...caps,
      filingStatus: input.filingStatus ?? caps.filingStatus,
      accounts:
        specs.length === 0
          ? caps.accounts
          : specs.map((s) => ({
              personId: s.personId ?? null,
              accountType: s.category,
              hsaCoverageType: s.hsaCoverageType ?? null,
            })),
    },
  };
}
