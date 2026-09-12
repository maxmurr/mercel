import { DeleteObjectCommand, paginateListObjectsV2 } from "@aws-sdk/client-s3";
import { s3 } from "./s3.ts";

/** Options for emptying an S3 folder. */
interface DeleteFolderFromS3Options {
  /**
   * The S3 folder prefix without a leading slash, with or without a trailing slash.
   * @example "dist/abc12"
   */
  prefix: string;
}

/**
 * Deletes every object under an S3 folder, one key at a time.
 * Uses S3_BUCKET and the shared S3 client; see uploadFileToS3.
 * Deleting stops at the first failure, leaving the remaining objects in place.
 * @param options The nonempty S3 folder prefix to empty.
 * @returns The number of objects deleted, or zero if the folder is already empty.
 * @throws If S3_BUCKET is missing, the prefix is empty, or listing or deleting fails.
 * @example
 * await deleteFolderFromS3({ prefix: "dist/abc12" });
 */
export async function deleteFolderFromS3({
  prefix,
}: DeleteFolderFromS3Options): Promise<number> {
  const bucket = process.env.S3_BUCKET;
  if (!bucket) {
    throw new Error("S3 delete configuration missing: set S3_BUCKET.");
  }
  if (!prefix) {
    throw new Error("S3 delete prefix must not be empty.");
  }

  const folderPrefix = prefix.endsWith("/") ? prefix : `${prefix}/`;
  let deletedCount = 0;
  for await (const page of paginateListObjectsV2(
    { client: s3 },
    { Bucket: bucket, Prefix: folderPrefix }
  )) {
    for (const { Key: key } of page.Contents ?? []) {
      if (!key) {
        continue;
      }
      // biome-ignore lint/performance/noAwaitInLoops: Delete one key at a time to bound open requests.
      await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
      deletedCount += 1;
    }
  }
  return deletedCount;
}
