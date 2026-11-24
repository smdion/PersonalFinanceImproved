import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { resetTrpcMock, setQuery } from "./trpc-mock";

// The page's queries go through the shared tRPC mock; its tools and the
// assumptions band are stubbed (their own tests cover them).
vi.mock("@/lib/trpc", async () => ({
  trpc: (await import("./trpc-mock")).trpc,
}));
vi.mock("@/lib/context/user-context", () => ({
  useUser: () => ({ role: "admin", name: "Test", permissions: [] }),
  isAdmin: (u: { role: string }) => u.role === "admin",
}));
vi.mock("@/lib/hooks/use-active-retirement-profile", () => ({
  useActiveRetirementProfile: () => [null, vi.fn()],
}));
vi.mock("@/lib/hooks/use-effective-profile-id", () => ({
  useEffectiveProfileId: () => ({ profileId: null }),
}));
vi.mock("@/components/retirement/assumptions-band", () => ({
  AssumptionsBand: () => null,
}));
vi.mock("@/components/tax-optimization/roth-explorer", () => ({
  RothExplorer: () => null,
}));
vi.mock("@/components/tax-optimization/withdrawal-comparison", () => ({
  WithdrawalComparison: () => null,
}));
vi.mock("@/components/tax-optimization/irmaa-cliff-alert", () => ({
  IrmaaCliffAlert: () => null,
}));

import { TaxOptimizationContent } from "@/app/(dashboard)/tax-optimization/tax-optimization-content";

afterEach(() => {
  resetTrpcMock();
});

describe("TaxOptimizationContent", () => {
  it("shows what the page's projection left out, once", () => {
    setQuery("retirement.retirementProfiles.list", []);
    setQuery("projection.getProjectionMetadata", {
      result: null,
      settings: {},
      perPersonSettings: [],
    });
    setQuery("projection.computeTaxProjection", {
      rows: [{ year: 2050, age: 65 }],
      meta: { bracketsThroughYear: 2026 },
      notes: ["A tax note"],
    });
    render(<TaxOptimizationContent />);
    expect(screen.getAllByText("A tax note")).toHaveLength(1);
  });
});
