/** Where community tax-data updates come from (one rolling `tax-data` release holding the file
 *  and its signatures as one asset) and the keys they must be signed with. Newer = the file's
 *  `dataVersion`. To rotate a key, add the new one and sign with both for a while. */

/** The public repository the release lives on. */
export const TAX_DATA_REPO = "smdion/PersonalFinanceImproved";

/** The release (and its tag) every install reads. */
export const TAX_DATA_RELEASE_TAG = "tax-data";

/** A test release published from a branch (`pnpm tax-data:publish --test`): only a
 *  server with LEDGR_TAX_DATA_CHANNEL=test reads it; every other install ignores it. */
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
