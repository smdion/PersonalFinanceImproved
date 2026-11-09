/**
 * A backup's file input is cleared after each pick, so picking the same
 * (corrected) file again after a refused import or first-run restore
 * retries it. A browser fires `change` only when the input's value
 * changes; `pick` does the same.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { resetTrpcMock, setQuery } from "./trpc-mock";

vi.mock("@/lib/context/user-context", () => ({
  useUser: () => ({ role: "admin", name: "Test", permissions: [] }),
  isAdmin: () => true,
}));
vi.mock("@/lib/trpc", async () => ({
  trpc: (await import("./trpc-mock")).trpc,
}));

const file = new File(['{"tables":{}}'], "backup.json");

/** Picks `picked` as a browser does: no `change` when the value is the same. */
function pick(input: HTMLInputElement, picked: File) {
  const path = `C:\\fakepath\\${picked.name}`;
  if (input.value === path) return;
  Object.defineProperty(input, "files", {
    configurable: true,
    value: [picked],
  });
  let value = path;
  Object.defineProperty(input, "value", {
    configurable: true,
    get: () => value,
    set: (v: string) => {
      value = v;
    },
  });
  fireEvent.change(input);
}

const refused = {
  ok: false,
  json: async () => ({ error: "correct the backup" }),
};

beforeEach(() => {
  resetTrpcMock();
  setQuery("version.list", []);
  setQuery("version.getRetention", { retentionCount: 30 });
  setQuery("settings.getFirstRunState", { adminNeeded: false });
});
afterEach(() => vi.unstubAllGlobals());

describe("picking the same backup file again", () => {
  it("retries an import the Versions page refused", async () => {
    const fetch = vi.fn().mockResolvedValue(refused);
    vi.stubGlobal("fetch", fetch);
    const { VersionsContent } =
      await import("@/app/(dashboard)/versions/versions-content");
    const { container } = render(<VersionsContent />);
    const input =
      container.querySelector<HTMLInputElement>('input[type="file"]')!;

    const importOnce = async () => {
      pick(input, file);
      fireEvent.change(screen.getByPlaceholderText("IMPORT"), {
        target: { value: "IMPORT" },
      });
      const confirm = screen
        .getAllByRole("button", { name: "Import" })
        .find((b) => b.className.includes("bg-amber-600"))!;
      await act(async () => fireEvent.click(confirm));
      await screen.findByText("correct the backup");
    };

    await importOnce();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    await importOnce();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("retries a first-run restore that was refused", async () => {
    const fetch = vi.fn().mockResolvedValue(refused);
    vi.stubGlobal("fetch", fetch);
    const { OnboardingWizard } =
      await import("@/components/onboarding/onboarding-wizard");
    const { container } = render(<OnboardingWizard onComplete={() => {}} />);
    const input =
      container.querySelector<HTMLInputElement>('input[type="file"]')!;

    pick(input, file);
    await screen.findByText("correct the backup");
    pick(input, file);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  });
});
