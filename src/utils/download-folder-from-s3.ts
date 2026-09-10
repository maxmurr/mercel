import { lstat, mkdir, open, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import {
  GetObjectCommand,
  paginateListObjectsV2,
  S3Client,
} from "@aws-sdk/client-s3";

/** Options for downloading an S3 folder into a local directory. */
interface DownloadFolderFromS3Options {
  /**
   * The local destination directory. Relative paths resolve from the current working directory.
   * Existing files are not overwritten.
   * @example "output/abc12"
   */
  directoryPath: string;
  /**
   * The S3 folder prefix, with or without a trailing slash. Leading slashes are preserved.
   * @example "/output/abc12"
   */
  prefix: string;
}

/** Options for mapping an S3 object key to a safe local file path. */
interface CreateS3DownloadPathOptions {
  /** The absolute local destination directory. */
  directoryPath: string;
  /** The S3 object key to download. */
  key: string;
  /** The S3 folder prefix, including its trailing slash. */
  prefix: string;
}

const endpoint = process.env.S3_ENDPOINT;
const s3 = new S3Client(endpoint ? { endpoint, forcePathStyle: true } : {});
const unsafePathCharacters = /[\\\0:]/;

/**
 * Creates parent directories without following symlinks below the destination.
 * @param options The destination, S3 key, and folder prefix.
 * @returns The local file path with the S3 prefix removed.
 * @throws If the key contains unsafe path segments or a parent directory is a symlink.
 * @example
 * await createS3DownloadPath({ directoryPath: "/tmp/site", key: "site/src/main.ts", prefix: "site/" });
 */
async function createS3DownloadPath({
  directoryPath,
  key,
  prefix,
}: CreateS3DownloadPathOptions): Promise<string> {
  const parts = key.slice(prefix.length).split("/");
  if (
    !key.startsWith(prefix) ||
    parts.some((part) => ["", ".", ".."].includes(part)) ||
    unsafePathCharacters.test(parts.join("/"))
  ) {
    throw new Error(`S3 download unsafe object key: ${key}`);
  }

  let parentPath = directoryPath;
  for (const part of parts.slice(0, -1)) {
    parentPath = join(parentPath, part);
    // biome-ignore lint/performance/noAwaitInLoops: Validate each parent before creating its children.
    await mkdir(parentPath, { recursive: true });
    const parent = await lstat(parentPath);
    if (parent.isSymbolicLink()) {
      throw new Error(`S3 download symlink directory: ${parentPath}`);
    }
  }
  return join(directoryPath, ...parts);
}

/**
 * Downloads every file in an S3 folder, preserving paths relative to its prefix.
 * Uses S3_BUCKET and the AWS SDK's default credential and region configuration.
 * Set S3_ENDPOINT for S3-compatible storage with path-style addressing.
 * Load environment variables before importing this module; the S3 client is shared.
 * The destination must not be modified concurrently. Folder markers are skipped.
 * On failure, completed files remain and the incomplete file is removed.
 * @param options The nonempty S3 folder prefix and local destination directory.
 * @returns The number of files downloaded, or zero if the prefix has no files.
 * @throws If configuration is missing, a path is unsafe, a file already exists, or listing or downloading fails.
 * @example
 * await downloadFolderFromS3({ prefix: "/output/abc12", directoryPath: "output/abc12" });
 */
export async function downloadFolderFromS3({
  prefix,
  directoryPath,
}: DownloadFolderFromS3Options): Promise<number> {
  const bucket = process.env.S3_BUCKET;
  if (!bucket) {
    throw new Error("S3 download configuration missing: set S3_BUCKET.");
  }
  if (!prefix) {
    throw new Error("S3 download prefix must not be empty.");
  }

  const folderPrefix = prefix.endsWith("/") ? prefix : `${prefix}/`;
  const destination = resolve(directoryPath);
  await mkdir(destination, { recursive: true });
  let downloadedCount = 0;

  for await (const page of paginateListObjectsV2(
    { client: s3 },
    { Bucket: bucket, Prefix: folderPrefix }
  )) {
    for (const { Key: key } of page.Contents ?? []) {
      if (!key || key.endsWith("/")) {
        continue;
      }
      // biome-ignore lint/performance/noAwaitInLoops: Download one file at a time to bound open streams.
      const filePath = await createS3DownloadPath({
        directoryPath: destination,
        key,
        prefix: folderPrefix,
      });
      const file = await open(filePath, "wx");
      let complete = false;
      try {
        const { Body: body } = await s3.send(
          new GetObjectCommand({ Bucket: bucket, Key: key })
        );
        if (!body) {
          throw new Error(`S3 download response body missing: ${key}`);
        }
        await pipeline(body.transformToWebStream(), file.createWriteStream());
        complete = true;
        downloadedCount += 1;
      } finally {
        await file.close();
        if (!complete) {
          await rm(filePath, { force: true });
        }
      }
    }
  }
  return downloadedCount;
}
