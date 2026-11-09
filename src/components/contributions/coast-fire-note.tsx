"use client";

/**
 * What the plan's contributions buy: the age they could stop and retirement
 * still works, from the same Coast FIRE calculation as the Retirement page.
 * Always the plan's active profiles, whichever one this page is showing.
 */
import Link from "next/link";
import { trpc } from "@/lib/trpc";
import { useDashboardProjection } from "@/lib/hooks/use-dashboard-projection";
import { usePlanEngineInput } from "@/lib/hooks/use-plan-engine-input";
import { planAgeLabel } from "@/lib/pure/household/household-timeline";

export function CoastFireNote() {
  const { input, ready } = usePlanEngineInput();
  const { data: projection } = useDashboardProjection();
  const { data } = trpc.projection.computeCoastFire.useQuery(input, {
    enabled: ready,
    staleTime: 60_000,
  });
  const r = data?.result;
  if (!r) return null;
  const first = projection?.result?.projectionByYear[0];
  const stopLabel =
    first && r.coastFireAge !== null
      ? planAgeLabel(
          first,
          "people" in projection
            ? projection.people.find((p) => p.id === projection.primaryPersonId)
                ?.name
            : undefined,
          r.coastFireAge,
        )
      : `age ${r.coastFireAge}`;
  const text =
    r.status === "already_coast"
      ? "In your projection, contributions could stop today and retirement would still work"
      : r.status === "found"
        ? `In your projection, contributions could stop in ${stopLabel} and retirement would still work`
        : "Your projection needs contributions all the way to retirement";
  return (
    <p className="text-caption text-muted -mt-2 mb-3">
      {text}, on average returns (the Simulation can be stricter) —{" "}
      <Link href="/retirement" className="text-blue-600 hover:underline">
        see Coast FIRE on Retirement
      </Link>
      .
    </p>
  );
}
