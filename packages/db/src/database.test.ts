import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { assertExitsWithoutDatabaseUrl } from "@repo/utils/test-helpers";
import { expect, test } from "vitest";

test.each(["./database.ts", "../drizzle.config.ts"])(
  "%s rejects missing DATABASE_URL",
  (path) => {
    assertExitsWithoutDatabaseUrl({
      entrypoint: fileURLToPath(new URL(path, import.meta.url)),
    });
  }
);

test("PostgreSQL client initializes without opening a connection", () => {
  const result = spawnSync(
    "bun",
    [fileURLToPath(new URL("./database.ts", import.meta.url))],
    {
      env: {
        ...process.env,
        DATABASE_URL: "postgresql://test:test@127.0.0.1:1/test",
      },
      timeout: 5000,
    }
  );

  expect(result.error).toBeUndefined();
  expect(result.stderr.toString()).toBe("");
  expect(result.status).toBe(0);
});
