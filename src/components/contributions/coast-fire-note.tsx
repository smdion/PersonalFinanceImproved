"use client";

/**
 * What the plan's contributions buy: the age they could stop and retirement
 * still works, from the same Coast FIRE calculation as the Retirement page.
 * Always the plan's active profiles, whichever one this page is showing.
 */
import Link from "next/link";
import { trpc } from "@/lib/trpc";
import { usePlanEngineInput } from "@/lib/hooks/use-plan-engine-input";

export function CoastFireNote() {
  const { input, ready } = usePlanEngineInput();
  const { data } = trpc.projection.computeCoastFire.useQuery(input, {
    enabled: ready,
    staleTime: 60_000,
  });
  const r = data?.result;
  if (!r) return null;
  const text =
    r.status === "already_coast"
      ? "Your active plan could stop contributing today and retirement would still work"
      : r.status === "found"
        ? `Your active plan's contributions could stop at age ${r.coastFireAge} and retirement would still work`
        : "Your active plan needs contributions all the way to retirement";
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
