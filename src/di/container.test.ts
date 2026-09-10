import type { Queue } from "bullmq";
import { beforeEach, expect, expectTypeOf, test, vi } from "vitest";
import type { IUploadService } from "../services/upload.service.interface.ts";
import type { getFilePaths } from "../utils/file-paths.ts";
import type { uploadFileToS3 } from "../utils/upload-file-to-s3.ts";
import { createApplicationContainer } from "./container.ts";

const mocks = vi.hoisted(() => ({
  clone: vi.fn<(repoUrl: string, directory: string) => Promise<void>>(),
  getFilePaths: vi.fn<typeof getFilePaths>(),
  uploadFileToS3: vi.fn<typeof uploadFileToS3>(),
}));

vi.mock("simple-git", () => ({ simpleGit: () => ({ clone: mocks.clone }) }));
vi.mock("../utils/file-paths.ts", () => ({ getFilePaths: mocks.getFilePaths }));
vi.mock("../utils/upload-file-to-s3.ts", () => ({
  uploadFileToS3: mocks.uploadFileToS3,
}));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.clone.mockResolvedValue(undefined);
  mocks.getFilePaths.mockResolvedValue([]);
});

test("resolves a typed upload service singleton wired to the supplied queue", async () => {
  const jobQueue = { add: vi.fn<Queue<{ uploadId: string }>["add"]>() };
  const container = createApplicationContainer(jobQueue);

  expect(container.get("JobQueue")).toBe(jobQueue);
  expectTypeOf(container.get("JobQueue")).toEqualTypeOf<
    Pick<Queue<{ uploadId: string }>, "add">
  >();

  const uploadService = container.get("IUploadService");
  expectTypeOf(uploadService).toEqualTypeOf<IUploadService>();
  expect(container.get("IUploadService")).toBe(uploadService);

  await uploadService.uploadRepository({
    id: "abc12",
    repoUrl: "https://github.com/example/repo.git",
  });
  expect(mocks.clone).toHaveBeenCalledOnce();
  expect(mocks.getFilePaths).toHaveBeenCalledOnce();
  expect(mocks.uploadFileToS3).not.toHaveBeenCalled();
  expect(jobQueue.add).toHaveBeenCalledExactlyOnceWith(
    "deploy",
    { uploadId: "abc12" },
    { jobId: "abc12" }
  );
});

test("separate containers do not share instances", () => {
  const first = createApplicationContainer({ add: vi.fn() });
  const second = createApplicationContainer({ add: vi.fn() });

  expect(first.get("IUploadService")).not.toBe(second.get("IUploadService"));
});
