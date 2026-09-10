import assert from "node:assert/strict";
import { once } from "node:events";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vitest";

test("downloadFolderFromS3 paginates, preserves files, and rejects unsafe paths and failures", async () => {
  const directory = await mkdtemp(join(tmpdir(), "mercel-s3-download-"));
  const directoryPath = join(directory, "download");
  const prefix = "/output/abc12";
  const contents = Buffer.from([0, 255, 1, 2, 3]);
  let pages = [
    [`${prefix}/`, `${prefix}/src/`, `${prefix}/src/file ?#.bin`],
    [`${prefix}/empty`],
  ];
  const listings: URLSearchParams[] = [];
  const downloads: string[] = [];
  let rejectListing = false;
  let rejectDownload = false;
  let truncateDownload = false;
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    const isListing = url.searchParams.get("list-type") === "2";
    if (isListing) {
      listings.push(url.searchParams);
    } else {
      downloads.push(decodeURIComponent(url.pathname));
    }
    if ((isListing && rejectListing) || (!isListing && rejectDownload)) {
      response.writeHead(403, { "Content-Type": "application/xml" });
      response.end("<Error><Code>AccessDenied</Code></Error>");
      return;
    }
    if (isListing) {
      const page = Number(url.searchParams.get("continuation-token") ?? "0");
      const truncated = page < pages.length - 1;
      response.writeHead(200, { "Content-Type": "application/xml" });
      response.end(
        `<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
          <IsTruncated>${truncated}</IsTruncated>
          ${truncated ? `<NextContinuationToken>${page + 1}</NextContinuationToken>` : ""}
          ${(pages[page] ?? []).map((key) => `<Contents><Key>${key}</Key></Contents>`).join("")}
        </ListBucketResult>`
      );
      return;
    }
    response.writeHead(
      200,
      truncateDownload
        ? { Connection: "close", "Content-Length": contents.length + 1 }
        : {}
    );
    response.end(url.pathname.endsWith("/empty") ? Buffer.alloc(0) : contents);
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
    const { downloadFolderFromS3 } = await import(
      "./download-folder-from-s3.ts"
    );

    expect(await downloadFolderFromS3({ directoryPath, prefix })).toBe(2);
    expect(await readFile(join(directoryPath, "src/file ?#.bin"))).toEqual(
      contents
    );
    expect(await readFile(join(directoryPath, "empty"))).toEqual(
      Buffer.alloc(0)
    );
    expect(downloads).toEqual([
      `/test-bucket/${prefix}/src/file ?#.bin`,
      `/test-bucket/${prefix}/empty`,
    ]);
    expect(listings.map((params) => params.get("prefix"))).toEqual([
      `${prefix}/`,
      `${prefix}/`,
    ]);
    expect(listings.map((params) => params.get("continuation-token"))).toEqual([
      null,
      "1",
    ]);
    expect(listings.every((params) => !params.has("delimiter"))).toBe(true);

    pages = [[]];
    expect(
      await downloadFolderFromS3({ directoryPath, prefix: `${prefix}/` })
    ).toBe(0);
    expect(listings.at(-1)?.get("prefix")).toBe(`${prefix}/`);

    pages = [[`${prefix}/src/file ?#.bin`]];
    await expect(
      downloadFolderFromS3({ directoryPath, prefix })
    ).rejects.toMatchObject({ code: "EEXIST" });
    expect(await readFile(join(directoryPath, "src/file ?#.bin"))).toEqual(
      contents
    );

    for (const key of [
      `${prefix}/../escape`,
      `${prefix}/src/../../escape`,
      `${prefix}//absolute`,
      `${prefix}/./file`,
      `${prefix}/src//file`,
      `${prefix}/bad\\file`,
      `${prefix}/C:/file`,
      `${prefix}-other/file`,
    ]) {
      pages = [[key]];
      // biome-ignore lint/performance/noAwaitInLoops: Each case supplies a different listing to the same local server.
      await expect(
        downloadFolderFromS3({ directoryPath, prefix })
      ).rejects.toThrow("S3 download unsafe object key:");
    }

    const outsideDirectory = join(directory, "outside");
    await mkdir(outsideDirectory);
    await symlink(outsideDirectory, join(directoryPath, "linked"), "dir");
    pages = [[`${prefix}/linked/nested/file.bin`]];
    await expect(
      downloadFolderFromS3({ directoryPath, prefix })
    ).rejects.toThrow("S3 download symlink directory:");
    expect(await readdir(outsideDirectory)).toEqual([]);

    const outsideFile = join(outsideDirectory, "keep.bin");
    await writeFile(outsideFile, contents);
    await symlink(outsideFile, join(directoryPath, "alias.bin"), "file");
    pages = [[`${prefix}/alias.bin`]];
    await expect(
      downloadFolderFromS3({ directoryPath, prefix })
    ).rejects.toMatchObject({ code: "EEXIST" });
    expect(await readFile(outsideFile)).toEqual(contents);
    expect(downloads).toHaveLength(2);

    rejectListing = true;
    await expect(
      downloadFolderFromS3({ directoryPath, prefix })
    ).rejects.toMatchObject({ name: "AccessDenied" });
    rejectListing = false;
    rejectDownload = true;
    pages = [[`${prefix}/failed.bin`]];
    await expect(
      downloadFolderFromS3({ directoryPath, prefix })
    ).rejects.toMatchObject({ name: "AccessDenied" });
    await expect(
      readFile(join(directoryPath, "failed.bin"))
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(join(directoryPath, "src/file ?#.bin"))).toEqual(
      contents
    );

    rejectDownload = false;
    truncateDownload = true;
    await expect(
      downloadFolderFromS3({ directoryPath, prefix })
    ).rejects.toThrow();
    await expect(
      readFile(join(directoryPath, "failed.bin"))
    ).rejects.toMatchObject({ code: "ENOENT" });

    await expect(
      downloadFolderFromS3({ directoryPath, prefix: "" })
    ).rejects.toThrow("S3 download prefix must not be empty.");
    vi.stubEnv("S3_BUCKET", "");
    await expect(
      downloadFolderFromS3({ directoryPath, prefix })
    ).rejects.toThrow("S3 download configuration missing: set S3_BUCKET.");
  } finally {
    vi.unstubAllEnvs();
    const closed = once(server, "close");
    server.close();
    await closed;
    await rm(directory, { force: true, recursive: true });
  }
});
