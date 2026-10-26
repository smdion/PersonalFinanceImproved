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
    TAX_DATA_TAG_PREFIX: "tax-data-v",
    TAX_DATA_TEST_TAG_PREFIX: "tax-data-test-v",
    TAX_DATA_PUBLIC_KEYS: [{ keyId: k.keyId, publicKey: k.publicKey }],
  };
});

import { TEST_TAX_DATA_KEY as keys } from "../helpers/tax-data-keys";

import { createTestCaller, adminSession } from "../routers/setup";
import { readTaxData } from "../helpers/tax-data";
import { signTaxData } from "@/lib/tax-data/signature";
import {
  checkForTaxDataUpdate,
  setTaxDataSyncEnabled,
} from "@/lib/tax-data/sync";
import * as schema from "@/lib/db/schema-sqlite";
import type { Db } from "@/server/helpers";

/** A fake GitHub serving one release. */
function github(
  release: { version: number; fileText: string; signature: string } | null,
  tags: number[] = release ? [release.version] : [],
) {
  return vi.fn<typeof fetch>(async (url) => {
    const u = String(url);
    if (u.includes("/git/matching-refs/tags/"))
      return new Response(
        JSON.stringify(tags.map((n) => ({ ref: `refs/tags/tax-data-v${n}` }))),
      );
    if (release && u.endsWith(`tax-data-v${release.version}/us-federal.json`))
      return new Response(release.fileText);
    if (
      release &&
      u.endsWith(`tax-data-v${release.version}/us-federal.json.sig`)
    )
      return new Response(release.signature);
    return new Response("not found", { status: 404 });
  });
}

/** The shipped file, one version on, with `change` applied — signed. */
function release(
  change: (f: ReturnType<typeof readTaxData>) => void = (f) => {
    f.years["2026"]!.limits.ira_limit!.value = 7600;
  },
  privateKey = keys.privateKey,
) {
  const f = readTaxData();
  f.dataVersion += 1;
  change(f);
  const fileText = JSON.stringify(f, null, 2) + "\n";
  return {
    version: f.dataVersion,
    fileText,
    signature: JSON.stringify([signTaxData(fileText, privateKey, "test")]),
  };
}

async function setup() {
  const t = await createTestCaller(adminSession);
  // eslint-disable-next-line no-restricted-syntax -- Drizzle ORM: the SQLite test db as the app's PG-typed Db (same as the router harness)
  const db = t.db as unknown as Db;
  await setTaxDataSyncEnabled(db, true);
  const updates = () => t.db.select().from(schema.taxDataUpdates).all();
  return { ...t, db, updates };
}

