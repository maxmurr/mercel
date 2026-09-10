import { execFileSync, spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { Queue } from "bullmq";
import { expect, test } from "vitest";

const DEPLOY_SERVER_PATH = fileURLToPath(
  new URL("./deploy-server.ts", import.meta.url)
);

test("deploy server rejects missing REDIS_URL", () => {
  const result = spawnSync("bun", [DEPLOY_SERVER_PATH], {
    env: { ...process.env, DEPLOY_PORT: "0", REDIS_URL: "" },
    timeout: 5000,
  });

  expect(result.error).toBeUndefined();
  expect(result.status).toBe(1);
  expect(result.stderr.toString()).toContain(
    "Deploy server configuration missing: set REDIS_URL."
  );
});

test("deploy server logs incoming BullMQ jobs without consuming them", async ({
  onTestFinished,
}) => {
  const redisContainer = execFileSync(
    "docker",
    [
      "run",
      "--detach",
      "--rm",
      "--publish",
      "127.0.0.1::6379",
      "redis:8-alpine",
      "redis-server",
      "--save",
      "",
      "--appendonly",
      "no",
    ],
    { encoding: "utf8", timeout: 30_000 }
  ).trim();
  onTestFinished(() => {
    execFileSync("docker", ["rm", "--force", redisContainer], {
      timeout: 10_000,
    });
  });
  const redisAddress = execFileSync(
    "docker",
    ["port", redisContainer, "6379/tcp"],
    { encoding: "utf8", timeout: 10_000 }
  ).trim();
  const redisUrl = `redis://${redisAddress}`;
  const queue = new Queue<{ uploadId: string }>("jobs", {
    connection: { url: redisUrl },
  });
  const queueErrors: Error[] = [];
  queue.on("error", (error: Error) => queueErrors.push(error));
  onTestFinished(async () => {
    await queue.close();
  });
  await queue.waitUntilReady();

  const server = spawn("bun", [DEPLOY_SERVER_PATH], {
    env: {
      ...process.env,
      DEPLOY_PORT: "0",
      NODE_ENV: "production",
      REDIS_URL: redisUrl,
    },
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 10_000,
  });
  const serverClosed = once(server, "close");
  const lines = createInterface({ input: server.stdout })[
    Symbol.asyncIterator
  ]();
  onTestFinished(async () => {
    server.kill();
    await serverClosed;
  });

  const startup = JSON.parse((await lines.next()).value ?? "null");
  expect(startup).toMatchObject({
    action: "server_start",
    port: expect.any(Number),
    service: "mercel-deploy-server",
  });
  const response = await fetch(`http://localhost:${startup.port}/`);
  expect(response.status).toBe(404);

  const jobs = await queue.addBulk([
    { data: { uploadId: "abc12" }, name: "deploy", opts: { jobId: "abc12" } },
    { data: { uploadId: "def34" }, name: "deploy", opts: { jobId: "def34" } },
  ]);
  const events = await Promise.all(jobs.map(() => lines.next()));
  expect(events.map(({ value }) => JSON.parse(value ?? "null"))).toEqual(
    jobs.map((job) =>
      expect.objectContaining({
        action: "job_added",
        jobId: job.id,
        level: "info",
        name: "deploy",
        queue: "jobs",
        service: "mercel-deploy-server",
      })
    )
  );
  expect(await Promise.all(jobs.map((job) => job.getState()))).toEqual([
    "waiting",
    "waiting",
  ]);
  expect(queueErrors).toEqual([]);
}, 30_000);
