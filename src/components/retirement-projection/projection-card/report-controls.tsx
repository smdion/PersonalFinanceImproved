/** The print buttons, the report gate and the advisor report's root. */
import type { ProjectionState } from "../projection-table-types";
import { ReportRoot } from "../report/report-root";
import { ReportGateModal } from "../report/report-gate-modal";
import type { useProjectionReport } from "./use-projection-report";

export function ReportControls({
  state,
  people,
  report,
}: {
  state: ProjectionState;
  people: { id: number; name: string }[] | undefined;
  report: ReturnType<typeof useProjectionReport>;
}) {
  const {
    result,
    isRerunning,
    runMonteCarlo,
    mcQuery,
    deflate,
    coastFireAge: deterministicCoastFireAge,
    enginePeople,
    engineSettings,
    enginePerPersonSettings,
    bracketOptimizerResult,
  } = state;
  const {
    reportMode,
    gateFailure,
    setGateFailure,
    handlePrint,
    handlePrintAdvisor,
  } = report;
  return (
    <>
      {/* The print buttons, hidden from the printout itself. */}
      {result && (
        <div className="text-caption flex items-center gap-3 print:hidden">
          <button
            type="button"
            onClick={() => handlePrint("basic")}
            className="text-muted hover:text-secondary underline"
          >
            Print Chart &amp; Table
          </button>
          <button
            type="button"
            onClick={handlePrintAdvisor}
            className="text-muted hover:text-secondary underline"
          >
            Print Full Report
          </button>
        </div>
      )}

      {gateFailure && (
        <ReportGateModal
          failure={gateFailure}
          isRunning={isRerunning}
          onRunSimulation={() => {
            runMonteCarlo();
            setGateFailure(null);
          }}
          onCancel={() => setGateFailure(null)}
        />
      )}

      {/* Advisor-report-only root: hidden on screen, print-visible,
              reached only once the gate passed. */}
      {reportMode === "advisor" && result && mcQuery.data?.result && (
        <div className="hidden print:block">
          <ReportRoot
            projectionResult={result}
            mcResult={mcQuery.data.result}
            deflate={deflate}
            coastFireAge={deterministicCoastFireAge}
            peopleNames={(people ?? enginePeople ?? []).map((p) => p.name)}
            generatedAt={new Date()}
            engineSettings={engineSettings}
            perPersonSettings={enginePerPersonSettings}
            rmdExcessYears={
              result.projectionByYear.filter(
                (y) => y.phase === "decumulation" && y.rmdExcessAmount > 0.01,
              ).length
            }
            qcdYears={
              result.projectionByYear.filter(
                (y) => y.phase === "decumulation" && y.qcdAmount > 0.01,
              ).length
            }
            irmaaCappedRothYears={
              result.projectionByYear.filter(
                (y) =>
                  y.phase === "decumulation" &&
                  y.rothConversionIrmaaCapped === true,
              ).length
            }
            bracketOptimizerResult={bracketOptimizerResult}
          />
        </div>
      )}
    </>
  );
}
