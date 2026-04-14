/**
 * Shared schemas and helpers for the sync router group.
 * Internal to sync/ — do not import from outside this directory.
 */
import { z } from "zod/v4";

/** Supported budget API services. */
export const serviceEnum = z.enum(["ynab", "actual"]);
