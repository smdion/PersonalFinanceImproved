/**
 * The plan's raise as a label: one rate, or each person's when they differ
 * (salaries grow at each person's own rate).
 */
import { formatPercent } from "@/lib/utils/format";

export function annualRaiseLabel(
  householdRate: number,
  people?: ReadonlyArray<{
    name?: string | null;
    salaryAnnualIncrease?: number | string | null;
  }>,
): string {
  const rates = (people ?? []).flatMap((p) =>
    p.salaryAnnualIncrease == null
      ? []
      : [{ name: p.name, rate: Number(p.salaryAnnualIncrease) }],
  );
  if (rates.length < 2 || new Set(rates.map((r) => r.rate)).size < 2)
    return formatPercent(householdRate, 1);
  return rates
    .map((r) => `${r.name ?? "Person"} ${formatPercent(r.rate, 1)}`)
    .join(", ");
}
