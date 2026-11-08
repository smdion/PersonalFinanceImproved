/** The toolbar's person view pills: Joint and each person. */
import { PillBtn, LabeledPillGroup } from "../pill-btn";
import type { ProjectionState } from "../projection-table-types";

export function PersonViewPills({
  state,
  people,
}: {
  state: ProjectionState;
  people: { id: number; name: string }[] | undefined;
}) {
  const {
    enginePeople,
    personFilter,
    setPersonFilter,
    hasIndividualAccountData,
  } = state;
  const pp = people ?? enginePeople;
  // A scenario from a Simple-tax-mode simulation has no per-person balances,
  // so the person pills are disabled rather than showing $0 everywhere.
  const personViewDisabledTitle = hasIndividualAccountData
    ? undefined
    : "Per-person breakdown isn't available for this scenario — it uses Simple tax mode, which doesn't track individual accounts. Switch to Advanced tax mode or view Joint totals.";
  return (
    <>
      {pp && pp.length > 1 && (
        <LabeledPillGroup label="View">
          <PillBtn
            active={personFilter === "all"}
            onClick={() => setPersonFilter("all")}
            label="Joint"
          />
          {pp.map((p) => (
            <PillBtn
              key={p.id}
              active={personFilter === p.id}
              onClick={() => setPersonFilter(p.id)}
              label={p.name}
              disabled={!!personViewDisabledTitle}
              title={personViewDisabledTitle}
            />
          ))}
        </LabeledPillGroup>
      )}
    </>
  );
}
