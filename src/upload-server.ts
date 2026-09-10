import { cors } from "@elysia/cors";
import { openapi } from "@elysia/openapi";
import { workbench } from "@getworkbench/elysia";
import { createNodeRedisClient, Queue } from "bullmq";
import { Elysia } from "elysia";
import { initLogger, log as logger } from "evlog";
import { evlog } from "evlog/elysia";
import { createClient } from "redis";
import { createApplicationContainer } from "./di/container.ts";
import { createDeployRoutes } from "./routes/deploy.routes.ts";
import { createStatusRoutes } from "./routes/status.routes.ts";

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

const container = createApplicationContainer(jobQueue);

new Elysia()
  .use(evlog())
  .use(cors({ credentials: false, origin: "*" }))
  // Disable Elysia's CSS overrides so Scalar's selected theme can apply.
  .use(openapi({ scalar: { customCss: "" } }))
  .get("/", () => "Hello Elysia")
  .use(createDeployRoutes(container.get("IUploadService")))
  .use(createStatusRoutes(jobQueue))
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
