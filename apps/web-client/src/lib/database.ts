import { drizzle } from "drizzle-orm/postgres-js";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("Database configuration missing: set DATABASE_URL.");
}

/**
 * PostgreSQL pool for Next.js server code. `@repo/db/database` uses Bun's SQL
 * driver, which the Node.js runtime Next.js renders with cannot load.
 */
export const postgresDb = drizzle(databaseUrl);
