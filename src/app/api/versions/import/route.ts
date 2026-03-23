import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
// eslint-disable-next-line no-restricted-imports -- API route, server-side only
import { auth } from "@/server/auth";
import { importBackup, type BackupData } from "@/lib/db/version-logic";
import { log } from "@/lib/logger";

const allowDev = process.env.ALLOW_DEV_MODE === "true";
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
const MAX_STRING_LENGTH = 10_000; // guard against oversized string values in imported data
const MAX_JSON_DEPTH = 10; // guard against deeply nested JSONB structures

/** Zod schema for validating imported backup JSON structure. */
const backupDataSchema = z.object({
  schemaVersion: z.string().min(1).max(50),
  exportedAt: z.string().min(1).max(50),
  tables: z.record(
    z.string().max(100),
    z.array(z.record(z.string().max(200), z.unknown())),
  ),
});

/** Recursively check that no string exceeds MAX_STRING_LENGTH and depth doesn't exceed MAX_JSON_DEPTH. */
function validateImportDepthAndSize(value: unknown, depth = 0): string | null {
  if (depth > MAX_JSON_DEPTH)
    return `Nested structure exceeds maximum depth of ${MAX_JSON_DEPTH}`;
  if (typeof value === "string" && value.length > MAX_STRING_LENGTH) {
    return `String value exceeds maximum length of ${MAX_STRING_LENGTH} characters`;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const err = validateImportDepthAndSize(item, depth + 1);
      if (err) return err;
    }
  } else if (value !== null && typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) {
      const err = validateImportDepthAndSize(v, depth + 1);
      if (err) return err;
    }
  }
  return null;
}

export async function POST(request: Request) {
  try {
    // Check auth — require session with version permission or admin
    const session = await auth();
    if (!allowDev && !session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (
      !allowDev &&
      session?.user?.role !== "admin" &&
      !session?.user?.permissions.includes("version")
    ) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Parse multipart form data
    const formData = await request.formData();
    const file = formData.get("file");

    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: "File too large (max 50MB)" },
        { status: 400 },
      );
    }

    const text = await file.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return NextResponse.json({ error: "Invalid JSON file" }, { status: 400 });
    }

    // Validate structure with Zod
    const result = backupDataSchema.safeParse(parsed);
    if (!result.success) {
      const issues = result.error.issues.map((i) => i.message).join("; ");
      return NextResponse.json(
        { error: `Invalid backup format: ${issues}` },
        { status: 400 },
      );
    }
    const backup: BackupData = result.data;

    // Validate depth and string sizes beyond what Zod checks
    const validationErr = validateImportDepthAndSize(backup.tables);
    if (validationErr) {
      return NextResponse.json(
        { error: `Invalid backup data: ${validationErr}` },
        { status: 400 },
      );
    }

    const importResult = await importBackup(
      db as Parameters<typeof importBackup>[0],
      backup,
    );

    return NextResponse.json({ ok: true, ...importResult });
  } catch (error) {
    log("error", "import_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: "An internal error occurred during import" },
      { status: 500 },
    );
  }
}
