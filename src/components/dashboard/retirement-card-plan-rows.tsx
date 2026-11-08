import { formatCurrency } from "@/lib/utils/format";

export function PlanTimeRows({
  yearsToRet,
  result,
  yearOf,
  retAge,
  portfolioTotal,
}: {
  yearsToRet: number;
  result: { projectionByYear: { year: number }[] };
  yearOf: (age: number) => number;
  retAge: number;
  portfolioTotal: number;
}) {
  return (
    <>
      <div className="flex justify-between">
        <span className="text-muted">Years to retirement</span>
        <span className="text-primary">
          {yearsToRet} yrs{" "}
          <span className="text-caption text-faint">
            ({result.projectionByYear[0]?.year} → {yearOf(retAge)})
          </span>
        </span>
      </div>
      <div className="flex justify-between">
        <span className="text-muted">Retirement accounts</span>
        <span className="text-primary">{formatCurrency(portfolioTotal)}</span>
      </div>
    </>
  );
}

export function RetirementBudgetRow({
  retirementBudget,
}: {
  retirementBudget: number;
}) {
  return (
    <>
      {retirementBudget > 0 && (
        <div className="flex justify-between">
          <span className="text-muted">Retirement budget</span>
          <span className="text-primary">
            {formatCurrency(retirementBudget)}/yr
          </span>
        </div>
      )}
    </>
  );
}
