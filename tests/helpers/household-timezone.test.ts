import "./setup-mocks";
import { describe, it, expect, afterEach } from "vitest";
import {
  applyHouseholdTimeZone,
  isValidTimeZone,
} from "@/server/helpers/household-timezone";

const original = process.env.TZ;
afterEach(() => {
  if (original === undefined) delete process.env.TZ;
  else process.env.TZ = original;
});

describe("household time zone", () => {
  it("recognizes IANA zones and rejects anything else", () => {
    expect(isValidTimeZone("America/Chicago")).toBe(true);
    expect(isValidTimeZone("Not/AZone")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
    expect(isValidTimeZone(42)).toBe(false);
  });

  it("moves server date getters to the household's day", () => {
    // 03:30 UTC on Jan 1 is still Dec 31 in Chicago.
    const instant = new Date("2027-01-01T03:30:00Z");
    applyHouseholdTimeZone("UTC");
    expect(instant.getFullYear()).toBe(2027);
    applyHouseholdTimeZone("America/Chicago");
    expect(instant.getFullYear()).toBe(2026);
    expect(instant.getDate()).toBe(31);
  });

  it("falls back to the container's zone when cleared or invalid", () => {
    applyHouseholdTimeZone("America/Chicago");
    applyHouseholdTimeZone(null);
    expect(process.env.TZ).toBe(original);
    applyHouseholdTimeZone("America/Chicago");
    applyHouseholdTimeZone("Not/AZone");
    expect(process.env.TZ).toBe(original);
  });
});
