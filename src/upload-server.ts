import { join } from "node:path";
import { cors } from "@elysia/cors";
import { openapi } from "@elysia/openapi";
import { workbench } from "@getworkbench/elysia";
import { createNodeRedisClient, Queue } from "bullmq";
import { Elysia, t } from "elysia";
import { initLogger, log as logger } from "evlog";
import { evlog } from "evlog/elysia";
import { createClient } from "redis";
import { simpleGit } from "simple-git";
import { generateId, idPattern } from "./utils/id.ts";
import {
  type UploadFolderProgress,
  uploadFolderToS3,
} from "./utils/upload-folder-to-s3.ts";

initLogger({
  env: { service: "mercel-upload-server" },
  redact: {
    paths: ["repoUrl"],
    // Git and SDK errors can echo credential URLs, or paths with query tokens.
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
  logger.error("redis", error.message)
);
await redisPublisher.connect();

const jobQueue = new Queue<{ uploadId: string }>("jobs", {
  connection: createNodeRedisClient(redisPublisher),
});
jobQueue.on("error", (error: Error) => logger.error("queue", error.message));
await jobQueue.waitUntilReady();

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
      const cloneDirectory = join("output/upload", id);
      let progress: UploadFolderProgress | undefined;

      log.set({ action: "deploy", id, stage: "clone" });
      try {
        await simpleGit().clone(body.repoUrl, cloneDirectory);
        log.set({ stage: "scan" });
        progress = await uploadFolderToS3({
          directoryPath: cloneDirectory,
          onProgress: (update) => {
            progress = update;
            log.set({ stage: "upload" });
          },
          prefix: `output/${id}`,
        });
        log.set({ stage: "publish" });
        await jobQueue.add("deploy", { uploadId: id }, { jobId: id });
        log.set({ stage: "complete" });
        return { id };
      } catch (error) {
        log.error(error instanceof Error ? error : new Error(String(error)));
        return status(500, { id });
      } finally {
        log.set({ uploadedBytes: 0, uploadedCount: 0, ...progress });
      }
    },
    {
      body: t.Object({
        repoUrl: t.String({
          examples: ["https://github.com/example/repo.git"],
          minLength: 1,
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
        const job = await jobQueue.getJob(query.id);
        const currentStatus = job ? await job.getState() : "unknown";
        if (currentStatus === "unknown") {
          return status(404, { message: "Upload not found" });
        }
        return { status: currentStatus };
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
