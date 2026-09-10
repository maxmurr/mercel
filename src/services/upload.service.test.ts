import { join, resolve } from "node:path";
import type { Queue } from "bullmq";
import { beforeEach, expect, test, vi } from "vitest";
import type { getFilePaths } from "../utils/file-paths.ts";
import type { uploadFileToS3 } from "../utils/upload-file-to-s3.ts";
import type {
  IUploadService,
  UploadProgress,
} from "./upload.service.interface.ts";
import { MockUploadService } from "./upload.service.mock.ts";
import { UploadService } from "./upload.service.ts";

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

const ID = "abc12";
const REPO_URL = "https://github.com/example/repo.git";
const FILE_PATHS = [
  resolve("output", ID, "nested", "file with spaces.bin"),
  resolve("output", ID, ".hidden"),
];
const add = vi.fn<Queue<{ uploadId: string }>["add"]>();

beforeEach(() => {
  vi.resetAllMocks();
  mocks.clone.mockResolvedValue(undefined);
  mocks.getFilePaths.mockResolvedValue(FILE_PATHS);
  mocks.uploadFileToS3.mockResolvedValue(4);
});

test("uploads files sequentially with exact keys and enqueues only after every upload", async () => {
  const service: IUploadService = new UploadService({ add });
  const firstStarted = Promise.withResolvers<void>();
  const firstUpload = Promise.withResolvers<number>();
  const lastStarted = Promise.withResolvers<void>();
  const lastUpload = Promise.withResolvers<number>();
  mocks.uploadFileToS3
    .mockImplementationOnce(() => {
      firstStarted.resolve();
      return firstUpload.promise;
    })
    .mockImplementationOnce(() => {
      lastStarted.resolve();
      return lastUpload.promise;
    });
  const onProgress = vi.fn<(progress: UploadProgress) => void>();

  const upload = service.uploadRepository({
    id: ID,
    onProgress,
    repoUrl: REPO_URL,
  });
  await firstStarted.promise;
  expect(mocks.clone).toHaveBeenCalledExactlyOnceWith(
    REPO_URL,
    join("output", ID)
  );
  expect(mocks.getFilePaths).toHaveBeenCalledExactlyOnceWith({
    directoryPath: join("output", ID),
  });
  expect(mocks.uploadFileToS3).toHaveBeenCalledTimes(1);
  expect(add).not.toHaveBeenCalled();

  firstUpload.resolve(4);
  await lastStarted.promise;
  expect(mocks.uploadFileToS3).toHaveBeenCalledTimes(2);
  expect(add).not.toHaveBeenCalled();

  lastUpload.resolve(0);
  await expect(upload).resolves.toBeUndefined();
  expect(mocks.uploadFileToS3.mock.calls).toEqual([
    [
      {
        filePath: FILE_PATHS[0],
        key: `/output/${ID}/nested/file with spaces.bin`,
      },
    ],
    [{ filePath: FILE_PATHS[1], key: `/output/${ID}/.hidden` }],
  ]);
  expect(add).toHaveBeenCalledExactlyOnceWith(
    "deploy",
    { uploadId: ID },
    { jobId: ID }
  );
  expect(onProgress.mock.calls.map(([progress]) => progress)).toEqual([
    { stage: "clone" },
    { stage: "scan" },
    { fileCount: 2, stage: "upload" },
    { stage: "publish" },
    { stage: "complete" },
    { uploadedBytes: 4, uploadedCount: 2 },
  ]);
});

test.each(["clone", "scan"] as const)(
  "%s failure rejects unchanged without uploads or enqueue",
  async (stage) => {
    const error = new Error(`Test ${stage} failure`);
    if (stage === "clone") {
      mocks.clone.mockRejectedValueOnce(error);
    } else {
      mocks.getFilePaths.mockRejectedValueOnce(error);
    }
    const service: IUploadService = new UploadService({ add });
    const progress: UploadProgress = {};

    await expect(
      service.uploadRepository({
        id: ID,
        onProgress: (update) => Object.assign(progress, update),
        repoUrl: REPO_URL,
      })
    ).rejects.toBe(error);

    expect(mocks.uploadFileToS3).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
    expect(progress).toEqual({ stage, uploadedBytes: 0, uploadedCount: 0 });
  }
);

test("partial upload failure reports only completed uploads and stops before enqueue", async () => {
  const error = new Error("Test upload failure");
  mocks.getFilePaths.mockResolvedValueOnce([
    ...FILE_PATHS,
    resolve("output", ID, "unreached.txt"),
  ]);
  mocks.uploadFileToS3.mockResolvedValueOnce(4).mockRejectedValueOnce(error);
  const service: IUploadService = new UploadService({ add });
  const progress: UploadProgress = {};

  await expect(
    service.uploadRepository({
      id: ID,
      onProgress: (update) => Object.assign(progress, update),
      repoUrl: REPO_URL,
    })
  ).rejects.toBe(error);

  expect(mocks.uploadFileToS3).toHaveBeenCalledTimes(2);
  expect(add).not.toHaveBeenCalled();
  expect(progress).toEqual({
    currentKey: `/output/${ID}/.hidden`,
    fileCount: 3,
    stage: "upload",
    uploadedBytes: 4,
    uploadedCount: 1,
  });
});

