"use client";

/**
 * How the retirement projection treats this loan: it doesn't model the
 * loan at all — it spends the budget until retirement and the retirement
 * spending after — so a payment still in the budget keeps being paid
 * after payoff, until retirement. Said plainly so the plan's spending can
 * be checked against the payoff.
 */
import Link from "next/link";
import { useDashboardProjection } from "@/lib/hooks/use-dashboard-projection";

export function RetirementPayoffNote({ payoffDate }: { payoffDate: string }) {
  const { data } = useDashboardProjection();
  const years = data?.result?.projectionByYear ?? [];
  const retirementYear = years.find((y) => y.phase === "decumulation")?.year;
  if (retirementYear === undefined) return null;
  const payoffYear = Number(payoffDate.slice(0, 4));
  const gap = retirementYear - payoffYear;
  return (
    <p className="text-caption text-muted mt-3">
      Your retirement projection doesn&apos;t drop this payment when the loan is
      paid off: it spends your{" "}
      <Link href="/budget" className="text-blue-600 hover:underline">
        budget
      </Link>{" "}
      until you retire in {retirementYear}
      {gap > 0
        ? `, so if the payment is in that budget the plan keeps paying it for about ${gap} ${gap === 1 ? "year" : "years"} after ${payoffYear}`
        : ""}
      , then your{" "}
      <Link href="/retirement" className="text-blue-600 hover:underline">
        retirement spending
      </Link>
      .
    </p>
  );
}
