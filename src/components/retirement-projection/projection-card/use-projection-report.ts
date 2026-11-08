import { useEffect, useRef, useState } from "react";
import { checkReportGate } from "@/lib/pure/advice/report/mc-freshness";
import type { ReportGateFailure } from "@/lib/pure/advice/report/mc-freshness";
import type { ProjectionState } from "../projection-table-types";

export function useProjectionReport(
  state: ProjectionState,
  scenarioView: ProjectionState["scenarioView"],
  mcTaxMode: ProjectionState["mcTaxMode"],
  sharedInput: ProjectionState["sharedInput"],
  debouncedInput: ProjectionState["debouncedInput"],
  engineQuery: ProjectionState["engineQuery"],
  mcQuery: ProjectionState["mcQuery"],
) {
  // Print/export report. "none" = normal screen view (default print
  // behavior, unchanged). "basic" prints just the chart+table with page
  // chrome hidden. "advisor" (was "fancy") mounts the purpose-built
  // advisor-report document instead — ReportRoot, not the interactive
  // chart/table — hidden on screen via `hidden print:block`, so this is a
  // no-op on layout until printed. Only reachable after checkReportGate
  // passes (see handlePrintAdvisor below) — never printed with stale/
  // missing Monte Carlo data.
  const [reportMode, setReportMode] = useState<"none" | "basic" | "advisor">(
    "none",
  );
  const [gateFailure, setGateFailure] = useState<ReportGateFailure | null>(
    null,
  );
  const originalTitleRef = useRef<string>("");
  // "Print Chart & Table" is a deliberate export action, not a screenshot
  // of whatever's on screen — it should always include every year
  // regardless of the interactive table's own milestone-only toggle
  // state, restored after printing so it doesn't silently change what the
  // user was looking at on screen.
  const priorShowAllYearsRef = useRef<boolean | null>(null);
  const handlePrint = (mode: "basic" | "advisor") => {
    originalTitleRef.current = document.title;
    setReportMode(mode);
    document.title = `Retirement Projection - ${new Date().toLocaleDateString()}`;
    if (mode === "basic" && !state.showAllYears) {
      priorShowAllYearsRef.current = state.showAllYears;
      state.setShowAllYears(true);
    }
    // Two rAFs: one for React to commit the report-only DOM, one for the
    // browser to paint it, before the print dialog captures the page.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => window.print());
    });
  };
  const handlePrintAdvisor = () => {
    const gate = checkReportGate({
      scenarioView,
      mcTaxMode,
      sharedInput,
      debouncedInput,
      engineQuery: {
        isFetching: engineQuery.isFetching,
        isPlaceholderData: engineQuery.isPlaceholderData,
        data: engineQuery.data,
      },
      mcQuery: {
        isFetching: mcQuery.isFetching,
        data: mcQuery.data?.result ?? null,
      },
    });
    if (!gate.ok) {
      setGateFailure(gate.failure ?? null);
      return;
    }
    handlePrint("advisor");
  };
  useEffect(() => {
    const reset = () => {
      setReportMode("none");
      if (originalTitleRef.current) document.title = originalTitleRef.current;
      if (priorShowAllYearsRef.current != null) {
        state.setShowAllYears(priorShowAllYearsRef.current);
        priorShowAllYearsRef.current = null;
      }
    };
    window.addEventListener("afterprint", reset);
    return () => window.removeEventListener("afterprint", reset);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- state.setShowAllYears is a stable useState setter, safe to close over once
  }, []);
  return {
    reportMode,
    gateFailure,
    setGateFailure,
    handlePrint,
    handlePrintAdvisor,
  };
}
