"use client";

/**
 * CoastFireCard — displays the user's Coast FIRE age.
 *
 * "Coast FIRE" is the earliest age at which the user can stop contributing
 * to retirement accounts and still fund their plan through end of plan.
 * The card handles three outcomes:
 *   - "already_coast" — you can stop today
 *   - "found" — earliest safe coast age is in the future
 *   - "unreachable" — plan can't coast at any age
 *
 * The card takes the same input shape as computeProjection (subset)
 * so the parent can forward its existing projection state without
 * building a separate input object.
 */

import { Card } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import { formatCurrency } from "@/lib/utils/format";

type CoastFireInput = Parameters<
  typeof trpc.projection.computeCoastFire.useQuery
>[0];

interface CoastFireCardProps {
  input: CoastFireInput;
}

export function CoastFireCard({ input }: CoastFireCardProps) {
  const { data, isLoading, error } = trpc.projection.computeCoastFire.useQuery(
    input,
    {
      placeholderData: (prev) => prev,
      staleTime: 60_000, // Coast FIRE is expensive (~6 engine runs); cache for 1 min.
    },
  );

  return (
    <Card className="p-4">
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-primary">Coast FIRE</h3>
        <p className="text-xs text-muted mt-0.5">
          The earliest age at which you can stop contributing and still fund
          your plan through end of plan.
        </p>
      </div>

      {isLoading && (
        <div className="text-xs text-muted animate-pulse">
          Calculating Coast FIRE age...
        </div>
      )}

      {error && (
        <div className="text-xs text-error">
          Couldn&apos;t compute Coast FIRE: {error.message}
        </div>
      )}

      {data?.result && <CoastFireBody result={data.result} />}
    </Card>
  );
}

function CoastFireBody({
  result,
}: {
  result: {
    coastFireAge: number | null;
    status: "already_coast" | "found" | "unreachable";
    endBalance: number;
    sustainableWithdrawal: number;
    projectedExpensesAtRetirement: number;
  };
}) {
  if (result.status === "unreachable") {
    return (
      <div>
        <div className="text-xl font-semibold text-warning">Not reachable</div>
        <p className="text-xs text-muted mt-2">
          Your plan doesn&apos;t coast at any age — continuing contributions
          through retirement is required to fund expenses. Consider higher
          contributions, lower expenses, a later retirement age, or a longer
          projection horizon.
        </p>
      </div>
    );
  }

  const ageLabel =
    result.status === "already_coast"
      ? "You are already Coast FIRE"
      : `Coast FIRE age: ${result.coastFireAge}`;

  return (
    <div>
      <div className="text-xl font-semibold text-primary">{ageLabel}</div>
      <p className="text-xs text-muted mt-2">
        {result.status === "already_coast"
          ? "If you stopped contributing today, your portfolio would still fund your plan through end of plan."
          : `If you stop contributing at age ${result.coastFireAge}, your portfolio is projected to sustain ${formatCurrency(
              result.sustainableWithdrawal,
            )}/yr at retirement (vs ${formatCurrency(
              result.projectedExpensesAtRetirement,
            )} projected expenses).`}
      </p>
      <p className="text-xs text-faint mt-1">
        Projected end-of-plan balance: {formatCurrency(result.endBalance)}
      </p>
    </div>
  );
}
