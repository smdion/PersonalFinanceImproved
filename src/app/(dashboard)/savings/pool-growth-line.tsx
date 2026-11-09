import { formatCurrency } from "@/lib/utils/format";

/** The Extra Paychecks tab's pool line: today's pool and where raises take it. */
export function renderPoolGrowthLine(
  derivedPoolByYear: Map<number, number>,
  maxMonthlyFunding: number | null,
  projectionYears: number,
  startYear: number,
) {
  if (maxMonthlyFunding === null)
    return (
      <p className="text-faint text-xs">Requires paycheck and budget data.</p>
    );
  const endYear = startYear + projectionYears;
  const endPool = derivedPoolByYear.get(endYear) ?? maxMonthlyFunding;
  const totalGrowthPercent =
    maxMonthlyFunding > 0
      ? ((endPool - maxMonthlyFunding) / maxMonthlyFunding) * 100
      : 0;
  const hasGrowth = Math.abs(totalGrowthPercent) >= 0.01;
  return (
    <p className="text-faint text-xs tabular-nums">
      {hasGrowth ? (
        <>
          <span className="text-primary font-medium">
            {formatCurrency(maxMonthlyFunding)}/mo
          </span>
          {" → "}
          <span className="text-primary font-medium">
            {formatCurrency(endPool)}/mo
          </span>
          {" by "}
          {endYear}
          <span className="ml-1 text-green-600">
            (+{totalGrowthPercent.toFixed(1)}%)
          </span>
        </>
      ) : (
        <>
          <span className="text-primary font-medium">
            {formatCurrency(maxMonthlyFunding)}/mo
          </span>
          <span className="text-faint/60 ml-1">
            · set raise rates to project growth
          </span>
        </>
      )}
    </p>
  );
}
