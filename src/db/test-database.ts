import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/bun-sql";
import { migrate } from "drizzle-orm/bun-sql/migrator";
import type { TestContext } from "vitest";
import { startContainer } from "../test-helpers.ts";

/** Starts an isolated PostgreSQL database with production migrations for integration tests. */
export async function createTestDatabase({
  onTestFinished,
}: Pick<TestContext, "onTestFinished">) {
  const { address, container } = startContainer({
    env: {
      POSTGRES_DB: "test",
      POSTGRES_PASSWORD: "test",
      POSTGRES_USER: "test",
    },
    image: "postgres:18-alpine",
    onTestFinished,
    port: 5432,
  });
  execFileSync(
    "docker",
    [
      "exec",
      container,
      "sh",
      "-c",
      "until pg_isready -h 127.0.0.1 -U test -d test; do sleep 0.1; done",
    ],
    { timeout: 15_000 }
  );
  const databaseUrl = `postgresql://test:test@${address}/test`;
  const database = drizzle(databaseUrl);
  const sql = database.$client;
  onTestFinished(async () => {
    await sql.close({ timeout: 1 });
  });
  await migrate(database, {
    migrationsFolder: fileURLToPath(new URL("../../drizzle", import.meta.url)),
  });
  return { database, databaseUrl, sql };
}