test("enqueue rejection reports publish stage and full counts without a stale key", async () => {
  const error = new Error("Test enqueue failure");
  const publishStarted = Promise.withResolvers<void>();
  const publish = Promise.withResolvers<never>();
  add.mockImplementationOnce(() => {
    publishStarted.resolve();
    return publish.promise;
  });
  const service: IUploadService = new UploadService({ add });
  const progress: UploadProgress = {};
  const upload = service.uploadRepository({
    id: ID,
    onProgress: (update) => Object.assign(progress, update),
    repoUrl: REPO_URL,
  });
  const rejection = expect(upload).rejects.toBe(error);

  await publishStarted.promise;
  expect(progress.stage).toBe("publish");
  publish.reject(error);
  await rejection;

  expect(mocks.uploadFileToS3).toHaveBeenCalledTimes(2);
  expect(progress).toEqual({
    fileCount: 2,
    stage: "publish",
    uploadedBytes: 8,
    uploadedCount: 2,
  });
});

test("empty scan still enqueues and progress observer is optional", async () => {
  mocks.getFilePaths.mockResolvedValueOnce([]);
  const service: IUploadService = new UploadService({ add });

  await expect(
    service.uploadRepository({ id: ID, repoUrl: REPO_URL })
  ).resolves.toBeUndefined();

  expect(mocks.uploadFileToS3).not.toHaveBeenCalled();
  expect(add).toHaveBeenCalledExactlyOnceWith(
    "deploy",
    { uploadId: ID },
    { jobId: ID }
  );
});

test("concurrent requests keep progress, failures, and deployment IDs separate", async () => {
  const otherId = "xyz34";
  const error = new Error("Test concurrent upload failure");
  mocks.getFilePaths.mockImplementation(({ directoryPath }) =>
    Promise.resolve([resolve(directoryPath, "file.bin")])
  );
  const firstStarted = Promise.withResolvers<void>();
  const firstUpload = Promise.withResolvers<number>();
  mocks.uploadFileToS3
    .mockImplementationOnce(() => {
      firstStarted.resolve();
      return firstUpload.promise;
    })
    .mockRejectedValueOnce(error);
  const service: IUploadService = new UploadService({ add });
  const firstProgress: UploadProgress = {};
  const secondProgress: UploadProgress = {};

  const firstRequest = service.uploadRepository({
    id: ID,
    onProgress: (update) => Object.assign(firstProgress, update),
    repoUrl: REPO_URL,
  });
  await firstStarted.promise;
  await expect(
    service.uploadRepository({
      id: otherId,
      onProgress: (update) => Object.assign(secondProgress, update),
      repoUrl: REPO_URL,
    })
  ).rejects.toBe(error);
  expect(add).not.toHaveBeenCalled();

  firstUpload.resolve(7);
  await firstRequest;

  expect(add).toHaveBeenCalledExactlyOnceWith(
    "deploy",
    { uploadId: ID },
    { jobId: ID }
  );
  expect(firstProgress).toEqual({
    fileCount: 1,
    stage: "complete",
    uploadedBytes: 7,
    uploadedCount: 1,
  });
  expect(secondProgress).toEqual({
    currentKey: `/output/${otherId}/file.bin`,
    fileCount: 1,
    stage: "upload",
    uploadedBytes: 0,
    uploadedCount: 0,
  });
});

test.each(["success", "failure"] as const)(
  "mock records %s without touching infrastructure",
  async (outcome) => {
    const error = new Error("Test mock upload failure");
    const mock = new MockUploadService(
      outcome === "failure" ? error : undefined
    );
    const service: IUploadService = mock;
    const progress: UploadProgress = {};
    const upload = service.uploadRepository({
      id: ID,
      onProgress: (update) => Object.assign(progress, update),
      repoUrl: REPO_URL,
    });

    if (outcome === "failure") {
      await expect(upload).rejects.toBe(error);
      expect(progress).toEqual({
        stage: "clone",
        uploadedBytes: 0,
        uploadedCount: 0,
      });
    } else {
      await expect(upload).resolves.toBeUndefined();
      expect(progress).toEqual({
        fileCount: 0,
        stage: "complete",
        uploadedBytes: 0,
        uploadedCount: 0,
      });
    }
    expect(mock.calls).toEqual([{ id: ID, repoUrl: REPO_URL }]);
    expect(mocks.clone).not.toHaveBeenCalled();
    expect(mocks.getFilePaths).not.toHaveBeenCalled();
    expect(mocks.uploadFileToS3).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
  }
);
