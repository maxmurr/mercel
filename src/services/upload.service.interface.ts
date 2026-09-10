export interface UploadProgress {
  /** Failed S3 object key; omitted outside upload failures. */
  currentKey?: string;
  /** Number of files found after scanning succeeds. */
  fileCount?: number;
  stage?: "clone" | "scan" | "upload" | "publish" | "complete";
  /** Total bytes from successfully completed uploads, including on failure. */
  uploadedBytes?: number;
  /** Number of successfully completed uploads, including on failure. */
  uploadedCount?: number;
}

export interface UploadRepositoryOptions {
  /** Caller-generated five-character alphanumeric deployment ID. */
  id: string;
  /** Optional synchronous progress observer; must not throw. */
  onProgress?: (progress: UploadProgress) => void;
  /** Repository URL or local Git repository path accepted by Git. */
  repoUrl: string;
}

export interface IUploadService {
  /**
   * Clones and uploads a repository, resolving only after its job is enqueued.
   * Failures reject unchanged; final progress counts include only completed uploads.
   * The caller retains the supplied ID even on failure. Partial uploads are not removed.
   */
  uploadRepository: (options: UploadRepositoryOptions) => Promise<void>;
}
