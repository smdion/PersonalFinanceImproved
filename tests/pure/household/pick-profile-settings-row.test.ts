import { describe, expect, it } from "vitest";
import { pickProfileSettingsRow } from "@/lib/pure/household/retirement-profile";

const rows = [
  { id: "b", profileId: 1, personId: 7 },
  { id: "a", profileId: 1, personId: 3 },
  { id: "c", profileId: 2, personId: 5 },
];

describe("pickProfileSettingsRow", () => {
  it("prefers the primary person's row in the profile", () => {
    expect(pickProfileSettingsRow(rows, 1, 7)?.id).toBe("b");
  });

  it("falls back to the lowest person id when the primary has no row", () => {
    expect(pickProfileSettingsRow(rows, 1, 5)?.id).toBe("a");
    expect(pickProfileSettingsRow(rows, 1, null)?.id).toBe("a");
  });

  it("with no profile, picks the same way over every row, never by array order", () => {
    expect(pickProfileSettingsRow(rows, null, 5)?.id).toBe("c");
    expect(pickProfileSettingsRow(rows, null, 99)?.id).toBe("a");
    expect(pickProfileSettingsRow(rows, null, null)?.id).toBe("a");
  });
});
