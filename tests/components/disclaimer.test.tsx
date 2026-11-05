/**
 * The shared disclaimer on the pages without a test of their own here:
 * Milestones, Plan Health and the printed report (Recommendations, the
 * Checkup, Retirement and the claiming-age explorer assert it in theirs).
 * Each page's children are stubbed: only the disclaimer is under test.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { evaluateMilestones } from "@/lib/pure/advice/milestones/milestones";
import { makeInput } from "../fixtures/milestones";
import { setQueryState } from "./trpc-mock";

const DISCLAIMER =
  "Estimates from the figures and assumptions you entered. Not financial, tax or legal advice.";

vi.mock("@/lib/context/user-context", () => ({
  useUser: () => ({ role: "viewer", name: "Test", permissions: [] }),
  isAdmin: (u: { role: string }) => u.role === "admin",
}));
const input = makeInput({});
vi.mock("@/lib/hooks/use-milestones", () => ({
  useMilestones: () => ({
    isLoading: false,
    projectionLoading: false,
    error: false,
    input,
    results: evaluateMilestones(input),
  }),
}));
vi.mock("@/lib/hooks/use-first-reached", () => ({
  useFirstReached: () => () => null,
}));
vi.mock("@/components/milestones/milestone-settings", () => ({
  AddCustomGoal: () => null,
  CheckpointSourcePicker: () => null,
  SavingsTargetSourcePicker: () => null,
  MilestoneChecklistEditor: () => null,
  useCustomGoalActions: () => ({ isPending: false, remove: vi.fn() }),
}));
vi.mock("@/components/milestones/milestones-hero", () => ({
  MilestonesHero: () => null,
}));
vi.mock("@/components/milestones/foo-ladder", () => ({
  FooLadder: () => null,
}));
vi.mock("@/components/milestones/milestone-row", () => ({
  MilestoneRow: () => null,
}));
vi.mock("@/components/ui/balanced-columns", () => ({
  BalancedColumns: () => null,
}));
vi.mock("@/lib/trpc", async () => ({
  trpc: (await import("./trpc-mock")).trpc,
}));

// The stress test is still loading.
setQueryState("projection.computeStressTest", { isLoading: true });

describe("the shared disclaimer", () => {
  it("Milestones shows it", async () => {
    const { MilestonesContent } =
      await import("@/app/(dashboard)/milestones/milestones-content");
    render(<MilestonesContent />);
    expect(screen.getByText(DISCLAIMER)).toBeInTheDocument();
  });

  it("Plan Health shows it", async () => {
    const { PlanHealthCard } = await import("@/components/cards/plan-health");
    render(<PlanHealthCard deterministicNestEgg={1_000_000} />);
    expect(screen.getByText(DISCLAIMER)).toBeInTheDocument();
  });

  it("the report's footer shows it and keeps the risk-analysis note", async () => {
    const { ReportFooter } =
      await import("@/components/cards/projection/report/report-header");
    render(<ReportFooter generatedAt={new Date("2026-11-03T12:00:00Z")} />);
    expect(screen.getByText(DISCLAIMER)).toBeInTheDocument();
    expect(
      screen.getByText(/The risk analysis in this report/),
    ).toBeInTheDocument();
  });
});
