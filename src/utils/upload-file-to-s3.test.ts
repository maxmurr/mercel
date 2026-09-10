import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buffer } from "node:stream/consumers";
import { expect, test, vi } from "vitest";

test("uploadFileToS3 uploads file contents and keys and propagates failures", async () => {
  const directory = await mkdtemp(join(tmpdir(), "mercel-s3-upload-"));
  const filePath = join(directory, "file.bin");
  const contents = Buffer.from([0, 255, 1, 2, 3]);
  const uploads: { path: string; body: Buffer }[] = [];
  let rejectUpload = false;
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    uploads.push({ body: await buffer(request), path: url.pathname });
    if (rejectUpload) {
      response.writeHead(403, { "Content-Type": "application/xml" });
      response.end("<Error><Code>AccessDenied</Code></Error>");
      return;
    }
    response.writeHead(200, { ETag: '"test-etag"' });
    response.end();
  });

  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    assert(address && typeof address !== "string");
    vi.stubEnv("S3_ENDPOINT", `http://127.0.0.1:${address.port}`);
    vi.stubEnv("S3_BUCKET", "test-bucket");
    vi.stubEnv("AWS_REGION", "us-east-1");
    vi.stubEnv("AWS_ACCESS_KEY_ID", "test-access-key");
    vi.stubEnv("AWS_SECRET_ACCESS_KEY", "test-secret-key");
    vi.stubEnv("AWS_SESSION_TOKEN", "");
    const { uploadFileToS3 } = await import("./upload-file-to-s3.ts");

    await writeFile(filePath, contents);
    expect(await uploadFileToS3({ filePath })).toBe(contents.length);
    expect(uploads[0]).toEqual({
      body: contents,
      path: "/test-bucket/file.bin",
    });

    await uploadFileToS3({ filePath, key: "deployments/file.bin" });
    expect(uploads[1]?.path).toBe("/test-bucket/deployments/file.bin");

    await writeFile(filePath, "");
    expect(await uploadFileToS3({ filePath })).toBe(0);
    expect(uploads[2]?.body.length).toBe(0);

    await expect(
      uploadFileToS3({ filePath: join(directory, "missing") })
    ).rejects.toMatchObject({ code: "ENOENT" });

    rejectUpload = true;
    await expect(uploadFileToS3({ filePath })).rejects.toMatchObject({
      name: "AccessDenied",
    });

    vi.stubEnv("S3_BUCKET", "");
    await expect(uploadFileToS3({ filePath })).rejects.toThrow(
      "S3 upload configuration missing: set S3_BUCKET."
    );
  } finally {
    vi.unstubAllEnvs();
    const closed = once(server, "close");
    server.close();
    await closed;
    await rm(directory, { force: true, recursive: true });
  }
});
