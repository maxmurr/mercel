import { QueueEvents } from "bullmq";
import { Elysia } from "elysia";
import { initLogger, log as logger } from "evlog";

initLogger({
  env: { service: "mercel-deploy-server" },
  redact: {
    patterns: [/\b[a-z][a-z\d+.-]*:\/\/\S+/gi],
  },
});

const { REDIS_URL } = process.env;

if (!REDIS_URL) {
  throw new Error("Deploy server configuration missing: set REDIS_URL.");
}

const jobEvents = new QueueEvents("jobs", {
  connection: { url: REDIS_URL },
});
jobEvents.on("error", (error: Error) => logger.error("queue", error.message));
jobEvents.on("added", ({ jobId, name }) => {
  logger.info({ action: "job_added", jobId, name, queue: "jobs" });
});
await jobEvents.waitUntilReady();

new Elysia()
  .onStop(async () => {
    await jobEvents.close();
  })
  .listen(process.env.DEPLOY_PORT ?? 3001, (server) => {
    logger.info({
      action: "server_start",
      hostname: server.hostname,
      port: server.port,
    });
  });
