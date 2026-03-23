import type { Config } from "drizzle-kit";

export default {
  schema: "./src/lib/db/schema-pg.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url:
      process.env.DATABASE_URL ??
      "postgresql://postgres:postgres@localhost:5432/ledgr",
  },
} satisfies Config;
