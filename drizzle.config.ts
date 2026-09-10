import { defineConfig } from "drizzle-kit";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("Database configuration missing: set DATABASE_URL.");
}

export default defineConfig({
  dbCredentials: { url: databaseUrl },
  dialect: "postgresql",
  out: "./drizzle",
  schema: "./src/db/schema.ts",
});
