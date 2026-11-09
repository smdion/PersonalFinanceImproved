import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { resetTrpcMock, setMutationResult, setQuery } from "./trpc-mock";

// The Versions page lists the values a restore or import set to their
// column's default, until dismissed; a restore or import that changed none
// lists nothing.

vi.mock("@/lib/context/user-context", () => ({
  useUser: () => ({ role: "admin", name: "Test", permissions: [] }),
  isAdmin: () => true,
}));
vi.mock("@/lib/trpc", async () => ({
  trpc: (await import("./trpc-mock")).trpc,
}));

const note = {
  table: "retirement_settings",
  column: "withdrawal_strategy",
  value: "retired_strategy",
  rows: 1,
  defaultedTo: "fixed",
};
const NOTE_LINE =
  'retirement settings, withdrawal strategy: "retired_strategy" became fixed (1 row)';

async function renderPage() {
  const { VersionsContent } =
    await import("@/app/(dashboard)/versions/versions-content");
  return render(<VersionsContent />);
}

describe("Versions page: values a restore or import set to their default", () => {
  beforeEach(() => {
    resetTrpcMock();
    setQuery("version.list", [
      {
        id: 4,
        name: "Spring",
        description: null,
        versionType: "manual",
        schemaVersion: "0017",
        tableCount: 80,
        totalRows: 100,
        sizeEstimateBytes: 2048,
        createdAt: "2026-04-01T12:00:00.000Z",
        createdBy: "test",
      },
    ]);
    setQuery("version.getRetention", { retentionCount: 30 });
    setQuery("version.listRestoreDataLoss", []);
  });
  afterEach(() => vi.unstubAllGlobals());

  async function restore() {
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    fireEvent.click(
      screen.getByLabelText("Create backup of current state before restoring"),
    );
    fireEvent.change(screen.getByPlaceholderText("Spring"), {
      target: { value: "Spring" },
    });
    const confirm = screen
      .getAllByRole("button", { name: "Restore" })
      .find((b) => b.className.includes("bg-amber-600"))!;
    await act(async () => fireEvent.click(confirm));
  }

  it("lists a restore's notes, and Dismiss clears them", async () => {
    setMutationResult("version.restore", {
      restoredTables: 80,
      restoredRows: 100,
      valueNotes: [note],
    });
    await renderPage();
    await restore();
    const item = await screen.findByText(/withdrawal strategy/);
    expect(item.textContent).toBe(NOTE_LINE);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText(/withdrawal strategy/)).toBeNull();
  });

  it("lists nothing after a restore that changed no value", async () => {
    setMutationResult("version.restore", {
      restoredTables: 80,
      restoredRows: 100,
      valueNotes: [],
    });
    await renderPage();
    await restore();
    expect(screen.queryByText(/set to their defaults/)).toBeNull();
  });

  it("lists an import's notes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
          restoredTables: 80,
          restoredRows: 100,
          valueNotes: [note],
        }),
      }),
    );
    const { container } = await renderPage();
    const input =
      container.querySelector<HTMLInputElement>('input[type="file"]')!;
    const file = new File(['{"tables":{}}'], "backup.json");
    fireEvent.change(input, { target: { files: [file] } });
    fireEvent.change(screen.getByPlaceholderText("IMPORT"), {
      target: { value: "IMPORT" },
    });
    const confirm = screen
      .getAllByRole("button", { name: "Import" })
      .find((b) => b.className.includes("bg-amber-600"))!;
    await act(async () => fireEvent.click(confirm));
    await waitFor(() =>
      expect(screen.getByText(/withdrawal strategy/).textContent).toBe(
        NOTE_LINE,
      ),
    );
  });
});
