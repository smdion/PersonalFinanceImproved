/**
 * Community tax-data updates: download and verify the signed release (one plain
 * GET, no household data) and keep a newer one for admin review. Off unless enabled;
 * forced off by LEDGR_TAX_DATA_SYNC=off or demo. Proxies need NODE_USE_ENV_PROXY=1.
 */
import { eq } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import {
  TAX_DATA_ASSET,
  TAX_DATA_RELEASE_TAG,
  TAX_DATA_REPO,
  TAX_DATA_TEST_RELEASE_TAG,
} from "@/lib/config/tax-data-sync";
import {
  SK_TAX_DATA_LAST_CHECK,
  SK_TAX_DATA_SYNC_ENABLED,
} from "@/lib/constants/settings-keys";
import { TAX_DATA_FORMAT_VERSION } from "@/lib/db/migrate/reference-reconcile-core";
import {
  previewCommunityTaxData,
  readTaxDataFile,
} from "@/lib/db/migrate/reference-data";
import {
  unpackSignedTaxData,
  verifyTaxDataSignature,
} from "@/lib/tax-data/signature";
import { checkTaxDataFile } from "@/lib/tax-data/checked-file";
import { log } from "@/lib/logger";
import type { Db } from "@/lib/db";
import { writeStamp } from "@/lib/utils/clock";
import { readStoredSetting } from "@/lib/db/stored-setting";
import { z } from "zod/v4";

const TIMEOUT_MS = 15_000;
const MAX_BYTES = 1024 * 1024;
const USER_AGENT = "Ledgr self-hosted personal finance (tax-data updates)";

const TAX_DATA_CHECK_RESULTS = [
  "off",
  "current", // nothing newer than this install has (or nothing published)
  "pending", // a verified update is waiting for an admin
  "applied", // a newer release changed nothing here: recorded as applied
  "needs-newer-ledgr", // a newer file format, or no bundled key verifies
  "invalid", // signed but fails the checks — never offered
  "rate-limited",
  "error",
] as const;
type TaxDataCheckResult = (typeof TAX_DATA_CHECK_RESULTS)[number];

type TaxDataLastCheck = {
  at: string;
  result: TaxDataCheckResult;
  detail?: string;
};

/** The stored last check, as `checkForTaxDataUpdate` writes it. */
const lastCheckShape: z.ZodType<TaxDataLastCheck | null> = z
  .looseObject({
    at: z.string(),
    result: z.enum(TAX_DATA_CHECK_RESULTS),
    detail: z.string().optional(),
  })
  .nullable();

/** Where to fetch from (tests point this at a fake). */
type TaxDataSource = {
  fetch?: typeof fetch;
  downloadBase?: string;
};

async function getSetting(db: Db, key: string): Promise<unknown> {
  const [row] = await db
    .select()
    .from(schema.appSettings)
    .where(eq(schema.appSettings.key, key));
  return row?.value;
}

async function setSetting(db: Db, key: string, value: unknown) {
  await db
    .insert(schema.appSettings)
    .values({ key, value })
    .onConflictDoUpdate({ target: schema.appSettings.key, set: { value } });
}

/** Why sync is off, or null when it's on. */
export async function taxDataSyncOffReason(
  db: Db,
): Promise<"operator" | "demo" | "setting" | null> {
  if (process.env.LEDGR_TAX_DATA_SYNC === "off") return "operator";
  if (process.env.DEMO_ONLY === "true") return "demo";
  return (await getSetting(db, SK_TAX_DATA_SYNC_ENABLED)) === true
    ? null
    : "setting";
}

export async function setTaxDataSyncEnabled(db: Db, enabled: boolean) {
  await setSetting(db, SK_TAX_DATA_SYNC_ENABLED, enabled);
}

export async function lastTaxDataCheck(
  db: Db,
): Promise<TaxDataLastCheck | null> {
  const stored = (await getSetting(db, SK_TAX_DATA_LAST_CHECK)) ?? null;
  return readStoredSetting(SK_TAX_DATA_LAST_CHECK, stored, lastCheckShape);
}

class RateLimited extends Error {}

/** The release this server reads: the test release only on a server set
 *  to the test channel (LEDGR_TAX_DATA_CHANNEL=test). */
function releaseTag(): string {
  return process.env.LEDGR_TAX_DATA_CHANNEL === "test"
    ? TAX_DATA_TEST_RELEASE_TAG
    : TAX_DATA_RELEASE_TAG;
}

