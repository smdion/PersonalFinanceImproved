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
  href: "/milestones",
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

// The saved settings row the server holds; upsert writes it, fetch reads it.
let saved: { key: string; value: unknown }[] = [];
const mutateAsync = vi.fn(async (input: { key: string; value: unknown }) => {
  // Simulate a slow server so a second click lands before the first is done.
  await new Promise((r) => setTimeout(r, 5));
  saved = [{ key: input.key, value: input.value }];
});
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      settings: {
        appSettings: {
          list: {
            invalidate: vi.fn(),
            fetch: vi.fn(async () => saved),
          },
        },
      },
    }),
    settings: {
      appSettings: {
        // The page's cached copy stays stale on purpose.
        list: { useQuery: () => ({ data: [] }) },
        upsert: {
          useMutation: () => ({ mutateAsync, isPending: false }),
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
    saved = [];
    mutateAsync.mockClear();
  });

  it("viewers see the recommendations but no snooze or dismiss controls", async () => {
    role = "viewer";
    await renderPage();
    expect(screen.getAllByText("Do First").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Dismiss" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Snooze" })).toBeNull();
  });

  it("two quick dismissals both stick (the second doesn't overwrite the first)", async () => {
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
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(2));
    expect(Object.keys(saved[0]!.value as object).sort()).toEqual(["a", "b"]);
  });
});
