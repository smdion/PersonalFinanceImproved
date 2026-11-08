/**
 * The push preview stays open while its push runs, so it shows the push's
 * result: Escape and a backdrop click cancel it only when nothing is pending.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { PushPreviewModal } from "@/components/ui/push-preview-modal";

afterEach(() => {
  cleanup();
});

const items = [
  { name: "Emergency Fund", field: "target", currentYnab: 0, newValue: 100 },
];

function renderPreview(isPending: boolean, onCancel = vi.fn()) {
  render(
    <PushPreviewModal
      title="Push to Actual"
      items={items}
      onConfirm={vi.fn()}
      onCancel={onCancel}
      isPending={isPending}
      destinationLabel="Actual"
    />,
  );
  return onCancel;
}

describe("PushPreviewModal while a push is pending", () => {
  it("ignores Escape and a backdrop click", () => {
    const onCancel = renderPreview(true);
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(screen.getByRole("presentation"));
    expect(onCancel).not.toHaveBeenCalled();
    expect(
      screen.getByRole("alertdialog", { name: "Push to Actual" }),
    ).toBeTruthy();
  });

  it("cancels on Escape and on a backdrop click when nothing is pending", () => {
    const onCancel = renderPreview(false);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("presentation"));
    expect(onCancel).toHaveBeenCalledTimes(2);
  });
});
