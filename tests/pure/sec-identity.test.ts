/** SEC identity and stand-in suggestions. Invented fund names only. */
import { describe, it, expect } from "vitest";
import {
  buildRegistryIndex,
  suggestStandIn,
  type RegistryRow,
} from "@/lib/pure/sec-identity";

const row = (
  over: Partial<RegistryRow> & { seriesId: string },
): RegistryRow => ({
  cik: "1",
  seriesName: "Example Fund",
  classId: `C${over.seriesId.slice(1)}`,
  ticker: null,
  ...over,
});

const index = buildRegistryIndex(
  [
    row({
      seriesId: "S1",
      seriesName: "Acme LifeStage Index 2060 Fund",
      ticker: "ACMEX",
    }),
    row({ seriesId: "S2", seriesName: "Acme LifeStage Index 2050 Fund" }),
    row({ seriesId: "S3", seriesName: "Acme Total Bond Fund" }),
    row({ seriesId: "S4", seriesName: "Duplicate Name Fund" }),
    row({ seriesId: "S5", seriesName: "Duplicate Name Fund" }),
  ],
  new Map([["ACMBX", { seriesId: "S3", classId: "C3" }]]),
);

describe("buildRegistryIndex", () => {
  it("resolves tickers from both the ticker list and the registry", () => {
    expect(index.byTicker.get("ACMBX")?.seriesId).toBe("S3");
    expect(index.byTicker.get("ACMEX")?.seriesId).toBe("S1");
  });
  it("only matches series names that are unique", () => {
    expect(index.seriesByName.get("acme total bond fund")).toBe("S3");
    expect(index.seriesByName.has("duplicate name fund")).toBe(false);
  });
});

describe("suggestStandIn", () => {
  it("suggests the registered fund for a plan-only version of it", () => {
    expect(
      suggestStandIn("Acme LifeStage Index 2060 NL Fund H", index)?.seriesId,
    ).toBe("S1");
  });
  it("never crosses target years", () => {
    expect(
      suggestStandIn("Acme LifeStage Index 2070 NL Fund", index),
    ).toBeNull();
  });
  it("needs real overlap", () => {
    expect(suggestStandIn("Something Else Entirely", index)).toBeNull();
  });
});
