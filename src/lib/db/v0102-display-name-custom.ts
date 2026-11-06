/** Restore step, and migration 0014 for live rows (keep the two together):
 *  an entry's `displayNameActive` (the old name of `displayNameCustom`)
 *  becomes `displayNameCustom` unless that is set; the old key goes. */

import { v0810Object as asObject } from "./v0810-profile-sets";

/** A nested value is an object; only the column itself is ever JSON text. */
const isPlain = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export function renameDisplayNameActive(
  tables: Record<string, unknown[]>,
): void {
  for (const cp of tables["contribution_profiles"] ?? []) {
    const row = asObject(cp);
    if (!row) continue;
    const fields = asObject(row["contribution_active_fields"]);
    const stored = fields?.["contributionAccounts"];
    if (!fields || !isPlain(stored)) continue;
    const perAccount = { ...stored };
    let changed = false;
    for (const [accountId, value] of Object.entries(perAccount)) {
      if (!isPlain(value) || !("displayNameActive" in value)) continue;
      const { displayNameActive: old, ...rest } = value;
      if (rest["displayNameCustom"] === undefined && typeof old === "string")
        rest["displayNameCustom"] = old;
      perAccount[accountId] = rest;
      changed = true;
    }
    if (changed)
      row["contribution_active_fields"] = {
        ...fields,
        contributionAccounts: perAccount,
      };
  }
}
