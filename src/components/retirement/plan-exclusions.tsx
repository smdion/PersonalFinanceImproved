/** The plan's "doesn't include" list, under the projection. */
import { PLAN_EXCLUSIONS } from "@/lib/config/plan-exclusions";

export function PlanExclusions() {
  return (
    <details className="text-caption text-faint mt-3">
      <summary className="cursor-pointer">
        What this plan doesn&apos;t include
      </summary>
      <ul className="mt-1 list-disc space-y-0.5 pl-5">
        {PLAN_EXCLUSIONS.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </details>
  );
}
