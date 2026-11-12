import { describe, it, expect } from "vitest";
import { coastFireLabel } from "@/components/dashboard/coast-fire-label";

const age = (a: number) => `age ${a}`;

describe("coastFireLabel", () => {
  it("says a retiree's unreachable verdict is the plan failing", () => {
    expect(
      coastFireLabel(
        { status: "unreachable", coastFireAge: null, retired: true },
        age,
      ),
    ).toBe("Already retired: the plan doesn't pass");
  });

  it("keeps 'Not reachable' for a household still working", () => {
    expect(
      coastFireLabel(
        { status: "unreachable", coastFireAge: null, retired: false },
        age,
      ),
    ).toBe("Not reachable");
    expect(
      coastFireLabel(
        { status: "already_coast", coastFireAge: 50, retired: true },
        age,
      ),
    ).toBe("Already Coast");
    expect(
      coastFireLabel(
        { status: "found", coastFireAge: 55, retired: false },
        age,
      ),
    ).toBe("age 55");
  });
});
