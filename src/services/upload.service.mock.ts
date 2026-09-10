import type {
  IUploadService,
  UploadRepositoryOptions,
} from "./upload.service.interface.ts";

/** Tests-only upload service that records calls without filesystem or network access. */
export class MockUploadService implements IUploadService {
  readonly calls: Pick<UploadRepositoryOptions, "id" | "repoUrl">[] = [];
  private readonly error: Error | undefined;

  constructor(error?: Error) {
    this.error = error;
  }

  uploadRepository({ id, onProgress, repoUrl }: UploadRepositoryOptions) {
    this.calls.push({ id, repoUrl });
    onProgress?.({ stage: "clone" });

    if (this.error) {
      onProgress?.({ uploadedBytes: 0, uploadedCount: 0 });
      return Promise.reject(this.error);
    }

    onProgress?.({
      fileCount: 0,
      stage: "complete",
      uploadedBytes: 0,
      uploadedCount: 0,
    });
    return Promise.resolve();
  }
}
