/**
 * Shared schemas and helpers for the sync router group.
 * Internal to sync/ — do not import from outside this directory.
 */
import { z } from "zod/v4";
import { BUDGET_API_SERVICE_VALUES } from "@/lib/config/budget-apps";

/** Supported budget API services. */
export const serviceEnum = z.enum(BUDGET_API_SERVICE_VALUES);
