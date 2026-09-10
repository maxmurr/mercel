import { drizzle } from "drizzle-orm/bun-sql";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("Database configuration missing: set DATABASE_URL.");
}

/** Shared PostgreSQL pool; connections open on the first query. */
export const postgresDb = drizzle(databaseUrl);
