/** SimpleFIN settings: a stale institution's accounts carry the reconnect
 *  message, and only that institution's. Invented accounts. */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import * as trpcMock from "./trpc-mock";

vi.mock("@/lib/trpc", async () => ({
  trpc: (await import("./trpc-mock")).trpc,
}));
vi.mock("@/lib/context/user-context", () => ({
  useUser: () => ({ role: "admin", permissions: [] }),
  hasPermission: () => true,
}));

import { SimplefinCard } from "@/components/settings/integrations-simplefin";

const account = (id: number, orgName: string, accountName: string) => ({
  id,
  orgName,
  accountName,
  isIncluded: true,
  lastBalance: 1000,
  lastBalanceDate: "2026-11-06T06:00:00Z",
  lastSeenAt: "2026-11-06T13:50:00Z",
  linkedPerformanceAccountId: null,
  linkedLoanId: null,
});

describe("SimplefinCard stale feeds", () => {
  beforeEach(() => {
    trpcMock.resetTrpcMock();
    trpcMock.setQuery("simplefin.getStatus", {
      connected: true,
      lastSyncedAt: "2026-11-06T13:50:00Z",
      lastError: null,
      staleFeeds: [
        { id: 2, institution: "Voya Financial", balanceDay: "2026-11-01" },
      ],
    });
    trpcMock.setQuery("simplefin.listAccounts", [
      account(1, "Fidelity Investments", "Brokerage (1111)"),
      account(2, "Voya Financial", "Example 401(k) Plan (2222)"),
    ]);
  });

  it("puts the reconnect message under the stale institution only", () => {
    render(<SimplefinCard />);
    const message = screen.getByText(
      "Voya hasn't updated since Nov 1: reconnect it in SimpleFIN Bridge",
    );
    expect(message.parentElement).toHaveTextContent(/^Voya Financial/);
    expect(
      screen.getAllByText(/reconnect it in SimpleFIN Bridge/),
    ).toHaveLength(1);
  });
});
