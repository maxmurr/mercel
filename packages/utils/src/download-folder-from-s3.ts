import { lstat, mkdir, open, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { GetObjectCommand, paginateListObjectsV2 } from "@aws-sdk/client-s3";
import { s3 } from "./s3.ts";

/** Options for downloading an S3 folder into a local directory. */
interface DownloadFolderFromS3Options {
  /**
   * The local destination directory, created if missing. Relative paths resolve from the current working directory.
   * Downloading onto an existing file throws instead of overwriting it.
   * @example "output/abc12"
   */
  directoryPath: string;
  /**
   * The S3 folder prefix without a leading slash, with or without a trailing slash.
   * @example "output/abc12"
   */
  prefix: string;
}

/** Options for preparing the local file path that receives an S3 object. */
interface PrepareDownloadFilePathOptions {
  /** The absolute local destination directory. */
  directoryPath: string;
  /** The S3 object key to download. */
  key: string;
  /** The S3 folder prefix, including its trailing slash. */
  prefix: string;
}

const unsafePathCharacters = /[\\\0:]/;

/**
 * Maps an S3 object key to a local file path, creating parent directories without following symlinks.
 * @param options The destination, S3 key, and folder prefix.
 * @returns The local file path with the S3 prefix removed.
 * @throws If the key contains unsafe path segments or a parent directory is a symlink.
 * @example
 * await prepareDownloadFilePath({ directoryPath: "/tmp/site", key: "site/src/main.ts", prefix: "site/" });
 */
async function prepareDownloadFilePath({
  directoryPath,
  key,
  prefix,
}: PrepareDownloadFilePathOptions): Promise<string> {
  const parts = key.slice(prefix.length).split("/");
  const isOutsidePrefix = !key.startsWith(prefix);
  const hasUnsafeSegment = parts.some((part) => ["", ".", ".."].includes(part));
  const hasUnsafeCharacter = unsafePathCharacters.test(parts.join("/"));
  if (isOutsidePrefix || hasUnsafeSegment || hasUnsafeCharacter) {
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
 * await downloadFolderFromS3({ prefix: "output/abc12", directoryPath: "output/abc12" });
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
      const filePath = await prepareDownloadFilePath({
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
