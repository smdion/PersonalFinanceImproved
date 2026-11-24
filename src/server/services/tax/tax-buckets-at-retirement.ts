/** Tax Buckets' "At Retirement" view: the "now" entries carried to the
 *  projection's retirement transition (computeTaxBucketProjection). */
import { computeTaxBucketProjection } from "@/lib/pure/accounts/tax-buckets/tax-bucket-projection";
import type { EngineYearProjection } from "@/lib/pure/engine/types/index";
import type { taxBucketBreakdown } from "@/server/services/tax/tax-bucket-breakdown";

type Breakdown = Awaited<ReturnType<typeof taxBucketBreakdown>>;

/** The projection response's parts the view reads. */
type ProjectionRun = {
  result: { projectionByYear: EngineYearProjection[] } | null;
  perPersonSettings?: {
    personId: number;
    ruleOf55Override: boolean;
    retirementAge: number;
  }[];
};

/** The "At Retirement" entries; null while the projection has no result. */
export function taxBucketsAtRetirement(
  now: Pick<Breakdown, "accounts" | "people">,
  run: ProjectionRun,
) {
  if (!run.result) return null;
  // Rule of 55 forecasting override: the same per-person setting the
  // retirement engine reads (`perPersonSettings` on the projection).
  const ruleOf55OverrideByPersonId = run.perPersonSettings
    ? new Map(
        run.perPersonSettings.map((ps) => [ps.personId, ps.ruleOf55Override]),
      )
    : undefined;
  // Each person's retirement year — the same figure the engine uses for
  // when a still-active job ends.
  const birthYears = new Map(now.people.map((p) => [p.id, p.birthYear]));
  const retirementYearByPersonId = run.perPersonSettings
    ? new Map(
        run.perPersonSettings.flatMap((ps) => {
          const by = birthYears.get(ps.personId);
          return by != null
            ? [[ps.personId, by + ps.retirementAge] as const]
            : [];
        }),
      )
    : undefined;
  return computeTaxBucketProjection({
    nowEntries: now.accounts,
    projectionByYear: run.result.projectionByYear,
    people: now.people,
    ruleOf55OverrideByPersonId,
    retirementYearByPersonId,
  });
}
