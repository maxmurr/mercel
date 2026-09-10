import { rm } from "node:fs/promises";
import { join } from "node:path";
import { postgresDb } from "@repo/db/database";
import { markDeploymentFailed } from "@repo/db/deployments";
import { deployments } from "@repo/db/schema";
import { buildApp } from "@repo/utils/build-app";
import { downloadFolderFromS3 } from "@repo/utils/download-folder-from-s3";
import { idPattern } from "@repo/utils/id";
import { uploadFolderToS3 } from "@repo/utils/upload-folder-to-s3";
import { Worker } from "bullmq";
import { eq } from "drizzle-orm";
import { initLogger, log as logger } from "evlog";

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
    try {
      await postgresDb
        .insert(deployments)
        .values({ id: data.uploadId, status: "active" })
        .onConflictDoUpdate({
          set: { status: "active" },
          target: deployments.id,
        });
      // Each job owns this scratch directory; discard partial downloads and builds before retrying.
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
      await buildApp({ directoryPath, preset: "vite" });
      await uploadFolderToS3({
        directoryPath: join(directoryPath, "dist"),
        prefix: `dist/${data.uploadId}`,
      });
      await postgresDb
        .update(deployments)
        .set({ status: "completed" })
        .where(eq(deployments.id, data.uploadId));
      return fileCount;
    } catch (error) {
      await markDeploymentFailed({ from: ["active"], id: data.uploadId });
      throw error;
    }
  },
  { connection: { url: REDIS_URL } }
);
jobWorker.on("error", (error) => logger.error("queue", error.message));
jobWorker.on("completed", (job, fileCount) => {
  logger.info({
    action: "deploy_completed",
    fileCount,
    jobId: job.id,
    queue: "jobs",
  });
});
jobWorker.on("failed", (job, error) => {
  logger.error({
    action: "deploy_failed",
    error: error.message,
    jobId: job?.id,
    queue: "jobs",
  });
});
const shutdown = async () => {
  logger.info({ action: "worker_stopping", queue: "jobs" });
  try {
    try {
      await jobWorker.close();
    } finally {
      await postgresDb.$client.close();
    }
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
