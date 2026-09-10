import { join, relative, sep } from "node:path";
import { cors } from "@elysia/cors";
import { openapi } from "@elysia/openapi";
import { workbench } from "@getworkbench/elysia";
import { createNodeRedisClient, Queue } from "bullmq";
import { Elysia, t } from "elysia";
import { initLogger, log as logger } from "evlog";
import { evlog } from "evlog/elysia";
import { createClient } from "redis";
import { simpleGit } from "simple-git";
import { getFilePaths } from "./utils/file-paths.ts";
import { generateId, idPattern } from "./utils/id.ts";
import { uploadFileToS3 } from "./utils/upload-file-to-s3.ts";

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
      let uploadedCount = 0;
      let uploadedBytes = 0;
      let currentKey: string | undefined;

      log.set({ action: "deploy", id, stage: "clone" });
      try {
        await simpleGit().clone(body.repoUrl, cloneDirectory);
        log.set({ stage: "scan" });
        const filePaths = await getFilePaths({ directoryPath: cloneDirectory });
        log.set({ fileCount: filePaths.length, stage: "upload" });
        for (const filePath of filePaths) {
          const relativePath = relative(cloneDirectory, filePath)
            .split(sep)
            .join("/");
          currentKey = `output/${id}/${relativePath}`;
          // biome-ignore lint/performance/noAwaitInLoops: Keep one upload stream open at a time.
          uploadedBytes += await uploadFileToS3({ filePath, key: currentKey });
          uploadedCount += 1;
        }
        currentKey = undefined;
        log.set({ stage: "publish" });
        await jobQueue.add("deploy", { uploadId: id }, { jobId: id });
        log.set({ stage: "complete" });
        return { id };
      } catch (error) {
        log.error(error instanceof Error ? error : new Error(String(error)));
        return status(500, { id });
      } finally {
        log.set({
          ...(currentKey === undefined ? {} : { currentKey }),
          uploadedBytes,
          uploadedCount,
        });
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