/** GET as text with a time and size cap; null on 404. */
async function getText(
  url: string,
  doFetch: typeof fetch,
): Promise<string | null> {
  const res = await doFetch(url, {
    headers: { "User-Agent": USER_AGENT },
    redirect: "follow",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (res.status === 404) return null;
  if (res.status === 403 || res.status === 429)
    throw new RateLimited(`GitHub returned ${res.status}`);
  if (!res.ok || !res.body) throw new Error(`GitHub returned ${res.status}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_BYTES) {
      await reader.cancel();
      throw new Error("Response too large");
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

/** The highest data version this install has (shipped, or any fetched
 *  update whatever was decided). */
async function knownDataVersion(db: Db): Promise<number> {
  const rows = await db
    .select({ v: schema.taxDataUpdates.dataVersion })
    .from(schema.taxDataUpdates);
  return Math.max(readTaxDataFile().dataVersion, ...rows.map((r) => r.v));
}

/** A version field of the parsed file, read before it is checked: one that
 *  isn't a number reads as absent; a JSON null file throws, as reading a
 *  field of null does. */
function versionField(
  parsed: unknown,
  key: "formatVersion" | "dataVersion",
): number | undefined {
  if (parsed === null)
    throw new TypeError(`Cannot read properties of null (reading '${key}')`);
  const value: unknown =
    typeof parsed === "object" ? Reflect.get(parsed, key) : undefined;
  return typeof value === "number" ? value : undefined;
}

/**
 * Check for a newer community release; keep a verified one for review.
 * `force` skips the on/off setting (an admin's "Check now" still respects
 * the operator and demo switches).
 */
export async function checkForTaxDataUpdate(
  db: Db,
  {
    source = {},
    force = false,
  }: { source?: TaxDataSource; force?: boolean } = {},
): Promise<TaxDataLastCheck> {
  const done = async (r: Omit<TaxDataLastCheck, "at">) => {
    const result = { at: writeStamp().toISOString(), ...r };
    await setSetting(db, SK_TAX_DATA_LAST_CHECK, result);
    return result;
  };
  const off = await taxDataSyncOffReason(db);
  if (off && !(force && off === "setting"))
    return { at: writeStamp().toISOString(), result: "off" };

  try {
    const url =
      (source.downloadBase ?? "https://github.com") +
      `/${TAX_DATA_REPO}/releases/download/${releaseTag()}/${TAX_DATA_ASSET}`;
    const assetText = await getText(url, source.fetch ?? fetch);
    // Nothing published yet.
    if (assetText === null) return await done({ result: "current" });
    const signed = unpackSignedTaxData(assetText);
    if (!signed)
      return await done({
        result: "invalid",
        detail: "the release isn't a signed tax-data file",
      });
    const { fileText, signature } = signed;

    // Verified before it's parsed.
    if (!verifyTaxDataSignature(fileText, signature))
      return await done({
        result: "needs-newer-ledgr",
        detail: "signed with a key this Ledgr doesn't have",
      });
    const parsed: unknown = JSON.parse(fileText);
    const formatVersion = versionField(parsed, "formatVersion");
    if (formatVersion !== undefined && formatVersion > TAX_DATA_FORMAT_VERSION)
      return await done({
        result: "needs-newer-ledgr",
        detail: "a newer tax-data format",
      });
    // Not newer than what's shipped or already fetched (incl. a replay of
    // an older signed file): nothing to do.
    const dataVersion = versionField(parsed, "dataVersion");
    if (
      dataVersion === undefined ||
      !Number.isSafeInteger(dataVersion) ||
      dataVersion <= (await knownDataVersion(db))
    )
      return await done({ result: "current" });
    // A limit key this version doesn't know is kept (shown as not used
    // here, in place for a version that uses it), never a reason to refuse.
    const { file, problems } = checkTaxDataFile(parsed, {
      unknownKeys: "ignore",
      citations: "lenient",
    });
    if (!file) {
      log("warn", "tax_data_update_invalid", { problems });
      return await done({
        result: "invalid",
        detail: problems.slice(0, 3).join("; "),
      });
    }

    // Nothing here would change: recorded as applied, not offered.
    const changes = await previewCommunityTaxData(db, file);
    const status = changes.length ? "pending" : "applied";
    await db
      .insert(schema.taxDataUpdates)
      .values({
        dataVersion: file.dataVersion,
        fileText,
        signature,
        status,
        ...(status === "applied" && {
          decidedBy: "automatic (no changes)",
          decidedAt: writeStamp(),
        }),
      })
      .onConflictDoNothing();
    return await done({ result: status });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    log("warn", "tax_data_check_failed", { error: detail });
    return await done({
      result: err instanceof RateLimited ? "rate-limited" : "error",
      detail,
    });
  }
}

/** Is the scheduled check due? Weekly; a day after a failed one. */
export async function taxDataCheckDue(db: Db, now: Date): Promise<boolean> {
  const last = await lastTaxDataCheck(db);
  if (!last) return true;
  const failed = last.result === "error" || last.result === "rate-limited";
  const wait = (failed ? 1 : 7) * 24 * 60 * 60 * 1000;
  return now.getTime() - new Date(last.at).getTime() >= wait;
}
