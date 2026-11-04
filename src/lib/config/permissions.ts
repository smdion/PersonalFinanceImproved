/**
 * The permission keys a viewer can be granted (admins hold all). Shared by
 * the server (auth group mapping, tRPC gates) and the client (`hasPermission`),
 * so a new permission is one entry here.
 */

export const PERMISSIONS = [
  "scenario",
  "portfolio",
  "performance",
  "budget",
  "savings",
  "brokerage",
  "version",
  "contributionProfile",
  "sync",
] as const;

export type Permission = (typeof PERMISSIONS)[number];
