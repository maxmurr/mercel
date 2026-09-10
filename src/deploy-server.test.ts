import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { Queue, QueueEvents } from "bullmq";
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

test("deploy server downloads BullMQ jobs, retries partial downloads, and rejects invalid jobs", async ({
  onTestFinished,
}) => {
  const directory = await mkdtemp(join(tmpdir(), "mercel-deploy-"));
  onTestFinished(async () => {
    await rm(directory, { force: true, recursive: true });
  });
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
  const queue = new Queue<unknown, number>("jobs", {
    connection: { url: redisUrl },
  });
  const queueEvents = new QueueEvents("jobs", {
    connection: { url: redisUrl },
  });
  const queueErrors: Error[] = [];
  queue.on("error", (error: Error) => queueErrors.push(error));
  queueEvents.on("error", (error: Error) => queueErrors.push(error));
  onTestFinished(async () => {
    await queueEvents.close();
    await queue.close();
  });
  await Promise.all([queue.waitUntilReady(), queueEvents.waitUntilReady()]);

  const files = new Map([
    ["output/abc12/index.html", Buffer.from("<h1>Deploy</h1>")],
    ["output/abc12/assets/logo.bin", Buffer.from([0, 255, 1])],
    ["output/def34/.git/HEAD", Buffer.from("ref: refs/heads/main\n")],
    ["output/ghi56/first.txt", Buffer.from("first")],
    ["output/ghi56/second.txt", Buffer.from("second")],
  ]);
  const prefixes: string[] = [];
  let failedKey = "output/ghi56/second.txt";
  const s3Server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.searchParams.get("list-type") === "2") {
      const prefix = url.searchParams.get("prefix") ?? "";
      prefixes.push(prefix);
      response.writeHead(200, { "Content-Type": "application/xml" });
      response.end(
        `<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
          <IsTruncated>false</IsTruncated>
          ${[...files.keys()]
            .filter((key) => key.startsWith(prefix))
            .map((key) => `<Contents><Key>${key}</Key></Contents>`)
            .join("")}
        </ListBucketResult>`
      );
      return;
    }
    const requestedKey = decodeURIComponent(url.pathname).slice(
      "/test-bucket/".length
    );
    if (requestedKey === failedKey) {
      response.writeHead(403, { "Content-Type": "application/xml" });
      response.end("<Error><Code>AccessDenied</Code></Error>");
      return;
    }
    const contents = files.get(requestedKey);
    response.writeHead(contents ? 200 : 404);
    response.end(contents);
  });
  onTestFinished(async () => {
    const closed = once(s3Server, "close");
    s3Server.close();
    await closed;
  });
  s3Server.listen(0, "127.0.0.1");
  await once(s3Server, "listening");
  const address = s3Server.address();
  assert(address && typeof address !== "string");

  const queuedJob = await queue.add(
    "deploy",
    { uploadId: "abc12" },
    { jobId: "abc12" }
  );
  expect(await queuedJob.getState()).toBe("waiting");

  const server = spawn("bun", [DEPLOY_SERVER_PATH], {
    cwd: directory,
    env: {
      ...process.env,
      AWS_ACCESS_KEY_ID: "test-access-key",
      AWS_REGION: "us-east-1",
      AWS_SECRET_ACCESS_KEY: "test-secret-key",
      AWS_SESSION_TOKEN: "",
      DEPLOY_PORT: "0",
      NODE_ENV: "production",
      REDIS_URL: redisUrl,
      S3_BUCKET: "test-bucket",
      S3_ENDPOINT: `http://127.0.0.1:${address.port}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 15_000,
  });
  const serverClosed = once(server, "close");
  const lines = createInterface({ input: server.stdout })[
    Symbol.asyncIterator
  ]();
  const errors = createInterface({ input: server.stderr })[
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
  const healthResponse = await fetch(`http://localhost:${startup.port}/`);
  expect(healthResponse.status).toBe(404);

  const jobs = [
    queuedJob,
    await queue.add("deploy", { uploadId: "def34" }, { jobId: "def34" }),
  ];
  expect(
    await Promise.all(
      jobs.map((job) => job.waitUntilFinished(queueEvents, 5000))
    )
  ).toEqual([2, 1]);
  expect(await Promise.all(jobs.map((job) => job.getState()))).toEqual([
    "completed",
    "completed",
  ]);
  expect(prefixes).toEqual(["output/abc12/", "output/def34/"]);
  await Promise.all(
    [...files.entries()].slice(0, 3).map(async ([key, contents]) => {
      const relativePath = key.slice("output/".length);
      expect(
        await readFile(join(directory, "output", "deploy", relativePath))
      ).toEqual(contents);
    })
  );
  const events = await Promise.all(jobs.map(() => lines.next()));
  expect(events.map(({ value }) => JSON.parse(value ?? "null"))).toEqual([
    expect.objectContaining({
      action: "download_completed",
      fileCount: 2,
      jobId: "abc12",
    }),
    expect.objectContaining({
      action: "download_completed",
      fileCount: 1,
      jobId: "def34",
    }),
  ]);

  const failedJob = await queue.add(
    "deploy",
    { uploadId: "ghi56" },
    { jobId: "ghi56" }
  );
  await expect(
    failedJob.waitUntilFinished(queueEvents, 5000)
  ).rejects.toThrow();
  expect(await failedJob.getState()).toBe("failed");
  expect(JSON.parse((await errors.next()).value ?? "null")).toMatchObject({
    action: "download_failed",
    jobId: "ghi56",
    level: "error",
  });
  const retryDirectory = join(directory, "output", "deploy", "ghi56");
  expect(await readFile(join(retryDirectory, "first.txt"), "utf8")).toBe(
    "first"
  );
  await writeFile(join(retryDirectory, "stale.txt"), "discard on retry");
  failedKey = "";
  await failedJob.retry();
  expect(await failedJob.waitUntilFinished(queueEvents, 5000)).toBe(2);
  expect(await readFile(join(retryDirectory, "second.txt"), "utf8")).toBe(
    "second"
  );
  await expect(
    readFile(join(retryDirectory, "stale.txt"))
  ).rejects.toMatchObject({ code: "ENOENT" });

  const emptyJob = await queue.add(
    "deploy",
    { uploadId: "empty" },
    { jobId: "empty" }
  );
  await expect(emptyJob.waitUntilFinished(queueEvents, 5000)).rejects.toThrow(
    "Deploy download found no files for uploadId: empty"
  );
  expect(await emptyJob.getState()).toBe("failed");

  const outsideFile = join(directory, "output", "keep.txt");
  await writeFile(outsideFile, "keep");
  const invalidJobs = await queue.addBulk([
    { data: { uploadId: "../.." }, name: "deploy" },
    { data: { uploadId: 12_345 }, name: "deploy" },
    { data: {}, name: "deploy" },
    { data: null, name: "deploy" },
    { data: { uploadId: "abc12" }, name: "other" },
  ]);
  await Promise.all(
    invalidJobs.map(async (job) => {
      await expect(job.waitUntilFinished(queueEvents, 5000)).rejects.toThrow(
        "Deploy job"
      );
      expect(await job.getState()).toBe("failed");
    })
  );
  expect(await readFile(outsideFile, "utf8")).toBe("keep");
  expect(prefixes).toEqual([
    "output/abc12/",
    "output/def34/",
    "output/ghi56/",
    "output/ghi56/",
    "output/empty/",
  ]);
  expect(queueErrors).toEqual([]);
}, 30_000);
