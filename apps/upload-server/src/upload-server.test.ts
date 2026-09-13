import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
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
import { deployments } from "@repo/db/schema";
import { createTestDatabase } from "@repo/db/test-database";
import { getFilePaths } from "@repo/utils/file-paths";
import { idPattern } from "@repo/utils/id";
import {
  assertExitsWithoutDatabaseUrl,
  readLogEvent,
  startContainer,
} from "@repo/utils/test-helpers";
import { Worker } from "bullmq";
import bun from "bun";
import { eq } from "drizzle-orm";
import { createClient } from "redis";
import { expect, test } from "vitest";

const UPLOAD_SERVER_PATH = fileURLToPath(
  new URL("./upload-server.ts", import.meta.url)
);
const deployToken = "test-deploy-token";
const deployHeaders = { Authorization: `Bearer ${deployToken}` };
const SECRET_URL =
  "https://deploy:demo-secret%21suffix@example.com/org/repo.git?access_token=demo-query-token#demo-fragment";

test("upload server rejects missing DATABASE_URL", () => {
  assertExitsWithoutDatabaseUrl({ entrypoint: UPLOAD_SERVER_PATH });
});

test.each(["REDIS_URL", "WORKBENCH_USER", "WORKBENCH_PASS"])(
  "startup rejects missing %s",
  (missing) => {
    const result = spawnSync("bun", [UPLOAD_SERVER_PATH], {
      env: {
        ...process.env,
        DATABASE_URL: "postgresql://test:test@127.0.0.1:1/test",
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

test.each([undefined, "", "   "])(
  "startup rejects missing DEPLOY_TOKEN %j",
  (token) => {
    const result = spawnSync("bun", ["--no-env-file", UPLOAD_SERVER_PATH], {
      env: {
        ...process.env,
        DATABASE_URL: "postgresql://test:test@127.0.0.1:1/test",
        DEPLOY_TOKEN: token,
        REDIS_URL: "redis://127.0.0.1:1",
        WORKBENCH_PASS: "test-password",
        WORKBENCH_USER: "test-user",
      },
      timeout: 5000,
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr.toString()).toContain(
      "Deployment authentication missing: set DEPLOY_TOKEN."
    );
  }
);

test("deploy persists status independently of BullMQ jobs, including upload failures", async ({
  onTestFinished,
}) => {
  const { database, databaseUrl, sql } = await createTestDatabase({
    onTestFinished,
  });
  const { address: redisAddress } = startContainer({
    command: ["redis-server", "--save", "", "--appendonly", "no"],
    image: "redis:8-alpine",
    onTestFinished,
    port: 6379,
  });
  const redisUrl = `redis://${redisAddress}`;
  const redis = createClient({ url: redisUrl });
  const redisErrors: Error[] = [];
  redis.on("error", (error: Error) => redisErrors.push(error));
  onTestFinished(() => redis.destroy());
  await redis.connect();

  const uploads = new Map<string, Buffer>();
  const queuedDuringUpload: number[] = [];
  const statusesDuringUpload: string[] = [];
  let uploadsUntilFailure = Number.POSITIVE_INFINITY;
  let rejectedKey: string | undefined;
  const s3Server = createServer(async (request, response) => {
    const body = await buffer(request);
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.searchParams.get("list-type") === "2") {
      const folder = `/test-bucket/${url.searchParams.get("prefix") ?? ""}`;
      response.writeHead(200, { "Content-Type": "application/xml" });
      response.end(
        `<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
        <IsTruncated>false</IsTruncated>
        ${[...uploads.keys()]
          .filter((key) => key.startsWith(folder))
          .map(
            (key) =>
              `<Contents><Key>${key.slice("/test-bucket/".length)}</Key></Contents>`
          )
          .join("")}
      </ListBucketResult>`
      );
      return;
    }
    if (request.method === "DELETE") {
      uploads.delete(decodeURIComponent(url.pathname));
      response.writeHead(204);
      response.end();
      return;
    }
    const uploadId = url.pathname.split("/")[3] ?? "";
    queuedDuringUpload.push(await redis.exists(`bull:jobs:${uploadId}`));
    if (request.method === "PUT") {
      const [deployment] = await database
        .select()
        .from(deployments)
        .where(eq(deployments.id, uploadId));
      statusesDuringUpload.push(deployment?.status ?? "missing");
    }
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
  const sourceDirectory = join(workspace, "source");
  const server = spawn("bun", [UPLOAD_SERVER_PATH], {
    cwd: workspace,
    env: {
      ...process.env,
      AWS_ACCESS_KEY_ID: "test-access-key",
      AWS_REGION: "us-east-1",
      AWS_SECRET_ACCESS_KEY: "test-secret-key",
      AWS_SESSION_TOKEN: "",
      DATABASE_URL: databaseUrl,
      DEPLOY_TOKEN: deployToken,
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
    await mkdir(sourceDirectory);
    await writeFile(join(sourceDirectory, "README.md"), "# Test project\n");
    await mkdir(join(sourceDirectory, "nested"));
    await writeFile(
      join(sourceDirectory, "nested", "file with spaces.bin"),
      Buffer.from([0, 255, 1])
    );
    await writeFile(join(sourceDirectory, ".hidden"), "");
    const archivePath = join(workspace, "source.tar.gz");
    spawnSync("tar", ["-czf", archivePath, "-C", sourceDirectory, "."]);
    const archive = bun.file(archivePath);
    const archiveForm = (file: Blob | string, republishId?: string) => {
      const form = new FormData();
      if (typeof file === "string") {
        form.append("archive", file);
      } else {
        form.append("archive", file, "source.tar.gz");
      }
      if (republishId) {
        form.append("id", republishId);
      }
      return form;
    };

    const startup = await readLogEvent(
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
        "multipart/form-data",
        "schema",
      ],
      expect.objectContaining({
        properties: {
          archive: expect.objectContaining({
            format: "binary",
            type: "string",
          }),
          id: expect.objectContaining({
            pattern: idPattern.source,
            type: "string",
          }),
        },
        required: ["archive"],
      })
    );
    for (const status of ["200", "409", "500"]) {
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
      ["/deploy", "/deploy/"].flatMap((path) =>
        [null, archiveForm(archive)].map(async (body) => {
          const unauthorized = await fetch(new URL(path, baseUrl), {
            body,
            method: "POST",
          });
          expect(unauthorized.status).toBe(401);
        })
      )
    );
    expect(await database.select().from(deployments)).toEqual([]);

    await Promise.all(
      [
        null,
        JSON.stringify({}),
        JSON.stringify({ archive: "source.tar.gz" }),
        new FormData(),
        archiveForm("source.tar.gz"),
      ].map(async (body) => {
        const result = await fetch(new URL("/deploy", baseUrl), {
          body,
          headers: {
            ...deployHeaders,
            ...(body instanceof FormData
              ? {}
              : { "Content-Type": "application/json" }),
          },
          method: "POST",
        });
        expect(result.status).toBe(422);
      })
    );
    expect(uploads.size).toBe(0);
    expect(await redis.lRange("bull:jobs:wait", 0, -1)).toEqual([]);

    const deploy = await fetch(new URL("/deploy", baseUrl), {
      body: archiveForm(archive),
      headers: deployHeaders,
      method: "POST",
    });
    expect(deploy.status).toBe(200);
    const deployResponse = await deploy.json();

    const deployEvent = await readLogEvent(
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
    const extractedDirectory = join(outputDirectory, id);
    expect(deployEvent).not.toHaveProperty("filePaths");
    expect(deployEvent).not.toHaveProperty("currentKey");
    expect(await readFile(join(extractedDirectory, "README.md"), "utf8")).toBe(
      "# Test project\n"
    );
    const relativePaths = async (directoryPath: string) =>
      (await getFilePaths({ directoryPath }))
        .map((filePath) => relative(directoryPath, filePath))
        .sort();
    expect(await relativePaths(extractedDirectory)).toEqual(
      await relativePaths(sourceDirectory)
    );

    const filePaths = await getFilePaths({
      directoryPath: extractedDirectory,
    });
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
        const key = `/test-bucket/output/${id}/${relative(extractedDirectory, filePath).split(sep).join("/")}`;
        expect(uploads.get(key)).toEqual(await readFile(filePath));
      })
    );

    expect(queuedDuringUpload).toEqual(filePaths.map(() => 0));
    expect(statusesDuringUpload).toEqual(filePaths.map(() => "uploading"));
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

    // Queue transitions alone do not change the persisted deployment status.
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
    const unchangedStatus = await fetch(new URL(`/status?id=${id}`, baseUrl));
    expect(await unchangedStatus.json()).toEqual({ status: "waiting" });
    await database
      .update(deployments)
      .set({ status: "active" })
      .where(eq(deployments.id, id));
    const activeStatus = await fetch(new URL(`/status?id=${id}`, baseUrl));
    expect(activeStatus.status).toBe(200);
    expect(await activeStatus.json()).toEqual({ status: "active" });

    await job.moveToFailed(new Error("Test job failure"), "test-token", false);
    await database
      .update(deployments)
      .set({ status: "failed" })
      .where(eq(deployments.id, id));
    const failedStatus = await fetch(new URL(`/status?id=${id}`, baseUrl));
    expect(failedStatus.status).toBe(200);
    expect(await failedStatus.json()).toEqual({ status: "failed" });

    await job.retry();
    const retriedJob = await worker.getNextJob("retry-token", { block: false });
    await retriedJob.moveToCompleted(null, "retry-token", false);
    await database
      .update(deployments)
      .set({ status: "completed" })
      .where(eq(deployments.id, id));
    const completedStatus = await fetch(new URL(`/status?id=${id}`, baseUrl));
    expect(completedStatus.status).toBe(200);
    expect(await completedStatus.json()).toEqual({ status: "completed" });

    await retriedJob.remove();
    const removedStatus = await fetch(new URL(`/status?id=${id}`, baseUrl));
    expect(removedStatus.status).toBe(200);
    expect(await removedStatus.json()).toEqual({ status: "completed" });
    await worker.close();

    await writeFile(join(sourceDirectory, "README.md"), "# Republished\n");
    await rm(join(sourceDirectory, "nested"), { recursive: true });
    const republishPath = join(workspace, "republish.tar.gz");
    spawnSync("tar", ["-czf", republishPath, "-C", sourceDirectory, "."]);
    const uploadsBeforeUnauthorized = new Map(uploads);
    await Promise.all(
      [
        undefined,
        "Bearer wrong-deploy-token",
        "Bearer test-deploy-tokem",
        `Basic ${Buffer.from("test-user:test-password").toString("base64")}`,
      ].map(async (authorization) => {
        const unauthorized = await fetch(new URL("/deploy", baseUrl), {
          body: archiveForm(bun.file(republishPath), id),
          headers: authorization ? { Authorization: authorization } : {},
          method: "POST",
        });
        expect(unauthorized.status).toBe(401);
        expect(await unauthorized.json()).toEqual({ message: "Unauthorized" });
      })
    );
    expect(await database.select().from(deployments)).toEqual([
      { id, status: "completed" },
    ]);
    expect(uploads).toEqual(uploadsBeforeUnauthorized);
    expect(await readFile(join(extractedDirectory, "README.md"), "utf8")).toBe(
      "# Test project\n"
    );
    expect(await redis.lRange("bull:jobs:wait", 0, -1)).toEqual([]);

    const republish = await fetch(new URL("/deploy", baseUrl), {
      body: archiveForm(bun.file(republishPath), id),
      headers: deployHeaders,
      method: "POST",
    });

    expect(republish.status).toBe(200);
    expect(await republish.json()).toEqual({ id });
    expect(await readdir(outputDirectory)).toEqual([id]);
    expect(await relativePaths(extractedDirectory)).toEqual([
      ".hidden",
      "README.md",
    ]);
    expect(
      [...uploads.keys()]
        .filter((key) => key.startsWith(`/test-bucket/output/${id}/`))
        .sort()
    ).toEqual([
      `/test-bucket/output/${id}/.hidden`,
      `/test-bucket/output/${id}/README.md`,
    ]);
    expect(uploads.get(`/test-bucket/output/${id}/README.md`)?.toString()).toBe(
      "# Republished\n"
    );
    expect(await redis.lRange("bull:jobs:wait", 0, -1)).toEqual([id]);
    const republishedStatus = await fetch(new URL(`/status?id=${id}`, baseUrl));
    expect(await republishedStatus.json()).toEqual({ status: "waiting" });

    const conflict = await fetch(new URL("/deploy", baseUrl), {
      body: archiveForm(bun.file(republishPath), id),
      headers: deployHeaders,
      method: "POST",
    });
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toEqual({ id });
    expect(await redis.lRange("bull:jobs:wait", 0, -1)).toEqual([id]);
    expect(
      await database
        .select({ status: deployments.status })
        .from(deployments)
        .where(eq(deployments.id, id))
    ).toEqual([{ status: "waiting" }]);
    await redis.del(`bull:jobs:${id}`);
    await redis.del("bull:jobs:wait");
    await database
      .update(deployments)
      .set({ status: "completed" })
      .where(eq(deployments.id, id));

    uploadsUntilFailure = 1;
    const failedUpload = await fetch(new URL("/deploy", baseUrl), {
      body: archiveForm(archive),
      headers: deployHeaders,
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
    const failedUploadStatus = await fetch(
      new URL(`/status?id=${failedUploadId}`, baseUrl)
    );
    expect(await failedUploadStatus.json()).toEqual({ status: "failed" });
    const failedUploadEvent = await readLogEvent(
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
      body: archiveForm(new Blob(["not a tarball"])),
      headers: deployHeaders,
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
    const failedExtractStatus = await fetch(
      new URL(`/status?id=${failedDeployBody.id}`, baseUrl)
    );
    expect(await failedExtractStatus.json()).toEqual({ status: "failed" });
    const failedExtractEvent = await readLogEvent(
      errorLines,
      (event) => event.id === failedDeployBody.id && event.action === "deploy"
    );
    expect(failedExtractEvent).toMatchObject({
      error: { message: expect.stringContaining("Archive extraction failed") },
      level: "error",
      stage: "extract",
      status: 500,
      uploadedBytes: 0,
      uploadedCount: 0,
    });
    expect(failedExtractEvent).not.toHaveProperty("currentKey");
    expect(failedExtractEvent).not.toHaveProperty("fileCount");
    for (const secret of [
      deployToken,
      "wrong-deploy-token",
      "demo-secret",
      "demo-query-token",
      "demo-fragment",
    ]) {
      expect(output).not.toContain(secret);
    }

    // Deny BullMQ reads and scripts without changing its internal Redis keys.
    await redis.aclSetUser("default", ["-hgetall", "-evalsha", "-eval"]);
    const redisUnavailableStatus = await fetch(
      new URL(`/status?id=${id}`, baseUrl)
    );
    expect(redisUnavailableStatus.status).toBe(200);
    expect(await redisUnavailableStatus.json()).toEqual({
      status: "completed",
    });
    uploadsUntilFailure = Number.POSITIVE_INFINITY;
    const redisFailedDeploy = await fetch(new URL("/deploy", baseUrl), {
      body: archiveForm(archive),
      headers: deployHeaders,
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
    const publishFailureEvent = await readLogEvent(
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
    const publishFailureStatus = await fetch(
      new URL(`/status?id=${redisFailedBody.id}`, baseUrl)
    );
    expect(await publishFailureStatus.json()).toEqual({ status: "failed" });

    await sql`ALTER TABLE deployments RENAME TO unavailable_deployments`;
    const unavailableStatus = await fetch(new URL(`/status?id=${id}`, baseUrl));
    expect(unavailableStatus.status).toBe(503);
    expect(unavailableStatus.headers.get("cache-control")).toBe("no-store");
    expect(await unavailableStatus.json()).toEqual({
      message: "Upload status unavailable",
    });
    const uploadsBeforeDatabaseFailure = uploads.size;
    const databaseFailedDeploy = await fetch(new URL("/deploy", baseUrl), {
      body: archiveForm(archive),
      headers: deployHeaders,
      method: "POST",
    });
    expect(databaseFailedDeploy.status).toBe(500);
    expect(await databaseFailedDeploy.json()).toEqual({
      id: expect.any(String),
    });
    expect(uploads.size).toBe(uploadsBeforeDatabaseFailure);
    await sql`ALTER TABLE unavailable_deployments RENAME TO deployments`;
    expect(await redis.lRange("bull:jobs:wait", 0, -1)).toEqual([]);
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
