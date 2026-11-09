/** buildDemoSchema checks its own slug: anything that isn't a demo
 *  profile's key is refused before a connection is taken or SQL runs. */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { connect } = vi.hoisted(() => ({ connect: vi.fn() }));
vi.mock("@/lib/db", () => ({ pool: { connect }, db: {} }));
vi.mock("@/lib/db/schema", () => ({}));

import { buildDemoSchema } from "@/server/services/demo/demo-schema";
import type { DemoProfileSlug } from "@/lib/demo";

describe("buildDemoSchema slug guard", () => {
  beforeEach(() => connect.mockReset());

  it.each(["x; drop", "../public", "", "public", "constructor"])(
    "refuses %j before any statement",
    async (slug) => {
      await expect(
        buildDemoSchema(slug as DemoProfileSlug, new Date()),
      ).rejects.toThrow("Not a demo profile");
      expect(connect).not.toHaveBeenCalled();
    },
  );

  it("takes a connection for a real profile", async () => {
    const query = vi.fn().mockRejectedValue(new Error("stop"));
    connect.mockResolvedValue({ query, release: vi.fn() });
    await expect(
      buildDemoSchema("single-income", new Date()),
    ).rejects.toThrow();
    expect(connect).toHaveBeenCalledTimes(1);
  });
});
