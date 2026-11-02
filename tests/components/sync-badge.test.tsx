/** The badge names the budget app actually connected. */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { SyncBadge } from "@/components/ui/sync-badge";

describe("SyncBadge", () => {
  it.each([
    ["actual", "Synced from Actual Budget"],
    ["ynab", "Synced from YNAB"],
    ["", "Synced from the budget API"],
  ])("%s", (source, text) => {
    render(<SyncBadge source={source} />);
    expect(screen.getByText(text)).toBeTruthy();
  });
});
