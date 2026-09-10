import { createReadStream } from "node:fs";
import { basename } from "node:path";
import { Upload } from "@aws-sdk/lib-storage";
import { s3 } from "./s3.ts";

/**
 * Options for uploading a local file to S3.
 */
interface UploadFileToS3Options {
  /**
   * The absolute or relative path to the file to upload.
   * Relative paths resolve from the current working directory.
   * @example "/project/report.pdf"
   */
  filePath: string;
  /**
   * The S3 object key. An existing object at this key is overwritten.
   * @default basename(filePath)
   * @example "uploads/report.pdf"
   */
  key?: string;
}

/**
 * Uploads a local file to S3, overwriting an existing key.
 * Uses S3_BUCKET and the AWS SDK's default credential and region configuration.
 * Set S3_ENDPOINT for S3-compatible storage with path-style addressing.
 * Load environment variables before importing this module; the S3 client is shared.
 * @param options The local file path and optional S3 object key.
 * @returns The number of bytes uploaded.
 * @throws If S3_BUCKET is missing, the file cannot be read, or the upload fails.
 * @example
 * await uploadFileToS3({
 *   filePath: "/project/report.pdf",
 *   key: "uploads/report.pdf",
 * });
 */
export async function uploadFileToS3({
  filePath,
  key = basename(filePath),
}: UploadFileToS3Options): Promise<number> {
  const bucket = process.env.S3_BUCKET;
  if (!bucket) {
    throw new Error("S3 upload configuration missing: set S3_BUCKET.");
  }

  const body = createReadStream(filePath);

  try {
    await new Upload({
      client: s3,
      params: { Body: body, Bucket: bucket, Key: key },
    }).done();
    return body.bytesRead;
  } finally {
    body.destroy();
  }
}
