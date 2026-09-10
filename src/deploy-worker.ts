import { rm } from "node:fs/promises";
import { join } from "node:path";
import { Worker } from "bullmq";
import { initLogger, log as logger } from "evlog";
import { downloadFolderFromS3 } from "./utils/download-folder-from-s3.ts";
import { idPattern } from "./utils/id.ts";

initLogger({
  env: { service: "mercel-deploy-worker" },
  redact: {
    patterns: [/\b[a-z][a-z\d+.-]*:\/\/\S+/gi],
  },
});

const { REDIS_URL } = process.env;

if (!REDIS_URL) {
  throw new Error("Deploy worker configuration missing: set REDIS_URL.");
}

const isDeployJobData = (data: unknown): data is { uploadId: string } =>
  typeof data === "object" &&
  data !== null &&
  "uploadId" in data &&
  typeof data.uploadId === "string" &&
  idPattern.test(data.uploadId);

const jobWorker = new Worker<unknown, number>(
  "jobs",
  async (job) => {
    if (job.name !== "deploy") {
      throw new Error("Deploy job name must be deploy.");
    }
    const { data } = job;
    if (!isDeployJobData(data)) {
      throw new Error(
        "Deploy job data must be an object whose uploadId is five letters or digits."
      );
    }

    const directoryPath = join("output", "deploy", data.uploadId);
    // Each job owns this scratch directory; discard partial downloads before retrying.
    await rm(directoryPath, { force: true, recursive: true });
    const fileCount = await downloadFolderFromS3({
      directoryPath,
      prefix: `output/${data.uploadId}`,
    });
    if (fileCount === 0) {
      throw new Error(
        `Deploy download found no files for uploadId: ${data.uploadId}`
      );
    }
    return fileCount;
  },
  { connection: { url: REDIS_URL } }
);
jobWorker.on("error", (error) => logger.error("queue", error.message));
jobWorker.on("completed", (job, fileCount) => {
  logger.info({
    action: "download_completed",
    fileCount,
    jobId: job.id,
    queue: "jobs",
  });
});
jobWorker.on("failed", (job, error) => {
  logger.error({
    action: "download_failed",
    error: error.message,
    jobId: job?.id,
    queue: "jobs",
  });
});
const shutdown = async () => {
  logger.info({ action: "worker_stopping", queue: "jobs" });
  try {
    await jobWorker.close();
  } catch (error) {
    logger.error(
      "worker_shutdown",
      error instanceof Error ? error.message : String(error)
    );
    process.exitCode = 1;
  }
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await jobWorker.waitUntilReady();
logger.info({ action: "worker_start", queue: "jobs" });
