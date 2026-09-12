import { Mastra } from "@mastra/core";
import { PostgresStore } from "@mastra/pg";
import { agent } from "./agents/agent";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("Database configuration missing: set DATABASE_URL.");
}

/** Mastra registry for server-side code and the local Studio CLI. */
export const mastra = new Mastra({
  agents: { agent },
  // Threads and messages share the app's database, so conversations survive reloads and restarts.
  storage: new PostgresStore({ connectionString, id: "mastra-storage" }),
});
