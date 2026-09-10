import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import type { TestContext } from "vitest";

/** Matches the startup error every entrypoint prints when DATABASE_URL is unset. */
const missingDatabaseUrlPattern =
  /Database configuration missing: set DATABASE_URL\./;

/**
 * Options for asserting that an entrypoint refuses to start without DATABASE_URL.
 */
interface AssertExitsWithoutDatabaseUrlOptions {
  /**
   * Absolute path of the script Bun runs with an empty DATABASE_URL.
   * @example fileURLToPath(new URL("./upload-server.ts", import.meta.url))
   */
  entrypoint: string;
}

/**
 * Runs an entrypoint with DATABASE_URL cleared and asserts it exits with status 1 and the shared configuration error.
 * @param options The entrypoint to run.
 * @returns Nothing; passes silently when the process fails as expected.
 * @throws AssertionError when the process starts, exits with another status, or prints a different error.
 * @example
 * assertExitsWithoutDatabaseUrl({
 *   entrypoint: fileURLToPath(new URL("./deploy-worker.ts", import.meta.url)),
 * });
 */
export function assertExitsWithoutDatabaseUrl({
  entrypoint,
}: AssertExitsWithoutDatabaseUrlOptions): void {
  const result = spawnSync("bun", [entrypoint], {
    env: { ...process.env, DATABASE_URL: "" },
    timeout: 5000,
  });

  assert.ifError(result.error);
  assert.equal(result.status, 1);
  assert.match(result.stderr.toString(), missingDatabaseUrlPattern);
}

/** Runs a throwaway Docker container on a random localhost port and removes it after the test. */
export function startContainer({
  command = [],
  env = {},
  image,
  onTestFinished,
  port,
}: Pick<TestContext, "onTestFinished"> & {
  command?: string[];
  env?: Record<string, string>;
  image: string;
  port: number;
}): { address: string; container: string } {
  const container = execFileSync(
    "docker",
    [
      "run",
      "--detach",
      "--rm",
      "--publish",
      `127.0.0.1::${port}`,
      ...Object.entries(env).flatMap(([key, value]) => [
        "--env",
        `${key}=${value}`,
      ]),
      image,
      ...command,
    ],
    { encoding: "utf8", timeout: 30_000 }
  ).trim();
  onTestFinished(() => {
    execFileSync("docker", ["rm", "--force", container], { timeout: 10_000 });
  });
  const address = execFileSync("docker", ["port", container, `${port}/tcp`], {
    encoding: "utf8",
    timeout: 10_000,
  }).trim();
  return { address, container };
}

/** Reads JSON log lines in order until one matches, failing if the process exits first. */
export async function readLogEvent(
  lines: AsyncIterator<string>,
  matches: (event: Record<string, unknown>) => boolean
): Promise<Record<string, unknown>> {
  for (;;) {
    // biome-ignore lint/performance/noAwaitInLoops: Read log events in order until the expected event arrives.
    const { value, done } = await lines.next();
    if (done) {
      throw new Error("Process stopped before the expected log event arrived.");
    }
    const event: Record<string, unknown> = JSON.parse(value);
    if (matches(event)) {
      return event;
    }
  }
}
