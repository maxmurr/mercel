import { relative, resolve, sep } from "node:path";
import { getFilePaths } from "./file-paths.ts";
import { uploadFileToS3 } from "./upload-file-to-s3.ts";

/** Upload progress for a folder, reported before and after each file upload. */
export interface UploadFolderProgress {
  /** The S3 object key being uploaded; absent between uploads and after completion. */
  currentKey?: string;
  /** The number of files found in the folder, excluding symlinks. */
  fileCount: number;
  /** The total bytes of files uploaded so far. */
  uploadedBytes: number;
  /** The number of files uploaded so far. */
  uploadedCount: number;
}

/** Options for uploading a local directory to an S3 folder. */
interface UploadFolderToS3Options {
  /**
   * The local directory to upload. Relative paths resolve from the current working directory.
   * @example "output/upload/abc12"
   */
  directoryPath: string;
  /**
   * Called before and after each file upload with a progress snapshot.
   * The snapshot passed before a failed upload names the failed key in currentKey.
   */
  onProgress?: (progress: UploadFolderProgress) => void;
  /**
   * The S3 folder prefix without a leading slash, with or without a trailing slash.
   * @example "output/abc12"
   */
  prefix: string;
}

/**
 * Uploads every file in a directory to S3, keyed by the prefix plus each path relative to the directory.
 * Hidden files are included and symlinks are skipped. Files upload one at a time and stop at the first
 * failure; uploaded files remain in S3 and existing keys are overwritten.
 * Uses S3_BUCKET and the shared S3 client; see uploadFileToS3.
 * @param options The local directory, S3 folder prefix, and optional progress callback.
 * @returns The final progress with the file count and uploaded totals.
 * @throws If the prefix is empty, the directory cannot be read, S3_BUCKET is missing, or an upload fails.
 * @example
 * await uploadFolderToS3({ directoryPath: "output/upload/abc12", prefix: "output/abc12" });
 */
export async function uploadFolderToS3({
  directoryPath,
  onProgress,
  prefix,
}: UploadFolderToS3Options): Promise<UploadFolderProgress> {
  if (!prefix) {
    throw new Error("S3 upload prefix must not be empty.");
  }
  const folderPrefix = prefix.endsWith("/") ? prefix : `${prefix}/`;
  const source = resolve(directoryPath);
  const filePaths = await getFilePaths({ directoryPath: source });
  const fileCount = filePaths.length;
  let uploadedBytes = 0;
  let uploadedCount = 0;
  for (const filePath of filePaths) {
    const currentKey = `${folderPrefix}${relative(source, filePath).split(sep).join("/")}`;
    onProgress?.({ currentKey, fileCount, uploadedBytes, uploadedCount });
    // biome-ignore lint/performance/noAwaitInLoops: Upload one file at a time to bound open streams.
    uploadedBytes += await uploadFileToS3({ filePath, key: currentKey });
    uploadedCount += 1;
    onProgress?.({ fileCount, uploadedBytes, uploadedCount });
  }
  return { fileCount, uploadedBytes, uploadedCount };
}
