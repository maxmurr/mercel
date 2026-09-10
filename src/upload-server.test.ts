import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { createInterface } from "node:readline";
import { buffer } from "node:stream/consumers";
import { fileURLToPath } from "node:url";
import { Worker } from "bullmq";
import { createClient } from "redis";
import { simpleGit } from "simple-git";
import { expect, test } from "vitest";
import { getFilePaths } from "./utils/file-paths.ts";
import { idPattern } from "./utils/id.ts";

const UPLOAD_SERVER_PATH = fileURLToPath(
  new URL("./upload-server.ts", import.meta.url)
);
const SECRET_URL =
  "https://deploy:demo-secret%21suffix@example.com/org/repo.git?access_token=demo-query-token#demo-fragment";

async function readServerEvent(
  lines: AsyncIterator<string>,
  matches: (event: Record<string, unknown>) => boolean
): Promise<Record<string, unknown>> {
  for (;;) {
    // biome-ignore lint/performance/noAwaitInLoops: Read server events in order until the expected event arrives.
    const { value, done } = await lines.next();
    if (done) {
      throw new Error("Server stopped before the expected log event arrived.");
    }
    const event: Record<string, unknown> = JSON.parse(value);
    if (matches(event)) {
      return event;
    }
  }
}

test.each(["REDIS_URL", "WORKBENCH_USER", "WORKBENCH_PASS"])(
  "startup rejects missing %s",
  (missing) => {
    const result = spawnSync("bun", [UPLOAD_SERVER_PATH], {
      env: {
        ...process.env,
        PORT: "0",
        REDIS_URL: "redis://127.0.0.1:1",
        WORKBENCH_PASS: "test-password",
        WORKBENCH_USER: "test-user",
        [missing]: "",
      },
      timeout: 5000,
    });

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr.toString()).toContain(
      "Workbench configuration missing: set REDIS_URL, WORKBENCH_USER, and WORKBENCH_PASS."
    );
  }
);

