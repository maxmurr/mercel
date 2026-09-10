import type { Queue } from "bullmq";
import type { IUploadService } from "../services/upload.service.interface.ts";

export const DI_SYMBOLS = {
  IUploadService: Symbol.for("IUploadService"),
  JobQueue: Symbol.for("JobQueue"),
} as const;

export interface DI_RETURN_TYPES {
  IUploadService: IUploadService;
  JobQueue: Pick<Queue<{ uploadId: string }>, "add">;
}
