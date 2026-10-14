/**
 * Current glide path editor — Save only enables for a mix it can store:
 * whole ages, each once, every row adding to 100%.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CurrentGlidePathEditor } from "@/components/investments/current-glide-path-editor";

const mutate = vi.fn();
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      investments: { invalidate: vi.fn() },
      settings: { appSettings: { list: { invalidate: vi.fn() } } },
    }),
    settings: {
      appSettings: {
        upsert: { useMutation: () => ({ mutate, isPending: false }) },
      },
    },
  },
}));

function renderEditor() {
  render(
    <CurrentGlidePathEditor
      classes={[
        { assetClassId: 1, name: "Stocks" },
        { assetClassId: 2, name: "Bonds" },
      ]}
      currentGlidePath={[{ age: 40, allocations: { 1: 0.6, 2: 0.4 } }]}
      age={40}
      todaysTarget={{ 1: 0.6, 2: 0.4 }}
      onClose={() => {}}
    />,
  );
  return screen.getByRole("button", { name: "Save" });
}

describe("CurrentGlidePathEditor", () => {
  it("saves a valid mix", () => {
    const save = renderEditor();
    expect(save).toBeEnabled();
    fireEvent.click(save);
    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        value: [{ age: 40, allocations: { "1": 0.6, "2": 0.4 } }],
      }),
    );
  });

  it("won't save a cleared age (it isn't age 0)", () => {
    const save = renderEditor();
    fireEvent.change(screen.getByRole("spinbutton", { name: "Age" }), {
      target: { value: "" },
    });
    expect(save).toBeDisabled();
  });

  it("won't save a mix that doesn't add to 100%", () => {
    const save = renderEditor();
    fireEvent.change(
      screen.getByRole("spinbutton", { name: "Bonds % at age 40" }),
      { target: { value: "30" } },
    );
    expect(save).toBeDisabled();
  });
});