test("deploy uploads before publishing a BullMQ job and exposes its live state", async ({
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
  const redis = createClient({ url: redisUrl });
  const redisErrors: Error[] = [];
  redis.on("error", (error: Error) => redisErrors.push(error));
  onTestFinished(() => redis.destroy());
  await redis.connect();

  const uploads = new Map<string, Buffer>();
  const queuedDuringUpload: number[] = [];
  let uploadsUntilFailure = Number.POSITIVE_INFINITY;
  let rejectedKey: string | undefined;
  const s3Server = createServer(async (request, response) => {
    const body = await buffer(request);
    const url = new URL(request.url ?? "/", "http://localhost");
    const uploadId = url.pathname.split("/")[3] ?? "";
    queuedDuringUpload.push(await redis.exists(`bull:jobs:${uploadId}`));
    if (uploadsUntilFailure === 0) {
      rejectedKey = decodeURIComponent(url.pathname).replace(
        "/test-bucket/",
        ""
      );
      response.writeHead(403, { "Content-Type": "application/xml" });
      response.end(
        `<Error><Code>AccessDenied</Code><Message>Upload rejected at ${SECRET_URL}</Message></Error>`
      );
      return;
    }
    uploadsUntilFailure -= 1;
    uploads.set(decodeURIComponent(url.pathname), body);
    response.writeHead(200, { ETag: '"test-etag"' });
    response.end();
  });
  s3Server.listen(0, "127.0.0.1");
  await once(s3Server, "listening");
  const address = s3Server.address();
  assert(address && typeof address !== "string");

  const workspace = await mkdtemp(join(tmpdir(), "mercel-deploy-"));
  const repoUrl = join(workspace, "source");
  const server = spawn("bun", [UPLOAD_SERVER_PATH], {
    cwd: workspace,
    env: {
      ...process.env,
      AWS_ACCESS_KEY_ID: "test-access-key",
      AWS_REGION: "us-east-1",
      AWS_SECRET_ACCESS_KEY: "test-secret-key",
      AWS_SESSION_TOKEN: "",
      NODE_ENV: "production",
      PORT: "0",
      REDIS_URL: redisUrl,
      S3_BUCKET: "test-bucket",
      S3_ENDPOINT: `http://127.0.0.1:${address.port}`,
      WORKBENCH_PASS: "test-password",
      WORKBENCH_USER: "test-user",
    },
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 30_000,
  });
  const serverClosed = once(server, "close");
  const stdout = server.stdout.setEncoding("utf8");
  let output = "";
  stdout.on("data", (chunk) => {
    output += chunk;
  });
  const lines = createInterface({ input: stdout })[Symbol.asyncIterator]();
  const stderr = server.stderr.setEncoding("utf8");
  stderr.on("data", (chunk) => {
    output += chunk;
  });
  const errorLines = createInterface({ input: stderr })[Symbol.asyncIterator]();

  try {
    await mkdir(repoUrl);
    await writeFile(join(repoUrl, "README.md"), "# Test repository\n");
    await mkdir(join(repoUrl, "nested"));
    await writeFile(
      join(repoUrl, "nested", "file with spaces.bin"),
      Buffer.from([0, 255, 1])
    );
    await writeFile(join(repoUrl, ".hidden"), "");
    await simpleGit(repoUrl, {
      config: [
        "user.name=Test",
        "user.email=test@example.com",
        "commit.gpgsign=false",
      ],
    })
      .init()
      .add(".")
      .commit("Initial commit");

    const startup = await readServerEvent(
      lines,
      (event) => event.action === "server_start"
    );
    expect(startup).toMatchObject({
      hostname: expect.any(String),
      level: "info",
      port: expect.any(Number),
      service: "mercel-upload-server",
    });
    const baseUrl = `http://localhost:${startup.port}`;

    const home = await fetch(new URL("/", baseUrl), {
      headers: { Origin: "https://example.com" },
    });
    expect(home.status).toBe(200);
    expect(await home.text()).toBe("Hello Elysia");
    expect(home.headers.get("access-control-allow-origin")).toBe("*");

    const preflight = await fetch(new URL("/deploy", baseUrl), {
      headers: {
        "Access-Control-Request-Method": "POST",
        Origin: "https://example.com",
      },
      method: "OPTIONS",
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe("*");

    const jobs = await fetch(new URL("/jobs", baseUrl));
    expect(jobs.status).toBe(401);

    const docs = await fetch(new URL("/openapi", baseUrl));
    expect(docs.status).toBe(200);
    expect(docs.headers.get("content-type")).toContain("text/html");
    // Elysia's injected colors would override the selected Scalar theme.
    expect(await docs.text()).not.toContain("--scalar-color-accent:");

    const response = await fetch(new URL("/openapi/json", baseUrl));
    expect(response.status).toBe(200);
    const spec = await response.json();
    expect(spec).toHaveProperty(
      [
        "paths",
        "/deploy",
        "post",
        "requestBody",
        "content",
        "application/json",
        "schema",
      ],
      expect.objectContaining({
        properties: { repoUrl: expect.objectContaining({ type: "string" }) },
        required: ["repoUrl"],
      })
    );
    for (const status of ["200", "500"]) {
      expect(spec).toHaveProperty(
        [
          "paths",
          "/deploy",
          "post",
          "responses",
          status,
          "content",
          "application/json",
          "schema",
        ],
        expect.objectContaining({
          properties: { id: expect.objectContaining({ type: "string" }) },
          required: ["id"],
          type: "object",
        })
      );
    }

    expect(spec).toHaveProperty(["paths", "/status", "get", "parameters"]);
    for (const status of ["200", "404", "503"]) {
      expect(spec).toHaveProperty([
        "paths",
        "/status",
        "get",
        "responses",
        status,
      ]);
    }
    await Promise.all(
      ["/status", "/status?id=", "/status?id=abc$1"].map(async (path) => {
        expect((await fetch(new URL(path, baseUrl))).status).toBe(422);
      })
    );
    const unknownStatus = await fetch(new URL("/status?id=ABCDE", baseUrl));
    expect(unknownStatus.status).toBe(404);
    expect(await unknownStatus.json()).toEqual({ message: "Upload not found" });

    await Promise.all(
      [
        undefined,
        null,
        [],
        {},
        "repo",
        { repoUrl: "" },
        { repoUrl: null },
        { repoUrl: 42 },
      ].map(async (body) => {
        const result = await fetch(new URL("/deploy", baseUrl), {
          body: body === undefined ? null : JSON.stringify(body),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        });
        expect(result.status).toBe(422);
      })
    );
    expect(uploads.size).toBe(0);
    expect(await redis.lRange("bull:jobs:wait", 0, -1)).toEqual([]);

    const deploy = await fetch(new URL("/deploy", baseUrl), {
      body: JSON.stringify({ repoUrl }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    expect(deploy.status).toBe(200);
    const deployResponse = await deploy.json();

    const deployEvent = await readServerEvent(
      lines,
      (event) => event.action === "deploy"
    );
    expect(deployEvent.id).toBeTypeOf("string");
    expect(deployEvent).toMatchObject({
      action: "deploy",
      level: "info",
      method: "POST",
      path: "/deploy",
      requestId: expect.any(String),
      service: "mercel-upload-server",
      stage: "complete",
      status: 200,
    });
    const outputDirectory = join(workspace, "output", "upload");
    const id = String(deployEvent.id);
    expect(id).toMatch(idPattern);
    expect(deployResponse).toEqual({ id });
    expect(await readdir(outputDirectory)).toEqual([id]);
    const cloneDirectory = join(outputDirectory, id);
    expect(deployEvent).not.toHaveProperty("repoUrl");
    expect(deployEvent).not.toHaveProperty("filePaths");
    expect(deployEvent).not.toHaveProperty("currentKey");
    expect(await readFile(join(cloneDirectory, "README.md"), "utf8")).toBe(
      "# Test repository\n"
    );
    expect(await simpleGit(cloneDirectory).revparse(["HEAD"])).toBe(
      await simpleGit(repoUrl).revparse(["HEAD"])
    );

    const filePaths = await getFilePaths({ directoryPath: cloneDirectory });
    expect(uploads.size).toBe(filePaths.length);
    expect(deployEvent).toMatchObject({
      fileCount: filePaths.length,
      uploadedBytes: [...uploads.values()].reduce(
        (total, contents) => total + contents.length,
        0
      ),
      uploadedCount: filePaths.length,
    });
    await Promise.all(
      filePaths.map(async (filePath) => {
        const key = `/test-bucket/output/${id}/${relative(cloneDirectory, filePath).split(sep).join("/")}`;
        expect(uploads.get(key)).toEqual(await readFile(filePath));
      })
    );

    expect(queuedDuringUpload).toEqual(filePaths.map(() => 0));
    expect(await redis.lRange("bull:jobs:wait", 0, -1)).toEqual([id]);
    expect(await redis.hGet(`bull:jobs:${id}`, "name")).toBe("deploy");
    expect(
      JSON.parse((await redis.hGet(`bull:jobs:${id}`, "data")) ?? "null")
    ).toEqual({ uploadId: id });
    expect(await redis.exists("status")).toBe(0);
    const waitingStatus = await fetch(new URL(`/status?id=${id}`, baseUrl));
    expect(waitingStatus.status).toBe(200);
    expect(waitingStatus.headers.get("cache-control")).toBe("no-store");
    expect(await waitingStatus.json()).toEqual({ status: "waiting" });

    // BullMQ transitions must be visible without writing a separate status hash.
    const worker = new Worker("jobs", undefined, {
      autorun: false,
      connection: { url: redisUrl },
    });
    worker.on("error", (error: Error) => redisErrors.push(error));
    onTestFinished(async () => {
      await worker.close(true);
    });
    const job = await worker.getNextJob("test-token", { block: false });
    expect(job.id).toBe(id);
    const activeStatus = await fetch(new URL(`/status?id=${id}`, baseUrl));
    expect(activeStatus.status).toBe(200);
    expect(await activeStatus.json()).toEqual({ status: "active" });

    await job.moveToFailed(new Error("Test job failure"), "test-token", false);
    const failedStatus = await fetch(new URL(`/status?id=${id}`, baseUrl));
    expect(failedStatus.status).toBe(200);
    expect(await failedStatus.json()).toEqual({ status: "failed" });

    await job.retry();
    const retriedJob = await worker.getNextJob("retry-token", { block: false });
    await retriedJob.moveToCompleted(null, "retry-token", false);
    const completedStatus = await fetch(new URL(`/status?id=${id}`, baseUrl));
    expect(completedStatus.status).toBe(200);
    expect(await completedStatus.json()).toEqual({ status: "completed" });

    await retriedJob.remove();
    const removedStatus = await fetch(new URL(`/status?id=${id}`, baseUrl));
    expect(removedStatus.status).toBe(404);
    expect(await removedStatus.json()).toEqual({ message: "Upload not found" });
    await worker.close();

    uploadsUntilFailure = 1;
    const failedUpload = await fetch(new URL("/deploy", baseUrl), {
      body: JSON.stringify({ repoUrl }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    expect(failedUpload.status).toBe(500);
    const failedUploadBody = await failedUpload.json();
    expect(failedUploadBody).toEqual({ id: expect.any(String) });
    assert(
      failedUploadBody !== null &&
        typeof failedUploadBody === "object" &&
        "id" in failedUploadBody
    );
    const failedUploadId = String(failedUploadBody.id);
    expect(await redis.exists(`bull:jobs:${failedUploadId}`)).toBe(0);
    const failedUploadEvent = await readServerEvent(
      errorLines,
      (event) => event.id === failedUploadId && event.action === "deploy"
    );
    const partialUploads = [...uploads.entries()].filter(([key]) =>
      key.startsWith(`/test-bucket/output/${failedUploadId}/`)
    );
    expect(partialUploads).toHaveLength(1);
    expect(failedUploadEvent).toMatchObject({
      currentKey: rejectedKey,
      error: { message: "Upload rejected at [REDACTED]", name: "AccessDenied" },
      fileCount: filePaths.length,
      level: "error",
      stage: "upload",
      status: 500,
      uploadedBytes: partialUploads[0]?.[1].length,
      uploadedCount: 1,
    });
    expect(failedUploadEvent).not.toHaveProperty("filePaths");

    const failedDeploy = await fetch(new URL("/deploy", baseUrl), {
      body: JSON.stringify({ repoUrl: join(workspace, "missing-repo") }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    expect(failedDeploy.status).toBe(500);
    const failedDeployBody = await failedDeploy.json();
    expect(failedDeployBody).toEqual({ id: expect.any(String) });
    assert(
      failedDeployBody !== null &&
        typeof failedDeployBody === "object" &&
        "id" in failedDeployBody
    );
    expect(await redis.exists(`bull:jobs:${String(failedDeployBody.id)}`)).toBe(
      0
    );
    expect(await redis.lRange("bull:jobs:wait", 0, -1)).toEqual([]);
    const failedCloneEvent = await readServerEvent(
      errorLines,
      (event) => event.id === failedDeployBody.id && event.action === "deploy"
    );
    expect(failedCloneEvent).toMatchObject({
      level: "error",
      stage: "clone",
      status: 500,
      uploadedBytes: 0,
      uploadedCount: 0,
    });
    expect(failedCloneEvent).not.toHaveProperty("currentKey");
    expect(failedCloneEvent).not.toHaveProperty("fileCount");

    const credentialUrl = SECRET_URL.replace(
      "https://deploy:demo-secret%21suffix@example.com",
      `http://deploy:demo-secret%21suffix@127.0.0.1:${address.port}`
    );
    const failedCredentialClone = await fetch(new URL("/deploy", baseUrl), {
      body: JSON.stringify({ repoUrl: credentialUrl }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    expect(failedCredentialClone.status).toBe(500);
    const credentialBody = await failedCredentialClone.json();
    assert(
      credentialBody !== null &&
        typeof credentialBody === "object" &&
        "id" in credentialBody
    );
    const credentialEvent = await readServerEvent(
      errorLines,
      (event) => event.id === credentialBody.id && event.action === "deploy"
    );
    expect(credentialEvent).toMatchObject({ stage: "clone", status: 500 });
    expect(credentialEvent).not.toHaveProperty("repoUrl");
    for (const secret of ["demo-secret", "demo-query-token", "demo-fragment"]) {
      expect(output).not.toContain(secret);
    }

    // Deny BullMQ reads and scripts without changing its internal Redis keys.
    await redis.aclSetUser("default", ["-hgetall", "-evalsha", "-eval"]);
    const unavailableStatus = await fetch(new URL(`/status?id=${id}`, baseUrl));
    expect(unavailableStatus.status).toBe(503);
    expect(await unavailableStatus.json()).toEqual({
      message: "Upload status unavailable",
    });
    uploadsUntilFailure = Number.POSITIVE_INFINITY;
    const redisFailedDeploy = await fetch(new URL("/deploy", baseUrl), {
      body: JSON.stringify({ repoUrl }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    expect(redisFailedDeploy.status).toBe(500);
    const redisFailedBody = await redisFailedDeploy.json();
    expect(redisFailedBody).toEqual({ id: expect.any(String) });
    assert(
      redisFailedBody !== null &&
        typeof redisFailedBody === "object" &&
        "id" in redisFailedBody
    );
    const publishFailureEvent = await readServerEvent(
      errorLines,
      (event) => event.id === redisFailedBody.id && event.action === "deploy"
    );
    expect(publishFailureEvent).toMatchObject({
      fileCount: filePaths.length,
      level: "error",
      stage: "publish",
      status: 500,
      uploadedCount: filePaths.length,
    });
    expect(publishFailureEvent).not.toHaveProperty("currentKey");
    expect(await redis.lRange("bull:jobs:wait", 0, -1)).toEqual([]);
    expect(await redis.exists("status")).toBe(0);
    expect(redisErrors).toEqual([]);
  } finally {
    server.kill();
    await serverClosed;
    const s3Closed = once(s3Server, "close");
    s3Server.close();
    await s3Closed;
    await rm(workspace, { force: true, recursive: true });
  }
}, 30_000);
