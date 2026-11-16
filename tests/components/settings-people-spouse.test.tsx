import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

// Settings → People's Spouse column: two people show the joint return's
// pair read-only; three or more get a picker (an admin's) that stores it.

let currentRole: "admin" | "viewer" = "admin";

vi.mock("@/lib/context/user-context", () => ({
  useUser: () => ({ role: currentRole, name: "Test", permissions: [] }),
  isAdmin: (u: { role: string }) => u.role === "admin",
}));

vi.mock("@/lib/trpc", async () => ({
  trpc: (await import("./trpc-mock")).trpc,
}));

import { PeopleSettings } from "@/components/settings/people";
import { mutationCalls, resetTrpcMock, setQuery } from "./trpc-mock";

const person = (id: number, name: string, spousePersonId: number | null) => ({
  id,
  name,
  dateOfBirth: "1970-01-01",
  isPrimaryUser: id === 1,
  spousePersonId,
});

describe("PeopleSettings spouse column", () => {
  beforeEach(() => {
    resetTrpcMock();
    currentRole = "admin";
  });

  it("two people: each shows the other, read-only", () => {
    setQuery("people.list", [person(1, "Ann", null), person(2, "Ben", null)]);
    render(<PeopleSettings />);
    expect(screen.getByText("Ben (if filing jointly)")).toBeInTheDocument();
    expect(screen.getByText("Ann (if filing jointly)")).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("three people: an admin picks a spouse, and the stored one is selected", () => {
    setQuery("people.list", [
      person(1, "Ann", 3),
      person(2, "Ben", null),
      person(3, "Cal", 1),
    ]);
    render(<PeopleSettings />);
    const ann = screen.getByRole("combobox", { name: "Ann's spouse" });
    expect((ann as HTMLSelectElement).value).toBe("3");
    expect(
      within(ann)
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["None", "Ben", "Cal"]);
    fireEvent.change(screen.getByRole("combobox", { name: "Ben's spouse" }), {
      target: { value: "1" },
    });
    fireEvent.change(ann, { target: { value: "" } });
    expect(mutationCalls("people.setSpouse")).toEqual([
      { id: 2, spousePersonId: 1 },
      { id: 1, spousePersonId: null },
    ]);
  });

  it("three people, a viewer: the stored spouse's name, no picker", () => {
    currentRole = "viewer";
    setQuery("people.list", [
      person(1, "Ann", 3),
      person(2, "Ben", null),
      person(3, "Cal", 1),
    ]);
    render(<PeopleSettings />);
    expect(screen.queryByRole("combobox")).toBeNull();
    // Each row's cells (ID, Name, Date of Birth, Primary, Spouse, ...).
    const cells = (id: number) =>
      [
        ...screen
          .getAllByRole("row")
          .find((r) => r.querySelector("td")?.textContent === String(id))!
          .querySelectorAll("td"),
      ].map((c) => c.textContent);
    expect(cells(1)[4]).toBe("Cal");
    expect(cells(2)[4]).toBe("");
    expect(cells(3)[4]).toBe("Ann");
  });
});
