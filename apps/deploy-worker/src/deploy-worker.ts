import { rm } from "node:fs/promises";
import { join } from "node:path";
import { postgresDb } from "@repo/db/database";
import { markDeploymentFailed } from "@repo/db/deployments";
import { deployments } from "@repo/db/schema";
import { buildApp } from "@repo/utils/build-app";
import { downloadFolderFromS3 } from "@repo/utils/download-folder-from-s3";
import { idPattern } from "@repo/utils/id";
import {
  type UploadFolderProgress,
  uploadFolderToS3,
} from "@repo/utils/upload-folder-to-s3";
import { Worker } from "bullmq";
import { eq } from "drizzle-orm";
import { createLogger, initLogger, log as logger } from "evlog";

initLogger({
  env: { service: "mercel-deploy-worker" },
  redact: {
    patterns: [/\b[a-z][a-z\d+.-]*:\/\/\S+/gi, /[?#]\S+/g],
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
    const log = createLogger({
      action: "deploy_failed",
      attempt: job.attemptsMade + 1,
      jobId: job.id,
      queue: "jobs",
      stage: "validate",
    });
    let uploadId: string | undefined;
    let progress: UploadFolderProgress | undefined;
    try {
      if (job.name !== "deploy") {
        throw new Error("Deploy job name must be deploy.");
      }
      const { data } = job;
      if (!isDeployJobData(data)) {
        throw new Error(
          "Deploy job data must be an object whose uploadId is five letters or digits."
        );
      }
      ({ uploadId } = data);
      const directoryPath = join("output", "deploy", uploadId);
      log.set({ stage: "persist_active", uploadId });
      await postgresDb
        .insert(deployments)
        .values({ id: uploadId, status: "active" })
        .onConflictDoUpdate({
          set: { status: "active" },
          target: deployments.id,
        });
      // Each job owns this scratch directory; discard partial downloads and builds before retrying.
      log.set({ stage: "cleanup" });
      await rm(directoryPath, { force: true, recursive: true });
      log.set({ stage: "download" });
      const fileCount = await downloadFolderFromS3({
        directoryPath,
        prefix: `output/${uploadId}`,
      });
      log.set({ fileCount });
      if (fileCount === 0) {
        throw new Error(
          `Deploy download found no files for uploadId: ${uploadId}`
        );
      }
      log.set({ stage: "build" });
      await buildApp({ directoryPath, preset: "vite" });
      log.set({ stage: "upload" });
      progress = await uploadFolderToS3({
        directoryPath: join(directoryPath, "dist"),
        onProgress: (update) => {
          progress = update;
        },
        prefix: `dist/${uploadId}`,
      });
      log.set({ stage: "persist_completed" });
      await postgresDb
        .update(deployments)
        .set({ status: "completed" })
        .where(eq(deployments.id, uploadId));
      log.set({ action: "deploy_completed", stage: "complete" });
      return fileCount;
    } catch (error) {
      log.error(error instanceof Error ? error : new Error(String(error)));
      if (uploadId) {
        await markDeploymentFailed({ from: ["active"], id: uploadId });
      }
      throw error;
    } finally {
      log.set({ upload: { uploadedBytes: 0, uploadedCount: 0, ...progress } });
      log.emit();
    }
  },
  { connection: { url: REDIS_URL } }
);
jobWorker.on("error", (error) =>
  logger.error({ action: "queue_error", error: error.message, queue: "jobs" })
);
const shutdown = async () => {
  logger.info({ action: "worker_stopping", queue: "jobs" });
  try {
    try {
      await jobWorker.close();
    } finally {
      await postgresDb.$client.close();
    }
  } catch (error) {
    logger.error({
      action: "worker_shutdown",
      error: error instanceof Error ? error.message : String(error),
      queue: "jobs",
    });
    process.exitCode = 1;
  }
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await jobWorker.waitUntilReady();
logger.info({ action: "worker_start", queue: "jobs" });
