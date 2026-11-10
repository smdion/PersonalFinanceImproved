/**
 * Exit Demo on a household install ends the demo on the server: the cookie
 * is HttpOnly, so the browser can't clear it, and every page (and the
 * versions routes' 409) would keep reading the demo.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
}));
vi.mock("@/lib/trpc", async () => ({
  trpc: (await import("./trpc-mock")).trpc,
}));

import { mutationCalls, resetTrpcMock } from "./trpc-mock";
import { DemoBanner } from "@/components/layout/demo-banner";

describe("DemoBanner", () => {
  beforeEach(() => {
    resetTrpcMock();
    push.mockClear();
  });

  it("Exit Demo deactivates the demo on the server, then goes home", async () => {
    render(<DemoBanner profileName="Single income" />);
    fireEvent.click(screen.getByRole("button", { name: "Exit Demo" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/"));
    expect(mutationCalls("demo.deactivateDemo")).toHaveLength(1);
  });

  it("Switch Profile in a demo-only instance goes to the chooser and keeps the demo", async () => {
    render(<DemoBanner profileName="Single income" isDemoOnly />);
    fireEvent.click(screen.getByRole("button", { name: "Switch Profile" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/demo"));
    expect(mutationCalls("demo.deactivateDemo")).toHaveLength(0);
  });
});
