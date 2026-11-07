/**
 * Modal: the one dialog backdrop. Escape closes the top dialog only, the
 * backdrop closes it unless told not to, focus moves in, stays in, and goes
 * back to whatever opened it.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { Modal, type ModalProps } from "@/components/ui/modal";

afterEach(() => {
  cleanup();
});

function Opener(
  props: Pick<ModalProps, "closeOnEscape" | "closeOnBackdrop"> & {
    onClose?: () => void;
  },
) {
  const [open, setOpen] = useState(false);
  const { onClose, ...rest } = props;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      {open && (
        <Modal
          label="Test dialog"
          className="panel"
          {...rest}
          onClose={() => {
            onClose?.();
            setOpen(false);
          }}
        >
          <button type="button">First</button>
          <button type="button">Last</button>
        </Modal>
      )}
    </>
  );
}

function openWithClick() {
  const opener = screen.getByRole("button", { name: "Open" });
  opener.focus();
  fireEvent.click(opener);
  return opener;
}

describe("Modal", () => {
  it("is a named modal dialog with the shared backdrop and layer", () => {
    render(<Opener />);
    openWithClick();
    const dialog = screen.getByRole("dialog", { name: "Test dialog" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog.className).toContain("panel");
    const overlay = screen.getByRole("presentation");
    expect(overlay.className).toContain("z-[110]");
    expect(overlay.className).toContain("bg-black/40");
    expect(overlay.className).toContain("print:hidden");
  });

  it("takes alertdialog and aria-labelledby", () => {
    render(
      <Modal role="alertdialog" labelledBy="t" className="" onClose={() => {}}>
        <h2 id="t">Sure?</h2>
      </Modal>,
    );
    expect(screen.getByRole("alertdialog", { name: "Sure?" })).toBeTruthy();
  });

  it("moves focus into the dialog and returns it to the opener on close", () => {
    render(<Opener />);
    const opener = openWithClick();
    expect(screen.getByRole("dialog")).toBe(document.activeElement);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("leaves focus where a child put it on open (autoFocus)", () => {
    render(
      <Modal label="x" className="" onClose={() => {}}>
        <input aria-label="Amount" autoFocus />
      </Modal>,
    );
    expect(document.activeElement).toBe(screen.getByLabelText("Amount"));
  });

  it("keeps Tab inside the dialog", () => {
    render(<Opener />);
    openWithClick();
    const first = screen.getByRole("button", { name: "First" });
    const last = screen.getByRole("button", { name: "Last" });
    last.focus();
    fireEvent.keyDown(last, { key: "Tab" });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it("closes on Escape unless closeOnEscape is false", () => {
    const onClose = vi.fn();
    render(<Opener onClose={onClose} closeOnEscape={false} />);
    openWithClick();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("leaves an Escape a child already handled", () => {
    const onClose = vi.fn();
    render(
      <Modal label="x" className="" onClose={onClose}>
        <input
          aria-label="Cell"
          onKeyDown={(e) => {
            if (e.key === "Escape") e.preventDefault();
          }}
        />
      </Modal>,
    );
    fireEvent.keyDown(screen.getByLabelText("Cell"), { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes on a backdrop click, not a click inside", () => {
    const onClose = vi.fn();
    render(<Opener onClose={onClose} />);
    openWithClick();
    fireEvent.click(screen.getByRole("button", { name: "First" }));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("presentation"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("ignores a backdrop click when closeOnBackdrop is false", () => {
    const onClose = vi.fn();
    render(<Opener onClose={onClose} closeOnBackdrop={false} />);
    openWithClick();
    fireEvent.click(screen.getByRole("presentation"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("Escape closes only the dialog on top", () => {
    const outer = vi.fn();
    const inner = vi.fn();
    render(
      <Modal label="Outer" className="" onClose={outer}>
        <Modal label="Inner" className="" onClose={inner}>
          <p>inner</p>
        </Modal>
      </Modal>,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(inner).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
  });

  it("docks to the right edge with placement right", () => {
    render(
      <Modal label="x" className="" onClose={() => {}} placement="right">
        <p>x</p>
      </Modal>,
    );
    const overlay = screen.getByRole("presentation");
    expect(overlay.className).toContain("justify-end");
    expect(overlay.className).not.toContain("items-center");
  });
});
