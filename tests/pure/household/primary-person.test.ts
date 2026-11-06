import { describe, it, expect } from "vitest";
import { getPrimaryPerson } from "@/lib/pure/household/primary-person";

describe("getPrimaryPerson", () => {
  it("returns the person with isPrimaryUser=true", () => {
    const people = [
      { isPrimaryUser: false, name: "Partner" },
      { isPrimaryUser: true, name: "Primary" },
    ];
    expect(getPrimaryPerson(people)?.name).toBe("Primary");
  });

  it("falls back to first person when no primary flag", () => {
    const people = [
      { isPrimaryUser: false, name: "First" },
      { isPrimaryUser: false, name: "Second" },
    ];
    expect(getPrimaryPerson(people)?.name).toBe("First");
  });

  it("returns null for empty array", () => {
    expect(getPrimaryPerson([])).toBeNull();
  });
});
