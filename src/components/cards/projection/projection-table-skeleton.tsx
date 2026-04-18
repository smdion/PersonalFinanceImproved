/** Loading skeleton for ProjectionTable — full-width, matches the real table's
 *  column structure (Timeline | Contributions | Balances | Notes) so the layout
 *  doesn't shift when data arrives. Uses the same min-width and overflow-x-auto
 *  wrapper as the real table. */

// Column definitions mirror the real table's default "tax type" view:
// Timeline (3) + Contributions (6) + Balances (6) + Notes (1) = 16 columns.
// flex-grow values are proportional to real column widths.
const COLS = [
  // Timeline
  { id: "Year", grow: 3 },
  { id: "Age", grow: 2.5 },
  { id: "Phase", grow: 3.5 },
  // Contributions
  { id: "Salary", grow: 5 },
  { id: "Rate", grow: 3 },
  { id: "401k", grow: 5 },
  { id: "IRA", grow: 4.5 },
  { id: "HSA", grow: 4 },
  { id: "Broker", grow: 4.5 },
  // Balances
  { id: "InOut", grow: 5 },
  { id: "Trad", grow: 6 },
  { id: "Roth", grow: 5.5 },
  { id: "HSABal", grow: 5 },
  { id: "AfterTax", grow: 5.5 },
  { id: "Balance", grow: 6 },
  // Notes
  { id: "Notes", grow: 5 },
];

// Group header labels with span counts matching COLS above
const GROUPS = [
  { id: "g-timeline", label: "Timeline", span: 3 },
  { id: "g-contrib", label: "Contributions", span: 6 },
  { id: "g-balances", label: "Balances", span: 6 },
  { id: "g-notes", label: "Notes", span: 1 },
];

// Header shimmer widths (% of cell) — shorter for narrow cols, longer for wide
const HDR_FILLS = [
  55, 45, 50, 70, 55, 60, 55, 55, 60, 65, 70, 65, 60, 65, 75, 60,
];

// 8 data rows with staggered animation delays and per-cell fill %
const ROWS = [
  {
    id: "r0",
    delay: 0,
    fills: [55, 45, 55, 75, 60, 78, 72, 70, 74, 70, 80, 78, 72, 76, 85, 65],
  },
  {
    id: "r1",
    delay: 60,
    fills: [55, 45, 55, 70, 60, 72, 68, 65, 70, 68, 78, 74, 68, 72, 82, 0],
  },
  {
    id: "r2",
    delay: 120,
    fills: [55, 45, 55, 78, 60, 76, 74, 68, 72, 72, 82, 76, 70, 78, 88, 0],
  },
  {
    id: "r3",
    delay: 180,
    fills: [55, 45, 55, 72, 60, 70, 66, 62, 68, 66, 76, 72, 66, 74, 84, 0],
  },
  {
    id: "r4",
    delay: 240,
    fills: [55, 45, 60, 76, 60, 74, 70, 66, 74, 70, 80, 76, 70, 76, 86, 70],
  },
  {
    id: "r5",
    delay: 300,
    fills: [55, 45, 60, 70, 60, 68, 72, 64, 70, 68, 78, 74, 68, 72, 82, 0],
  },
  {
    id: "r6",
    delay: 360,
    fills: [55, 45, 60, 74, 60, 72, 68, 68, 72, 72, 82, 78, 72, 76, 86, 0],
  },
  {
    id: "r7",
    delay: 420,
    fills: [55, 45, 60, 68, 60, 76, 64, 62, 68, 66, 76, 72, 66, 70, 84, 0],
  },
];

export function ProjectionTableSkeleton() {
  return (
    <div className="space-y-2">
      {/* Controls row — mirrors Contributions / Balances / Show All Years pills */}
      <div className="flex items-center gap-3 flex-wrap">
        <div
          className="h-6 w-36 rounded-md bg-surface-strong animate-pulse"
          style={{ animationDuration: "1.8s" }}
        />
        <div className="w-px h-4 bg-surface-strong" />
        <div
          className="h-6 w-36 rounded-md bg-surface-strong animate-pulse"
          style={{ animationDelay: "100ms", animationDuration: "1.8s" }}
        />
        <div className="w-px h-4 bg-surface-strong" />
        <div
          className="h-6 w-24 rounded-md bg-surface-strong animate-pulse"
          style={{ animationDelay: "200ms", animationDuration: "1.8s" }}
        />
      </div>

      {/* Table — overflow-x-auto + min-width matches real table */}
      <div className="overflow-x-auto">
        <div style={{ minWidth: 1100 }}>
          {/* Group header row — py-1 matches real table's group header */}
          <div className="flex border-b border-subtle/60 py-1">
            {GROUPS.map(({ id, label, span }) => {
              const groupCols = COLS.slice(
                GROUPS.slice(
                  0,
                  GROUPS.indexOf(GROUPS.find((g) => g.id === id)!),
                ).reduce((acc, g) => acc + g.span, 0),
                GROUPS.slice(
                  0,
                  GROUPS.indexOf(GROUPS.find((g) => g.id === id)!),
                ).reduce((acc, g) => acc + g.span, 0) + span,
              );
              const totalGrow = groupCols.reduce((a, c) => a + c.grow, 0);
              return (
                <div
                  key={id}
                  className="text-center"
                  style={{ flex: totalGrow }}
                >
                  <span className="text-[10px] text-faint/60 font-semibold uppercase tracking-wider">
                    {label}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Column header shimmer row */}
          <div className="flex items-center gap-1 py-1.5 border-b border-subtle">
            {COLS.map(({ id }, ci) => (
              <div
                key={id}
                className="flex justify-center"
                style={{ flex: COLS[ci].grow }}
              >
                <div
                  className="h-2.5 rounded bg-surface-strong/60 animate-pulse"
                  style={{
                    width: `${HDR_FILLS[ci]}%`,
                    animationDuration: "1.8s",
                  }}
                />
              </div>
            ))}
          </div>

          {/* Data rows */}
          {ROWS.map(({ id, delay, fills }) => (
            <div
              key={id}
              className="flex items-center gap-1 py-1.5 border-b border-subtle/40 last:border-0"
            >
              {COLS.map(({ id: cid }, ci) => (
                <div
                  key={`${id}-${cid}`}
                  className="flex justify-center"
                  style={{ flex: COLS[ci].grow }}
                >
                  {fills[ci] > 0 && (
                    <div
                      className="h-3.5 rounded bg-surface-strong animate-pulse"
                      style={{
                        width: `${fills[ci]}%`,
                        animationDelay: `${delay}ms`,
                        animationDuration: "1.8s",
                      }}
                    />
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
