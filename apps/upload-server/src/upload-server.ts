import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { cors } from "@elysia/cors";
import { openapi } from "@elysia/openapi";
import { workbench } from "@getworkbench/elysia";
import { postgresDb } from "@repo/db/database";
import { markDeploymentFailed } from "@repo/db/deployments";
import { deployments } from "@repo/db/schema";
import { generateId, idPattern } from "@repo/utils/id";
import {
  type UploadFolderProgress,
  uploadFolderToS3,
} from "@repo/utils/upload-folder-to-s3";
import { createNodeRedisClient, Queue } from "bullmq";
import { $ } from "bun";
import { eq } from "drizzle-orm";
import { Elysia, t } from "elysia";
import { initLogger, log as logger } from "evlog";
import { evlog } from "evlog/elysia";
import { createClient } from "redis";

initLogger({
  env: { service: "mercel-upload-server" },
  redact: {
    // SDK errors can echo endpoint URLs, or paths with query tokens.
    patterns: [/\b[a-z][a-z\d+.-]*:\/\/\S+/gi, /[?#]\S+/g],
  },
});

const { REDIS_URL, WORKBENCH_USER, WORKBENCH_PASS } = process.env;

if (!(REDIS_URL && WORKBENCH_USER && WORKBENCH_PASS)) {
  throw new Error(
    "Workbench configuration missing: set REDIS_URL, WORKBENCH_USER, and WORKBENCH_PASS."
  );
}

const redisPublisher = createClient({
  disableOfflineQueue: true,
  url: REDIS_URL,
});
redisPublisher.on("error", (error: Error) =>
  logger.error({ action: "redis_error", error: error.message })
);
await redisPublisher.connect();

const jobQueue = new Queue<{ uploadId: string }>("jobs", {
  connection: createNodeRedisClient(redisPublisher),
});
jobQueue.on("error", (error: Error) =>
  logger.error({ action: "queue_error", error: error.message, queue: "jobs" })
);
await jobQueue.waitUntilReady();

/**
 * Unpacks a gzipped tarball into the directory. tar itself keeps members inside
 * it: leading slashes are stripped and `..` components refused.
 */
async function extractArchive(archive: File, directoryPath: string) {
  await mkdir(directoryPath, { recursive: true });
  try {
    await $`tar -xz -C ${directoryPath} < ${archive}`.quiet();
  } catch (error) {
    if (error instanceof $.ShellError) {
      throw new Error(
        `Archive extraction failed: ${error.stderr.toString().trim()}`,
        { cause: error }
      );
    }
    throw error;
  }
}

new Elysia()
  .use(evlog())
  .use(cors({ credentials: false, origin: "*" }))
  // Disable Elysia's CSS overrides so Scalar's selected theme can apply.
  .use(openapi({ scalar: { customCss: "" } }))
  .get("/", () => "Hello Elysia")
  .post(
    "/deploy",
    async ({ body, log, status }) => {
      const id = generateId();
      const sourceDirectory = join("output/upload", id);
      let progress: UploadFolderProgress | undefined;
      let deploymentCreated = false;

      log.set({ action: "deploy", id, stage: "extract" });
      try {
        await postgresDb.insert(deployments).values({ id, status: "cloning" });
        deploymentCreated = true;
        await extractArchive(body.archive, sourceDirectory);
        log.set({ stage: "scan" });
        await postgresDb
          .update(deployments)
          .set({ status: "uploading" })
          .where(eq(deployments.id, id));
        progress = await uploadFolderToS3({
          directoryPath: sourceDirectory,
          onProgress: (update) => {
            progress = update;
            log.set({ stage: "upload" });
          },
          prefix: `output/${id}`,
        });
        log.set({ stage: "publish" });
        // Persist waiting before enqueueing so a fast worker cannot be overwritten.
        await postgresDb
          .update(deployments)
          .set({ status: "waiting" })
          .where(eq(deployments.id, id));
        await jobQueue.add("deploy", { uploadId: id }, { jobId: id });
        log.set({ stage: "complete" });
        return { id };
      } catch (error) {
        if (deploymentCreated) {
          await markDeploymentFailed({
            from: ["cloning", "uploading", "waiting"],
            id,
          });
        }
        log.error(error instanceof Error ? error : new Error(String(error)));
        return status(500, { id });
      } finally {
        log.set({ uploadedBytes: 0, uploadedCount: 0, ...progress });
      }
    },
    {
      body: t.Object({
        archive: t.File({
          description:
            "Gzipped tarball of the project root, without node_modules.",
        }),
      }),
      response: {
        200: t.Object({ id: t.String() }),
        500: t.Object({ id: t.String() }),
      },
    }
  )
  .get(
    "/status",
    async ({ query, log, set, status }) => {
      set.headers["cache-control"] = "no-store";
      log.set({ action: "upload-status", id: query.id });
      try {
        const [deployment] = await postgresDb
          .select({ status: deployments.status })
          .from(deployments)
          .where(eq(deployments.id, query.id));
        if (!deployment) {
          return status(404, { message: "Upload not found" });
        }
        return deployment;
      } catch (error) {
        log.error(error instanceof Error ? error : new Error(String(error)));
        return status(503, { message: "Upload status unavailable" });
      }
    },
    {
      query: t.Object({ id: t.String({ pattern: idPattern.source }) }),
      response: {
        200: t.Object({ status: t.String() }),
        404: t.Object({ message: t.String() }),
        503: t.Object({ message: t.String() }),
      },
    }
  )
  .mount(
    "/jobs",
    workbench({
      auth: { password: WORKBENCH_PASS, username: WORKBENCH_USER },
      basePath: "/jobs",
      queues: [jobQueue],
    })
  )
  .listen(process.env.PORT ?? 3000, (server) => {
    logger.info({
      action: "server_start",
      hostname: server.hostname,
      port: server.port,
    });
  });
