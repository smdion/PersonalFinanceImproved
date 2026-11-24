import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { resetTrpcMock, setQuery } from "./trpc-mock";

// The stress test panel inside PlanHealthCard calls
// trpc.projection.computeStressTest.useQuery directly.
vi.mock("@/lib/trpc", async () => ({
  trpc: (await import("./trpc-mock")).trpc,
}));

import { PlanHealthCard } from "@/components/retirement/plan-health";

afterEach(() => {
  resetTrpcMock();
});

describe("PlanHealthCard's stress test", () => {
  it("shows what the stress test's projection left out", () => {
    setQuery("projection.computeStressTest", {
      scenarios: [],
      retirementAge: 65,
      notes: ["A stress test note"],
    });
    render(<PlanHealthCard retirementHorizonYears={30} />);
    expect(screen.getByText("A stress test note")).toBeInTheDocument();
  });
});
