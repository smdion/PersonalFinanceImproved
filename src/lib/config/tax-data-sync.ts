/**
 * Where community tax-data updates come from and the keys they must be
 * signed with (lib/tax-data/signature.ts). Releases named
 * `tax-data-v<dataVersion>` on the public repo carry `us-federal.json` and
 * `us-federal.json.sig`; `pnpm tax-data:publish` makes them.
 *
 * Rotating a key: add the new one here and sign with both for a while;
 * an install that never updates keeps only the keys it shipped with.
 */

/** The public repository the releases live on. */
export const TAX_DATA_REPO = "smdion/PersonalFinanceImproved";

/** Tag prefix of a tax-data release (`tax-data-v3`). */
export const TAX_DATA_TAG_PREFIX = "tax-data-v";

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
