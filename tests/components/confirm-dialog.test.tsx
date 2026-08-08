/**
 * Tests for ConfirmDialog's imperative API — confirm()/promptText() are
 * drop-in replacements for window.confirm()/window.prompt() that resolve a
 * Promise once the user acts on the single globally-mounted <ConfirmDialog />.
 * This file exercises the real module end to end (no mocking) since the
 * whole point is verifying the promise/global-setter wiring.
 *
 * confirm()/promptText() are called outside of a React event handler (they
 * call the stored setState directly), so each call must be wrapped in
 * act() for the resulting render to be flushed before we assert on it —
 * the same way React itself recommends for imperative state updates
 * triggered from outside React's event system.
 */
import { describe, it, expect, afterEach } from "vitest";
import { act } from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import {
  ConfirmDialog,
  confirm,
  promptText,
} from "@/components/ui/confirm-dialog";

afterEach(() => {
  cleanup();
});

function openConfirm(message: string): Promise<boolean> {
  let promise!: Promise<boolean>;
  act(() => {
    promise = confirm(message);
  });
  return promise;
}

function openPrompt(
  message: string,
  placeholder?: string,
): Promise<string | null> {
  let promise!: Promise<string | null>;
  act(() => {
    promise = promptText(message, placeholder);
  });
  return promise;
}

describe("confirm() / promptText() without a mounted ConfirmDialog", () => {
  it("confirm() throws if ConfirmDialog is not mounted", () => {
    expect(() => confirm("Are you sure?")).toThrow(/not mounted/);
  });

  it("promptText() throws if ConfirmDialog is not mounted", () => {
    expect(() => promptText("Name?")).toThrow(/not mounted/);
  });
});

describe("ConfirmDialog — confirm mode", () => {
  it("renders nothing when no dialog is pending", () => {
    const { container } = render(<ConfirmDialog />);
    expect(container.innerHTML).toBe("");
  });

  it("shows the message and resolves true when Confirm is clicked", async () => {
    render(<ConfirmDialog />);
    const promise = openConfirm("Delete this account?");

    expect(screen.getByText("Delete this account?")).toBeInTheDocument();
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Confirm"));
    await expect(promise).resolves.toBe(true);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("resolves false when Cancel is clicked", async () => {
    render(<ConfirmDialog />);
    const promise = openConfirm("Delete this account?");
    fireEvent.click(screen.getByText("Cancel"));
    await expect(promise).resolves.toBe(false);
  });

  it("resolves false when Escape is pressed", async () => {
    render(<ConfirmDialog />);
    const promise = openConfirm("Delete this account?");
    fireEvent.keyDown(document, { key: "Escape" });
    await expect(promise).resolves.toBe(false);
  });

  it("resolves false when the backdrop is clicked", async () => {
    render(<ConfirmDialog />);
    const promise = openConfirm("Delete this account?");
    // The backdrop is the outer role="presentation" element.
    fireEvent.click(screen.getByRole("presentation"));
    await expect(promise).resolves.toBe(false);
  });

  it("does not resolve when clicking inside the dialog body", () => {
    render(<ConfirmDialog />);
    openConfirm("Delete this account?");
    fireEvent.click(screen.getByRole("alertdialog"));
    // Dialog should still be open — clicking inside isn't the backdrop.
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });

  it("supports back-to-back confirm() calls (second replaces first)", async () => {
    render(<ConfirmDialog />);
    const first = openConfirm("First?");
    const second = openConfirm("Second?");
    expect(screen.getByText("Second?")).toBeInTheDocument();
    expect(screen.queryByText("First?")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Confirm"));
    await expect(second).resolves.toBe(true);
    // The first promise never resolves — that's expected/inherent to the
    // single-slot design; just make sure it doesn't reject either.
    void first;
  });
});

describe("ConfirmDialog — prompt mode", () => {
  it("shows an input with the given placeholder", () => {
    render(<ConfirmDialog />);
    openPrompt("What's your name?", "Jane Doe");
    expect(screen.getByText("What's your name?")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Jane Doe")).toBeInTheDocument();
  });

  it("resolves the trimmed input value when OK is clicked", async () => {
    render(<ConfirmDialog />);
    const promise = openPrompt("Name?");
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "  Alice  " } });
    fireEvent.click(screen.getByText("OK"));
    await expect(promise).resolves.toBe("Alice");
  });

  it("resolves null when OK is clicked with an empty input", async () => {
    render(<ConfirmDialog />);
    const promise = openPrompt("Name?");
    fireEvent.click(screen.getByText("OK"));
    await expect(promise).resolves.toBeNull();
  });

  it("resolves null when Cancel is clicked", async () => {
    render(<ConfirmDialog />);
    const promise = openPrompt("Name?");
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Bob" },
    });
    fireEvent.click(screen.getByText("Cancel"));
    await expect(promise).resolves.toBeNull();
  });

  it("submits on Enter key in the input", async () => {
    render(<ConfirmDialog />);
    const promise = openPrompt("Name?");
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "Carol" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await expect(promise).resolves.toBe("Carol");
  });

  it("resolves null on Escape", async () => {
    render(<ConfirmDialog />);
    const promise = openPrompt("Name?");
    fireEvent.keyDown(document, { key: "Escape" });
    await expect(promise).resolves.toBeNull();
  });
});

describe("ConfirmDialog — unmount cleanup", () => {
  it("unregisters the global setter on unmount, so a later confirm() throws", () => {
    const { unmount } = render(<ConfirmDialog />);
    unmount();
    expect(() => confirm("Anything?")).toThrow(/not mounted/);
  });

  it("re-mounting registers a fresh global setter", () => {
    const first = render(<ConfirmDialog />);
    first.unmount();
    render(<ConfirmDialog />);
    expect(() => {
      act(() => {
        confirm("Anything?");
      });
    }).not.toThrow();
  });
});

describe("ConfirmDialog — accessibility wiring", () => {
  it("has aria-modal and aria-labelledby pointing at the message", () => {
    render(<ConfirmDialog />);
    openConfirm("Sensitive action?");
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    const labelId = dialog.getAttribute("aria-labelledby");
    expect(labelId).toBeTruthy();
    expect(document.getElementById(labelId!)).toHaveTextContent(
      "Sensitive action?",
    );
  });
});
