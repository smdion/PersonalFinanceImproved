/**
 * Where community tax-data updates come from and the keys they must be
 * signed with (lib/tax-data/signature.ts). One rolling release on the
 * public repo — tag `tax-data`, replaced in place by each
 * `pnpm tax-data:publish` — carries one asset: the tax-data file and its
 * signatures together (an install never sees a new file with an old
 * signature mid-upload). No version in any name: which file is newer is
 * the file's own counter (`dataVersion`), checked after the signature.
 *
 * Rotating a key: add the new one here and sign with both for a while;
 * an install that never updates keeps only the keys it shipped with.
 */

/** The public repository the release lives on. */
export const TAX_DATA_REPO = "smdion/PersonalFinanceImproved";

/** The release (and its tag) every install reads. */
export const TAX_DATA_RELEASE_TAG = "tax-data";

/** A test release published from a branch (`pnpm tax-data:publish
 *  --test`): only a server with LEDGR_TAX_DATA_CHANNEL=test reads it — a
 *  dev install trying a change before it's merged; every other install
 *  ignores it. */
export const TAX_DATA_TEST_RELEASE_TAG = "tax-data-test";

/** The release asset: `{ "file": "<the file's exact text>",
 *  "signatures": [{ keyId, sig }] }`. */
export const TAX_DATA_ASSET = "us-federal.signed.json";

/** Ed25519 public keys (SPKI PEM) that may sign a tax-data release. */
export const TAX_DATA_PUBLIC_KEYS: readonly {
  keyId: string;
  publicKey: string;
}[] = [
  {
    keyId: "ledgr-2026",
    publicKey:
      "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAtJAEDi9QccYkYEstTNBSzDGweVwPYPbjOxLEdU1+iHE=\n-----END PUBLIC KEY-----\n",
  },
];
