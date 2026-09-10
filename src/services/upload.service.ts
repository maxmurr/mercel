import { join, relative, sep } from "node:path";
import type { Queue } from "bullmq";
import { simpleGit } from "simple-git";
import { getFilePaths } from "../utils/file-paths.ts";
import { uploadFileToS3 } from "../utils/upload-file-to-s3.ts";
import type {
  IUploadService,
  UploadRepositoryOptions,
} from "./upload.service.interface.ts";

/** Uploads repository files sequentially before publishing to the shared deployment queue. */
export class UploadService implements IUploadService {
  private readonly jobQueue: Pick<Queue<{ uploadId: string }>, "add">;

  constructor(jobQueue: Pick<Queue<{ uploadId: string }>, "add">) {
    this.jobQueue = jobQueue;
  }

  async uploadRepository({ id, onProgress, repoUrl }: UploadRepositoryOptions) {
    const cloneDirectory = join("output", id);
    let uploadedCount = 0;
    let uploadedBytes = 0;
    let currentKey: string | undefined;

    try {
      onProgress?.({ stage: "clone" });
      await simpleGit().clone(repoUrl, cloneDirectory);
      onProgress?.({ stage: "scan" });
      const filePaths = await getFilePaths({ directoryPath: cloneDirectory });
      onProgress?.({ fileCount: filePaths.length, stage: "upload" });
      for (const filePath of filePaths) {
        const relativePath = relative(cloneDirectory, filePath)
          .split(sep)
          .join("/");
        currentKey = `/output/${id}/${relativePath}`;
        // biome-ignore lint/performance/noAwaitInLoops: Keep one upload stream open at a time.
        uploadedBytes += await uploadFileToS3({ filePath, key: currentKey });
        uploadedCount += 1;
      }
      currentKey = undefined;
      onProgress?.({ stage: "publish" });
      await this.jobQueue.add("deploy", { uploadId: id }, { jobId: id });
      onProgress?.({ stage: "complete" });
    } finally {
      onProgress?.({
        ...(currentKey === undefined ? {} : { currentKey }),
        uploadedBytes,
        uploadedCount,
      });
    }
  }
}
