import bun from "bun";
import { expect, test, vi } from "vitest";

const connections = vi.hoisted(() => ({
  queue: {
    on: vi.fn<(event: string, listener: (error: Error) => void) => void>(),
    waitUntilReady: vi.fn(),
  },
  redis: {
    connect: vi.fn(),
    on: vi.fn<(event: string, listener: (error: Error) => void) => void>(),
  },
}));

vi.mock("@repo/db/database", () => ({ postgresDb: {} }));
vi.mock("redis", () => ({ createClient: () => connections.redis }));
vi.mock("bullmq", () => ({
  createNodeRedisClient: vi.fn(),
  Queue: class {
    on = connections.queue.on;
    waitUntilReady = connections.queue.waitUntilReady;
  },
}));
vi.mock("@getworkbench/elysia", () => ({
  workbench: () => () => new Response(),
}));

test("upload server redacts connection errors in development output", async () => {
  const output: string[] = [];
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("REDIS_URL", "redis://localhost:6379");
  vi.stubEnv("DEPLOY_TOKEN", "test-deploy-token");
  vi.stubEnv("WORKBENCH_USER", "test-user");
  vi.stubEnv("WORKBENCH_PASS", "test-password");
  vi.stubEnv("PORT", "0");
  const serve = vi.spyOn(bun, "serve");
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    output.push(args.map(String).join(" "));
  });
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    output.push(String(chunk));
    return true;
  });
  try {
    await import("./upload-server.ts");
    const listeners = [
      ...connections.redis.on.mock.calls,
      ...connections.queue.on.mock.calls,
    ];
    expect(listeners).toHaveLength(2);
    for (const [event, listener] of listeners) {
      expect(event).toBe("error");
      listener(
        new Error(
          "Connection failed redis://test:synthetic-secret@localhost:6379"
        )
      );
    }
  } finally {
    await Promise.all(
      serve.mock.results.map((result) =>
        result.type === "return" ? result.value.stop(true) : undefined
      )
    );
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  }
  const logged = output.join("\n");
  expect(logged).not.toContain("synthetic-secret");
  expect(logged).toContain("[REDACTED]");
  expect(logged).toContain("redis_error");
  expect(logged).toContain("queue_error");
});
