import { ProjectionHeroKpis } from "../projection-hero-kpis";
import type { ProjectionState, ReportMode } from "../projection-table-types";

export function HeroKpisPanel({
  reportMode,
  engineQuery,
  state,
}: {
  reportMode: ReportMode;
  engineQuery: ProjectionState["engineQuery"];
  state: ProjectionState;
}) {
  return (
    <div className={reportMode === "advisor" ? undefined : "print:hidden"}>
      {engineQuery.isLoading ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          {[0, 1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="border-subtle bg-surface-primary/40 min-h-[128px] animate-pulse rounded-lg border p-3"
              style={{
                animationDelay: `${i * 80}ms`,
                animationDuration: "1.8s",
              }}
            >
              <div className="bg-surface-strong/20 h-2.5 w-20 rounded" />
              <div className="bg-surface-strong/20 mt-4 h-8 w-24 rounded" />
              <div className="bg-surface-strong/20 mt-2 h-2 w-16 rounded" />
            </div>
          ))}
        </div>
      ) : (
        <ProjectionHeroKpis state={state} />
      )}
    </div>
  );
}
