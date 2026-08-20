import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SubAccountRow } from "@/components/portfolio/contribution-accounts-sub-account";
import type { PortfolioSub } from "@/components/portfolio/contribution-accounts-types";

// First direct coverage for SubAccountRow's label editor. Written
// alongside its migration onto useInlineNumberEdit (Phase 3 item 3d) with
// allowBlankCommit: true — clearing the label back to the default (tax
// type label) is a meaningful commit here, not a cancel, so this locks
// that in specifically (it's the same class of gap NoteButton had).

const people = [{ id: 1, name: "Alice" }];

const sub: PortfolioSub = {
  id: 42,
  amount: "500",
  taxType: "preTax",
  subType: null,
  label: "My Custom Label",
  ownerPersonId: null,
  isActive: true,
} as PortfolioSub;

describe("SubAccountRow label editor", () => {
  it("edits and commits a changed label on blur", () => {
    const onUpdate = vi.fn();
    render(<SubAccountRow sub={sub} people={people} onUpdate={onUpdate} />);

    fireEvent.click(screen.getByTitle("Edit label"));
    const input = screen.getByDisplayValue("My Custom Label");
    fireEvent.change(input, { target: { value: "New Label" } });
    fireEvent.blur(input);

    expect(onUpdate).toHaveBeenCalledWith(42, { label: "New Label" });
  });

  it("clearing the label to blank commits a null label (not a cancel)", () => {
    const onUpdate = vi.fn();
    render(<SubAccountRow sub={sub} people={people} onUpdate={onUpdate} />);

    fireEvent.click(screen.getByTitle("Edit label"));
    const input = screen.getByDisplayValue("My Custom Label");
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.blur(input);

    expect(onUpdate).toHaveBeenCalledWith(42, { label: null });
  });

  it("does not commit when the label is unchanged", () => {
    const onUpdate = vi.fn();
    render(<SubAccountRow sub={sub} people={people} onUpdate={onUpdate} />);

    fireEvent.click(screen.getByTitle("Edit label"));
    const input = screen.getByDisplayValue("My Custom Label");
    fireEvent.blur(input);

    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("Escape cancels without committing", () => {
    const onUpdate = vi.fn();
    render(<SubAccountRow sub={sub} people={people} onUpdate={onUpdate} />);

    fireEvent.click(screen.getByTitle("Edit label"));
    const input = screen.getByDisplayValue("My Custom Label");
    fireEvent.change(input, { target: { value: "Discarded" } });
    fireEvent.keyDown(input, { key: "Escape" });

    expect(onUpdate).not.toHaveBeenCalled();
    expect(screen.getByText("My Custom Label")).toBeInTheDocument();
  });
});
