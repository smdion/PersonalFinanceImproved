/**
 * Modal: the one dialog backdrop. Escape closes the top dialog only, the
 * backdrop closes it unless told not to, focus moves in, stays in (a Tab
 * from outside goes back in), and goes back to whatever opened it.
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

  it.each([
    ["Tab", false, "First"],
    ["Shift+Tab", true, "Last"],
  ])(
    "sends %s from outside the dialog back in (a focused button disabled itself)",
    (_, shiftKey, name) => {
      render(<Opener />);
      openWithClick();
      const first = screen.getByRole("button", { name: "First" });
      first.focus();
      first.blur();
      expect(document.activeElement).toBe(document.body);
      fireEvent.keyDown(document.body, { key: "Tab", shiftKey });
      expect(document.activeElement).toBe(screen.getByRole("button", { name }));
    },
  );

  it("leaves Tab outside alone for all but the newest dialog", () => {
    render(
      <>
        <Modal label="Outer" className="" onClose={() => {}}>
          <button type="button">Outer button</button>
        </Modal>
        <Modal label="Inner" className="" onClose={() => {}}>
          <button type="button">Inner button</button>
        </Modal>
      </>,
    );
    document.body.focus();
    fireEvent.keyDown(document.body, { key: "Tab" });
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Inner button" }),
    );
  });

  it("stays on top when the first-run wizard mounts under it later (a hydration re-render)", () => {
    const quickClose = vi.fn();
    const wizardClose = vi.fn();
    const quick = (
      <Modal label="Quick search" className="" onClose={quickClose}>
        <input aria-label="Search pages" autoFocus />
      </Modal>
    );
    const wizard = (
      <Modal
        label="Set up Ledgr"
        className=""
        layer="firstRun"
        onClose={wizardClose}
      >
        <button type="button">Get Started</button>
      </Modal>
    );
    const view = render(
      <>
        {quick}
        {null}
      </>,
    );
    const box = screen.getByLabelText("Search pages");
    expect(document.activeElement).toBe(box);
    view.rerender(
      <>
        {quick}
        {wizard}
      </>,
    );
    expect(document.activeElement).toBe(box);
    fireEvent.keyDown(box, { key: "Tab" });
    expect(document.activeElement).toBe(box);
    document.body.focus();
    fireEvent.keyDown(document.body, { key: "Tab" });
    expect(document.activeElement).toBe(box);
    fireEvent.keyDown(box, { key: "Escape" });
    expect(quickClose).toHaveBeenCalledTimes(1);
    expect(wizardClose).not.toHaveBeenCalled();
  });

  it("gives focus back on close only if it held it", () => {
    const wizard = (
      <Modal
        label="Set up Ledgr"
        className=""
        layer="firstRun"
        onClose={() => {}}
      >
        <button type="button">Get Started</button>
      </Modal>
    );
    const quick = (
      <Modal label="Quick search" className="" onClose={() => {}}>
        <input aria-label="Search pages" autoFocus />
      </Modal>
    );
    const view = render(
      <>
        {wizard}
        {quick}
      </>,
    );
    const box = screen.getByLabelText("Search pages");
    expect(document.activeElement).toBe(box);
    view.rerender(
      <>
        {null}
        {quick}
      </>,
    );
    expect(screen.queryByRole("dialog", { name: "Set up Ledgr" })).toBeNull();
    expect(document.activeElement).toBe(box);
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

  it("keeps a 1rem gap to the viewport with gutter", () => {
    render(
      <Modal label="x" className="" onClose={() => {}} gutter>
        <p>x</p>
      </Modal>,
    );
    expect(screen.getByRole("presentation").className).toContain("p-4");
  });
});
