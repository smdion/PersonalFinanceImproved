import type { Config } from "drizzle-kit";

export default {
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    host: process.env.DATABASE_HOST ?? "localhost",
    port: Number(process.env.DATABASE_PORT ?? 5432),
    user: process.env.DATABASE_USER ?? "postgres",
    password: process.env.DATABASE_PASSWORD ?? "",
    database: process.env.DATABASE_NAME ?? "ledgr",
    ssl:
      process.env.DATABASE_SSL === "true"
        ? { rejectUnauthorized: false }
        : false,
  },
} satisfies Config;
