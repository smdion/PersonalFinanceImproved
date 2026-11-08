import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { PreviewData } from "@/components/settings/integrations-types";
import { mutationCalls, resetTrpcMock } from "./trpc-mock";

vi.mock("@/lib/trpc", async () => ({
  trpc: (await import("./trpc-mock")).trpc,
}));

import { PortfolioSection } from "@/components/settings/integrations/portfolio-section";

beforeEach(() => {
  resetTrpcMock();
});

// Regression test for a live bug: two people sharing the same
// performanceAccountId (e.g. both have an IRA at the same institution) —
// the server (sync/preview.ts's portfolioLocalAccounts aggregation) correctly
// surfaces them as separate line items with distinct labels, but the
// client rendered/selected them using performanceAccountId alone, which
// collided. Caused a React duplicate-key warning AND a silent-wrong-mapping
// bug: selecting the second owner's account in "Link to existing" resolved
// to the first owner's account instead, since both <option> values were
// identical strings.

function makePortfolio(
  overrides: Partial<NonNullable<PreviewData["portfolio"]>> = {},
): NonNullable<PreviewData["portfolio"]> {
  return {
    snapshotDate: "2026-06-01",
    allAccounts: [],
    debtAccounts: [],
    localAccounts: [
      {
        label: "Traditional IRA — Alice",
        balance: 50000,
        performanceAccountId: 5,
        ownerPersonId: 1,
      },
      {
        label: "Traditional IRA — Bob",
        balance: 30000,
        performanceAccountId: 5,
        ownerPersonId: 2,
      },
    ],
    assetAccounts: [],
    mortgageAccounts: [],
    trackingAccounts: [
      {
        id: "remote-1",
        name: "Remote IRA",
        balance: 30000,
        type: "other",
      },
    ],
    existingMappings: [],
    ...overrides,
  };
}

describe("PortfolioSection — shared performanceAccountId across owners", () => {
  it("renders both owners' accounts without a duplicate-key collision", () => {
    const portfolio = makePortfolio();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(<PortfolioSection service="ynab" portfolio={portfolio} />);
    // Each account appears once in the "Add mapping" optgroup and once in
    // the per-tracking-account "Link to existing" select — 2 occurrences
    // each, not collapsed/duplicated/omitted by a React key collision.
    expect(screen.getAllByText(/Traditional IRA — Alice/)).toHaveLength(2);
    expect(screen.getAllByText(/Traditional IRA — Bob/)).toHaveLength(2);
    const keyWarning = errorSpy.mock.calls.find((c) =>
      String(c[0]).includes("same key"),
    );
    expect(keyWarning).toBeUndefined();
    errorSpy.mockRestore();
  });

  it("selecting the second owner's option in 'Link to existing' maps to that owner, not the first match", () => {
    const portfolio = makePortfolio();
    render(<PortfolioSection service="ynab" portfolio={portfolio} />);

    const select = screen
      .getByText("Link to existing...")
      .closest("select") as HTMLSelectElement;
    const bobOption = Array.from(select.options).find((o) =>
      o.textContent?.includes("Bob"),
    )!;
    fireEvent.change(select, { target: { value: bobOption.value } });

    expect(mutationCalls("sync.updateAccountMappings")).toHaveLength(1);
    const call = mutationCalls("sync.updateAccountMappings")[0] as {
      mappings: { localName: string }[];
    };
    const newMapping = call.mappings[call.mappings.length - 1]!;
    expect(newMapping.localName).toBe("Traditional IRA — Bob");
  });
});
