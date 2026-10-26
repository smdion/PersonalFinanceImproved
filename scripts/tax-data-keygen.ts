/**
 * Make a tax-data signing key pair (Ed25519). The private key is written
 * to `<out>` (mode 600) for the owner's password manager — never commit it
 * or put it in CI. Paste the printed public key into
 * src/lib/config/tax-data-sync.ts.
 *
 * Usage: pnpm tax-data:keygen <keyId> <out.pem>
 */
import { generateKeyPairSync } from "crypto";
import * as fs from "fs";

const [keyId, out] = process.argv.slice(2);
if (!keyId || !out) {
  console.error("Usage: tax-data-keygen <keyId> <out.pem>");
  process.exit(2);
}
if (fs.existsSync(out)) {
  console.error(`${out} exists — refusing to overwrite a key.`);
  process.exit(1);
}
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
fs.writeFileSync(
  out,
  privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  { mode: 0o600 },
);
console.log(
  `Private key: ${out} (store it in the password manager, then delete this file)\n`,
);
console.log(
  "Add to TAX_DATA_PUBLIC_KEYS in src/lib/config/tax-data-sync.ts:\n",
);
console.log(
  `  {\n    keyId: ${JSON.stringify(keyId)},\n    publicKey: ${JSON.stringify(publicKey.export({ type: "spki", format: "pem" }).toString())},\n  },`,
);
