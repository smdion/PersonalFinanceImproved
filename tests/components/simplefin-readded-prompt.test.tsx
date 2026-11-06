/** The "re-added account" merge prompt in SimpleFIN settings. Invented accounts. */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import * as trpcMock from "./trpc-mock";

vi.mock("@/lib/trpc", async () => ({
  trpc: (await import("./trpc-mock")).trpc,
}));
const user = { role: "viewer", permissions: ["sync"] as string[] };
vi.mock("@/lib/context/user-context", () => ({
  useUser: () => user,
  hasPermission: (u: typeof user, p: string) =>
    u.role === "admin" || u.permissions.includes(p),
}));
const confirmWithDiff = vi.fn(
  async (_message: string, _lines: string[], _label?: string) => true,
);
vi.mock("@/components/ui/confirm-dialog", () => ({
  confirmWithDiff: (message: string, lines: string[], label?: string) =>
    confirmWithDiff(message, lines, label),
}));

import { ReaddedMergePrompt } from "@/components/settings/simplefin-readded-prompt";

const copy = { id: 5040, accountName: "Example 401(k) Plan (1111)" };

describe("ReaddedMergePrompt", () => {
  beforeEach(() => {
    trpcMock.resetTrpcMock();
    user.permissions = ["sync"];
    confirmWithDiff.mockClear();
    trpcMock.setQuery("simplefin.listReaddedAccounts", [
      {
        copyId: 5040,
        candidates: [
          {
            id: 10,
            accountName: "Example 401(k) Plan (1111)",
            exactName: true,
            linked: true,
          },
        ],
      },
    ]);
    trpcMock.holdMutation("simplefin.mergeReaddedAccount");
  });

  it("offers the merge and sends it only after the confirm, which says it can't be undone", async () => {
    render(<ReaddedMergePrompt account={copy} />);
    expect(screen.getByText(/Looks like a re-added account/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Merge" }));
    await waitFor(() =>
      expect(trpcMock.mutationCalls("simplefin.mergeReaddedAccount")).toEqual([
        { copyId: 5040, keepId: 10 },
      ]),
    );
    const [message, lines] = confirmWithDiff.mock.calls[0]!;
    expect(message).toMatch(/can't be undone/);
    expect(lines.join(" ")).toMatch(/links/);
  });

  it("sends nothing when the confirm is cancelled", async () => {
    confirmWithDiff.mockResolvedValueOnce(false);
    render(<ReaddedMergePrompt account={copy} />);
    fireEvent.click(screen.getByRole("button", { name: "Merge" }));
    await waitFor(() => expect(confirmWithDiff).toHaveBeenCalled());
    expect(trpcMock.mutationCalls("simplefin.mergeReaddedAccount")).toEqual([]);
  });

  it("shows nothing for an account with no candidate", () => {
    const { container } = render(
      <ReaddedMergePrompt account={{ id: 1, accountName: "Checking" }} />,
    );
    expect(container.textContent).toBe("");
  });

  it("shows nothing without the sync permission the merge needs", () => {
    user.permissions = [];
    const { container } = render(<ReaddedMergePrompt account={copy} />);
    expect(container.textContent).toBe("");
  });
});
