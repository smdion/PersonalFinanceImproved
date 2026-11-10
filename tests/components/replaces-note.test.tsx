/**
 * The restore and import confirmations say what they replace: all current
 * data, and for someone who isn't an admin, what the restore keeps: sign-ins,
 * access settings, credentials, and the account links that still match.
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

  it("tells anyone else what stays: sign-ins, access settings, credentials, and links that still match", () => {
    expect(renderAs("viewer")).toBe(
      "This will replace all current data (sign-ins, access settings and each integration's credentials stay as they are, and so do its account links where they still name the same accounts) with the contents of:",
    );
  });
});
