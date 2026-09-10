import { S3Client } from "@aws-sdk/client-s3";

const endpoint = process.env.S3_ENDPOINT;

/**
 * The S3 client shared by every S3 utility.
 * Set S3_ENDPOINT for S3-compatible storage with path-style addressing.
 * Load environment variables before importing this module.
 */
export const s3 = new S3Client(
  endpoint ? { endpoint, forcePathStyle: true } : {}
);
