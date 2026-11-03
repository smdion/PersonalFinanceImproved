/**
 * The layer-rule ratchet (scripts/check-layers.ts): the known list only
 * shrinks. Running dependency-cruiser itself is `pnpm check:layers` in CI.
 */
import { describe, it, expect } from "vitest";
import {
  compareWithKnown,
  sortViolations,
  type LayerViolation,
} from "../../scripts/check-layers";

const a: LayerViolation = {
  rule: "ui-never-imports-server",
  from: "src/components/a.tsx",
  to: "src/server/auth.ts",
};
const b: LayerViolation = {
  rule: "pure-has-no-io",
  from: "src/lib/pure/b.ts",
  to: "src/lib/db/index.ts",
};

describe("check-layers known list", () => {
  it("passes when found and known match", () => {
    expect(compareWithKnown([a, b], [b, a])).toEqual([]);
  });

  it("fails a violation that isn't on the list", () => {
    expect(compareWithKnown([a, b], [b])).toEqual([
      "src/components/a.tsx → src/server/auth.ts breaks layer rule ui-never-imports-server; never add to the known list",
    ]);
  });

  it("fails a stale entry: a fixed violation must leave the list", () => {
    const errors = compareWithKnown([b], [a, b]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(
      /^src\/components\/a\.tsx → src\/server\/auth\.ts \(ui-never-imports-server\) no longer occurs: delete its entry/,
    );
  });

  it("fails an entry added since the base list", () => {
    const rules = new Set([a.rule, b.rule]);
    const errors = compareWithKnown([a, b], [a, b], { entries: [b], rules });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(
      /breaks layer rule ui-never-imports-server; never add to the known list/,
    );
  });

  it("lets a rule that is new since the base land with its known list", () => {
    const base = { entries: [b], rules: new Set([b.rule]) };
    expect(compareWithKnown([a, b], [a, b], base)).toEqual([]);
  });

  it("keys on rule, from and to", () => {
    const sameEdgeOtherRule = { ...a, rule: "no-circular" };
    expect(compareWithKnown([a, sameEdgeOtherRule], [a])).toHaveLength(1);
    expect(sortViolations([a, a, b])).toEqual([b, a]);
  });
});
