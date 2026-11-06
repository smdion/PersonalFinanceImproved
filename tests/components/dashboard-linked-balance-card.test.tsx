/**
 * The Current Balances card's notes on its daily changes, as rendered: a
 * report that never came is named by its days, "not in yet" only for the
 * latest close's, and each run of missing reports gets one line with the
 * account's move across it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/components/ui/help-tip", () => ({ HelpTip: () => null }));
vi.mock("@/lib/context/user-context", () => ({
  useUser: () => ({ role: "admin", permissions: [] }),
  hasPermission: () => true,
}));
vi.mock("@/lib/trpc", async () => ({
  trpc: (await import("./trpc-mock")).trpc,
}));
import { resetTrpcMock, setQuery } from "./trpc-mock";
import { LinkedBalanceCard } from "@/components/cards/dashboard/linked-balance-card";
import { TooltipProvider } from "@/components/ui/tooltip";

const DAYS = [
  "2026-10-29",
  "2026-10-30",
  "2026-11-02",
  "2026-11-03",
  "2026-11-04",
  "2026-11-05",
];
const GONE = ["2026-11-02", "2026-11-03", "2026-11-04"];
const close = (day: string, missing: string[]) => ({
  day,
  move: 10,
  known: 1,
  total: 2,
  missing,
  flows: 0,
  unreported: null,
});

beforeEach(() => {
  resetTrpcMock();
  setQuery("simplefin.getStatus", { connected: true });
  setQuery("simplefin.listBalanceHistory", [
    { totalBalance: 1000, accountCount: 2 },
  ]);
  setQuery("simplefin.listAccounts", []);
  setQuery("simplefin.listMatchableAccounts", []);
});

describe("LinkedBalanceCard daily change notes", () => {
  it("names the missing reports, keeps 'not in yet' for the latest close's, and sums the gap", () => {
    setQuery("investments.getCurrentBalances", {
      target: "2026-11-05",
      snapshotDate: null,
      summary: { total: 1000 },
      feeds: [],
      balances: [],
      movement: [
        close("2026-11-05", ["Fidelity Investments", "Voya"]),
        close("2026-11-04", ["Voya"]),
        close("2026-11-03", ["Voya"]),
        close("2026-11-02", ["Voya"]),
        close("2026-10-30", []),
      ],
      closeReports: [
        {
          key: "brokerage",
          name: "Fidelity Investments",
          closes: DAYS.map((day) => ({ day, valued: day !== "2026-11-05" })),
          gaps: [],
        },
        {
          key: "401k",
          name: "Voya",
          closes: DAYS.map((day) => ({ day, valued: !GONE.includes(day) })),
          gaps: [
            {
              before: "2026-10-30",
              after: "2026-11-05",
              missing: GONE,
              move: -5821.75,
            },
          ],
        },
      ],
    });
    render(
      <TooltipProvider>
        <LinkedBalanceCard />
      </TooltipProvider>,
    );
    expect(
      screen.getByText("Fidelity change not in yet · no Voya report Nov 2–4"),
    ).toBeInTheDocument();
    // Nov 2→3, 3→4 and Oct 30→Nov 2 each touch the same run.
    expect(screen.getAllByText("no Voya report Nov 2–4")).toHaveLength(3);
    expect(screen.queryByText(/excludes/)).toBeNull();
    expect(
      screen.getByText(
        "Voya: −$5,821.75 Oct 30 → Nov 5 (no daily reports Nov 2–4)",
      ),
    ).toBeInTheDocument();
    expect(
      screen
        .getByText("Fidelity change not in yet · no Voya report Nov 2–4")
        .getAttribute("title"),
    ).toContain("Voya sent no report for Nov 2–4");
  });
});
