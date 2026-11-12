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
  trpc: (await import("../trpc-mock")).trpc,
}));
import { resetTrpcMock, setQuery } from "../trpc-mock";
import { LinkedBalanceCard } from "@/components/dashboard/linked-balance-card";
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
      unpricedMoves: [],
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

  it("an account with no holdings whose balance moved shows its balance change, never +$0.00", () => {
    setQuery("simplefin.listAccounts", [
      {
        id: 13,
        orgName: "Voya Financial",
        isIncluded: true,
        linkedPerformanceAccountId: 4,
        accountType: "hsa",
        subType: null,
      },
      {
        id: 14,
        orgName: "Ally",
        isIncluded: true,
        linkedPerformanceAccountId: 5,
        accountType: "brokerage",
        subType: null,
      },
    ]);
    const row = {
      snapshot: 1000,
      noSnapshot: false,
      source: "reported" as const,
      market: false,
      move: null,
    };
    setQuery("investments.getCurrentBalances", {
      target: "2026-11-05",
      snapshotDate: null,
      summary: { total: 1548.92 },
      feeds: [],
      balances: [
        {
          ...row,
          key: "hsa",
          feedIds: [13],
          performanceAccountId: 4,
          current: 1048.92,
          noHoldings: { institution: "Voya Financial", balance: -151.08 },
        },
        // Cash whose balance didn't move keeps its zero.
        {
          ...row,
          key: "cash",
          feedIds: [14],
          performanceAccountId: 5,
          current: 500,
          noHoldings: null,
        },
      ],
      movement: [close("2026-11-05", []), close("2026-11-04", [])],
      closeReports: [],
      unpricedMoves: [
        {
          key: "hsa",
          performanceAccountId: 4,
          label: "Voya HSA",
          account: "Voya HSA",
          institution: "Voya Financial",
          changed: [{ day: "2026-11-05", balance: -151.08 }],
        },
      ],
    });
    render(
      <TooltipProvider>
        <LinkedBalanceCard />
      </TooltipProvider>,
    );
    // The balance change is on hover only: no second line.
    expect(screen.queryByText(/market and deposits not split/)).toBeNull();
    expect(
      screen.getByTitle(
        "Balance −$151.08; Voya sends no holdings, so market and deposits can't be split",
      ),
    ).toHaveTextContent("—");
    expect(screen.getByText("+$0.00")).toBeInTheDocument();
    // Named once under the list, never on a line.
    expect(
      screen.getByText("Not in daily changes (no holdings): Voya HSA"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/excludes/)).toBeNull();
  });

  it("names each no-holdings account once under the list, whatever its closes did", () => {
    // Every case that once repeated an account on each line: a quiet day
    // (Nov 9→10), the latest close pending, an institution's report missing,
    // and an account held in parts that moved on one close only. No tracked
    // account list (inactive, or not loaded): named by the account's name.
    setQuery("investments.getCurrentBalances", {
      target: "2026-11-11",
      snapshotDate: null,
      summary: { total: 1000 },
      feeds: [],
      balances: [],
      movement: [
        close("2026-11-11", ["Fidelity Investments"]),
        close("2026-11-10", []),
        close("2026-11-09", ["Voya Financial"]),
        close("2026-11-06", []),
        close("2026-11-05", []),
      ],
      closeReports: [],
      unpricedMoves: [
        {
          key: "hsa",
          performanceAccountId: 4,
          label: "Joanna HSA (Voya)",
          account: "Joanna HSA (Voya)",
          institution: "Voya Financial",
          changed: [
            { day: "2026-11-11", balance: -151.08 },
            { day: "2026-11-06", balance: 40 },
            { day: "2026-11-05", balance: 860 },
          ],
        },
        {
          key: "part:7:trad",
          performanceAccountId: 7,
          label: "Joint IRA (Vanguard) — Joanna — Traditional",
          account: "Joint IRA (Vanguard)",
          institution: "Vanguard",
          changed: [{ day: "2026-11-06", balance: 1686 }],
        },
        {
          key: "part:7:roth",
          performanceAccountId: 7,
          label: "Joint IRA (Vanguard) — Joanna — Roth",
          account: "Joint IRA (Vanguard)",
          institution: "Vanguard",
          changed: [{ day: "2026-11-06", balance: 12 }],
        },
      ],
    });
    render(
      <TooltipProvider>
        <LinkedBalanceCard />
      </TooltipProvider>,
    );
    const line = screen.getByText(
      "Not in daily changes (no holdings): Joanna HSA (Voya) and Joint IRA (Vanguard)",
    );
    expect(line.getAttribute("title")).toBe(
      "These send balances but no holdings, so market moves and money paid in can't be split. Balance changes: Joanna HSA (Voya) Nov 11 −$151.08, Nov 6 +$40.00, Nov 5 +$860.00; Joint IRA (Vanguard) Nov 6 +$1,698.00.",
    );
    // Only that line names one, by name or by "holdings".
    expect(screen.getAllByText(/holdings/)).toHaveLength(1);
    expect(screen.getAllByText(/Joint IRA|Joanna HSA/)).toHaveLength(1);
    // What differs by line stays on its line.
    expect(screen.getByText("Fidelity change not in yet")).toBeInTheDocument();
    expect(screen.getByText("excludes Voya")).toBeInTheDocument();
  });

  it("names a feed SimpleFIN still lists whose balance stopped", () => {
    setQuery("simplefin.getStatus", {
      connected: true,
      staleFeeds: [
        { id: 2, institution: "Voya Financial", balanceDay: "2026-11-01" },
      ],
    });
    setQuery("investments.getCurrentBalances", {
      target: "2026-11-05",
      snapshotDate: null,
      summary: { total: 1000 },
      feeds: [],
      balances: [],
      movement: [close("2026-11-05", ["Voya Financial"])],
      closeReports: [],
      unpricedMoves: [],
    });
    render(
      <TooltipProvider>
        <LinkedBalanceCard />
      </TooltipProvider>,
    );
    expect(
      screen.getByText(
        "Voya hasn't updated since Nov 1: reconnect it in SimpleFIN Bridge",
      ),
    ).toBeInTheDocument();
  });
});
