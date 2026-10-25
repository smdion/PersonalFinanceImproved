/**
 * Recommendations page — who can hide a recommendation, and that quick
 * successive dismissals all stick. The page and its dismissals hook run for
 * real; only the data layer (tRPC, the signed-in user) and the ranked list
 * are stubbed.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { Recommendation } from "@/lib/pure/recommendations";

let role = "viewer";
vi.mock("@/lib/context/user-context", () => ({
  useUser: () => ({ role, name: "Test", permissions: [] }),
  isAdmin: (u: { role: string }) => u.role === "admin",
}));

const rec = (id: string, title: string): Recommendation => ({
  id,
  area: "moneyMoves",
  urgency: "soon",
  title,
  action: `Do ${title}`,
  context: "",
  impact: null,
  focus: { topic: "milestone", milestoneId: "protection" },
  source: "moneyGuy",
});
const recommendations = [rec("a", "First"), rec("b", "Second")];
vi.mock("@/lib/hooks/use-recommendations", () => ({
  useRecommendations: () => ({
    isLoading: false,
    error: null,
    recommendations,
    dismissed: [],
  }),
}));

// Each click sends its own change; the server merges it (settings router).
const mutate = vi.fn();
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      settings: { appSettings: { list: { invalidate: vi.fn() } } },
    }),
    settings: {
      appSettings: {
        list: { useQuery: () => ({ data: [] }) },
        setDismissal: {
          useMutation: () => ({ mutate, isPending: false }),
        },
      },
    },
  },
}));

async function renderPage() {
  const { RecommendationsContent } =
    await import("@/app/(dashboard)/recommendations/recommendations-content");
  return render(<RecommendationsContent />);
}

describe("RecommendationsContent", () => {
  beforeEach(() => {
    mutate.mockClear();
  });

  it("viewers see the recommendations but no snooze or dismiss controls", async () => {
    role = "viewer";
    await renderPage();
    expect(screen.getAllByText("Do First").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Dismiss" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Snooze" })).toBeNull();
  });

  it("each dismissal sends only its own change (the server merges them)", async () => {
    role = "admin";
    await renderPage();
    const dismiss = (n: number) => {
      fireEvent.click(screen.getAllByRole("button", { name: "Dismiss" })[n]!);
      fireEvent.submit(
        screen.getByRole("textbox", { name: "Why dismiss" }).closest("form")!,
      );
    };
    dismiss(0);
    dismiss(1);
    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(2));
    expect(mutate.mock.calls.map(([c]) => c.id)).toEqual(["a", "b"]);
    expect(mutate.mock.calls[0]![0].value).toMatchObject({ until: null });
  });
});
