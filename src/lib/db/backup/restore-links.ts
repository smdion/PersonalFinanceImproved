/** Restore steps before the registered converters (backup-transforms.ts):
 *  two renames, then the links the start-up backfills made, matched by text
 *  as they did (a restore is never replayed); skipped from the credentials tag on. */
import { renameDisplayNameActive } from "../migrate/v0102-display-name-custom";
import { dropDeadHoldingLinkAndSettings } from "../migrate/v0102-dead-data";
import { CREDENTIALS_TAG } from "../migrate/v0106-credentials";
import { isRow, jsonArray, type Row } from "../migrate/converter-rows";
import { portfolioAccountLabel } from "@/lib/pure/accounts/portfolio-labels";
import { getDisplayConfig } from "@/lib/config/account-types";
import { log } from "@/lib/logger";
import pgJournal from "../../../../drizzle/meta/_journal.json";

type Tables = Record<string, unknown[]>;

const tags = pgJournal.entries.map((e) => e.tag);
/** The tags from the credentials tag on: a backup at one of them holds
 *  typed mapping ids and links already. */
const SINCE_LINKS = new Set(tags.slice(tags.indexOf(CREDENTIALS_TAG)));

const rows = (tables: Tables, name: string): Row[] =>
  (tables[name] ?? []).filter(isRow);
const text = (v: unknown) => (typeof v === "string" ? v : null);
const id = (v: unknown) => (v == null ? null : Number(v));

/** Each portfolio label the backfill matched a mapping's name against: a
 *  performance account's label and display name, then the latest snapshot's
 *  account labels; the first one wins. */
function labelToPerformanceId(tables: Tables): Map<string, number> {
  const labels = new Map<string, number>();
  const add = (label: string | null, performanceId: number | null) => {
    if (label && performanceId != null && !labels.has(label))
      labels.set(label, performanceId);
  };
  const performanceAccounts = rows(tables, "performance_accounts");
  for (const p of performanceAccounts)
    add(text(p["account_label"]), id(p["id"]));
  for (const p of performanceAccounts)
    add(text(p["display_name"]), id(p["id"]));
  const latest = rows(tables, "portfolio_snapshots").reduce<Row | null>(
    (best, s) =>
      best === null ||
      String(s["snapshot_date"]) > String(best["snapshot_date"])
        ? s
        : best,
    null,
  );
  if (!latest) return labels;
  const performanceById = new Map(
    performanceAccounts.map((p) => [id(p["id"]), p]),
  );
  const people = new Map(
    rows(tables, "people").map((p) => [Number(p["id"]), String(p["name"])]),
  );
  for (const a of rows(tables, "portfolio_accounts")) {
    if (id(a["snapshot_id"]) !== id(latest["id"])) continue;
    const performanceId = id(a["performance_account_id"]);
    if (performanceId == null) continue;
    const performance = performanceById.get(performanceId);
    const label = portfolioAccountLabel(
      {
        accountType: String(a["account_type"]),
        subType: text(a["sub_type"]),
        label: text(a["label"]),
        institution: String(a["institution"]),
      },
      performance && {
        displayName: text(performance["display_name"]),
        accountLabel: text(performance["account_label"]),
        ownershipType: text(performance["ownership_type"]),
      },
      id(a["owner_person_id"]),
      people,
    );
    add(label, performanceId);
  }
  return labels;
}

/** The backfill's portfolio-label match: a mapping with no `localId` whose
 *  name no asset holds and a portfolio label matches becomes that account's.
 *  Other names are left to the tag's converter (an asset name) or re-mapping. */
function linkMappingLabels(tables: Tables): number {
  const assetNames = new Set(
    rows(tables, "other_asset_items").map((a) => a["name"]),
  );
  let labels: Map<string, number> | null = null;
  let linked = 0;
  for (const c of rows(tables, "api_connections")) {
    const list = jsonArray(c["account_mappings"]);
    if (!list) continue;
    const next = list.map((mapping: unknown) => {
      if (!isRow(mapping)) return mapping;
      const name = text(mapping["localName"]);
      if (text(mapping["localId"]) || !name || assetNames.has(name))
        return mapping;
      if (/^[a-z]+:/.test(name)) return mapping;
      labels ??= labelToPerformanceId(tables);
      const performanceId = labels.get(name);
      if (performanceId === undefined) return mapping;
      linked++;
      return {
        ...mapping,
        localId: `performance:${performanceId}`,
        performanceAccountId: performanceId,
      };
    });
    if (next.some((m, i) => m !== list[i])) c["account_mappings"] = next;
  }
  return linked;
}

/** The start-up backfill's match, once (later releases leave a row
 *  unlinked): the first performance account whose label holds the type's
 *  label and whose owner is the row's person, or whose label holds its name. */
function linkContributionPerformanceIds(tables: Tables): number {
  const performanceAccounts = rows(tables, "performance_accounts");
  if (performanceAccounts.length === 0) return 0;
  const people = new Map(
    rows(tables, "people").map((p) => [id(p["id"]), text(p["name"])]),
  );
  let linked = 0;
  for (const c of rows(tables, "contribution_accounts")) {
    if (id(c["performance_account_id"]) !== null) continue;
    const personId = id(c["person_id"]);
    const personName =
      (personId === null ? null : people.get(personId))?.toLowerCase() ?? "";
    const typeLabel = getDisplayConfig(
      String(c["account_type"]),
      text(c["sub_type"]),
    ).displayLabel.toLowerCase();
    const match = performanceAccounts.find((p) => {
      const label = String(p["account_label"]).toLowerCase();
      return (
        label.includes(typeLabel) &&
        (id(p["owner_person_id"]) === personId ||
          (personName !== "" && label.includes(personName)))
      );
    });
    if (!match) continue;
    c["performance_account_id"] = id(match["id"]);
    linked++;
  }
  return linked;
}

/** Every step, in order, on a backup at `schemaVersion`. */
export function restoreLinks(tables: Tables, schemaVersion: string): void {
  renameDisplayNameActive(tables);
  dropDeadHoldingLinkAndSettings(tables);
  if (SINCE_LINKS.has(schemaVersion)) return;
  const contributions = linkContributionPerformanceIds(tables);
  const mappings = linkMappingLabels(tables);
  if (contributions > 0 || mappings > 0)
    log("info", "backup_restore_links", {
      contributionPerformanceIds: contributions,
      mappingsByLabel: mappings,
    });
}
