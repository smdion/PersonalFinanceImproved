import { formatCurrency } from "@/lib/utils/format";

/** What the emergency fund still needs, its surplus, or Funded. */
export function renderEfundNeeded(efund: { neededAfterRepay: number }) {
  const needed = efund.neededAfterRepay;
  const funded = needed <= 0.005;
  return (
    <span className={funded ? "text-green-600" : "text-red-600"}>
      {funded
        ? needed < -0.005
          ? `${formatCurrency(Math.abs(needed))} surplus`
          : "Funded"
        : formatCurrency(needed)}
    </span>
  );
}
