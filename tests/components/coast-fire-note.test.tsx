import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { resetTrpcMock, setQuery } from "./trpc-mock";

// The Contributions page's Coast FIRE note reads computeCoastFire and the
// dashboard projection through the shared tRPC mock.
vi.mock("@/lib/trpc", async () => ({
  trpc: (await import("./trpc-mock")).trpc,
}));
vi.mock("@/lib/hooks/use-plan-engine-input", () => ({
  usePlanEngineInput: () => ({ input: {}, ready: true }),
}));
vi.mock("@/lib/hooks/use-dashboard-projection", () => ({
  useDashboardProjection: () => ({ data: undefined }),
}));

import { CoastFireNote } from "@/components/contributions/coast-fire-note";

afterEach(() => {
  resetTrpcMock();
});

describe("CoastFireNote", () => {
  it("shows what Coast FIRE's projection left out, once", () => {
    setQuery("projection.computeCoastFire", {
      result: { status: "found", coastFireAge: 50, retired: false },
      notes: ["A Coast FIRE note"],
    });
    render(<CoastFireNote />);
    expect(screen.getByText(/contributions could stop/)).toBeInTheDocument();
    expect(screen.getAllByText("A Coast FIRE note")).toHaveLength(1);
  });
});
