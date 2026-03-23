"use client";

/** In-browser test runner UI that executes Vitest suites via tRPC, with directory quick-run buttons, custom file filtering, and per-file pass/fail result display. */
import { useState } from "react";
import { trpc } from "@/lib/trpc";

const TEST_DIRS = [
  "tests/accessibility",
  "tests/benchmarks",
  "tests/calculators",
  "tests/components",
  "tests/config",
  "tests/edge-cases",
  "tests/integration",
];

export function TestRunner() {
  const [fileFilter, setFileFilter] = useState("");
  const runTests = trpc.testing.runTests.useMutation();

  const handleRunAll = () => runTests.mutate({});
  const handleRunFile = (file: string) => runTests.mutate({ fileFilter: file });
  const handleRunCustom = () => {
    if (fileFilter.trim()) runTests.mutate({ fileFilter: fileFilter.trim() });
  };

  const result = runTests.data;

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-medium text-primary">Tests</h3>

      {/* Run All */}
      <div className="flex items-center gap-3">
        <button
          onClick={handleRunAll}
          disabled={runTests.isPending}
          className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {runTests.isPending ? "Running..." : "Run All Tests"}
        </button>
      </div>

      {/* Custom filter */}
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={fileFilter}
          onChange={(e) => setFileFilter(e.target.value)}
          placeholder="tests/calculators/tax.test.ts"
          className="flex-1 block rounded border border-strong px-2 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          onKeyDown={(e) => e.key === "Enter" && handleRunCustom()}
        />
        <button
          onClick={handleRunCustom}
          disabled={runTests.isPending || !fileFilter.trim()}
          className="px-3 py-1.5 text-xs font-medium text-blue-600 border border-blue-300 rounded hover:bg-blue-50 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Run
        </button>
      </div>

      {/* Directory quick-run buttons */}
      <div className="flex flex-wrap gap-1.5">
        {TEST_DIRS.map((dir) => (
          <button
            key={dir}
            onClick={() => handleRunFile(dir)}
            disabled={runTests.isPending}
            className="px-2 py-1 text-[10px] font-medium text-muted border border-subtle rounded hover:bg-surface-elevated disabled:opacity-50"
          >
            {dir.replace("tests/", "")}
          </button>
        ))}
      </div>

      {/* Results */}
      {runTests.isPending && (
        <div className="text-sm text-muted animate-pulse">Running tests...</div>
      )}

      {runTests.isError && (
        <div className="text-sm text-red-600">
          Error: {runTests.error.message}
        </div>
      )}

      {result && (
        <div className="space-y-3">
          {/* Summary bar */}
          <div
            className={`px-3 py-2 rounded text-sm font-medium ${
              result.success
                ? "bg-green-50 text-green-700"
                : "bg-red-50 text-red-700"
            }`}
          >
            {result.numPassed > 0 && (
              <span className="text-green-600">{result.numPassed} passed</span>
            )}
            {result.numFailed > 0 && (
              <>
                {result.numPassed > 0 && " / "}
                <span className="text-red-600">{result.numFailed} failed</span>
              </>
            )}
            {result.numSkipped > 0 && (
              <>
                {" "}
                /{" "}
                <span className="text-muted">{result.numSkipped} skipped</span>
              </>
            )}
            <span className="text-muted ml-2">
              — {(result.duration / 1000).toFixed(1)}s
            </span>
          </div>

          {/* Per-file results */}
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {result.testFiles.map((file) => (
              <TestFileBlock key={file.file} file={file} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function TestFileBlock({
  file,
}: {
  file: {
    file: string;
    tests: { name: string; status: string; duration: number; error?: string }[];
  };
}) {
  const [expanded, setExpanded] = useState(
    file.tests.some((t) => t.status === "fail"),
  );
  const passed = file.tests.filter((t) => t.status === "pass").length;
  const failed = file.tests.filter((t) => t.status === "fail").length;

  return (
    <div className="border border-subtle rounded">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-3 py-1.5 text-xs hover:bg-surface-elevated"
      >
        <span className="font-mono text-muted truncate">{file.file}</span>
        <span className="flex items-center gap-2 shrink-0 ml-2">
          {passed > 0 && <span className="text-green-600">{passed} pass</span>}
          {failed > 0 && <span className="text-red-600">{failed} fail</span>}
          <span className="text-faint">{expanded ? "▼" : "▶"}</span>
        </span>
      </button>
      {expanded && (
        <div className="border-t border-subtle px-3 py-1.5 space-y-1">
          {file.tests.map((t, i) => (
            <div key={i}>
              <div className="flex items-center gap-2 text-[11px]">
                <span
                  className={
                    t.status === "pass"
                      ? "text-green-600"
                      : t.status === "fail"
                        ? "text-red-600"
                        : "text-muted"
                  }
                >
                  {t.status === "pass" ? "✓" : t.status === "fail" ? "✗" : "○"}
                </span>
                <span className="text-secondary truncate">{t.name}</span>
                <span className="text-faint ml-auto shrink-0">
                  {t.duration}ms
                </span>
              </div>
              {t.error && (
                <pre className="mt-1 p-2 bg-red-50 text-red-700 text-[10px] rounded overflow-x-auto max-h-40 overflow-y-auto whitespace-pre-wrap">
                  {t.error}
                </pre>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
