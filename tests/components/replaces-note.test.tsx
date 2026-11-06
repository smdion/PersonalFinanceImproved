/**
 * The restore and import confirmations say what they replace: all current
 * data, and for someone who isn't an admin, that each integration keeps its
 * credentials and Server URL (the restore keeps them).
 */
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { ReplacesNote } from "@/components/versions/replaces-note";

let role = "admin";
vi.mock("@/lib/context/user-context", () => ({
  useUser: () => ({ role, permissions: ["version"] }),
  isAdmin: (user: { role: string }) => user.role === "admin",
}));

function renderAs(as: "admin" | "viewer") {
  role = as;
  const { container } = render(
    <ReplacesNote className="mb-1">with the contents of:</ReplacesNote>,
  );
  return container.textContent;
}

describe("ReplacesNote", () => {
  it("tells an admin the restore replaces all current data", () => {
    expect(renderAs("admin")).toBe(
      "This will replace all current data with the contents of:",
    );
  });

  it("tells anyone else that each integration keeps its credentials", () => {
    expect(renderAs("viewer")).toBe(
      "This will replace all current data (each integration keeps its credentials and Server URL) with the contents of:",
    );
  });
});
