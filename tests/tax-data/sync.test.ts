/**
 * Community tax-data check against a fake GitHub: only a newer, signed,
 * valid release is kept — and kept for review, never applied here.
 */
import "../routers/setup-mocks";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { generateKeyPairSync } from "crypto";

vi.mock("@/lib/config/tax-data-sync", async () => {
  const { TEST_TAX_DATA_KEY: k } = await import("../helpers/tax-data-keys");
  return {
    TAX_DATA_REPO: "owner/repo",
    TAX_DATA_RELEASE_TAG: "tax-data",
    TAX_DATA_TEST_RELEASE_TAG: "tax-data-test",
    TAX_DATA_ASSET: "us-federal.signed.json",
    TAX_DATA_PUBLIC_KEYS: [{ keyId: k.keyId, publicKey: k.publicKey }],
  };
});

import { TEST_TAX_DATA_KEY as keys } from "../helpers/tax-data-keys";
import { createTestCaller, adminSession } from "../routers/setup";
import { readTaxData } from "../helpers/tax-data";
import { packSignedTaxData, signTaxData } from "@/lib/tax-data/signature";
import {
  checkForTaxDataUpdate,
  setTaxDataSyncEnabled,
} from "@/lib/tax-data/sync";
import * as schema from "@/lib/db/schema-sqlite";
import type { Db } from "@/server/helpers";

/** A fake GitHub serving `asset` as the release (null: nothing published). */
function github(asset: string | null, tag = "tax-data") {
  return vi.fn<typeof fetch>(async (url) =>
    asset !== null &&
    String(url).endsWith(
      `/owner/repo/releases/download/${tag}/us-federal.signed.json`,
    )
      ? new Response(asset)
      : new Response("not found", { status: 404 }),
  );
}

/** The shipped file one counter on, with `change` applied, signed and packed. */
function release(
  change: (f: ReturnType<typeof readTaxData>) => void = (f) => {
    f.years["2026"]!.limits.ira_limit!.value = 7600;
  },
  { privateKey = keys.privateKey, bump = 1 } = {},
) {
  const f = readTaxData();
  f.dataVersion += bump;
  change(f);
  const fileText = JSON.stringify(f, null, 2) + "\n";
  return packSignedTaxData(fileText, [
    signTaxData(fileText, privateKey, "test"),
  ]);
}

async function setup() {
  const t = await createTestCaller(adminSession);
  // eslint-disable-next-line no-restricted-syntax -- Drizzle ORM: the SQLite test db as the app's PG-typed Db (same as the router harness)
  const db = t.db as unknown as Db;
  await setTaxDataSyncEnabled(db, true);
  const updates = () => t.db.select().from(schema.taxDataUpdates).all();
  const check = async (fetch: typeof globalThis.fetch, force = false) =>
    (await checkForTaxDataUpdate(db, { source: { fetch }, force })).result;
  return { ...t, db, updates, check };
}

describe("checkForTaxDataUpdate", () => {
  beforeEach(() => {
    delete process.env.LEDGR_TAX_DATA_SYNC;
    delete process.env.LEDGR_TAX_DATA_CHANNEL;
  });

  it("keeps a newer signed release for review (nothing applied)", async () => {
    const { updates, check, cleanup } = await setup();
    try {
      const gh = github(release());
      expect(await check(gh)).toBe("pending");
      expect(updates()).toMatchObject([
        { dataVersion: readTaxData().dataVersion + 1, status: "pending" },
      ]);
      // Checked again: already known.
      expect(await check(gh)).toBe("current");
    } finally {
      cleanup();
    }
  });

  it("does nothing when off, unless an admin checks now (but never past the operator switch)", async () => {
    const { db, updates, check, cleanup } = await setup();
    try {
      await setTaxDataSyncEnabled(db, false);
      const gh = github(release());
      expect(await check(gh)).toBe("off");
      expect(gh).not.toHaveBeenCalled();
      expect(await check(gh, true)).toBe("pending");
      process.env.LEDGR_TAX_DATA_SYNC = "off";
      await setTaxDataSyncEnabled(db, true);
      expect(await check(gh, true)).toBe("off");
      expect(updates()).toHaveLength(1);
    } finally {
      cleanup();
    }
  });

  it("refuses a file signed by another key, or altered after signing", async () => {
    const { updates, check, cleanup } = await setup();
    try {
      const other = generateKeyPairSync("ed25519")
        .privateKey.export({ type: "pkcs8", format: "pem" })
        .toString();
      expect(
        await check(github(release(undefined, { privateKey: other }))),
      ).toBe("needs-newer-ledgr");
      expect(await check(github(release().replace("7600", "9999")))).toBe(
        "needs-newer-ledgr",
      );
      expect(updates()).toEqual([]);
    } finally {
      cleanup();
    }
  });

  it("refuses a signed file that fails the checks, and an asset that isn't a signed file", async () => {
    const { updates, check, cleanup } = await setup();
    try {
      const absurd = release((f) => {
        f.years["2026"]!.limits.ss_wage_base!.value *= 3;
      });
      expect(await check(github(absurd))).toBe("invalid");
      expect(await check(github("not json"))).toBe("invalid");
      expect(updates()).toEqual([]);
    } finally {
      cleanup();
    }
  });

  it("keeps limit keys it doesn't know instead of refusing the file", async () => {
    const { check, cleanup } = await setup();
    try {
      const r = release((f) => {
        f.years["2026"]!.limits.ira_limit!.value = 7600;
        f.years["2026"]!.limits.some_future_limit = { value: 1, source: "x" };
      });
      expect(await check(github(r))).toBe("pending");
    } finally {
      cleanup();
    }
  });

  it("records a newer release that changes nothing here as applied; the shipped file or an older one (a replay) is nothing to do", async () => {
    const { updates, check, cleanup } = await setup();
    try {
      expect(await check(github(release(() => {})))).toBe("applied");
      expect(updates()).toMatchObject([{ status: "applied" }]);
      expect(await check(github(release(undefined, { bump: 0 })))).toBe(
        "current",
      );
      expect(await check(github(release(undefined, { bump: -1 })))).toBe(
        "current",
      );
      expect(updates()).toHaveLength(1);
    } finally {
      cleanup();
    }
  });

  it("nothing published, or a rate limit, isn't an update", async () => {
    const { updates, check, cleanup } = await setup();
    try {
      expect(await check(github(null))).toBe("current");
      const limited = vi.fn<typeof fetch>(
        async () => new Response("slow down", { status: 403 }),
      );
      expect(await check(limited)).toBe("rate-limited");
      expect(updates()).toEqual([]);
    } finally {
      cleanup();
    }
  });

  it("reads the test release only on a server set to the test channel", async () => {
    const { check, cleanup } = await setup();
    try {
      const gh = github(release(), "tax-data-test");
      expect(await check(gh)).toBe("current");
      process.env.LEDGR_TAX_DATA_CHANNEL = "test";
      expect(await check(gh)).toBe("pending");
    } finally {
      cleanup();
    }
  });
});