describe("checkForTaxDataUpdate", () => {
  beforeEach(() => {
    delete process.env.LEDGR_TAX_DATA_SYNC;
  });

  it("keeps a newer signed release for review (nothing applied)", async () => {
    const { db, updates, cleanup } = await setup();
    try {
      const r = release();
      const res = await checkForTaxDataUpdate(db, {
        source: { fetch: github(r) },
      });
      expect(res).toMatchObject({ result: "pending", dataVersion: r.version });
      expect(updates()).toMatchObject([
        { dataVersion: r.version, status: "pending" },
      ]);
      // Checked again: already known.
      expect(
        (await checkForTaxDataUpdate(db, { source: { fetch: github(r) } }))
          .result,
      ).toBe("current");
    } finally {
      cleanup();
    }
  });

  it("does nothing when off, unless an admin checks now (but never past the operator switch)", async () => {
    const { db, updates, cleanup } = await setup();
    try {
      await setTaxDataSyncEnabled(db, false);
      const gh = github(release());
      expect(
        (await checkForTaxDataUpdate(db, { source: { fetch: gh } })).result,
      ).toBe("off");
      expect(gh).not.toHaveBeenCalled();
      expect(
        (
          await checkForTaxDataUpdate(db, {
            source: { fetch: gh },
            force: true,
          })
        ).result,
      ).toBe("pending");
      process.env.LEDGR_TAX_DATA_SYNC = "off";
      await setTaxDataSyncEnabled(db, true);
      expect(
        (
          await checkForTaxDataUpdate(db, {
            source: { fetch: gh },
            force: true,
          })
        ).result,
      ).toBe("off");
      expect(updates()).toHaveLength(1);
    } finally {
      cleanup();
    }
  });

  it("refuses a file signed by another key, or altered after signing", async () => {
    const { db, updates, cleanup } = await setup();
    try {
      const other = generateKeyPairSync("ed25519")
        .privateKey.export({ type: "pkcs8", format: "pem" })
        .toString();
      const forged = release(undefined, other);
      expect(
        (await checkForTaxDataUpdate(db, { source: { fetch: github(forged) } }))
          .result,
      ).toBe("needs-newer-ledgr");
      const r = release();
      const altered = { ...r, fileText: r.fileText.replace("7600", "9999") };
      expect(
        (
          await checkForTaxDataUpdate(db, {
            source: { fetch: github(altered) },
          })
        ).result,
      ).toBe("needs-newer-ledgr");
      expect(updates()).toEqual([]);
    } finally {
      cleanup();
    }
  });

  it("refuses a signed file that fails the checks, or whose version isn't its tag", async () => {
    const { db, updates, cleanup } = await setup();
    try {
      const absurd = release((f) => {
        f.years["2026"]!.limits.ss_wage_base!.value *= 3;
      });
      expect(
        (await checkForTaxDataUpdate(db, { source: { fetch: github(absurd) } }))
          .result,
      ).toBe("invalid");
      const r = release();
      const mislabelled = github({ ...r, version: r.version + 5 });
      expect(
        (await checkForTaxDataUpdate(db, { source: { fetch: mislabelled } }))
          .result,
      ).toBe("invalid");
      expect(updates()).toEqual([]);
    } finally {
      cleanup();
    }
  });

  it("drops limit keys it doesn't know instead of refusing the file", async () => {
    const { db, cleanup } = await setup();
    try {
      const r = release((f) => {
        f.years["2026"]!.limits.ira_limit!.value = 7600;
        f.years["2026"]!.limits.some_future_limit = { value: 1, source: "x" };
      });
      expect(
        (await checkForTaxDataUpdate(db, { source: { fetch: github(r) } }))
          .result,
      ).toBe("pending");
    } finally {
      cleanup();
    }
  });

  it("records a release that changes nothing here as applied, and ignores older ones", async () => {
    const { db, updates, cleanup } = await setup();
    try {
      const same = release(() => {});
      expect(
        (await checkForTaxDataUpdate(db, { source: { fetch: github(same) } }))
          .result,
      ).toBe("applied");
      expect(updates()).toMatchObject([{ status: "applied" }]);
      // The shipped version itself, or anything older: nothing to do.
      const shipped = readTaxData().dataVersion;
      expect(
        (
          await checkForTaxDataUpdate(db, {
            source: { fetch: github(null, [shipped - 1, shipped]) },
          })
        ).result,
      ).toBe("current");
    } finally {
      cleanup();
    }
  });

  it("reads test releases only on a server set to the test channel", async () => {
    const { db, cleanup } = await setup();
    try {
      const r = release();
      // A test release is published under its own tag prefix.
      const testGithub = vi.fn<typeof fetch>(async (url) => {
        const u = String(url);
        if (u.includes("/git/matching-refs/tags/tax-data-test-v"))
          return new Response(
            JSON.stringify([{ ref: `refs/tags/tax-data-test-v${r.version}` }]),
          );
        if (u.includes("/git/matching-refs/tags/"))
          return new Response(JSON.stringify([]));
        if (u.endsWith(`tax-data-test-v${r.version}/us-federal.json`))
          return new Response(r.fileText);
        if (u.endsWith(`tax-data-test-v${r.version}/us-federal.json.sig`))
          return new Response(r.signature);
        return new Response("not found", { status: 404 });
      });
      expect(
        (await checkForTaxDataUpdate(db, { source: { fetch: testGithub } }))
          .result,
      ).toBe("current");
      process.env.LEDGR_TAX_DATA_CHANNEL = "test";
      expect(
        (await checkForTaxDataUpdate(db, { source: { fetch: testGithub } }))
          .result,
      ).toBe("pending");
    } finally {
      delete process.env.LEDGR_TAX_DATA_CHANNEL;
      cleanup();
    }
  });

  it("a rate limit or a release without its files yet isn't an update", async () => {
    const { db, updates, cleanup } = await setup();
    try {
      const limited = vi.fn<typeof fetch>(
        async () => new Response("slow down", { status: 403 }),
      );
      expect(
        (await checkForTaxDataUpdate(db, { source: { fetch: limited } }))
          .result,
      ).toBe("rate-limited");
      const tagOnly = github(null, [readTaxData().dataVersion + 1]);
      expect(
        (await checkForTaxDataUpdate(db, { source: { fetch: tagOnly } }))
          .result,
      ).toBe("current");
      expect(updates()).toEqual([]);
    } finally {
      cleanup();
    }
  });
});
